import { sha256 } from '@noble/hashes/sha2.js';
import { showToast } from './toastStore.ts';
import { getModelDownload } from './modelDownloadSession.ts';
import { browserImageTotal } from './browserImageAssets.ts';
import { VISUAL_PACKAGE_LIMIT_BYTES, visualPackageLimitMessage } from './visualLimit.ts';

export const MOTION_MODEL_IDS = ['depth', 'rife', 'pose', 'vector', 'tripo'] as const;
export type MotionModel = typeof MOTION_MODEL_IDS[number];
export type MotionAssetId = MotionModel | 'pose_engine' | 'vector_engine';
type Asset = { name: string; url: string; bytes: number; sha256: string };
const mediaPipeLicense: Asset = { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/800a56cc5004f6b0b0bb65134cc6c2ec12f0c88f/LICENSE', bytes: 12331, sha256: '8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8' };
export const MOTION_MODELS: Record<MotionAssetId, { label: string; path: string; purpose: string; source: string; license: string; assets: readonly Asset[] }> = {
  depth: {
    label: 'Depth Anything V2 Small', path: 'models/Depth-Anything-V2-Small-ONNX', purpose: 'Estimates relative depth for camera motion from one image.',
    source: 'https://huggingface.co/onnx-community/depth-anything-v2-small', license: 'Apache 2.0',
    assets: [
      { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/a561b849ebae10a6f5ef49e26c83cbbcd36c71bf/LICENSE', bytes: 11357, sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' },
      { name: 'preprocessor_config.json', url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/preprocessor_config.json', bytes: 461, sha256: '03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6' },
      { name: 'model.onnx', url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/f7421df/onnx/model_q4.onnx', bytes: 27404416, sha256: '5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8' },
    ],
  },
  rife: {
    label: 'RIFE 4.9', path: 'models/RIFE-4.9-ONNX', purpose: 'Creates in-between frames across an ordered set of images; it does not predict a future scene.',
    source: 'https://huggingface.co/edgetools/rife', license: 'MIT',
    assets: [
      { name: 'LICENSE.txt', url: 'https://huggingface.co/edgetools/rife/resolve/321b593c5f36c26f5b08fa2838dcf5eece382fa0/LICENSE', bytes: 1086, sha256: 'f53bd020ea33bd02ba66146209e507f30e06b5ceff94d492961b9a8243d06398' },
      { name: 'model.onnx', url: 'https://huggingface.co/edgetools/rife/resolve/321b593c5f36c26f5b08fa2838dcf5eece382fa0/rife49.onnx', bytes: 21458882, sha256: '76e4cef9ab42fa7dd4e8f6e4aba47462051e3faa969e4bca6479784fbab0ac6f' },
    ],
  },
  pose: {
    label: 'Pose Landmarker Full', path: 'models/Pose-Landmarker-Full', purpose: 'Estimates 33 body landmarks from images and video.',
    source: 'https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker', license: 'Apache 2.0',
    assets: [mediaPipeLicense, { name: 'pose_landmarker_full.task', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', bytes: 9398198, sha256: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1' }],
  },
  pose_engine: {
    label: 'MediaPipe Vision', path: 'engines/MediaPipe-Vision-1.1.1', purpose: 'Runs pose landmark detection entirely in this browser.',
    source: 'https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.1.1', license: 'Apache 2.0',
    assets: [mediaPipeLicense,
      { name: 'vision_bundle.mjs', url: 'https://unpkg.com/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs', bytes: 156139, sha256: 'a84921e02321e582484c1f8126d344b5f33b791fa09c640a52e20ee8632068f1' },
      { name: 'vision_wasm_internal.js', url: 'https://unpkg.com/@mediapipe/tasks-vision@1.1.1/wasm/vision_wasm_internal.js', bytes: 334128, sha256: '6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8' },
      { name: 'vision_wasm_internal.wasm', url: 'https://unpkg.com/@mediapipe/tasks-vision@1.1.1/wasm/vision_wasm_internal.wasm', bytes: 13519922, sha256: '0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd' },
      { name: 'vision_wasm_nosimd_internal.js', url: 'https://unpkg.com/@mediapipe/tasks-vision@1.1.1/wasm/vision_wasm_nosimd_internal.js', bytes: 333931, sha256: '942654dbdcebce08ea039af23d18e58bebf23c8607d74023d2df7071c8a7b638' },
      { name: 'vision_wasm_nosimd_internal.wasm', url: 'https://unpkg.com/@mediapipe/tasks-vision@1.1.1/wasm/vision_wasm_nosimd_internal.wasm', bytes: 12627509, sha256: 'c9b1b69bb87baf9e529254d8559dcbcf4c5a9c0eda84f56a12f17d675335ec9c' },
    ],
  },
  vector: {
    label: 'VTracer', path: 'models/VTracer-Vector', purpose: 'Turns raster artwork into editable SVG paths.',
    source: 'https://github.com/visioncortex/vtracer', license: 'MIT',
    assets: [
      { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/visioncortex/vtracer/d4927a9e863c9d13dad367f68b5d6ffec194c720/LICENSE', bytes: 1058, sha256: '81ee739f355765c110fc89feff14ffffce829901f96ba811fd0b65a41a8636c7' },
      { name: 'package.json', url: 'https://unpkg.com/@visioncortex/vtracer@1.0.0-alpha.4/package.json', bytes: 1002, sha256: '0e73861fdad985abc9ff815c2d000c9261aec058ce75fc4324cb1fc2e9102c28' },
    ],
  },
  vector_engine: {
    label: 'VTracer WebAssembly', path: 'engines/VTracer-1.0.0-alpha.4', purpose: 'Converts raster images to SVG entirely in the browser.',
    source: 'https://www.npmjs.com/package/@visioncortex/vtracer/v/1.0.0-alpha.4', license: 'MIT',
    assets: [
      { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/visioncortex/vtracer/d4927a9e863c9d13dad367f68b5d6ffec194c720/LICENSE', bytes: 1058, sha256: '81ee739f355765c110fc89feff14ffffce829901f96ba811fd0b65a41a8636c7' },
      { name: 'vtracer_wasm.js', url: 'https://unpkg.com/@visioncortex/vtracer@1.0.0-alpha.4/pkg/vtracer_wasm.js', bytes: 14925, sha256: 'e1855e9bb29d785344f672abdc692ca90ffa7ed863b9186b51c4e95a2a7dc17d' },
      { name: 'vtracer_wasm_bg.wasm', url: 'https://unpkg.com/@visioncortex/vtracer@1.0.0-alpha.4/pkg/vtracer_wasm_bg.wasm', bytes: 668378, sha256: '63716b70497b7468ef97545b50f5f34b8bbb7acde2d7b00deb4eb40781446d45' },
    ],
  },
  tripo: {
    label: 'TripoSR Q8', path: 'models/TripoSR-Q8-ONNX', purpose: 'Reconstructs a static 3D object from a cutout image.',
    source: 'https://huggingface.co/cgb/triposr-onnx-webgpu', license: 'MIT / Apache 2.0',
    assets: [
      { name: 'LICENSE-TripoSR.txt', url: 'https://raw.githubusercontent.com/VAST-AI-Research/TripoSR/107cefdc244c39106fa830359024f6a2f1c78871/LICENSE', bytes: 1080, sha256: 'ade0a66629bdd7e01e46b3296b3851cff0fd27989bca53da470ad6e96ed620fb' },
      { name: 'LICENSE-DINO.txt', url: 'https://raw.githubusercontent.com/facebookresearch/dino/7c446df5b9f45747937fb0d72314eb9f7b66930a/LICENSE', bytes: 11324, sha256: '50e6751797c50dedd75ef1b8a0d9e42f5f8472e9fbce91f34718e9f97b0c780a' },
      { name: 'MODEL-CARD.md', url: 'https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/048725e957f485cc6bc082a9d6a239fcf7d8880a/README.md', bytes: 3633, sha256: '179a47df133504635c15498b74a7a700f80ed3d43aa12c864ad58539fc667a78' },
      { name: 'triplane_q8.onnx', url: 'https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/048725e957f485cc6bc082a9d6a239fcf7d8880a/triplane_q8.onnx', bytes: 885712, sha256: '7721f5a45e79e02de8c6e909c21fb8e922fd0b594038a8fc1cfefa42c79ad6d5' },
      { name: 'triplane_q8.onnx.data', url: 'https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/048725e957f485cc6bc082a9d6a239fcf7d8880a/triplane_q8.onnx.data', bytes: 483785728, sha256: '50bf9b1c1218dc2c7fb6051d0d2cb7a48a1c5f75cc86e67a9d0e09a931298e35' },
      { name: 'decoder.onnx', url: 'https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/048725e957f485cc6bc082a9d6a239fcf7d8880a/decoder.onnx', bytes: 173796, sha256: '6ff43581f1d2b46aa61764c2729a8d33985b51cb6c8088cf36ffee3fd70355eb' },
    ],
  },
};
export const motionModelForPath = (path: string): MotionModel | null =>
  MOTION_MODEL_IDS.find(id => MOTION_MODELS[id].path === path) ?? null;

export const motionTotal = (id: MotionAssetId) => MOTION_MODELS[id].assets.reduce((n, asset) => n + asset.bytes, 0);
export const motionPackageBytes = (id: MotionModel) =>
  motionTotal(id) + (id === 'pose' ? motionTotal('pose_engine') : id === 'vector' ? motionTotal('vector_engine') : browserImageTotal('engine'));
export async function motionDirectory(folder: FileSystemDirectoryHandle, id: MotionAssetId, create = false) {
  const [rootName, childName] = MOTION_MODELS[id].path.split('/');
  const root = await folder.getDirectoryHandle(rootName, { create });
  return root.getDirectoryHandle(childName, { create });
}
async function existing(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
}
async function verified(dir: FileSystemDirectoryHandle, asset: Asset): Promise<File | null> {
  const file = await existing(dir, asset.name);
  if (!file || file.size !== asset.bytes) return null;
  const hash = sha256.create();
  for (let pos = 0; pos < file.size; pos += 1024 * 1024) hash.update(new Uint8Array(await file.slice(pos, pos + 1024 * 1024).arrayBuffer()));
  const actual = [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return actual === asset.sha256 ? file : null;
}
export async function assertMotionFiles(folder: FileSystemDirectoryHandle, id: MotionAssetId) {
  const dir = await motionDirectory(folder, id);
  const files = await Promise.all(MOTION_MODELS[id].assets.map(asset => verified(dir, asset)));
  if (files.some(file => !file)) throw new Error(`Download ${MOTION_MODELS[id].label} and its license first.`);
  return files as File[];
}

type State = { folder: FileSystemDirectoryHandle | null; checked: Record<MotionAssetId, boolean>; installed: Record<MotionAssetId, boolean>; saved: Record<MotionAssetId, number>; active: MotionAssetId | null; queue: MotionAssetId[]; paused: boolean; error: string };
const initialFlags = { depth: false, rife: false, pose: false, pose_engine: false, vector: false, vector_engine: false, tripo: false };
const initialSaved = { depth: 0, rife: 0, pose: 0, pose_engine: 0, vector: 0, vector_engine: 0, tripo: 0 };
let state: State = { folder: null, checked: initialFlags, installed: initialFlags, saved: initialSaved, active: null, queue: [], paused: false, error: '' };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getMotionAssets = () => state;
export const subscribeMotionAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let controller: AbortController | null = null;
let task: Promise<void> | null = null;

async function transfer(dir: FileSystemDirectoryHandle, asset: Asset, signal: AbortSignal, progress: (bytes: number) => void) {
  if (await verified(dir, asset)) { progress(asset.bytes); return; }
  const handle = await dir.getFileHandle(asset.name, { create: true });
  const current = await handle.getFile();
  // A full-sized file that failed its checksum must restart rather than request
  // an empty suffix. Partial files keep their committed bytes across reloads.
  // Small text files may be transparently compressed by CDNs; byte ranges can
  // then refer to compressed bytes. Restart those files from byte zero.
  const offset = !/\.(txt|md|json)$/i.test(asset.name) && current.size < asset.bytes ? current.size : 0;
  const headers: Record<string, string> = offset ? { Range: `bytes=${offset}-` } : {};
  const response = await fetch(asset.url, { headers, signal });
  if (!response.ok || !response.body) throw new Error(`${asset.name}: HTTP ${response.status}`);
  if (offset && (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))) throw new Error(`${asset.name} could not resume safely.`);
  if (!offset && response.status !== 200) throw new Error(`${asset.name} returned an unexpected range.`);
  const writable = await handle.createWritable({ keepExistingData: !!offset });
  const reader = response.body.getReader();
  let bytes = offset;
  try {
    if (offset) await writable.seek(offset);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      await writable.write(part.value);
      bytes += part.value.byteLength;
      if (bytes > asset.bytes) throw new Error(`${asset.name} exceeded its pinned size.`);
      progress(bytes);
      let remaining = part.value.byteLength;
      while (remaining > 0) {
        if (signal.aborted) throw signal.reason;
        const mebibytesPerSecond = getModelDownload().speedLimit;
        if (!mebibytesPerSecond) break;
        const milliseconds = Math.min(100, remaining / (mebibytesPerSecond * 1048576) * 1000);
        await new Promise(resolve => setTimeout(resolve, milliseconds));
        remaining -= mebibytesPerSecond * 1048576 * milliseconds / 1000;
      }
    }
    await writable.close();
  } catch (error) { await writable.close().catch(() => {}); throw error; }
  finally { await reader.cancel().catch(() => {}); }
  if (!await verified(dir, asset)) throw new Error(`${asset.name} failed its integrity check.`);
}
function next(folder: FileSystemDirectoryHandle) {
  if (task || state.folder !== folder || state.paused || !state.queue.length) return;
  const [id, ...rest] = state.queue;
  if (id !== 'pose_engine' && id !== 'vector_engine') {
    const bytes = motionPackageBytes(id);
    if (bytes > VISUAL_PACKAGE_LIMIT_BYTES) {
      const error = visualPackageLimitMessage(MOTION_MODELS[id].label, bytes);
      publish({ queue: rest, error });
      showToast(error, 'error');
      next(folder);
      return;
    }
  }
  const aborter = new AbortController(); controller = aborter;
  publish({ active: id, queue: rest, error: '' });
  task = (async () => {
    try {
      const dir = await motionDirectory(folder, id, true);
      let base = 0;
      for (const asset of MOTION_MODELS[id].assets) {
        await transfer(dir, asset, aborter.signal, bytes => publish({ saved: { ...state.saved, [id]: base + bytes } }));
        base += asset.bytes;
      }
      publish({ installed: { ...state.installed, [id]: true }, saved: { ...state.saved, [id]: motionTotal(id) }, active: null });
      showToast(`${MOTION_MODELS[id].label} finished downloading.`);
    } catch (error) {
      const saved = await motionDirectory(folder, id).then(async dir => {
        let total = 0;
        for (const asset of MOTION_MODELS[id].assets) total += Math.min(asset.bytes, (await existing(dir, asset.name))?.size || 0);
        return total;
      }).catch(() => state.saved[id]);
      const message = error instanceof Error ? error.message : String(error);
      publish({ active: null, queue: [id, ...state.queue], saved: { ...state.saved, [id]: saved }, paused: true, error: aborter.signal.aborted ? '' : message });
      if (!aborter.signal.aborted) showToast(`Motion download failed: ${message}`, 'error');
    } finally { controller = null; task = null; next(folder); }
  })();
}
export const motionAssetsManager = {
  async discover(folder: FileSystemDirectoryHandle) {
    if (task && state.folder === folder) return;
    if (task) throw new Error('Finish the active graphics download before switching workspaces.');
    if (state.folder !== folder) publish({ folder, checked: initialFlags, installed: initialFlags, saved: initialSaved, queue: [], paused: false });
    for (const id of ['depth', 'rife', 'pose', 'pose_engine', 'vector', 'vector_engine', 'tripo'] as const) {
      const dir = await motionDirectory(folder, id).catch(error => { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; });
      const files = dir ? await Promise.all(MOTION_MODELS[id].assets.map(asset => verified(dir, asset))) : [];
      const saved = dir ? await Promise.all(MOTION_MODELS[id].assets.map(asset => existing(dir, asset.name))).then(found => found.reduce((n, file, index) => n + Math.min(file?.size || 0, MOTION_MODELS[id].assets[index].bytes), 0)) : 0;
      if (state.folder !== folder) return;
      publish({ checked: { ...state.checked, [id]: true }, installed: { ...state.installed, [id]: files.length === MOTION_MODELS[id].assets.length && files.every(Boolean) }, saved: { ...state.saved, [id]: saved } });
    }
  },
  queue(folder: FileSystemDirectoryHandle, id: MotionAssetId) {
    if (state.folder && state.folder !== folder && task) throw new Error('A motion download is active in another workspace.');
    if (state.folder === folder && (state.active === id || state.queue.includes(id) || state.installed[id])) return;
    if (id !== 'pose_engine' && id !== 'vector_engine') {
      const bytes = motionPackageBytes(id);
      if (bytes > VISUAL_PACKAGE_LIMIT_BYTES) throw new Error(visualPackageLimitMessage(MOTION_MODELS[id].label, bytes));
    }
    publish({ folder, queue: [...(state.folder === folder ? state.queue : []), id], paused: state.folder === folder && state.paused });
    next(folder);
  },
  pause() { publish({ paused: true }); controller?.abort(); },
  async pauseAndWait() { this.pause(); await task; },
  resume(folder: FileSystemDirectoryHandle) { if (state.folder !== folder) return; publish({ paused: false, error: '' }); next(folder); },
};
