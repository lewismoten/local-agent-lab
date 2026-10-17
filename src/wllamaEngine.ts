import type { WllamaConstructor } from './browserEngineTypes';
import { showToast } from './toastStore.ts';
import { type Asset, removeFile, transferAsset, validFile, writeFile } from './prismEngine.ts';
import { engineAssetFiles, engineDirectory, engineRoot, engineSavedBytes, maybeEngineFile, organizeEngineFiles } from './engineFolders.ts';

const cdn = (name: string) => `https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/${name}`;
export const WLLAMA_ASSETS: readonly Asset[] = [
  { name: 'wllama-LICENCE.txt', url: cdn('LICENCE'), bytes: 1071, sha256: '5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720', label: 'Wllama license' },
  { name: 'wllama-3.8.1.mjs', url: cdn('esm/index.min.js'), bytes: 331458, sha256: '834d7be963172248caf13c6f2ae786009b43edfeefc85eeadc20609e8447d118', label: 'Wllama JavaScript' },
  { name: 'wllama-3.8.1.wasm', url: cdn('esm/wasm/wllama.wasm'), bytes: 8763949, sha256: '551f13439366eff11e057b1b91fe46a7fdac29d56d67372d4c5f19a549dfe70c', label: 'Wllama WebAssembly' },
];
const totalBytes = WLLAMA_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
const queueFile = 'wllama-queue.json';
type DownloadState = { status: 'idle' | 'queued' | 'downloading' | 'paused' | 'error'; installed: boolean; bytes: number; total: number; currentAsset: string; error: string; revision: number };
let state: DownloadState = { status: 'idle', installed: false, bytes: 0, total: totalBytes, currentAsset: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let active: Promise<void> | null = null;
const publish = (patch: Partial<DownloadState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getWllamaEngineDownload = () => state;
export const subscribeWllamaEngineDownload = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
async function saveQueue(dir: FileSystemDirectoryHandle, queued: boolean) {
  if (queued) await writeFile(dir, queueFile, JSON.stringify({ queued: true, version: '3.8.1' }));
  else await removeFile(dir, queueFile);
}
async function transfer(folder: FileSystemDirectoryHandle, signal: AbortSignal) {
  await organizeEngineFiles(folder, 'Wllama', WLLAMA_ASSETS, queueFile);
  const dir = await engineDirectory(folder, 'Wllama', true);
  let base = 0;
  for (const asset of WLLAMA_ASSETS) {
    if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
    if (!await validFile(dir, asset)) await transferAsset(dir, asset, base, signal, (bytes, currentAsset) => publish({ bytes, currentAsset }));
    base += asset.bytes;
    publish({ bytes: base });
  }
  await saveQueue(dir, false);
  publish({ status: 'idle', installed: true, bytes: totalBytes, currentAsset: '', error: '', revision: state.revision + 1 });
  showToast('Wllama engine finished downloading.');
}
export const wllamaEngineManager = {
  async discover(folder: FileSystemDirectoryHandle) {
    if (active) return;
    try {
      const installed = (await engineAssetFiles(folder, 'Wllama', WLLAMA_ASSETS, validFile)).every(Boolean);
      const queued = !!await maybeEngineFile(folder, 'Wllama', queueFile);
      publish({ installed, bytes: await engineSavedBytes(folder, 'Wllama', WLLAMA_ASSETS), status: installed ? 'idle' : queued ? 'paused' : 'idle', currentAsset: '', error: '', revision: state.revision + 1 });
    } catch (error) { publish({ status: 'error', error: error instanceof Error ? error.message : String(error) }); }
  },
  async queue(folder: FileSystemDirectoryHandle) {
    if (state.installed || active) return;
    const dir = await engineDirectory(folder, 'Wllama', true);
    await saveQueue(dir, true);
    publish({ status: 'queued', error: '' });
    await this.resume(folder);
  },
  async resume(folder: FileSystemDirectoryHandle) {
    if (active || state.installed) return;
    const taskController = new AbortController();
    controller = taskController;
    publish({ status: 'downloading', error: '' });
    active = (async () => {
      try { await transfer(folder, taskController.signal); }
      catch (error) {
        const paused = taskController.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        publish({ status: paused ? 'paused' : 'error', bytes: await engineSavedBytes(folder, 'Wllama', WLLAMA_ASSETS), error: paused ? '' : message, revision: state.revision + 1 });
        if (!paused) showToast(`Wllama download failed: ${message}`, 'error');
      } finally { controller = null; active = null; }
    })();
    await active;
  },
  pause() { controller?.abort(); },
  async remove(folder: FileSystemDirectoryHandle) {
    controller?.abort();
    await active;
    const root = await engineRoot(folder, true);
    const nested = await engineDirectory(folder, 'Wllama', true);
    for (const dir of [nested, root]) {
      for (const asset of WLLAMA_ASSETS) { await removeFile(dir, asset.name); await removeFile(dir, `${asset.name}.download.json`); }
      await saveQueue(dir, false);
    }
    publish({ status: 'idle', installed: false, bytes: 0, currentAsset: '', error: '', revision: state.revision + 1 });
    showToast('Wllama removed from the project folder.');
  },
};
export async function assertWllamaEngineFiles(folder: FileSystemDirectoryHandle) {
  const files = await engineAssetFiles(folder, 'Wllama', WLLAMA_ASSETS, validFile);
  if (files.some(file => !file)) throw new Error('Download Wllama and its license in Engines before loading this model.');
  return { script: files[1]!, wasm: files[2]! };
}
export async function loadWllamaModule(folder: FileSystemDirectoryHandle): Promise<{ Wllama: WllamaConstructor; wasmUrl: string }> {
  const { script, wasm } = await assertWllamaEngineFiles(folder);
  const scriptUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  try {
    const module = await import(/* @vite-ignore */ scriptUrl) as { Wllama: WllamaConstructor };
    return { Wllama: module.Wllama, wasmUrl };
  } catch (error) { URL.revokeObjectURL(wasmUrl); throw error; }
  finally { URL.revokeObjectURL(scriptUrl); }
}
