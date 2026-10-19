import { assertBrowserImageFiles, browserImageDefaultGuidance, browserImageDefaultSteps, type BrowserImageModelGroup } from './browserImageAssets';
import { clipTokenizer } from './clipTokenizer';
import { notifyResidentModelUnloaded, registerResidentModel, withLocalModelMemory } from './localModelMemory.ts';
import { unloadLocalOllama } from './localOllama.ts';
import type { Ort, TinyPipeline } from './tinySdPipeline.ts';
import { visualRuntimeFailure, visualRuntimeFailureMessage } from './visualRuntimeFailure.ts';

type Pipeline = {
  loadModels: (progress?: (value: { stage: string; model: string; index: number; total: number }) => void) => Promise<void>;
  generate: (prompt: string, options?: { seed?: number; steps?: number; onProgress?: (value: { step: number; totalSteps: number }) => void; onActivity?: (stage: string) => void; signal?: AbortSignal }) => Promise<{ imageData: ImageData }>;
  onPreview?: (value: BrowserImagePreview) => void;
  guidanceScale?: number;
  release: () => Promise<void>;
};
export type BrowserImagePreview = { step: number; totalSteps: number; imageData: ImageData };
export type BrowserImageOptions = { seed?: number; steps?: number; guidanceScale?: number; onStep?: (step: number, totalSteps: number) => void };
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
  ort?: { env: { logLevel: 'verbose' | 'info' | 'warning' | 'error' | 'fatal'; versions?: { web?: string }; wasm: { wasmPaths: { wasm: string; mjs: string }; numThreads: number } } };
  __riversSdTokenizer?: (text: string) => Promise<{ input_ids: { data: Int32Array } }>;
  __riversSdModel?: (url: string, key: string) => Promise<string>;
};

let folder: FileSystemDirectoryHandle | null = null;
let pipeline: Pipeline | null = null;
registerResidentModel('image', () => pipeline !== null, unloadBrowserImageModel, 5 * 60_000);
let loadedFor: FileSystemDirectoryHandle | null = null;
let loadedGroup: BrowserImageModelGroup | null = null;
let loading: Promise<Pipeline> | null = null;
let releasing: Promise<void> = Promise.resolve();
type ImageModelStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; message: string; folder: FileSystemDirectoryHandle | null };
let status: ImageModelStatus = { state: 'idle', message: '', folder: null };
const listeners = new Set<() => void>();
const publish = (next: ImageModelStatus) => { status = next; listeners.forEach(listener => listener()); };
export const getBrowserImageStatus = () => status;
export const subscribeBrowserImage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isBrowserImageLoadedFrom = (target: FileSystemDirectoryHandle | null, group: BrowserImageModelGroup = 'model') => !!target && pipeline !== null && loadedFor === target && loadedGroup === group;
const urls: string[] = [];
const globalRuntime = globalThis as RuntimeGlobal;
let runtimeSource: string | null = null;
const revokeUrls = () => { for (const url of urls.splice(0)) URL.revokeObjectURL(url); };

export function setBrowserImageFolder(next: FileSystemDirectoryHandle | null) {
  if (folder === next) return;
  folder = next;
  void withLocalModelMemory(() => unloadBrowserImageModel(), { claimResident: false });
}

export async function unloadBrowserImageModel() {
  const old = pipeline;
  pipeline = null; loadedFor = null; loadedGroup = null; loading = null;
  publish({ state: 'idle', message: '', folder: null });
  releasing = releasing.catch(() => {}).then(async () => {
    try { await old?.release(); }
    finally {
      revokeUrls();
      globalRuntime.__riversSdModel = undefined;
      globalRuntime.__riversSdTokenizer = undefined;
    }
  });
  try { await releasing; }
  finally { notifyResidentModelUnloaded(); }
}

