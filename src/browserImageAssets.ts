import { sha256 } from '@noble/hashes/sha2.js';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { showToast } from './toastStore.ts';
import { VISUAL_PACKAGE_LIMIT_BYTES, visualPackageLimitMessage } from './visualLimit.ts';

type Asset = { name: string; url: string; bytes: number; sha256: string; label: string };
const PREVIOUS_ONNX_SCRIPT = { name: 'ort.webgpu.min.js', bytes: 357648, sha256: '4dec2f5e74de2ec0f496d39ef55ec23762e8c6ca58cb958e691c9f2350a7b1c8' };
export type BrowserImageModelGroup = 'model' | 'tiny-q4' | 'tiny-fp16' | 'sdxs' | 'lcm' | 'supra-mobile';
type Group = 'engine' | BrowserImageModelGroup;
export const BROWSER_IMAGE_GROUPS = ['model', 'tiny-q4', 'tiny-fp16', 'sdxs', 'lcm', 'supra-mobile'] as const;
export const BROWSER_IMAGE_OUTPUT = { width: 512, height: 512, steps: 20 } as const;
export const BROWSER_IMAGE_MODEL_PATH = 'models/SD-1.5-ONNX';
export const BROWSER_IMAGE_MODEL_PATHS: Record<BrowserImageModelGroup, string> = {
  model: BROWSER_IMAGE_MODEL_PATH,
  'tiny-q4': 'models/Tiny-SD-Q4-ONNX',
  'tiny-fp16': 'models/Tiny-SD-FP16-ONNX',
  sdxs: 'models/SDXS-DreamShaper-ONNX',
  lcm: 'models/DreamShaper-8-LCM-INT8-ONNX',
  'supra-mobile': 'models/Supra2-IMG-Mobile-ONNX',
};
export const browserImageModelGroup = (path: string): BrowserImageModelGroup | null =>
  (Object.entries(BROWSER_IMAGE_MODEL_PATHS) as [BrowserImageModelGroup, string][]).find(([, value]) => value === path)?.[0] ?? null;
