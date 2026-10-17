import { assertBrowserImageFiles } from './browserImageAssets';
import { clipTokenizer } from './clipTokenizer';
import { withLocalModelMemory } from './localModelMemory.ts';
import { unloadLocalOllama } from './localOllama.ts';

type Pipeline = {
  loadModels: (progress?: (value: { stage: string; model: string; index: number; total: number }) => void) => Promise<void>;
  generate: (prompt: string, options?: { seed?: number; steps?: number; onProgress?: (value: { step: number; totalSteps: number }) => void }) => Promise<{ imageData: ImageData }>;
  onPreview?: (value: BrowserImagePreview) => void;
  release: () => Promise<void>;
};
export type BrowserImagePreview = { step: number; totalSteps: number; imageData: ImageData };
export function browserImagePreviewDataUrl(imageData: ImageData) {
  const source = document.createElement('canvas');
  source.width = imageData.width; source.height = imageData.height;
  source.getContext('2d')?.putImageData(imageData, 0, 0);
  const preview = document.createElement('canvas');
  preview.width = 256; preview.height = 256;
  preview.getContext('2d')?.drawImage(source, 0, 0, preview.width, preview.height);
  return preview.toDataURL('image/png');
}
type RuntimeGlobal = typeof globalThis & {
  ort?: { env: { wasm: { wasmPaths: { wasm: string; mjs: string }; numThreads: number } } };
  __riversSdTokenizer?: (text: string) => Promise<{ input_ids: { data: Int32Array } }>;
  __riversSdModel?: (url: string, key: string) => Promise<string>;
};

let folder: FileSystemDirectoryHandle | null = null;
let pipeline: Pipeline | null = null;
let loadedFor: FileSystemDirectoryHandle | null = null;
let loading: Promise<Pipeline> | null = null;
let releasing: Promise<void> = Promise.resolve();
type ImageModelStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; message: string; folder: FileSystemDirectoryHandle | null };
let status: ImageModelStatus = { state: 'idle', message: '', folder: null };
const listeners = new Set<() => void>();
const publish = (next: ImageModelStatus) => { status = next; listeners.forEach(listener => listener()); };
export const getBrowserImageStatus = () => status;
export const subscribeBrowserImage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isBrowserImageLoadedFrom = (target: FileSystemDirectoryHandle | null) => !!target && pipeline !== null && loadedFor === target;
const urls: string[] = [];
const globalRuntime = globalThis as RuntimeGlobal;
const revokeUrls = () => { for (const url of urls.splice(0)) URL.revokeObjectURL(url); };

export function setBrowserImageFolder(next: FileSystemDirectoryHandle | null) {
  if (folder === next) return;
  folder = next;
  void withLocalModelMemory(() => unloadBrowserImageModel());
}

export async function unloadBrowserImageModel() {
  const old = pipeline;
  pipeline = null; loadedFor = null; loading = null;
  publish({ state: 'idle', message: '', folder: null });
  releasing = releasing.catch(() => {}).then(async () => {
    try { await old?.release(); }
    finally {
      revokeUrls();
      globalRuntime.__riversSdModel = undefined;
      globalRuntime.__riversSdTokenizer = undefined;
    }
  });
  await releasing;
}

