import { showToast } from './toastStore.ts';
import { type Asset, maybeFile, removeFile, savedBytes, transferAsset, validFile, writeFile } from './prismEngine.ts';
import { engineAssetFiles, engineDirectory, engineRoot, engineSavedBytes, organizeEngineFiles } from './engineFolders.ts';

const npm = (name: string) => `https://cdn.jsdelivr.net/npm/needle-rs@0.3.1/${name}`;
const original = (name: string) => `https://huggingface.co/Abdalrahman/needle-rs-safetensors/resolve/658f8c6f80a28ed759961c8b70f34c0d5cb40fe1/${name}`;
const second = (name: string) => `https://huggingface.co/Cactus-Compute/needle2/resolve/32e9e3a93b205f786929697446ae669cf0a84579/${name}`;
const third = (name: string) => `https://huggingface.co/Cactus-Compute/needle3/resolve/93e88ede867e4311c39151285e74df513e4b835b/${name}`;
export type NeedleVersion = 'needle' | 'needle2' | 'needle3';
export const NEEDLE_LABELS: Record<NeedleVersion, string> = { needle: 'Needle', needle2: 'Needle 2', needle3: 'Needle 3' };
export const NEEDLE_CONTEXT_TOKENS: Record<NeedleVersion, number> = { needle: 1024, needle2: 2048, needle3: 8192 };
export const NEEDLE_MODEL_DIRS: Record<NeedleVersion, string> = { needle: 'Needle-1', needle2: 'Needle-2', needle3: 'Needle-3' };
export const NEEDLE_LEGACY_MODEL_PATHS: Record<NeedleVersion, string> = { needle: 'models/needle.safetensors', needle2: 'models/needle2.cact', needle3: 'models/needle3.cact' };
export const NEEDLE_MODEL_PATHS: Record<NeedleVersion, string> = { needle: 'models/Needle-1/needle.safetensors', needle2: 'models/Needle-2/needle2.cact', needle3: 'models/Needle-3/needle3.cact' };
export const NEEDLE_ENGINE_ASSETS: readonly Asset[] = [
  { name: 'needle-rs-LICENSE.txt', url: npm('LICENSE'), bytes: 1403, sha256: '831c057440d79f85a28362fd6765ccba24346e28343f1cecdb7eda7d1b479863', label: 'Needle engine license' },
  { name: 'needle-rs-NOTICE.txt', url: npm('NOTICE'), bytes: 2283, sha256: 'dffcff4a05adbcc8077e06893a547c789aa50f667398fce20c62de197277dba7', label: 'Needle engine notice' },
  { name: 'needle-rs-0.3.1.mjs', url: npm('needle_wasm.js'), bytes: 41423, sha256: 'b934a9c79288cc50208f811658780c055cf19479b93b54dfd7df87407de84b9c', label: 'Needle browser JavaScript' },
  { name: 'needle-rs-0.3.1.wasm', url: npm('needle_wasm_bg.wasm'), bytes: 573654, sha256: 'dd19c08185c4340fb576b5cc53b68fd7a0cd140bf2cd322a5aa5b5b25ddb16aa', label: 'Needle WebAssembly' },
];
export const NEEDLE_MODEL_ASSETS: Record<NeedleVersion, readonly Asset[]> = {
  needle: [
    { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/cactus-compute/needle/1807b1d230ba/LICENSE', bytes: 1071, sha256: '40150e30169beeb87130c9f66ad56302432788d931eec1e4ce80875d838df855', label: 'Needle license' },
    { name: 'needle.safetensors', url: original('needle.safetensors'), bytes: 22259039, sha256: '87bbc354a99d26bf3763a845fbaf7118bd1e42aa9f675f1422fb79cde5ae0f4d', label: 'Needle weights' },
    { name: 'vocab.txt', url: original('vocab.txt'), bytes: 122132, sha256: '37643f32cb6ee4c636be3098a044c32d652d902553bf84e734bfdd56fb34b43b', label: 'Needle vocabulary' },
  ],
  needle2: [
    { name: 'LICENSE.txt', url: second('LICENSE'), bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', label: 'Needle 2 license' },
    { name: 'needle2.cact', url: second('needle2.cact'), bytes: 13737807, sha256: 'b43aabfcaf1a6db6acf488076eab71d823c08697c7af4521fc1d174b60ede5ba', label: 'Needle 2 weights' },
  ],
  needle3: [
    { name: 'LICENSE.txt', url: third('LICENSE'), bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', label: 'Needle 3 license' },
    { name: 'needle3.cact', url: third('needle3.cact'), bytes: 35335380, sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38', label: 'Needle 3 weights' },
  ],
};
type NeedleAssetGroup = 'engine' | NeedleVersion;
type NeedleAssetState = { folder: FileSystemDirectoryHandle | null; active: NeedleAssetGroup | null; queue: NeedleAssetGroup[]; queuePaused: boolean; errorGroup: NeedleAssetGroup | null; status: 'idle' | 'downloading' | 'paused' | 'error'; installed: Record<NeedleAssetGroup, boolean>; checked: Record<NeedleAssetGroup, boolean>; present: Record<NeedleVersion, boolean>; verification: Record<NeedleAssetGroup, string>; saved: Record<NeedleAssetGroup, number>; currentBytes: number; totalBytes: number; currentAsset: string; error: string; revision: number };
const groups: NeedleAssetGroup[] = ['engine', 'needle', 'needle2', 'needle3'];
const assets = (group: NeedleAssetGroup) => group === 'engine' ? NEEDLE_ENGINE_ASSETS : NEEDLE_MODEL_ASSETS[group];
const legacyName = (version: NeedleVersion, name: string) => name === 'LICENSE.txt' ? `${NEEDLE_LEGACY_MODEL_PATHS[version].split('/').pop()}.LICENSE.txt` : name === 'vocab.txt' ? 'needle-vocab.txt' : name;
const legacyAsset = (version: NeedleVersion, asset: Asset): Asset => ({ ...asset, name: legacyName(version, asset.name) });
const sourceText = (version: NeedleVersion) => `${NEEDLE_LABELS[version]}\nWeights: ${NEEDLE_MODEL_ASSETS[version][1].url}\nLicense: ${NEEDLE_MODEL_ASSETS[version][0].url}\nBrowser engine: https://github.com/geekgineer/needle-rs\n`;
async function modelDirectory(folder: FileSystemDirectoryHandle, version: NeedleVersion, create = false) {
  const models = await folder.getDirectoryHandle('models', { create });
  return models.getDirectoryHandle(NEEDLE_MODEL_DIRS[version], { create });
}
async function modelFiles(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  let nested: FileSystemDirectoryHandle | null = null;
  try { nested = await modelDirectory(folder, version); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  const assets = NEEDLE_MODEL_ASSETS[version];
  const nestedFiles = nested ? await Promise.all(assets.map(asset => validFile(nested!, asset))) : [];
  if (nestedFiles.length && nestedFiles.every(Boolean)) return { files: nestedFiles as File[], present: true, saved: await savedBytes(nested!, assets), legacy: false };
  let root: FileSystemDirectoryHandle | null = null;
  try { root = await folder.getDirectoryHandle('models'); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  const legacyAssets = assets.map(asset => legacyAsset(version, asset));
  const legacyFiles = root ? await Promise.all(legacyAssets.map(asset => validFile(root!, asset))) : [];
  const present = !!(nested && await maybeFile(nested, assets[1].name) || root && await maybeFile(root, legacyAssets[1].name));
  const nestedSaved = nested ? await savedBytes(nested, assets) : 0;
  const legacySaved = root ? await savedBytes(root, legacyAssets) : 0;
  const inspect = nestedSaved >= legacySaved && nested ? { dir: nested, listed: assets, checked: nestedFiles } : root ? { dir: root, listed: legacyAssets, checked: legacyFiles } : null;
  const invalid = inspect ? inspect.listed.flatMap((asset, index) => inspect.checked[index] ? [] : [asset.label]) : [];
  return { files: legacyFiles.length && legacyFiles.every(Boolean) ? legacyFiles as File[] : null, present, saved: Math.max(nestedSaved, legacySaved), legacy: true, invalid };
}
async function copyFile(source: File, target: FileSystemDirectoryHandle, name: string) {
  const writer = await (await target.getFileHandle(name, { create: true })).createWritable();
  try { await source.stream().pipeTo(writer); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
async function organizeLegacyModel(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  const found = await modelFiles(folder, version);
  if (!found.files || !found.legacy) return false;
  const target = await modelDirectory(folder, version, true);
  const assets = NEEDLE_MODEL_ASSETS[version];
  for (const [index, asset] of assets.entries()) if (!await validFile(target, asset)) await copyFile(found.files[index], target, asset.name);
  for (const asset of assets) if (!await validFile(target, asset)) throw new Error(`${NEEDLE_LABELS[version]} could not be verified after organizing.`);
  await writeFile(target, 'SOURCE.txt', sourceText(version));
  const root = await folder.getDirectoryHandle('models');
  for (const asset of assets) await removeFile(root, legacyName(version, asset.name)).catch(() => {});
  return true;
}
async function stageLegacyAssets(folder: FileSystemDirectoryHandle, version: NeedleVersion, target: FileSystemDirectoryHandle) {
  let root: FileSystemDirectoryHandle;
  try { root = await folder.getDirectoryHandle('models'); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return; throw error; }
  for (const asset of NEEDLE_MODEL_ASSETS[version]) {
    if (await validFile(target, asset)) continue;
    const legacy = await validFile(root, legacyAsset(version, asset));
    if (legacy) await copyFile(legacy, target, asset.name);
  }
}
const emptyChecked = () => ({ engine: false, needle: false, needle2: false, needle3: false });
let state: NeedleAssetState = { folder: null, active: null, queue: [], queuePaused: false, errorGroup: null, status: 'idle', installed: { engine: false, needle: false, needle2: false, needle3: false }, checked: emptyChecked(), present: { needle: false, needle2: false, needle3: false }, verification: { engine: '', needle: '', needle2: '', needle3: '' }, saved: { engine: 0, needle: 0, needle2: 0, needle3: 0 }, currentBytes: 0, totalBytes: 0, currentAsset: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let activeTask: Promise<void> | null = null;
let discovery: { folder: FileSystemDirectoryHandle; promise: Promise<void> } | null = null;
const publish = (patch: Partial<NeedleAssetState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getNeedleAssets = () => state;
export const subscribeNeedleAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function startNext(folder: FileSystemDirectoryHandle) {
  if (activeTask || state.queuePaused || state.folder !== folder || !state.queue.length) return;
  const [group, ...queue] = state.queue;
  const taskController = new AbortController(); controller = taskController;
  const totalBytes = assets(group).reduce((sum, item) => sum + item.bytes, 0);
  publish({ queue, active: group, status: 'downloading', currentBytes: 0, totalBytes, currentAsset: '', error: '', errorGroup: null });
  activeTask = (async () => {
    try {
      if (group === 'engine') await organizeEngineFiles(folder, 'Needle', NEEDLE_ENGINE_ASSETS, 'needle-rs-queue.json');
      const dir = group === 'engine' ? await engineDirectory(folder, 'Needle', true) : await modelDirectory(folder, group, true);
      if (group !== 'engine') await stageLegacyAssets(folder, group, dir);
      let base = 0;
      for (const asset of assets(group)) {
        if (taskController.signal.aborted) throw new DOMException('Download paused', 'AbortError');
        if (!await validFile(dir, asset)) await transferAsset(dir, asset, base, taskController.signal, (bytes, currentAsset) => publish({ currentBytes: bytes, currentAsset }));
        base += asset.bytes;
        publish({ currentBytes: base });
      }
      if (group !== 'engine') await writeFile(dir, 'SOURCE.txt', sourceText(group));
      publish({ installed: { ...state.installed, [group]: true }, checked: { ...state.checked, [group]: true }, present: group === 'engine' ? state.present : { ...state.present, [group]: true }, verification: { ...state.verification, [group]: '' }, saved: { ...state.saved, [group]: totalBytes }, status: 'idle', active: null, currentAsset: '', revision: state.revision + 1 });
      showToast(`${group === 'engine' ? 'Needle browser engine' : NEEDLE_LABELS[group]} finished downloading.`);
    } catch (error) {
      const paused = taskController.signal.aborted;
      let savedBytesHere = state.saved[group];
      try { savedBytesHere = group === 'engine' ? await engineSavedBytes(folder, 'Needle', NEEDLE_ENGINE_ASSETS) : (await modelFiles(folder, group)).saved; } catch { /* Keep the last measured amount. */ }
      const message = paused ? '' : error instanceof Error ? error.message : String(error);
      publish({ saved: { ...state.saved, [group]: savedBytesHere }, queue: [group, ...state.queue.filter(item => item !== group)], queuePaused: true, active: null, status: paused ? 'paused' : 'error', error: message, errorGroup: paused ? null : group, revision: state.revision + 1 });
      if (!paused) showToast(`Needle download failed: ${message}`, 'error');
    } finally {
      controller = null; activeTask = null;
      startNext(folder);
    }
  })();
}
export const needleAssetsManager = {
  async discover(folder: FileSystemDirectoryHandle): Promise<void> {
    if (activeTask) { await activeTask; return this.discover(folder); }
    if (discovery?.folder === folder) return discovery.promise;
    const sameFolder = state.folder === folder;
    const installed = sameFolder ? { ...state.installed } : { engine: false, needle: false, needle2: false, needle3: false };
    const present = { needle: false, needle2: false, needle3: false };
    const verification = { engine: '', needle: '', needle2: '', needle3: '' };
    const saved = sameFolder ? { ...state.saved } : { engine: 0, needle: 0, needle2: 0, needle3: 0 };
    const checked = emptyChecked();
    const errors: string[] = [];
    publish({ folder, installed, present, verification, saved, checked, queue: sameFolder ? state.queue : [], queuePaused: sameFolder && state.queuePaused, active: null, status: sameFolder && state.queuePaused ? 'paused' : 'idle', error: '', errorGroup: null });
    const promise = (async () => { for (const group of groups) {
      try {
        if (group === 'engine') {
          const found = await engineAssetFiles(folder, 'Needle', NEEDLE_ENGINE_ASSETS, validFile);
          installed.engine = found.every(Boolean);
          saved.engine = await engineSavedBytes(folder, 'Needle', NEEDLE_ENGINE_ASSETS);
          if (!installed.engine && saved.engine) verification.engine = `${NEEDLE_ENGINE_ASSETS.filter((_, index) => !found[index]).map(asset => asset.label).join(', ')} need repair.`;
        } else {
          const found = await modelFiles(folder, group);
          installed[group] = !!found.files;
          present[group] = found.present;
          saved[group] = found.saved;
          verification[group] = !found.files && found.present ? `${found.invalid?.join(', ') || 'Model files'} need repair.` : '';
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
          const message = `${group}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(message); verification[group] = message;
        }
        installed[group] = false;
        if (error instanceof DOMException && error.name === 'NotFoundError') saved[group] = 0;
      }
      checked[group] = true;
      if (state.folder !== folder) return;
      publish({ installed: { ...installed }, checked: { ...checked }, present: { ...present }, verification: { ...verification }, saved: { ...saved } });
    }
    if (state.folder === folder) publish({ installed, checked, present, verification, saved, queue: sameFolder ? state.queue : [], queuePaused: sameFolder && state.queuePaused, status: errors.length ? 'error' : sameFolder && state.queuePaused ? 'paused' : 'idle', error: errors.join('; '), errorGroup: null, revision: state.revision + 1 });
    })();
    discovery = { folder, promise };
    try { await promise; }
    finally { if (discovery?.promise === promise) discovery = null; }
  },
  async organize(folder: FileSystemDirectoryHandle, onProgress?: (version: NeedleVersion) => void) {
    if (activeTask) throw new Error('Pause Needle downloads before organizing model files.');
    let moved = 0;
    for (const version of ['needle', 'needle2', 'needle3'] as const) {
      onProgress?.(version);
      if (await organizeLegacyModel(folder, version)) moved++;
    }
    await this.discover(folder);
    return moved;
  },
  async download(folder: FileSystemDirectoryHandle, group: NeedleAssetGroup) {
    if (state.folder !== folder && activeTask) throw new Error('A Needle download is active in another workspace.');
    if (state.folder === folder && (state.installed[group] || state.active === group || state.queue.includes(group))) return;
    publish({ folder, queue: [...(state.folder === folder ? state.queue : []), group], queuePaused: state.folder === folder && state.queuePaused });
    startNext(folder);
  },
  pause() { if (controller) { publish({ queuePaused: true }); controller.abort(); } },
  async pauseAndWait() { this.pause(); await Promise.all([activeTask, discovery?.promise.catch(() => {})]); },
  resume(folder: FileSystemDirectoryHandle) {
    if (state.folder !== folder) return;
    publish({ queuePaused: false, status: 'idle', error: '', errorGroup: null });
    startNext(folder);
  },
  removeQueued(folder: FileSystemDirectoryHandle, group: NeedleAssetGroup) {
    if (state.folder !== folder || state.active === group) return;
    publish({ queue: state.queue.filter(item => item !== group) });
  },
  async remove(folder: FileSystemDirectoryHandle, group: NeedleAssetGroup) {
    if (state.active === group) { this.pause(); await activeTask; }
    if (state.folder === folder) publish({ queue: state.queue.filter(item => item !== group) });
    try {
      if (group === 'engine') {
        const root = await engineRoot(folder, true);
        const nested = await engineDirectory(folder, 'Needle', true);
        for (const dir of [nested, root]) for (const asset of NEEDLE_ENGINE_ASSETS) { await removeFile(dir, asset.name); await removeFile(dir, `${asset.name}.download.json`); }
      } else {
        const root = await folder.getDirectoryHandle('models');
        await root.removeEntry(NEEDLE_MODEL_DIRS[group], { recursive: true }).catch(error => { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; });
        for (const asset of NEEDLE_MODEL_ASSETS[group]) { await removeFile(root, legacyName(group, asset.name)); await removeFile(root, `${legacyName(group, asset.name)}.download.json`); }
      }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
    publish({ installed: { ...state.installed, [group]: false }, checked: { ...state.checked, [group]: true }, present: group === 'engine' ? state.present : { ...state.present, [group]: false }, verification: { ...state.verification, [group]: '' }, saved: { ...state.saved, [group]: 0 }, errorGroup: state.errorGroup === group ? null : state.errorGroup, revision: state.revision + 1 });
    showToast(`${group === 'engine' ? 'Needle browser engine' : NEEDLE_LABELS[group]} removed.`);
  },
};
export async function assertNeedleFiles(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  const engineFiles = await engineAssetFiles(folder, 'Needle', NEEDLE_ENGINE_ASSETS, validFile);
  const model = await modelFiles(folder, version);
  if (engineFiles.some(file => !file)) throw new Error('Download the Needle browser engine and its license first.');
  if (!model.files) throw new Error(`Download or repair ${NEEDLE_LABELS[version]} and its license first.`);
  return { engineFiles: engineFiles as File[], modelFiles: model.files };
}
export async function readNeedleWeight(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  const name = NEEDLE_MODEL_ASSETS[version][1].name;
  try {
    const nested = await modelDirectory(folder, version);
    const file = await maybeFile(nested, name);
    if (file) return file;
  } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  try {
    const file = await maybeFile(await folder.getDirectoryHandle('models'), name);
    if (file) return file;
  } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  throw new Error(`${NEEDLE_MODEL_PATHS[version]} is missing.`);
}
export async function listPresentNeedleModels(folder: FileSystemDirectoryHandle): Promise<string[]> {
  const found = await Promise.all((Object.keys(NEEDLE_MODEL_PATHS) as NeedleVersion[]).map(async version => {
    try {
      const file = await readNeedleWeight(folder, version);
      return file.size === NEEDLE_MODEL_ASSETS[version][1].bytes ? NEEDLE_MODEL_PATHS[version] : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError' || error instanceof Error && error.message.endsWith(' is missing.')) return null;
      throw error;
    }
  }));
  return found.filter((path): path is string => !!path);
}