async function load(folderForLoad: FileSystemDirectoryHandle, group: BrowserImageModelGroup, progress?: (message: string) => void): Promise<Pipeline> {
  if (!('gpu' in navigator)) throw new Error('This browser does not support WebGPU image generation.');
  const gpu = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
  const adapter = await gpu.gpu?.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available for image generation.');
  if (!adapter.features.has('shader-f16')) throw new Error('This GPU does not expose shader-f16, which this image model requires.');
  progress?.('Checking workspace files…');
  const { engineFiles, modelFiles, engineVersion } = await assertBrowserImageFiles(folderForLoad, group);
  if (group === 'model' || group === 'tiny-q4' || group === 'tiny-fp16') globalRuntime.__riversSdTokenizer = clipTokenizer(JSON.parse(await modelFiles[1].text()));
  const engineSource = `${engineVersion}/${engineFiles[4].name}/${engineFiles[4].lastModified}`;
  if (globalRuntime.ort?.env.versions?.web !== engineVersion || runtimeSource !== engineSource) {
    progress?.('Starting ONNX Runtime…');
    const js = URL.createObjectURL(new Blob([engineFiles[3]], { type: 'text/javascript' })); urls.push(js);
    const tag = document.createElement('script'); tag.src = js;
    await new Promise<void>((resolve, reject) => { tag.onload = () => resolve(); tag.onerror = () => reject(new Error('The saved ONNX Runtime could not start.')); document.head.append(tag); });
    tag.remove();
    runtimeSource = engineSource;
  }
  if (!globalRuntime.ort) throw new Error('The saved ONNX Runtime did not expose its browser API.');
  // WebGPU exports can emit many harmless CPU constant-folding warnings while
  // sessions initialize. Keep actual runtime errors visible in the console.
  globalRuntime.ort.env.logLevel = 'error';
  const mjs = URL.createObjectURL(new Blob([engineFiles[4]], { type: 'text/javascript' })); urls.push(mjs);
  const wasm = URL.createObjectURL(new Blob([engineFiles[5]], { type: 'application/wasm' })); urls.push(wasm);
  globalRuntime.ort.env.wasm.wasmPaths = { mjs, wasm };
  // A single thread avoids a SharedArrayBuffer header requirement on GitHub Pages.
  globalRuntime.ort.env.wasm.numThreads = 1;
  if (group === 'lcm') {
    const vocab = JSON.parse(await modelFiles[1].text());
    const merges = (await modelFiles[2].text()).split(/\r?\n/).filter(line => !!line && !line.startsWith('#'));
    const tokenizer = clipTokenizer({ model: { vocab, merges }, pre_tokenizer: { type: 'Sequence' } });
    const { createLcmPipeline } = await import('./lcmPipeline.ts');
    const instance = createLcmPipeline(globalRuntime.ort as unknown as import('./imagePipelineUtils.ts').ImageOrt, modelFiles.slice(3, 6), tokenizer, url => urls.push(url));
    try { await instance.loadModels(value => progress?.(`Loading ${value.model} (${value.index + 1}/${value.total})…`)); return instance as Pipeline; }
    catch (error) { await instance.release().catch(() => {}); throw error; }
  }
  if (group === 'supra-mobile') {
    const { createSupraPipeline, supraTokenizer } = await import('./supraPipeline.ts');
    const instance = createSupraPipeline(globalRuntime.ort as unknown as import('./imagePipelineUtils.ts').ImageOrt, modelFiles.slice(3, 6), supraTokenizer(JSON.parse(await modelFiles[2].text())), url => urls.push(url));
    try { await instance.loadModels(value => progress?.(`Loading ${value.model} (${value.index + 1}/${value.total})…`)); return instance as Pipeline; }
    catch (error) { await instance.release().catch(() => {}); throw error; }
  }
  if (group === 'sdxs') {
    const vocab = JSON.parse(await modelFiles[3].text());
    const merges = (await modelFiles[4].text()).split(/\r?\n/).filter(line => !!line && !line.startsWith('#'));
    const tokenizer = clipTokenizer({ model: { vocab, merges }, pre_tokenizer: { type: 'Sequence' } });
    const { createSdxsPipeline } = await import('./sdxsPipeline.ts');
    const instance = createSdxsPipeline(globalRuntime.ort as unknown as import('./sdxsPipeline.ts').SdxsOrt, modelFiles.slice(5, 8), tokenizer, url => urls.push(url));
    try {
      await instance.loadModels(value => progress?.(`Loading ${value.model} (${value.index + 1}/${value.total})…`));
      return instance as Pipeline;
    } catch (error) { await instance.release().catch(() => {}); throw error; }
  }
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
  const source = await engineFiles[2].text();
  const importLine = 'import { AutoTokenizer, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.13.4";';
  let patched = source.replace(importLine, 'const AutoTokenizer = null, env = null;')
    .replace('const _sdBaseUrl = new URL(".", import.meta.url).href;', "const _sdBaseUrl = ''; ")
    .replace('await this.initTokenizer();', 'this.tokenizer = globalThis.__riversSdTokenizer;')
    .replace('fetchWithCache(url, cacheKey,', 'globalThis.__riversSdModel(url, cacheKey,')
    .replace('const guidanceScale = 7.5;', 'const guidanceScale = this.guidanceScale ?? 7.5;')
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
  if (group !== 'model') {
    // Match the symbolic dimensions used by the Diffusers ONNX export.
    const optionsStart = patched.indexOf('const SD15_MODEL_OPTIONS = {');
    const optionsEnd = patched.indexOf('\n\nconst MODEL_CONFIGS = {', optionsStart);
    if (optionsStart < 0 || optionsEnd < 0) throw new Error('The saved image pipeline has unknown model options.');
    patched = patched.slice(0, optionsStart) + `const SD15_MODEL_OPTIONS = {
      text_encoder: { freeDimensionOverrides: { batch_size: 2, sequence_length: 77 } },
      unet: { freeDimensionOverrides: { batch_size: 2, sequence_length: 77, height: 64, width: 64 } },
      vae_decoder: { freeDimensionOverrides: { batch_size: 1, latent_height: 64, latent_width: 64 } },
    };` + patched.slice(optionsEnd);
  }
  if (patched === source || patched.includes(importLine) || patched.includes('new URL(".", import.meta.url)') || patched.includes('await this.initTokenizer();') || patched.includes('const buffer = await fetchWithCache(') || !patched.includes('this.onPreview({ step: step + 1') || !patched.includes('this.guidanceScale ?? 7.5')) throw new Error('The saved image pipeline changed and cannot be adapted safely.');
  const moduleUrl = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })); urls.push(moduleUrl);
  const module = await import(/* @vite-ignore */ moduleUrl) as { SDPipeline: new (id: string, options: { provider: string }) => Pipeline };
  const instance = new module.SDPipeline('sd-1.5', { provider: 'webgpu' });
  try {
    await instance.loadModels(value => progress?.(`Loading ${value.model} (${value.index + 1}/${value.total})…`));
    return instance;
  } catch (error) { await instance.release().catch(() => {}); throw error; }
}

