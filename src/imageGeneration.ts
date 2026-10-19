import { unloadLocalOllama } from './localOllama.ts';
import { withLocalModelMemory } from './localModelMemory.ts';
import type { BrowserImagePreview } from './browserImage.ts';
import type { BrowserImageModelGroup } from './browserImageAssets.ts';
import { showToast } from './toastStore.ts';

export type ImageProvider = 'openai' | 'bonsai' | 'compatible' | 'browser';
export type ImagePreset = 'none' | 'openai' | 'bonsai' | 'tiny-sd' | 'small-sd' | 'pixart-delta' | 'browser-sd15' | 'browser-tiny-q4' | 'browser-tiny-fp16' | 'browser-sdxs' | 'browser-lcm' | 'browser-supra-mobile';
export type ImageConfig = { preset: ImagePreset; provider: ImageProvider; endpoint: string; model: string; apiKey: string; backend?: string; steps?: number; guidanceScale?: number };

export const browserImagePresetForGroup = (group: BrowserImageModelGroup): ImagePreset =>
  group === 'tiny-q4' ? 'browser-tiny-q4' : group === 'tiny-fp16' ? 'browser-tiny-fp16' : group === 'sdxs' ? 'browser-sdxs' : group === 'lcm' ? 'browser-lcm' : group === 'supra-mobile' ? 'browser-supra-mobile' : 'browser-sd15';

export const IMAGE_PRESETS: Record<ImagePreset, ImageConfig> = {
  none: { preset: 'none', provider: 'compatible', endpoint: '', model: '', apiKey: '' },
  openai: { preset: 'openai', provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '' },
  bonsai: { preset: 'bonsai', provider: 'bonsai', endpoint: 'http://localhost:8003', model: 'Bonsai Image 4B', apiKey: '', backend: 'bonsai-ternary-mlx' },
  'tiny-sd': { preset: 'tiny-sd', provider: 'compatible', endpoint: 'http://localhost:8001/v1', model: 'diffusers/tiny-stable-diffusion-torch', apiKey: '' },
  'small-sd': { preset: 'small-sd', provider: 'compatible', endpoint: 'http://localhost:8001/v1', model: 'OFA-Sys/small-stable-diffusion-v0', apiKey: '' },
  'pixart-delta': { preset: 'pixart-delta', provider: 'compatible', endpoint: 'http://localhost:8002/v1', model: 'PixArt-alpha/PixArt-LCM-XL-2-1024-MS', apiKey: '' },
  'browser-sd15': { preset: 'browser-sd15', provider: 'browser', endpoint: '', model: 'Stable Diffusion 1.5 ONNX', apiKey: '' },
  'browser-tiny-q4': { preset: 'browser-tiny-q4', provider: 'browser', endpoint: '', model: 'Tiny-SD Q4 ONNX', apiKey: '' },
  'browser-tiny-fp16': { preset: 'browser-tiny-fp16', provider: 'browser', endpoint: '', model: 'Tiny-SD FP16 ONNX', apiKey: '' },
  'browser-sdxs': { preset: 'browser-sdxs', provider: 'browser', endpoint: '', model: 'SDXS DreamShaper ONNX', apiKey: '', steps: 1, guidanceScale: 0 },
  'browser-lcm': { preset: 'browser-lcm', provider: 'browser', endpoint: '', model: 'DreamShaper 8 LCM INT8 ONNX', apiKey: '', steps: 4, guidanceScale: 0 },
  'browser-supra-mobile': { preset: 'browser-supra-mobile', provider: 'browser', endpoint: '', model: 'Supra2-IMG Mobile ONNX', apiKey: '', steps: 20, guidanceScale: 3 },
};

export function imageConfigured(config: ImageConfig) {
  return config.preset !== 'none' && (config.provider === 'browser' || !!config.endpoint.trim() && !!config.model.trim() && (config.provider !== 'openai' || !!config.apiKey));
}

export type ImageGenerationRecord = { model: string; provider: ImageProvider; prompt: string };
type ImageGeneratedRecorder = (image: Blob, request: ImageGenerationRecord) => Promise<void>;
const imageRecorderHost = globalThis as typeof globalThis & { __localAgentLabImageRecorder?: ImageGeneratedRecorder };
/** The active harness captures its workspace before an image request begins. */
export function setImageGeneratedRecorder(recorder: ImageGeneratedRecorder | null): () => void {
  imageRecorderHost.__localAgentLabImageRecorder = recorder || undefined;
  return () => { if (imageRecorderHost.__localAgentLabImageRecorder === recorder) imageRecorderHost.__localAgentLabImageRecorder = undefined; };
}