export const browserImageModelLabel = (group: BrowserImageModelGroup) => ({ model: 'Stable Diffusion 1.5', 'tiny-q4': 'Tiny-SD Q4', 'tiny-fp16': 'Tiny-SD FP16', sdxs: 'SDXS DreamShaper', lcm: 'DreamShaper 8 LCM', 'supra-mobile': 'Supra2-IMG Mobile' })[group];
export const browserImageDefaultSteps = (group: BrowserImageModelGroup) => group === 'sdxs' ? 1 : group === 'lcm' ? 4 : group === 'supra-mobile' ? 20 : BROWSER_IMAGE_OUTPUT.steps;
export const browserImageOutputSize = (group: BrowserImageModelGroup) => group === 'supra-mobile' ? 256 : 512;
export const browserImageDefaultGuidance = (group: BrowserImageModelGroup) => group === 'sdxs' || group === 'lcm' ? 0 : group === 'supra-mobile' ? 3 : 7.5;
const scribbler = '0b8f3a87099ae6c1154e987acb826f08add840d8';
const sd15 = 'd7c229b23e94f49b4a74c279ba17ff1afb367c31';
const script = (name: string) => `https://raw.githubusercontent.com/gopi-suvanam/scribbler-webnn/${scribbler}/${name}`;
const ort = (name: string) => `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/${name}`;
const model = (name: string) => `https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn/resolve/${sd15}/${name}`;
export const BROWSER_IMAGE_ENGINE_ASSETS: readonly Asset[] = [
  { name: 'SCRIBBLER-LICENSE.txt', url: script('LICENSE'), bytes: 1077, sha256: '74c78af1c0606f4ff080fa28b999ed24949f9ec787bd9d839a780f7d1491a887', label: 'Scribbler license' },
  { name: 'ONNX-LICENSE.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE', bytes: 1073, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c', label: 'ONNX Runtime license' },
  { name: 'sd.js', url: script('sd.js'), bytes: 31440, sha256: '4ff8904bfe01d53366050fd9b218542a2db87d3588861409a453a2537e61a905', label: 'Diffusion pipeline' },
  // ONNX 1.30's WebGPU bundle uses webgpuInit from asyncify, not jsepInit from the JSEP loader.
  { name: 'ort.webgpu.min.js', url: ort('ort.webgpu.min.js'), bytes: 66417, sha256: '7d65dad7eb4564ad98db9924a259af2e2c68ebfbdbf254fa5d728f1c5736e07a', label: 'ONNX WebGPU JavaScript' },
  { name: 'ort-wasm-simd-threaded.asyncify.mjs', url: ort('ort-wasm-simd-threaded.asyncify.mjs'), bytes: 53057, sha256: '3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28', label: 'ONNX WebAssembly loader' },
  { name: 'ort-wasm-simd-threaded.asyncify.wasm', url: ort('ort-wasm-simd-threaded.asyncify.wasm'), bytes: 26781914, sha256: '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da', label: 'ONNX WebAssembly' },
];
const BROWSER_IMAGE_PREVIOUS_ENGINE_ASSETS: readonly Asset[] = [
  ...BROWSER_IMAGE_ENGINE_ASSETS.slice(0, 3),
  { name: 'ort.webgpu.min.js', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.js', bytes: 357648, sha256: PREVIOUS_ONNX_SCRIPT.sha256, label: 'ONNX WebGPU JavaScript' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.mjs', bytes: 44677, sha256: '1cbcba8f2c769c1eecbab66a1b1e55ef11704515bf4306373e3db3c37cf6dcd8', label: 'ONNX WebAssembly loader' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm', bytes: 21872216, sha256: 'b45970d0632383a057c27ca5b660b216f8e00c17cf8db9f6207b5e4abc839368', label: 'ONNX WebAssembly' },
];
export const imageModelAcceptsPreviousEngine = (group: BrowserImageModelGroup) => group === 'model' || group === 'tiny-q4' || group === 'tiny-fp16' || group === 'sdxs';
export const BROWSER_IMAGE_MODEL_ASSETS: readonly Asset[] = [
  { name: 'LICENSE.txt', url: 'https://raw.githubusercontent.com/CompVis/stable-diffusion/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229/LICENSE', bytes: 14385, sha256: 'be351ebe7ac01bcdbb018639aadcfd38f136b7dc3f2a3d4d3a24db51d1b210ef', label: 'CreativeML Open RAIL-M license' },
  { name: 'Text_Encoder_LICENSE.txt', url: model('Text_Encoder_LICENSE.txt'), bytes: 214, sha256: '15712468f7eaa5e31bab2a2ee7445a301b7cd77e85b7a5378d38fa36a78620e6', label: 'Text encoder source and license notice' },
  { name: 'tokenizer.json', url: script('tokenizers/sd-1.5/tokenizer.json'), bytes: 2222656, sha256: '5e20ee7c61075a30c2118896987fe13d8b0f8f30a36ba0fbdb0754959c8d0bb4', label: 'CLIP tokenizer' },
  { name: 'text-encoder.onnx', url: model('text-encoder.onnx'), bytes: 246417740, sha256: '6e4d5bea3433a9455f2c7facf358477f4aea6509cb10500b9ed9def643c81579', label: 'SD 1.5 text encoder' },
  { name: 'sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx', url: model('sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx'), bytes: 1719405068, sha256: 'd680d78f36f5722c0205258337e91c41e0d552d17f812cffbe4f3fb138de3c82', label: 'SD 1.5 UNet' },
  { name: 'Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx', url: model('Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx'), bytes: 99124333, sha256: 'b25ae0f7ae9877104fe9bf6e9ca53a0b07562de741c4cd86f16e5205d56b3b6f', label: 'SD 1.5 VAE decoder' },
];
const tinyBase = 'https://huggingface.co/cursedhelm/aderpy-deepdreamer-onnx/resolve/fa62aeaf4ee8a66f77cdc2592983210451857aae/';
const tinyAsset = (variant: 'tiny-sd-web-q4f16' | 'tiny-sd-web-fp16', name: string, source: string, bytes: number, sha256: string, label: string): Asset => ({ name, url: `${tinyBase}${variant}/${source}`, bytes, sha256, label });
const tinyLicense = BROWSER_IMAGE_MODEL_ASSETS[0];
export const BROWSER_TINY_Q4_ASSETS: readonly Asset[] = [
  tinyLicense,
  tinyAsset('tiny-sd-web-q4f16', 'tokenizer.json', 'tokenizer/tokenizer.json', 3642034, '5f120510b5c01ccdb9a7d29d2beca07cac667f76472cab123ffb1c2f0b27cdeb', 'Tiny-SD tokenizer'),
  tinyAsset('tiny-sd-web-q4f16', 'text-encoder.onnx', 'text_encoder/model.onnx', 69631480, 'a790756197edc41efc70bc2cfaa7f282d2d8fcf1ca3e7ccd4de58fede1ce86c8', 'Tiny-SD Q4 text encoder'),
  tinyAsset('tiny-sd-web-q4f16', 'unet.onnx', 'unet/model.onnx', 465548639, 'c994b47cb486bc157451bbd799d9293e7e7501b97689a1d2b4399f4b4b4ba61b', 'Tiny-SD Q4 UNet'),
  tinyAsset('tiny-sd-web-q4f16', 'vae-decoder.onnx', 'vae_decoder/model.onnx', 97587114, '11ccb1037ee17cfddadd5c2b68eb31993cbdf69c90decf164d607f9576a40b40', 'Tiny-SD Q4 VAE'),
];
export const BROWSER_TINY_FP16_ASSETS: readonly Asset[] = [
  tinyLicense,
  tinyAsset('tiny-sd-web-fp16', 'tokenizer.json', 'tokenizer/tokenizer.json', 3642034, '5f120510b5c01ccdb9a7d29d2beca07cac667f76472cab123ffb1c2f0b27cdeb', 'Tiny-SD tokenizer'),
  tinyAsset('tiny-sd-web-fp16', 'text-encoder.onnx', 'text_encoder/model.onnx', 246343543, 'f9749fc65cd7652319089d48e57f40b1dc381bc77f245e49f6df1491e037f95a', 'Tiny-SD FP16 text encoder'),
  tinyAsset('tiny-sd-web-fp16', 'unet.onnx', 'unet/model.onnx', 647295610, 'ca4e66305815ec9cf0a8300cef17e5ddb4928fbcb13e428679fa353a204b8f71', 'Tiny-SD FP16 UNet'),
  tinyAsset('tiny-sd-web-fp16', 'vae-decoder.onnx', 'vae_decoder/model.onnx', 99093735, '3c91e9289f12f84da4987530a1b690719a229583dc8e5209cdc8601348538138', 'Tiny-SD FP16 VAE'),
];
const sdxsBase = 'https://huggingface.co/skillsafeai/sdxs-512-dreamshaper-onnx-webgpu/resolve/b23bf8f4f809a0beb6d095bf52b5854e0b66caef/';
const sdxsAsset = (name: string, source: string, bytes: number, hash: string, label: string): Asset => ({ name, url: sdxsBase + source, bytes, sha256: hash, label });
export const BROWSER_SDXS_ASSETS: readonly Asset[] = [
  { name: 'LICENSE-OpenRAIL++-M.md', url: 'https://huggingface.co/dtaddis/localimagegen-sdxs-mobile/resolve/5652687809c3fa72c00da2f7766fd537d9b6d7c7/LICENSE-sdxs-openrail%2B%2B.md', bytes: 14109, sha256: '19b6998b569b53ac1fc2158a8a3202c8699a9a4605b47075715d9c96be7fb6d0', label: 'SDXS license' },
  { name: 'LICENSE-CreativeML-OpenRAIL-M.md', url: 'https://huggingface.co/dtaddis/localimagegen-sdxs-mobile/resolve/5652687809c3fa72c00da2f7766fd537d9b6d7c7/LICENSE.md', bytes: 14465, sha256: '84804f0a5d78ed48992f7a6640ee6165877ccf9e704669713cababf65558cf4a', label: 'DreamShaper base license' },
  { name: 'LICENSE-TAESD-MIT.txt', url: 'https://raw.githubusercontent.com/madebyollin/taesd/d968ebf70e930b76243c773a63162ed94482361f/LICENSE', bytes: 1073, sha256: '261497cf8e9ed613ed1fa5ddf48af32cdf50545b2ccd9edd7eacc91fb9255d6e', label: 'TAESD decoder license' },
  sdxsAsset('vocab.json', 'tokenizer/vocab.json', 1059962, 'e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349', 'SDXS vocabulary'),
  sdxsAsset('merges.txt', 'tokenizer/merges.txt', 524619, '9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a', 'SDXS token merges'),
  sdxsAsset('text-encoder.onnx', 'text_encoder.onnx', 246275486, '73464847bad29badc218bf9f0d285f36b92ddccd6b874643d2a2d31766870e83', 'SDXS text encoder'),
  sdxsAsset('unet.onnx', 'unet.onnx', 631766742, 'f81dc16670944fead5561851a06038a21c23779760065249274801f47896ece7', 'SDXS UNet'),
  sdxsAsset('vae-decoder.onnx', 'vae_decoder.onnx', 2467568, '75c5e431703b1d87bcc44f5610b49f6b73594b09857a2263958123afe0be7190', 'SDXS VAE decoder'),
];
const lcmBase = 'https://huggingface.co/skillsafeai/dreamshaper-8-lcm-onnx-webgpu/resolve/a310400909a293a7a937a54854910ed06469192b/';
const lcmAsset = (name: string, source: string, bytes: number, hash: string, label: string): Asset => ({ name, url: lcmBase + source, bytes, sha256: hash, label });
export const BROWSER_LCM_ASSETS: readonly Asset[] = [
  BROWSER_IMAGE_MODEL_ASSETS[0],
  lcmAsset('vocab.json', 'tokenizer/vocab.json', 1059962, 'e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349', 'DreamShaper vocabulary'),
  lcmAsset('merges.txt', 'tokenizer/merges.txt', 524619, '9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a', 'DreamShaper token merges'),
  lcmAsset('text-encoder.onnx', 'int8/text_encoder_int8.onnx', 123612877, 'ff9bd0225990f6827682cfe37cf95912135e4f84945ba7f3abfe70a19eeff8fb', 'DreamShaper text encoder'),
  lcmAsset('unet.onnx', 'int8/unet_int8.onnx', 861356871, 'a6bab857c28d27ac914a2d8e731011c0d9b361da7553efc6117e04f722e9f4ca', 'DreamShaper UNet'),
  lcmAsset('vae-decoder.onnx', 'int8/vae_decoder_int8.onnx', 49791103, '7556dbb3d599dbad393dc598b8bf28874245b721aa581f321dfbd0f7211f37d2', 'DreamShaper VAE decoder'),
];
const supraBase = 'https://huggingface.co/mikhsol/Supra2-IMG-mobile-onnx/resolve/988fec1a4b9e2fc1453296f7ccf542fce80ba344/';
const supraAsset = (name: string, source: string, bytes: number, hash: string, label: string): Asset => ({ name, url: supraBase + source, bytes, sha256: hash, label });
export const BROWSER_SUPRA_ASSETS: readonly Asset[] = [
  supraAsset('LICENSE.txt', 'LICENSE', 11358, 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', 'Supra2 license'),
  supraAsset('NOTICE.txt', 'NOTICE', 1902, '70c56428b895ee27bdb5ed9e7d0eb39a87c65646524e7614d999fa43ba3793cc', 'Supra2 notice'),
  supraAsset('tokenizer.json', 'tokenizer/tokenizer.json', 2422164, 'd7af4599a1914d04aaf44839418757f40ccca4c78033edeba369484978378335', 'Supra2 tokenizer'),
  supraAsset('text-encoder.onnx', 'text_encoder/model_int8.onnx', 137211850, 'e6e4ae7ba3cdcd73f13256908b0666038097c81bf61eb91fd31aa504e45bbb11', 'Supra2 text encoder'),
  supraAsset('dit.onnx', 'dit/model_int8.onnx', 106574020, 'a53f5fe8c0b51f40b8dad3013281485514b944db9f474e87302f7e5c4558acbc', 'Supra2 transformer'),
  supraAsset('vae-decoder.onnx', 'vae_decoder/model.onnx', 198078680, 'ac7fae16a6b6bd3868e45fae1fa222f812ebae82bdec1557bd2bb6fbc8b673a6', 'Supra2 VAE decoder'),
];
export const browserImageLicenseLinks = (group: BrowserImageModelGroup) => group === 'sdxs'
  ? [{ label: 'Open RAIL++-M', url: BROWSER_SDXS_ASSETS[0].url }, { label: 'DreamShaper Open RAIL-M', url: BROWSER_SDXS_ASSETS[1].url }, { label: 'TAESD MIT', url: BROWSER_SDXS_ASSETS[2].url }]
  : group === 'supra-mobile'
    ? [{ label: 'Apache 2.0', url: BROWSER_SUPRA_ASSETS[0].url }, { label: 'NOTICE', url: BROWSER_SUPRA_ASSETS[1].url }]
    : [{ label: 'CreativeML Open RAIL-M', url: BROWSER_IMAGE_MODEL_ASSETS[0].url }];
export const browserImageAssets = (group: Group): readonly Asset[] => group === 'engine' ? BROWSER_IMAGE_ENGINE_ASSETS : group === 'model' ? BROWSER_IMAGE_MODEL_ASSETS : group === 'tiny-q4' ? BROWSER_TINY_Q4_ASSETS : group === 'tiny-fp16' ? BROWSER_TINY_FP16_ASSETS : group === 'sdxs' ? BROWSER_SDXS_ASSETS : group === 'lcm' ? BROWSER_LCM_ASSETS : BROWSER_SUPRA_ASSETS;
const assets = browserImageAssets;
export const browserImageTotal = (group: Group) => assets(group).reduce((sum, item) => sum + item.bytes, 0);
export async function browserImageDirectory(folder: FileSystemDirectoryHandle, group: Group, create = false) {
  const parent = await folder.getDirectoryHandle(group === 'engine' ? 'engines' : 'models', { create });
  return parent.getDirectoryHandle(group === 'engine' ? 'ONNX-Image' : BROWSER_IMAGE_MODEL_PATHS[group].slice('models/'.length), { create });
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
  for (const asset of assets(group)) total += group === 'engine' ? (await verified(dir, asset) ? asset.bytes : 0) : Math.min(asset.bytes, (await maybeFile(dir, asset.name))?.size || 0);
  return total;
}
async function hasOnnxEngineNeedingUpdate(dir: FileSystemDirectoryHandle) {
  return !!(await verified(dir, BROWSER_IMAGE_ENGINE_ASSETS[3])) || !!(await verified(dir, BROWSER_IMAGE_PREVIOUS_ENGINE_ASSETS[3]));
}
type State = { folder: FileSystemDirectoryHandle | null; active: Group | null; queue: Group[]; paused: boolean; installed: Record<Group, boolean>; checked: Record<Group, boolean>; saved: Record<Group, number>; legacyInstalled: boolean; updateAvailable: boolean; current: string; error: string; revision: number };
const emptyGroups = () => ({ engine: false, model: false, 'tiny-q4': false, 'tiny-fp16': false, sdxs: false, lcm: false, 'supra-mobile': false });
const emptyProgress = () => ({ engine: 0, model: 0, 'tiny-q4': 0, 'tiny-fp16': 0, sdxs: 0, lcm: 0, 'supra-mobile': 0 });
let state: State = { folder: null, active: null, queue: [], paused: false, installed: emptyGroups(), checked: emptyGroups(), saved: emptyProgress(), legacyInstalled: false, updateAvailable: false, current: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getBrowserImageAssets = () => state;
export const subscribeBrowserImageAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let controller: AbortController | null = null;
let task: Promise<void> | null = null;
let discovery: { folder: FileSystemDirectoryHandle; promise: Promise<void> } | null = null;
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
  if (group !== 'engine') {
    const packageBytes = browserImageTotal(group) + browserImageTotal('engine');
    if (packageBytes > VISUAL_PACKAGE_LIMIT_BYTES) {
      const error = visualPackageLimitMessage(browserImageModelLabel(group), packageBytes);
      publish({ queue, error, revision: state.revision + 1 });
      showToast(error, 'error');
      startNext(folder);
      return;
    }
  }
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
      if (group !== 'engine') await writeText(dir, 'SOURCE.txt', `${browserImageModelLabel(group)} ONNX\n${assets(group).find(asset => asset.name.endsWith('.onnx'))?.url || ''}\nLicense: ${group === 'sdxs' ? 'Open RAIL++-M, CreativeML Open RAIL-M, and TAESD MIT' : group === 'supra-mobile' ? 'Apache 2.0; see LICENSE.txt and NOTICE.txt' : 'CreativeML Open RAIL-M'}\n`);
      publish({ installed: { ...state.installed, [group]: true }, checked: { ...state.checked, [group]: true }, legacyInstalled: group === 'engine' ? false : state.legacyInstalled, updateAvailable: group === 'engine' ? false : state.updateAvailable, active: null, current: '', revision: state.revision + 1 });
      showToast(`${group === 'engine' ? 'ONNX image engine' : browserImageModelLabel(group)} finished downloading.`);
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
  async discover(folder: FileSystemDirectoryHandle): Promise<void> {
    if (task) { await task; return this.discover(folder); }
    if (discovery?.folder === folder) return discovery.promise;
    const promise = (async () => {
      const installed = state.folder === folder ? { ...state.installed } : emptyGroups();
      const progress = state.folder === folder ? { ...state.saved } : emptyProgress();
      const checked = state.folder === folder ? { ...state.checked } : emptyGroups();
      const sameFolder = state.folder === folder;
      publish({ folder, installed, saved: progress, checked, queue: sameFolder ? state.queue : [], active: null, paused: sameFolder && state.paused, current: '', error: '', legacyInstalled: sameFolder && state.legacyInstalled, updateAvailable: sameFolder && state.updateAvailable });
      for (const group of ['engine', ...BROWSER_IMAGE_GROUPS] as const) {
        try {
          const dir = await browserImageDirectory(folder, group);
          const found = await Promise.all(assets(group).map(asset => verified(dir, asset)));
          progress[group] = group === 'engine' ? found.reduce((total, file, index) => total + (file ? assets(group)[index].bytes : 0), 0) : await saved(dir, group);
          installed[group] = found.every(Boolean);
          if (group === 'engine') {
            const previous = !installed.engine && (await Promise.all(BROWSER_IMAGE_PREVIOUS_ENGINE_ASSETS.map(asset => verified(dir, asset)))).every(Boolean);
            if (state.folder === folder) publish({ legacyInstalled: previous, updateAvailable: !installed.engine && await hasOnnxEngineNeedingUpdate(dir) });
          }
        } catch (error) {
          if (!missing(error)) throw error;
          progress[group] = 0;
          installed[group] = false;
          if (group === 'engine' && state.folder === folder) publish({ legacyInstalled: false, updateAvailable: false });
        }
        checked[group] = true;
        if (state.folder !== folder) return;
        publish({ installed: { ...state.installed, [group]: installed[group] }, saved: { ...state.saved, [group]: progress[group] }, checked: { ...state.checked, [group]: true } });
      }
      if (state.folder === folder) publish({ paused: (Object.keys(progress) as Group[]).some(group => progress[group] > 0 && !installed[group] && !(group === 'engine' && state.legacyInstalled)), revision: state.revision + 1 });
    })();
    discovery = { folder, promise };
    try { await promise; }
    finally { if (discovery?.promise === promise) discovery = null; }
  },
  queue(folder: FileSystemDirectoryHandle, group: Group) {
    if (state.folder && state.folder !== folder && task) throw new Error('An image download is active in another workspace.');
    if (state.folder === folder && (state.installed[group] || state.active === group || state.queue.includes(group))) return;
    if (group !== 'engine') {
      const packageBytes = browserImageTotal(group) + browserImageTotal('engine');
      if (packageBytes > VISUAL_PACKAGE_LIMIT_BYTES) throw new Error(visualPackageLimitMessage(browserImageModelLabel(group), packageBytes));
    }
    publish({ folder, queue: [...(state.folder === folder ? state.queue : []), group], paused: state.folder === folder && state.paused });
    startNext(folder);
  },
  pause() { publish({ paused: true }); controller?.abort(); },
  async pauseAndWait() { this.pause(); await Promise.all([task, discovery?.promise.catch(() => {})]); },
  resume(folder: FileSystemDirectoryHandle) { if (state.folder !== folder) return; publish({ paused: false, error: '' }); startNext(folder); },
};
export async function assertBrowserOnnxEngineFiles(folder: FileSystemDirectoryHandle) {
  const dir = await browserImageDirectory(folder, 'engine');
  const files = await Promise.all(BROWSER_IMAGE_ENGINE_ASSETS.map(asset => verified(dir, asset)));
  if (files.some(file => !file)) throw new Error('Download the ONNX image engine in Engines first.');
  return files as File[];
}
export async function assertBrowserImageFiles(folder: FileSystemDirectoryHandle, group: BrowserImageModelGroup = 'model') {
  const engine = await browserImageDirectory(folder, 'engine');
  const modelDir = await browserImageDirectory(folder, group);
  let engineVersion = '1.30.0';
  let engineFiles = await Promise.all(BROWSER_IMAGE_ENGINE_ASSETS.map(asset => verified(engine, asset)));
  if (engineFiles.some(file => !file) && imageModelAcceptsPreviousEngine(group)) {
    const previous = await Promise.all(BROWSER_IMAGE_PREVIOUS_ENGINE_ASSETS.map(asset => verified(engine, asset)));
    if (previous.every(Boolean)) { engineFiles = previous; engineVersion = '1.22.0'; }
  }
  const modelFiles = await Promise.all(assets(group).map(asset => verified(modelDir, asset)));
  if (engineFiles.some(file => !file) || modelFiles.some(file => !file)) throw new Error(`Download the ONNX image engine in Engines and ${browserImageModelLabel(group)} in Catalog first.`);
  if (state.folder === folder) publish({ installed: { ...state.installed, engine: engineVersion === '1.30.0' || state.installed.engine, [group]: true }, legacyInstalled: engineVersion === '1.22.0' || state.legacyInstalled, checked: { ...state.checked, engine: true, [group]: true }, saved: { ...state.saved, engine: engineVersion === '1.30.0' ? browserImageTotal('engine') : state.saved.engine, [group]: browserImageTotal(group) } });
  return { engineFiles: engineFiles as File[], modelFiles: modelFiles as File[], engineVersion };
}
