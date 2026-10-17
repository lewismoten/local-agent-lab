import { sha256 } from '@noble/hashes/sha2.js';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { showToast } from './toastStore.ts';

type Asset = { name: string; url: string; bytes: number; sha256: string; label: string };
type Group = 'engine' | 'model';
export const BROWSER_IMAGE_MODEL_PATH = 'models/SD-1.5-ONNX';
const scribbler = '0b8f3a87099ae6c1154e987acb826f08add840d8';
const sd15 = 'd7c229b23e94f49b4a74c279ba17ff1afb367c31';
const script = (name: string) => `https://raw.githubusercontent.com/gopi-suvanam/scribbler-webnn/${scribbler}/${name}`;
const ort = (name: string) => `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/${name}`;
const model = (name: string) => `https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn/resolve/${sd15}/${name}`;
export const BROWSER_IMAGE_ENGINE_ASSETS: readonly Asset[] = [
  { name: 'SCRIBBLER-LICENSE.txt', url: script('LICENSE'), bytes: 1077, sha256: '74c78af1c0606f4ff080fa28b999ed24949f9ec787bd9d839a780f7d1491a887', label: 'Scribbler license' },
  { name: 'ONNX-LICENSE.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE', bytes: 1073, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c', label: 'ONNX Runtime license' },
  { name: 'sd.js', url: script('sd.js'), bytes: 31440, sha256: '4ff8904bfe01d53366050fd9b218542a2db87d3588861409a453a2537e61a905', label: 'Diffusion pipeline' },
  { name: 'ort.webgpu.min.js', url: ort('ort.webgpu.min.js'), bytes: 357648, sha256: '4dec2f5e74de2ec0f496d39ef55ec23762e8c6ca58cb958e691c9f2350a7b1c8', label: 'ONNX WebGPU JavaScript' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', url: ort('ort-wasm-simd-threaded.jsep.mjs'), bytes: 44677, sha256: '1cbcba8f2c769c1eecbab66a1b1e55ef11704515bf4306373e3db3c37cf6dcd8', label: 'ONNX WebAssembly loader' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', url: ort('ort-wasm-simd-threaded.jsep.wasm'), bytes: 21872216, sha256: 'b45970d0632383a057c27ca5b660b216f8e00c17cf8db9f6207b5e4abc839368', label: 'ONNX WebAssembly' },
];
export const BROWSER_IMAGE_MODEL_ASSETS: readonly Asset[] = [
  { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/CompVis/stable-diffusion/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229/LICENSE', bytes: 14385, sha256: 'be351ebe7ac01bcdbb018639aadcfd38f136b7dc3f2a3d4d3a24db51d1b210ef', label: 'CreativeML Open RAIL-M license' },
  { name: 'tokenizer.json', url: script('tokenizers/sd-1.5/tokenizer.json'), bytes: 2222656, sha256: '5e20ee7c61075a30c2118896987fe13d8b0f8f30a36ba0fbdb0754959c8d0bb4', label: 'CLIP tokenizer' },
  { name: 'text-encoder.onnx', url: model('text-encoder.onnx'), bytes: 246417740, sha256: '6e4d5bea3433a9455f2c7facf358477f4aea6509cb10500b9ed9def643c81579', label: 'SD 1.5 text encoder' },
  { name: 'sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx', url: model('sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx'), bytes: 1719405068, sha256: 'd680d78f36f5722c0205258337e91c41e0d552d17f812cffbe4f3fb138de3c82', label: 'SD 1.5 UNet' },
  { name: 'Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx', url: model('Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx'), bytes: 99124333, sha256: 'b25ae0f7ae9877104fe9bf6e9ca53a0b07562de741c4cd86f16e5205d56b3b6f', label: 'SD 1.5 VAE decoder' },
];
const assets = (group: Group) => group === 'engine' ? BROWSER_IMAGE_ENGINE_ASSETS : BROWSER_IMAGE_MODEL_ASSETS;
export const browserImageTotal = (group: Group) => assets(group).reduce((sum, item) => sum + item.bytes, 0);
export async function browserImageDirectory(folder: FileSystemDirectoryHandle, group: Group, create = false) {
  const parent = await folder.getDirectoryHandle(group === 'engine' ? 'engines' : 'models', { create });
  return parent.getDirectoryHandle(group === 'engine' ? 'ONNX-Image' : 'SD-1.5-ONNX', { create });
}
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
async function maybeFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch (error) { if (missing(error)) return null; throw error; }
}
async function digest(file: Blob, onProgress?: (bytes: number) => void) {
  const hash = sha256.create();
  const step = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += step) {
    hash.update(new Uint8Array(await file.slice(offset, Math.min(file.size, offset + step)).arrayBuffer()));
    onProgress?.(Math.min(file.size, offset + step));
  }
  return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verified(dir: FileSystemDirectoryHandle, asset: Asset) {
  const file = await maybeFile(dir, asset.name);
  if (!file || file.size !== asset.bytes) return null;
  // Large assets get a verified sidecar at download time; avoid re-hashing 2 GB on every page visit.
  if (asset.bytes > 64 * 1024 * 1024) {
    const proof = await maybeFile(dir, `${asset.name}.verified.json`);
    if (proof) {
      try {
        const record = JSON.parse(await proof.text()) as { sha256: string; size: number; lastModified: number };
        if (record.sha256 === asset.sha256 && record.size === file.size && record.lastModified === file.lastModified) return file;
      } catch { /* Rehash after a damaged sidecar. */ }
    }
  }
  if (await digest(file) !== asset.sha256) return null;
  if (asset.bytes > 64 * 1024 * 1024) await writeText(dir, `${asset.name}.verified.json`, JSON.stringify({ sha256: asset.sha256, size: file.size, lastModified: file.lastModified })).catch(() => {});
  return file;
}
async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(text); await writer.close();
}
async function saved(dir: FileSystemDirectoryHandle, group: Group) {
  let total = 0;
  for (const asset of assets(group)) total += Math.min(asset.bytes, (await maybeFile(dir, asset.name))?.size || 0);
  return total;
}
type State = { folder: FileSystemDirectoryHandle | null; active: Group | null; queue: Group[]; paused: boolean; installed: Record<Group, boolean>; saved: Record<Group, number>; current: string; error: string; revision: number };
let state: State = { folder: null, active: null, queue: [], paused: false, installed: { engine: false, model: false }, saved: { engine: 0, model: 0 }, current: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getBrowserImageAssets = () => state;
export const subscribeBrowserImageAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let controller: AbortController | null = null;
let task: Promise<void> | null = null;
async function waitForSpeed(bytes: number, signal: AbortSignal) {
  let remaining = bytes;
  while (remaining > 0) {
    if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
    const speed = modelDownloadManager.getSnapshot().speedLimit;
    if (!speed) return;
    const duration = Math.min(100, remaining / (speed * 1048576) * 1000);
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, duration);
      const abort = () => { clearTimeout(timer); reject(new DOMException('Download paused', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
    });
    remaining -= (performance.now() - start) * speed * 1048576 / 1000;
  }
}
export async function transferBrowserImageAsset(dir: FileSystemDirectoryHandle, group: Group, asset: Asset, signal: AbortSignal, base: number) {
  if (await verified(dir, asset)) return;
  const prior = await maybeFile(dir, asset.name);
  const recordName = `${asset.name}.download.json`;
  const record = await maybeFile(dir, recordName);
  // Only the pinned Hugging Face model files have a reliable byte-range response.
  // CDN range responses for ONNX assets can describe a compressed representation
  // while a full GET serves the uncompressed file pinned below.
  const resumable = asset.url.startsWith('https://huggingface.co/');
  if (record && resumable) {
    try {
      const priorRecord = JSON.parse(await record.text()) as { url: string; bytes: number; sha256: string };
      if (priorRecord.url !== asset.url || priorRecord.bytes !== asset.bytes || priorRecord.sha256 !== asset.sha256) throw new Error('different');
    } catch { throw new Error(`${asset.label} has a partial download from another version. Keep it aside before downloading this version.`); }
  }
  let offset = resumable && prior && record && prior.size < asset.bytes ? prior.size : 0;
  // Request an explicit range for large files, even from zero. Hugging Face's Xet
  // bridge can reject an unbounded multi-gigabyte response while serving HTTP 206.
  const response = await fetch(asset.url, resumable ? { headers: { Range: `bytes=${offset}-` }, signal } : { signal });
  if (!response.ok || !response.body) throw new Error(`${asset.label} could not be downloaded (${response.status}).`);
  if (response.status === 206) {
    const range = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== asset.bytes) throw new Error(`${asset.label} could not resume safely.`);
  } else if (response.status === 200) offset = 0;
  else throw new Error(`${asset.label} returned an unexpected range.`);
  await writeText(dir, recordName, JSON.stringify({ url: asset.url, bytes: asset.bytes, sha256: asset.sha256 }));
  const handle = await dir.getFileHandle(asset.name, { create: true });
  const reader = response.body.getReader();
  let writer: FileSystemWritableFileStream | null = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset) await writer.seek(offset);
  let count = offset;
  let checkpoint = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
      if (count + value.byteLength > asset.bytes) throw new Error(`${asset.label} exceeded its pinned size.`);
      await writer.write(value); count += value.byteLength; checkpoint += value.byteLength;
      publish({ saved: { ...state.saved, [group]: base + count }, current: asset.label });
      await waitForSpeed(value.byteLength, signal);
      if (checkpoint >= 32 * 1024 * 1024) {
        await writer.close(); writer = null;
        writer = await handle.createWritable({ keepExistingData: true }); await writer.seek(count);
        checkpoint = 0;
      }
    }
    await writer?.close(); writer = null;
    if (count !== asset.bytes) throw new Error(`${asset.label} ended early. Resume the saved portion.`);
    publish({ current: `Verifying ${asset.label}` });
    if (!await verified(dir, asset)) throw new Error(`${asset.label} failed its integrity check.`);
    await dir.removeEntry(recordName).catch(() => {});
  } finally { await writer?.close().catch(() => {}); await reader.cancel().catch(() => {}); }
}
function startNext(folder: FileSystemDirectoryHandle) {
  if (task || state.paused || state.folder !== folder || !state.queue.length) return;
  const [group, ...queue] = state.queue;
  const aborter = new AbortController(); controller = aborter;
  publish({ active: group, queue, current: '', error: '' });
  task = (async () => {
    try {
      const dir = await browserImageDirectory(folder, group, true);
      let base = 0;
      for (const asset of assets(group)) {
        if (aborter.signal.aborted) throw new DOMException('Download paused', 'AbortError');
        await transferBrowserImageAsset(dir, group, asset, aborter.signal, base);
        base += asset.bytes;
        publish({ saved: { ...state.saved, [group]: base } });
      }
      if (group === 'model') await writeText(dir, 'SOURCE.txt', `Stable Diffusion 1.5 ONNX\n${model('text-encoder.onnx')}\nLicense: CreativeML Open RAIL-M\n`);
      publish({ installed: { ...state.installed, [group]: true }, active: null, current: '', revision: state.revision + 1 });
      showToast(`${group === 'engine' ? 'ONNX image engine' : 'Stable Diffusion 1.5'} finished downloading.`);
    } catch (error) {
      const paused = aborter.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      let committed = state.saved[group];
      try { committed = await saved(await browserImageDirectory(folder, group), group); } catch { /* Keep the last displayed count if folder access was revoked. */ }
      publish({ active: null, queue: [group, ...state.queue], paused: true, saved: { ...state.saved, [group]: committed }, error: paused ? '' : message, revision: state.revision + 1 });
      if (!paused) showToast(`Image download failed: ${message}`, 'error');
    } finally { controller = null; task = null; startNext(folder); }
  })();
}
export const browserImageAssetsManager = {
  async discover(folder: FileSystemDirectoryHandle) {
    if (task) return;
    const installed = { engine: false, model: false };
    const progress = { engine: 0, model: 0 };
    for (const group of ['engine', 'model'] as const) {
      try {
        const dir = await browserImageDirectory(folder, group);
        progress[group] = await saved(dir, group);
        installed[group] = (await Promise.all(assets(group).map(asset => verified(dir, asset)))).every(Boolean);
      } catch (error) { if (!missing(error)) throw error; }
    }
    publish({ folder, installed, saved: progress, paused: (progress.engine > 0 && !installed.engine) || (progress.model > 0 && !installed.model), revision: state.revision + 1 });
  },
  queue(folder: FileSystemDirectoryHandle, group: Group) {
    if (state.folder && state.folder !== folder && task) throw new Error('An image download is active in another workspace.');
    if (state.folder === folder && (state.installed[group] || state.active === group || state.queue.includes(group))) return;
    publish({ folder, queue: [...(state.folder === folder ? state.queue : []), group], paused: state.folder === folder && state.paused });
    startNext(folder);
  },
  pause() { publish({ paused: true }); controller?.abort(); },
  resume(folder: FileSystemDirectoryHandle) { if (state.folder !== folder) return; publish({ paused: false, error: '' }); startNext(folder); },
};
export async function assertBrowserImageFiles(folder: FileSystemDirectoryHandle) {
  const engine = await browserImageDirectory(folder, 'engine');
  const modelDir = await browserImageDirectory(folder, 'model');
  const engineFiles = await Promise.all(BROWSER_IMAGE_ENGINE_ASSETS.map(asset => verified(engine, asset)));
  const modelFiles = await Promise.all(BROWSER_IMAGE_MODEL_ASSETS.map(asset => verified(modelDir, asset)));
  if (engineFiles.some(file => !file) || modelFiles.some(file => !file)) throw new Error('Download the ONNX image engine in Engines and Stable Diffusion 1.5 in Catalog first.');
  return { engineFiles: engineFiles as File[], modelFiles: modelFiles as File[] };
}