function imageBlobFromBase64(encoded: string): Blob {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const type = bytes[0] === 0x89 && ascii(1, 4) === 'PNG' ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp'
        : ascii(0, 3) === 'GIF' ? 'image/gif'
          : ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12)) ? 'image/avif' : '';
  if (!type) throw new Error('The image provider returned an unsupported image format.');
  return new Blob([bytes], { type });
}

export async function generateImage(config: ImageConfig, prompt: string, signal?: AbortSignal, onProgress?: (message: string) => void, onPreview?: (value: BrowserImagePreview) => void, workspace?: FileSystemDirectoryHandle | null, onStep?: (step: number, totalSteps: number) => void, seed?: number): Promise<Blob> {
  const recorder = imageRecorderHost.__localAgentLabImageRecorder;
  const result = await generateImageImpl(config, prompt, signal, onProgress, onPreview, workspace, onStep, seed);
  if (recorder) {
    try { await recorder(result, { model: config.model, provider: config.provider, prompt }); }
    catch (error) {
      console.warn('Image generated but could not be saved to the image library:', error);
      showToast('Image created, but could not be saved to Images.', 'error');
    }
  }
  return result;
}

async function generateImageImpl(config: ImageConfig, prompt: string, signal?: AbortSignal, onProgress?: (message: string) => void, onPreview?: (value: BrowserImagePreview) => void, workspace?: FileSystemDirectoryHandle | null, onStep?: (step: number, totalSteps: number) => void, seed?: number): Promise<Blob> {
  if (!imageConfigured(config)) throw new Error('Choose an image generator in AI profiles first.');
  if (config.provider === 'browser') {
    const group: BrowserImageModelGroup = config.preset === 'browser-tiny-q4' ? 'tiny-q4' : config.preset === 'browser-tiny-fp16' ? 'tiny-fp16' : config.preset === 'browser-sdxs' ? 'sdxs' : config.preset === 'browser-lcm' ? 'lcm' : config.preset === 'browser-supra-mobile' ? 'supra-mobile' : 'model';
    const runtime = await import('./browserImage.ts');
    if (workspace) runtime.setBrowserImageFolder(workspace);
    return runtime.generateBrowserImage(prompt, signal, onProgress, onPreview, group, { steps: config.steps, guidanceScale: config.guidanceScale, onStep, seed });
  }
  let localEndpoint = false;
  try { localEndpoint = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.endpoint).hostname); } catch { /* Fetch will report the endpoint error. */ }
  if (localEndpoint) return withLocalModelMemory(async () => {
    onProgress?.('Releasing local text models…');
    if (typeof window !== 'undefined') {
      const [{ unloadBrowserModel }, { unloadNeedle }, { unloadBrowserImageModel }] = await Promise.all([import('./browserModel.ts'), import('./needleRuntime.ts'), import('./browserImage.ts')]);
      await unloadBrowserModel();
      await unloadNeedle();
      await unloadBrowserImageModel();
    }
    await unloadLocalOllama();
    return generateRemoteImage(config, prompt, signal);
  });
  return generateRemoteImage(config, prompt, signal);
}

async function generateRemoteImage(config: ImageConfig, prompt: string, signal?: AbortSignal): Promise<Blob> {
  const base = config.endpoint.trim().replace(/\/+$/, '');
  const response = config.provider === 'bonsai'
    ? await fetch(`${base}/generate`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, backend: config.backend || 'bonsai-ternary-mlx', width: 512, height: 512, steps: 4, guidance: 1 }),
    })
    : await fetch(`${base}/images/generations`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, prompt, size: config.preset === 'pixart-delta' || config.preset === 'openai' ? '1024x1024' : '512x512', ...(config.provider === 'compatible' ? { response_format: 'b64_json' } : {}) }),
    });
  if (!response.ok) throw new Error(`Image request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  if (config.provider === 'bonsai') {
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Bonsai Image returned data that was not an image.');
    return blob;
  }
  const body = await response.json();
  const encoded = body.data?.[0]?.b64_json;
  if (typeof encoded === 'string') return imageBlobFromBase64(encoded);
  const url = body.data?.[0]?.url;
  if (typeof url === 'string') {
    const image = await fetch(url, { signal });
    if (!image.ok) throw new Error(`Could not fetch generated image (${image.status}).`);
    return image.blob();
  }
  throw new Error('The image provider returned no image.');
}