async function ready(group: BrowserImageModelGroup, progress?: (message: string) => void) {
  await releasing;
  if (!folder) throw new Error('Connect a project folder to use the browser image generator.');
  if (pipeline && loadedFor === folder && loadedGroup === group) return pipeline;
  if (loading) return loading;
  const target = folder;
  publish({ state: 'loading', message: 'Loading image model…', folder: target });
  const report = (message: string) => { publish({ state: 'loading', message, folder: target }); progress?.(message); };
  loading = load(target, group, report).then(async instance => {
    if (folder !== target) { await instance.release(); throw new Error('The connected workspace changed while loading the image model.'); }
    pipeline = instance; loadedFor = target; loadedGroup = group; publish({ state: 'ready', message: 'Image model loaded', folder: target }); return instance;
  }).catch(error => {
    runtimeSource = null; revokeUrls();
    const message = visualRuntimeFailureMessage(error);
    publish({ state: 'error', message, folder: target });
    if (visualRuntimeFailure(error)) throw new Error(message, { cause: error });
    throw error;
  }).finally(() => { loading = null; });
  return loading;
}

async function prepareImageModel(group: BrowserImageModelGroup, progress?: (message: string) => void) {
  if (pipeline && loadedFor === folder && loadedGroup === group) return;
  if (pipeline) await unloadBrowserImageModel();
  if (!folder) throw new Error('Connect a project folder to use the browser image generator.');
  if (!('gpu' in navigator)) throw new Error('This browser does not support WebGPU image generation.');
  const gpu = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
  const adapter = await gpu.gpu?.requestAdapter();
  if (!adapter?.features.has('shader-f16')) throw new Error('This GPU does not expose shader-f16, which this image model requires.');
  await assertBrowserImageFiles(folder, group);
  progress?.('Releasing local text models…');
  const [{ unloadBrowserModel }, { unloadNeedle }] = await Promise.all([import('./browserModel.ts'), import('./needleRuntime.ts')]);
  await unloadBrowserModel();
  await unloadNeedle();
  await (await import('./browserSpeech.ts')).unloadBrowserSpeech();
  await (await import('./browserTranscription.ts')).unloadBrowserTranscription();
  await unloadLocalOllama();
}

