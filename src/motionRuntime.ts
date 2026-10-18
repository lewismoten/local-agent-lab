import { assertBrowserOnnxEngineFiles } from './browserImageAssets.ts';
import { unloadBrowserImageModel } from './browserImage.ts';
import { unloadBrowserModel } from './browserModel.ts';
import { unloadBrowserSpeech } from './browserSpeech.ts';
import { unloadBrowserTranscription } from './browserTranscription.ts';
import { withLocalModelMemory } from './localModelMemory.ts';
import { unloadLocalOllama } from './localOllama.ts';
import { unloadNeedle } from './needleRuntime.ts';
import { assertMotionFiles, type MotionModel } from './motionAssets.ts';
import type { ImageOrt, ImageSession, ImageTensor } from './imagePipelineUtils.ts';

type RuntimeGlobal = typeof globalThis & { ort?: ImageOrt & { env: { logLevel: string; wasm: { wasmPaths: { mjs: string; wasm: string }; numThreads: number } } } };
const runtimeGlobal = globalThis as RuntimeGlobal;
let loadedScript = '';
let runtimeUrls: string[] = [];
const imageSide = 512;

async function prepare(folder: FileSystemDirectoryHandle, id: MotionModel) {
  const [modelFiles, engineFiles] = await Promise.all([assertMotionFiles(folder, id), assertBrowserOnnxEngineFiles(folder)]);
  await unloadBrowserImageModel();
  await unloadBrowserModel();
  await unloadNeedle();
  await unloadBrowserSpeech();
  await unloadBrowserTranscription();
  await unloadLocalOllama();
  const scriptKey = `${engineFiles[3].size}/${engineFiles[3].lastModified}`;
  if (!runtimeGlobal.ort || loadedScript !== scriptKey) {
    const url = URL.createObjectURL(new Blob([engineFiles[3]], { type: 'text/javascript' }));
    const script = document.createElement('script'); script.src = url;
    try { await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error('The saved ONNX engine could not start.')); document.head.append(script); }); }
    finally { script.remove(); URL.revokeObjectURL(url); }
    loadedScript = scriptKey;
  }
  if (!runtimeGlobal.ort) throw new Error('The saved ONNX engine did not expose its browser API.');
  for (const url of runtimeUrls) URL.revokeObjectURL(url);
  const mjs = URL.createObjectURL(new Blob([engineFiles[4]], { type: 'text/javascript' }));
  const wasm = URL.createObjectURL(new Blob([engineFiles[5]], { type: 'application/wasm' }));
  runtimeUrls = [mjs, wasm];
  runtimeGlobal.ort.env.logLevel = 'error';
  runtimeGlobal.ort.env.wasm.wasmPaths = { mjs, wasm };
  runtimeGlobal.ort.env.wasm.numThreads = 1;
  return modelFiles[modelFiles.length - 1];
}
async function withSession<T>(folder: FileSystemDirectoryHandle, id: MotionModel, work: (ort: ImageOrt, session: ImageSession) => Promise<T>): Promise<T> {
  return withLocalModelMemory(async () => {
    const file = await prepare(folder, id);
    const url = URL.createObjectURL(file);
    let session: ImageSession | undefined;
    try {
      if (!runtimeGlobal.ort) throw new Error('ONNX engine unavailable.');
      try { session = await runtimeGlobal.ort.InferenceSession.create(url, { executionProviders: ['webgpu'], logSeverityLevel: 3 }); }
      catch (webgpuError) {
        try { session = await runtimeGlobal.ort.InferenceSession.create(url, { executionProviders: ['wasm'], logSeverityLevel: 3 }); }
        catch { throw webgpuError; }
      }
      return await work(runtimeGlobal.ort, session);
    } finally { await session?.release().catch(() => {}); URL.revokeObjectURL(url); }
  });
}
export async function imageDataFromBlob(blob: Blob, width = imageSide, height = imageSide) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable.');
    // Cover preserves the aspect ratio and gives both models the same frame size.
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    context.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    return context.getImageData(0, 0, width, height);
  } finally { bitmap.close(); }
}
function planes(image: ImageData, normalize: boolean) {
  const area = image.width * image.height;
  const values = new Float32Array(area * 3);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < area; i++) for (let channel = 0; channel < 3; channel++) {
    const value = image.data[4 * i + channel] / 255;
    values[channel * area + i] = normalize ? (value - mean[channel]) / std[channel] : value;
  }
  return values;
}
export async function estimateDepth(folder: FileSystemDirectoryHandle, image: ImageData): Promise<{ data: Float32Array; width: number; height: number }> {
  // DPT's published processor resizes to 518 and normalizes ImageNet RGB channels.
  const canvas = document.createElement('canvas'); canvas.width = 518; canvas.height = 518;
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  source.getContext('2d')?.putImageData(image, 0, 0);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(source, 0, 0, 518, 518);
  const processed = context.getImageData(0, 0, 518, 518);
  return withSession(folder, 'depth', async (ort, session) => {
    const output = await session.run({ pixel_values: new ort.Tensor('float32', planes(processed, true), [1, 3, 518, 518]) });
    const tensor = output.predicted_depth as ImageTensor | undefined;
    if (!tensor || tensor.dims.length < 3) throw new Error('The depth model returned no depth map.');
    const width = Number(tensor.dims.at(-1)), height = Number(tensor.dims.at(-2));
    const data = Float32Array.from(tensor.data);
    if (data.length !== width * height) throw new Error('The depth map has an unexpected shape.');
    let min = Infinity, max = -Infinity;
    for (const value of data) { if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); } }
    const scale = max > min ? 1 / (max - min) : 0;
    for (let i = 0; i < data.length; i++) data[i] = Number.isFinite(data[i]) ? (data[i] - min) * scale : 0;
    return { data, width, height };
  });
}
export function depthPreview(depth: { data: Float32Array; width: number; height: number }) {
  const output = new ImageData(depth.width, depth.height);
  for (let i = 0; i < depth.data.length; i++) {
    const gray = Math.round(Math.min(1, Math.max(0, depth.data[i])) * 255);
    output.data.set([gray, gray, gray, 255], i * 4);
  }
  return output;
}
export function parallaxFrame(source: ImageData, depth: { data: Float32Array; width: number; height: number }, phase: number, strength: number) {
  const result = new ImageData(source.width, source.height);
  const shift = Math.sin(phase * Math.PI * 2) * strength;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const depthX = Math.min(depth.width - 1, Math.floor(x * depth.width / source.width));
    const depthY = Math.min(depth.height - 1, Math.floor(y * depth.height / source.height));
    const near = depth.data[depthY * depth.width + depthX];
    const sourceX = Math.min(source.width - 1, Math.max(0, Math.round(x + shift * (near - 0.35))));
    const from = (y * source.width + sourceX) * 4, to = (y * source.width + x) * 4;
    result.data[to] = source.data[from]; result.data[to + 1] = source.data[from + 1];
    result.data[to + 2] = source.data[from + 2]; result.data[to + 3] = 255;
  }
  return result;
}
export async function interpolateRife(folder: FileSystemDirectoryHandle, first: ImageData, last: ImageData, position: number): Promise<ImageData> {
  if (first.width !== last.width || first.height !== last.height || first.width % 32 || first.height % 32) throw new Error('RIFE frames must have matching dimensions divisible by 32.');
  return withSession(folder, 'rife', async (ort, session) => {
    const dims = [1, 3, first.height, first.width];
    const result = await session.run({ img0: new ort.Tensor('float32', planes(first, false), dims), img1: new ort.Tensor('float32', planes(last, false), dims), timestep: new ort.Tensor('float32', new Float32Array([position]), [1]) });
    const tensor = result.output as ImageTensor | undefined;
    if (!tensor || tensor.data.length !== first.width * first.height * 3) throw new Error('RIFE returned an unexpected frame.');
    const image = new ImageData(first.width, first.height), area = first.width * first.height;
    for (let i = 0; i < area; i++) {
      for (let channel = 0; channel < 3; channel++) image.data[i * 4 + channel] = Math.max(0, Math.min(255, Math.round(tensor.data[channel * area + i] * 255)));
      image.data[i * 4 + 3] = 255;
    }
    return image;
  });
}

export async function recordFrames(frames: ImageData[], fps: number, onFrame?: (index: number) => void, signal?: AbortSignal) {
  if (!frames.length) throw new Error('No frames to record.');
  const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = frames[0].height;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream || !('MediaRecorder' in window)) throw new Error('This browser cannot record a canvas video.');
  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  if (!track?.requestFrame) {
    stream.getTracks().forEach(item => item.stop());
    stream = canvas.captureStream(fps);
    track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('This browser cannot encode WebM video.');
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error('Video recording failed.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });
  try {
    recorder.start();
    for (let i = 0; i < frames.length; i++) {
      if (signal?.aborted) throw signal.reason;
      context.putImageData(frames[i], 0, 0);
      track.requestFrame?.();
      onFrame?.(i + 1);
      await new Promise(resolve => setTimeout(resolve, 1000 / fps));
    }
    recorder.stop();
    return await finished;
  } finally { if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach(track => track.stop()); }
}