async function load(folderForLoad: FileSystemDirectoryHandle, progress?: (message: string) => void): Promise<Pipeline> {
  if (!('gpu' in navigator)) throw new Error('This browser does not support WebGPU image generation.');
  const gpu = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
  const adapter = await gpu.gpu?.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available for image generation.');
  if (!adapter.features.has('shader-f16')) throw new Error('This GPU does not expose shader-f16, which this Stable Diffusion model requires.');
  progress?.('Checking workspace files…');
  const { engineFiles, modelFiles } = await assertBrowserImageFiles(folderForLoad);
  globalRuntime.__riversSdTokenizer = clipTokenizer(JSON.parse(await modelFiles[1].text()));
  const modelFile = new Map([
    ['sd-1.5_text_encoder', modelFiles[2]],
    ['sd-1.5_unet', modelFiles[3]],
    ['sd-1.5_vae_decoder', modelFiles[4]],
  ]);
  globalRuntime.__riversSdModel = async (_url, key) => {
    const file = modelFile.get(key);
    if (!file) throw new Error(`The saved ${key} component is missing.`);
    const url = URL.createObjectURL(file);
    urls.push(url);
    return url;
  };
  if (!globalRuntime.ort) {
    progress?.('Starting ONNX Runtime…');
    const js = URL.createObjectURL(new Blob([engineFiles[3]], { type: 'text/javascript' })); urls.push(js);
    const tag = document.createElement('script'); tag.src = js;
    await new Promise<void>((resolve, reject) => { tag.onload = () => resolve(); tag.onerror = () => reject(new Error('The saved ONNX Runtime could not start.')); document.head.append(tag); });
    tag.remove();
  }
  if (!globalRuntime.ort) throw new Error('The saved ONNX Runtime did not expose its browser API.');
  const mjs = URL.createObjectURL(new Blob([engineFiles[4]], { type: 'text/javascript' })); urls.push(mjs);
  const wasm = URL.createObjectURL(new Blob([engineFiles[5]], { type: 'application/wasm' })); urls.push(wasm);
  globalRuntime.ort.env.wasm.wasmPaths = { mjs, wasm };
  // A single thread avoids a SharedArrayBuffer header requirement on GitHub Pages.
  globalRuntime.ort.env.wasm.numThreads = 1;
  const source = await engineFiles[2].text();
  const importLine = 'import { AutoTokenizer, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.13.4";';
  const patched = source.replace(importLine, 'const AutoTokenizer = null, env = null;')
    .replace('const _sdBaseUrl = new URL(".", import.meta.url).href;', "const _sdBaseUrl = ''; ")
    .replace('await this.initTokenizer();', 'this.tokenizer = globalThis.__riversSdTokenizer;')
    .replace('fetchWithCache(url, cacheKey,', 'globalThis.__riversSdModel(url, cacheKey,')
    .replace('            onProgress && onProgress({ step: step + 1, totalSteps: steps });', `            onProgress && onProgress({ step: step + 1, totalSteps: steps });
            if (this.onPreview && step < steps - 1 && (step === 0 || (step + 1) % 4 === 0)) {
                try {
                    const previewInput = f16Array(Array.from(latents, v => v / 0.18215));
                    const previewTensor = new ort.Tensor("float16", previewInput, [1, latentC, latentH, latentW]);
                    const previewOutput = await this.sessions.vae_decoder.run({ latent_sample: previewTensor });
                    this.onPreview({ step: step + 1, totalSteps: steps, imageData: _vaeOutputToImageData(previewOutput.sample.data, width, height) });
                } catch (error) {
                    this.onPreview = undefined;
                    console.warn('Live image preview unavailable; continuing generation.', error);
                }
            }`);
  if (patched === source || patched.includes(importLine) || patched.includes('new URL(".", import.meta.url)') || patched.includes('await this.initTokenizer();') || patched.includes('const buffer = await fetchWithCache(') || !patched.includes('this.onPreview({ step: step + 1')) throw new Error('The saved image pipeline changed and cannot be adapted safely.');
  const moduleUrl = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })); urls.push(moduleUrl);
  const module = await import(/* @vite-ignore */ moduleUrl) as { SDPipeline: new (id: string, options: { provider: string }) => Pipeline };
  const instance = new module.SDPipeline('sd-1.5', { provider: 'webgpu' });
  try {
    await instance.loadModels(value => progress?.(`Loading ${value.model} (${value.index + 1}/${value.total})…`));
    return instance;
  } catch (error) { await instance.release().catch(() => {}); throw error; }
}

async function ready(progress?: (message: string) => void) {
  await releasing;
  if (!folder) throw new Error('Connect a project folder to use the browser image generator.');
  if (pipeline && loadedFor === folder) return pipeline;
  if (loading) return loading;
  const target = folder;
  publish({ state: 'loading', message: 'Loading image model…', folder: target });
  const report = (message: string) => { publish({ state: 'loading', message, folder: target }); progress?.(message); };
  loading = load(target, report).then(async instance => {
    if (folder !== target) { await instance.release(); throw new Error('The connected workspace changed while loading the image model.'); }
    pipeline = instance; loadedFor = target; publish({ state: 'ready', message: 'Image model loaded', folder: target }); return instance;
  }).catch(error => { revokeUrls(); publish({ state: 'error', message: error instanceof Error ? error.message : String(error), folder: target }); throw error; }).finally(() => { loading = null; });
  return loading;
}

async function prepareImageModel(progress?: (message: string) => void) {
  if (pipeline) return;
  if (!folder) throw new Error('Connect a project folder to use the browser image generator.');
  if (!('gpu' in navigator)) throw new Error('This browser does not support WebGPU image generation.');
  const gpu = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
  const adapter = await gpu.gpu?.requestAdapter();
  if (!adapter?.features.has('shader-f16')) throw new Error('This GPU does not expose shader-f16, which this Stable Diffusion model requires.');
  await assertBrowserImageFiles(folder);
  progress?.('Releasing local text models…');
  const [{ unloadBrowserModel }, { unloadNeedle }] = await Promise.all([import('./browserModel.ts'), import('./needleRuntime.ts')]);
  await unloadBrowserModel();
  await unloadNeedle();
  await unloadLocalOllama();
}

export async function loadBrowserImageModel(progress?: (message: string) => void) {
  return withLocalModelMemory(async () => { await prepareImageModel(progress); await ready(progress); });
}

export async function generateBrowserImage(prompt: string, signal?: AbortSignal, progress?: (message: string) => void, onPreview?: (value: BrowserImagePreview) => void): Promise<Blob> {
  return withLocalModelMemory(async () => {
    if (signal?.aborted) throw signal.reason;
    await prepareImageModel(progress);
    const model = await ready(progress);
    progress?.('Generating image…');
    model.onPreview = onPreview;
    let result: { imageData: ImageData };
    try {
      result = await model.generate(prompt, { steps: 20, onProgress: value => {
        if (signal?.aborted) throw signal.reason;
        progress?.(`Generating image · ${value.step}/${value.totalSteps}`);
      } });
    } finally { model.onPreview = undefined; }
    if (signal?.aborted) throw signal.reason;
    const canvas = document.createElement('canvas');
    canvas.width = result.imageData.width; canvas.height = result.imageData.height;
    canvas.getContext('2d')?.putImageData(result.imageData, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The generated image could not be encoded.')), 'image/png'));
  });
}