export async function loadBrowserImageModel(group: BrowserImageModelGroup = 'model', progress?: (message: string) => void) {
  return withLocalModelMemory(async () => { await prepareImageModel(group, progress); await ready(group, progress); });
}

export async function generateBrowserImage(prompt: string, signal?: AbortSignal, progress?: (message: string) => void, onPreview?: (value: BrowserImagePreview) => void, group: BrowserImageModelGroup = 'model', options: BrowserImageOptions = {}): Promise<Blob> {
  return withLocalModelMemory(async () => {
    const steps = options.steps ?? browserImageDefaultSteps(group);
    const guidanceScale = options.guidanceScale ?? browserImageDefaultGuidance(group);
    if (!Number.isInteger(steps) || (group === 'sdxs' ? steps !== 1 : group === 'lcm' ? steps !== 4 : group === 'supra-mobile' ? steps < 12 || steps > 40 : group === 'model' ? ![20, 25, 50].includes(steps) : steps < 10 || steps > 50)) throw new Error('Unsupported image step count.');
    if (group === 'sdxs' || group === 'lcm' ? guidanceScale !== 0 : !Number.isFinite(guidanceScale) || guidanceScale < 1 || guidanceScale > 12) throw new Error('Unsupported prompt strength.');
    if (signal?.aborted) throw signal.reason;
    await prepareImageModel(group, progress);
    const model = await ready(group, progress);
    progress?.('Generating image…');
    model.onPreview = onPreview;
    model.guidanceScale = guidanceScale;
    let result: { imageData: ImageData };
    try {
      const onProgress = (value: { step: number; totalSteps: number }) => {
        if (signal?.aborted) throw signal.reason;
        progress?.(`Generating image · ${value.step}/${value.totalSteps}`);
        options.onStep?.(value.step, value.totalSteps);
      };
      result = group === 'model' || group === 'sdxs' || group === 'lcm' || group === 'supra-mobile'
        ? await model.generate(prompt, { seed: options.seed, steps, onProgress, signal, onActivity: group === 'supra-mobile' ? stage => progress?.(stage) : undefined })
        : await (await import('./tinySdPipeline.ts')).generateTinySd(model as unknown as TinyPipeline, globalRuntime.ort as unknown as Ort, prompt, steps, onProgress, options.seed, guidanceScale);
    } catch (cause) {
      if (visualRuntimeFailure(cause)) {
        await unloadBrowserImageModel().catch(() => {});
        throw new Error(`${visualRuntimeFailureMessage(cause)} The image model was unloaded.`, { cause });
      }
      throw cause;
    } finally { model.onPreview = undefined; }
    if (signal?.aborted) throw signal.reason;
    const canvas = document.createElement('canvas');
    canvas.width = result.imageData.width; canvas.height = result.imageData.height;
    canvas.getContext('2d')?.putImageData(result.imageData, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The generated image could not be encoded.')), 'image/png'));
  });
}
