import { showToast } from './toastStore.ts';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { engineAssetFiles, engineDirectory, engineRoot, engineSavedBytes, maybeEngineFile, organizeEngineFiles } from './engineFolders.ts';

const PRISM_COMMIT = 'dd85c7b5d686fc6d2acc8fba005960e4bb6b5346';
const prismUrl = (name: string) => `https://raw.githubusercontent.com/PrismML-Eng/Talk/${PRISM_COMMIT}/${name}`;
const compilerUrl = (name: string) => `https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/${name}`;
export const PRISM_ENGINE_FILE = 'prism-bonsai-kernels.ts';
export const PRISM_ENGINE_PATH = `engines/PrismML/${PRISM_ENGINE_FILE}`;
export type Asset = { name: string; url: string; bytes: number; sha256: string; label: string };
// These files are downloaded only when requested; none is shipped in the site.
export const PRISM_ASSETS: readonly Asset[] = [
  { name: 'prism-bonsai-LICENSE.txt', url: prismUrl('LICENSE'), bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', label: 'PrismML license' },
  { name: 'prism-bonsai-NOTICE.txt', url: prismUrl('NOTICE'), bytes: 22565, sha256: '3f4d9acea945b865727c6218bee484fedf4f56b4ae1bbdac6e8ec1ed70483385', label: 'PrismML notice' },
  { name: 'esbuild-LICENSE.md', url: compilerUrl('LICENSE.md'), bytes: 1069, sha256: 'b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681', label: 'Compiler license' },
  { name: 'esbuild-browser.mjs', url: compilerUrl('esm/browser.min.js'), bytes: 52913, sha256: '0d8890748ceca85752d40d62753c6c3517c9ffa3ae369b20485246ac9403b805', label: 'Browser compiler' },
  { name: 'esbuild.wasm', url: compilerUrl('esbuild.wasm'), bytes: 13978850, sha256: 'b1831a5c0f6cf688034fb94d0419812f165ea316a3380d3fc00a151e562d2eaf', label: 'Compiler WebAssembly' },
  { name: PRISM_ENGINE_FILE, url: prismUrl('kernels.ts'), bytes: 3162601, sha256: 'a773676ae581975985d28813e7a28249d47c035b5ff5b7f5dc66e450c525b899', label: 'PrismML engine source' },
];
const totalBytes = PRISM_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
const queueFile = 'prism-bonsai-queue.json';
type EngineState = { status: 'idle' | 'checking' | 'queued' | 'downloading' | 'paused' | 'error'; folder: FileSystemDirectoryHandle | null; installed: boolean; bytes: number; total: number; currentAsset: string; error: string; revision: number };
let state: EngineState = { status: 'idle', folder: null, installed: false, bytes: 0, total: totalBytes, currentAsset: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let active: Promise<void> | null = null;
let discoveryId = 0;
const publish = (patch: Partial<EngineState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getPrismEngineDownload = () => state;
export const subscribePrismEngineDownload = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
export async function maybeFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch (error) { if (missing(error)) return null; throw error; }
}
async function hash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(data); await writer.close();
}
export async function removeFile(dir: FileSystemDirectoryHandle, name: string) {
  try { await dir.removeEntry(name); } catch (error) { if (!missing(error)) throw error; }
}
export async function validFile(dir: FileSystemDirectoryHandle, asset: Asset): Promise<File | null> {
  const file = await maybeFile(dir, asset.name);
  return file?.size === asset.bytes && await hash(file) === asset.sha256 ? file : null;
}
export async function savedBytes(dir: FileSystemDirectoryHandle, assets: readonly Asset[] = PRISM_ASSETS) {
  let bytes = 0;
  for (const asset of assets) bytes += Math.min((await maybeFile(dir, asset.name))?.size || 0, asset.bytes);
  return bytes;
}
async function saveQueue(dir: FileSystemDirectoryHandle, queued: boolean) {
  if (queued) await writeFile(dir, queueFile, JSON.stringify({ queued: true, version: PRISM_COMMIT }));
  else await removeFile(dir, queueFile);
}
async function throttle(bytes: number, signal: AbortSignal) {
  let remaining = bytes;
  while (remaining > 0) {
    if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
    const speed = modelDownloadManager.getSnapshot().speedLimit;
    if (!speed) return;
    const duration = Math.min(100, remaining / (speed * 1048576) * 1000);
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, duration);
      const abort = () => { clearTimeout(timer); reject(new DOMException('Download paused', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
    });
    remaining -= (performance.now() - started) * speed * 1048576 / 1000;
  }
}
class AssetIntegrityError extends Error {}
async function transferAssetAttempt(dir: FileSystemDirectoryHandle, asset: Asset, baseBytes: number, signal: AbortSignal, onProgress: (bytes: number, label: string) => void, resume: boolean) {
  const recordName = `${asset.name}.download.json`;
  const record = await maybeFile(dir, recordName);
  const existing = await maybeFile(dir, asset.name);
  let bytes = resume && record && existing && existing.size < asset.bytes ? existing.size : 0;
  let response = await fetch(asset.url, { headers: bytes ? { Range: `bytes=${bytes}-` } : {}, signal });
  if (!response.ok || !response.body) throw new Error(`Could not download ${asset.label} (${response.status}).`);
  if (bytes && response.status === 206) {
    const range = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (range && Number(range[1]) === bytes && Number(range[3]) === asset.bytes) {
      // This response follows the saved portion.
    } else if (range && Number(range[3]) !== asset.bytes) {
      await response.body.cancel();
      throw new Error(`${asset.label} changed upstream. The pinned download was not used.`);
    } else {
      // If Content-Range is hidden by CORS or malformed, restart safely.
      await response.body.cancel();
      response = await fetch(asset.url, { signal });
      bytes = 0;
    }
  } else if (bytes && response.status === 200) bytes = 0;
  if ((response.status !== 200 && !(bytes && response.status === 206)) || !response.body) {
    await response.body?.cancel();
    throw new Error(`${asset.label} did not provide a safe download response (${response.status}).`);
  }
  await writeFile(dir, recordName, JSON.stringify({ url: asset.url, total: asset.bytes, sha256: asset.sha256 }));
  const handle = await dir.getFileHandle(asset.name, { create: true });
  const reader = response.body.getReader();
  let writer: FileSystemWritableFileStream | null = await handle.createWritable({ keepExistingData: bytes > 0 });
  if (bytes) await writer.seek(bytes);
  onProgress(baseBytes + bytes, asset.label);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
      if (bytes + value.byteLength > asset.bytes) throw new Error(`${asset.label} exceeded its pinned size.`);
      await writer.write(value);
      bytes += value.byteLength;
      onProgress(baseBytes + bytes, asset.label);
      await writer.close(); writer = null; // Commit each part for resume on another machine.
      await throttle(value.byteLength, signal);
      writer = await handle.createWritable({ keepExistingData: true });
      await writer.seek(bytes);
    }
    await writer?.close(); writer = null;
    if (bytes < asset.bytes) throw new Error(`${asset.label} download stopped early. Resume the saved portion.`);
    if (!await validFile(dir, asset)) throw new AssetIntegrityError(`${asset.label} failed its integrity check.`);
    // The verified file is usable even when a drive denies deletion of this
    // optional resume record. A later download checks the file first.
    await removeFile(dir, recordName).catch(() => {});
  } catch (error) {
    await writer?.close().catch(() => {});
    throw error;
  } finally { await reader.cancel().catch(() => {}); }
}
export async function transferAsset(dir: FileSystemDirectoryHandle, asset: Asset, baseBytes: number, signal: AbortSignal, onProgress: (bytes: number, label: string) => void = () => {}) {
  if (await validFile(dir, asset)) return;
  try { await transferAssetAttempt(dir, asset, baseBytes, signal, onProgress, true); }
  catch (error) {
    if (!(error instanceof AssetIntegrityError) || signal.aborted) throw error;
    // A resumed prefix can be corrupt even if its length is correct. Overwrite
    // from byte zero once; no removeEntry permission is required.
    try { await transferAssetAttempt(dir, asset, baseBytes, signal, onProgress, false); }
    catch (retryError) {
      if (retryError instanceof AssetIntegrityError) throw new Error(`${asset.label} still failed its integrity check after a clean retry. Check the workspace drive or connection.`, { cause: retryError });
      throw retryError;
    }
  }
}
async function transfer(folder: FileSystemDirectoryHandle, signal: AbortSignal) {
  await organizeEngineFiles(folder, 'PrismML', PRISM_ASSETS, queueFile);
  const dir = await engineDirectory(folder, 'PrismML', true);
  let baseBytes = 0;
  for (const asset of PRISM_ASSETS) {
    if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
    if (!await validFile(dir, asset)) await transferAsset(dir, asset, baseBytes, signal, (bytes, currentAsset) => publish({ bytes, currentAsset }));
    baseBytes += asset.bytes;
    publish({ bytes: baseBytes });
  }
  await saveQueue(dir, false);
  publish({ installed: true, status: 'idle', bytes: totalBytes, currentAsset: '', error: '', revision: state.revision + 1 });
  showToast('PrismML source and browser compiler finished downloading.');
}
export const prismEngineManager = {
  async discover(folder: FileSystemDirectoryHandle) {
    if (active) await active;
    const id = ++discoveryId;
    publish({ folder, installed: false, status: 'checking', error: '' });
    try {
      const installed = (await engineAssetFiles(folder, 'PrismML', PRISM_ASSETS, validFile)).every(Boolean);
      if (id !== discoveryId || active) return;
      const queued = !!await maybeEngineFile(folder, 'PrismML', queueFile);
      const bytes = await engineSavedBytes(folder, 'PrismML', PRISM_ASSETS);
      if (id !== discoveryId || active) return;
      publish({ installed, bytes, total: totalBytes, status: installed ? 'idle' : queued ? 'paused' : 'idle', currentAsset: '', error: '', revision: state.revision + 1 });
    } catch (error) {
      if (id !== discoveryId) return;
      if (missing(error)) publish({ installed: false, bytes: 0, status: 'idle', error: '', revision: state.revision + 1 });
      else publish({ installed: false, error: error instanceof Error ? error.message : String(error), status: 'error' });
    }
  },
  async queue(folder: FileSystemDirectoryHandle, waitForCompletion = true) {
    if (state.folder === folder && state.installed || active) return;
    const dir = await engineDirectory(folder, 'PrismML', true);
    await saveQueue(dir, true);
    publish({ folder, installed: false, status: 'queued', error: '' });
    const completion = this.resume(folder);
    if (waitForCompletion) await completion;
    else void completion.catch(error => showToast(`Engine download failed: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  },
  async resume(folder: FileSystemDirectoryHandle) {
    if (active || state.folder === folder && state.installed) return;
    discoveryId++;
    const controllerForTask = new AbortController();
    controller = controllerForTask;
    publish({ folder, status: 'downloading', error: '' });
    active = (async () => {
      try { await transfer(folder, controllerForTask.signal); }
      catch (error) {
        const paused = controllerForTask.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        publish({ status: paused ? 'paused' : 'error', bytes: await engineSavedBytes(folder, 'PrismML', PRISM_ASSETS), error: paused ? '' : message, revision: state.revision + 1 });
        if (!paused) showToast(`Engine download failed: ${message}`, 'error');
      } finally { active = null; controller = null; }
    })();
    await active;
  },
  pause() { controller?.abort(); },
  async pauseAndWait() { this.pause(); await active; },
  resetWorkspace() { discoveryId++; publish({ folder: null, status: 'idle', installed: false, bytes: 0, currentAsset: '', error: '', revision: state.revision + 1 }); },
  async remove(folder: FileSystemDirectoryHandle) {
    discoveryId++;
    controller?.abort();
    await active;
    const root = await engineRoot(folder, true);
    const nested = await engineDirectory(folder, 'PrismML', true);
    for (const dir of [nested, root]) {
      for (const asset of PRISM_ASSETS) { await removeFile(dir, asset.name); await removeFile(dir, `${asset.name}.download.json`); }
      await saveQueue(dir, false);
    }
    publish({ folder, status: 'idle', installed: false, bytes: 0, currentAsset: '', error: '', revision: state.revision + 1 });
    showToast('PrismML source and compiler removed from the project folder.');
  },
};

export async function assertPrismEngineFiles(folder: FileSystemDirectoryHandle): Promise<File> {
  const files = await engineAssetFiles(folder, 'PrismML', PRISM_ASSETS, validFile);
  const source = files[5];
  if (!source || files.some(file => !file)) throw new Error('Download the complete PrismML engine and its license files in Engines first.');
  return source;
}
export async function loadPrismModule(folder: FileSystemDirectoryHandle, onProgress: (message: string) => void = () => {}): Promise<{ Bonsai: { load: (options: Record<string, unknown>) => Promise<unknown> } }> {
  const source = await assertPrismEngineFiles(folder);
  if (!('gpu' in navigator)) throw new Error('This browser does not offer WebGPU. Try a WebGPU-enabled browser or use the local-server profile.');
  const files = await engineAssetFiles(folder, 'PrismML', PRISM_ASSETS.slice(2, 5), validFile);
  const compilerFile = files[1];
  const wasmFile = files[2];
  if (!compilerFile || !wasmFile || !files[0]) throw new Error('Download the browser compiler and its license in Engines first.');
  const compilerBlobUrl = URL.createObjectURL(new Blob([compilerFile], { type: 'text/javascript' }));
  let esbuild: { initialize: (options: Record<string, unknown>) => Promise<void>; transform: (source: string, options: Record<string, unknown>) => Promise<{ code: string }>; stop: () => void };
  try { esbuild = await import(/* @vite-ignore */ compilerBlobUrl); }
  finally { URL.revokeObjectURL(compilerBlobUrl); }
  try {
    onProgress('Starting the browser compiler…');
    await esbuild.initialize({ wasmModule: await WebAssembly.compile(await wasmFile.arrayBuffer()), worker: true });
    onProgress('Compiling the saved PrismML source…');
    const result = await esbuild.transform(await source.text(), { loader: 'ts', format: 'esm', target: 'es2022', minify: true, sourcefile: PRISM_ENGINE_FILE });
    const moduleBlobUrl = URL.createObjectURL(new Blob([result.code], { type: 'text/javascript' }));
    try { return await import(/* @vite-ignore */ moduleBlobUrl); }
    finally { URL.revokeObjectURL(moduleBlobUrl); }
  } finally { esbuild.stop(); }
}
