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
import { MP4_RECORDER_FORMATS, WEBM_RECORDER_FORMATS, type VideoExportFormat } from './videoEncodingSupport.ts';

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
async function withSession<T>(folder: FileSystemDirectoryHandle, id: MotionModel, work: (ort: ImageOrt, session: ImageSession) => Promise<T>, onBackend?: (backend: 'WebGPU' | 'WASM') => void): Promise<T> {
  return withLocalModelMemory(async () => {
    const file = await prepare(folder, id);
    const url = URL.createObjectURL(file);
    let session: ImageSession | undefined;
    let backend: 'WebGPU' | 'WASM' = 'WebGPU';
    try {
      if (!runtimeGlobal.ort) throw new Error('ONNX engine unavailable.');
      try { session = await runtimeGlobal.ort.InferenceSession.create(url, { executionProviders: ['webgpu'], logSeverityLevel: 3 }); }
      catch (webgpuError) {
        try { session = await runtimeGlobal.ort.InferenceSession.create(url, { executionProviders: ['wasm'], logSeverityLevel: 3 }); backend = 'WASM'; }
        catch { throw webgpuError; }
      }
      onBackend?.(backend);
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
export async function estimateDepth(folder: FileSystemDirectoryHandle, image: ImageData, onBackend?: (backend: 'WebGPU' | 'WASM') => void): Promise<{ data: Float32Array; width: number; height: number }> {
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
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('The depth model returned no finite depth values.');
    const scale = max > min ? 1 / (max - min) : 0;
    for (let i = 0; i < data.length; i++) data[i] = Number.isFinite(data[i]) ? (data[i] - min) * scale : 0;
    return { data, width, height };
  }, onBackend);
}
export function depthPreview(depth: { data: Float32Array; width: number; height: number }) {
  const output = new ImageData(depth.width, depth.height);
  for (let i = 0; i < depth.data.length; i++) {
    const gray = Math.round(Math.min(1, Math.max(0, depth.data[i])) * 255);
    output.data.set([gray, gray, gray, 255], i * 4);
  }
  return output;
}
export async function depthFromBlob(blob: Blob, width = imageSide, height = imageSide) {
  const image = await imageDataFromBlob(blob, width, height);
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const offset = i * 4;
    const alpha = image.data[offset + 3] / 255;
    const luminance = (0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2]) / 255;
    data[i] = luminance * alpha;
  }
  return { data, width, height };
}
export type ParallaxControls = { strengthPx: number; panXPx: number; panYPx: number; zoomPercent: number; tiltDegrees: number };
export type CameraEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type CameraKeyframe = { at: number; camera: ParallaxControls; easing: CameraEasing };
const cameraKeys = ['strengthPx', 'panXPx', 'panYPx', 'zoomPercent', 'tiltDegrees'] as const;
export const neutralCamera = (): ParallaxControls => ({ strengthPx: 0, panXPx: 0, panYPx: 0, zoomPercent: 0, tiltDegrees: 0 });
function reflectedPixel(position: number, size: number) {
  if (size <= 1) return 0;
  const pixel = Math.round(position);
  if (pixel >= 0 && pixel < size) return pixel;
  const period = 2 * (size - 1);
  const wrapped = ((pixel % period) + period) % period;
  return wrapped < size ? wrapped : period - wrapped;
}

export function loopCameraAt(controls: ParallaxControls, phase: number): ParallaxControls {
  const radians = phase * Math.PI * 2;
  const sine = Math.sin(radians);
  const wave = Math.abs(sine) < 1e-12 ? 0 : sine;
  return { strengthPx: controls.strengthPx * wave, panXPx: controls.panXPx * wave, panYPx: controls.panYPx * wave, zoomPercent: controls.zoomPercent * (1 - Math.cos(radians)) / 2, tiltDegrees: controls.tiltDegrees * wave };
}

export function cameraAtKeyframes(keyframes: CameraKeyframe[], phase: number): ParallaxControls {
  if (!keyframes.length) return neutralCamera();
  const ordered = [...keyframes].sort((a, b) => a.at - b.at);
  if (phase <= ordered[0].at) return { ...ordered[0].camera };
  if (phase >= ordered[ordered.length - 1].at) return { ...ordered[ordered.length - 1].camera };
  const startIndex = ordered.findIndex((_, index) => index < ordered.length - 1 && phase <= ordered[index + 1].at);
  const start = ordered[startIndex], end = ordered[startIndex + 1];
  const span = end.at - start.at;
  const raw = span > 0 ? Math.max(0, Math.min(1, (phase - start.at) / span)) : 1;
  const eased = start.easing === 'ease-in' ? raw * raw : start.easing === 'ease-out' ? 1 - (1 - raw) ** 2 : start.easing === 'ease-in-out' ? raw * raw * (3 - 2 * raw) : raw;
  const camera = neutralCamera();
  for (const key of cameraKeys) camera[key] = start.camera[key] + (end.camera[key] - start.camera[key]) * eased;
  return camera;
}

export function cameraFrame(source: ImageData, depth: { data: Float32Array; width: number; height: number }, camera: ParallaxControls) {
  const result = new ImageData(source.width, source.height);
  const zoom = 1 + camera.zoomPercent / 100;
  const angle = camera.tiltDegrees * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const centerX = (source.width - 1) / 2, centerY = (source.height - 1) / 2;
  const panX = camera.panXPx, panY = camera.panYPx;
  const parallax = camera.strengthPx;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const translatedX = x - centerX - panX, translatedY = y - centerY - panY;
    const sceneX = centerX + (cosine * translatedX + sine * translatedY) / zoom;
    const sceneY = centerY + (-sine * translatedX + cosine * translatedY) / zoom;
    const depthX = Math.max(0, Math.min(depth.width - 1, Math.floor(sceneX * depth.width / source.width)));
    const depthY = Math.max(0, Math.min(depth.height - 1, Math.floor(sceneY * depth.height / source.height)));
    const near = depth.data[depthY * depth.width + depthX];
    // Reflect content beyond the frame instead of smearing a single edge pixel.
    // This is a border fill; newly uncovered scenery behind foreground objects
    // still needs a separate depth-aware repair pass.
    const sourceX = reflectedPixel(sceneX + parallax * (near - 0.35), source.width);
    const sourceY = reflectedPixel(sceneY, source.height);
    const from = (sourceY * source.width + sourceX) * 4, to = (y * source.width + x) * 4;
    result.data[to] = source.data[from]; result.data[to + 1] = source.data[from + 1];
    result.data[to + 2] = source.data[from + 2]; result.data[to + 3] = 255;
  }
  return result;
}
export function parallaxFrame(source: ImageData, depth: { data: Float32Array; width: number; height: number }, phase: number, controls: number | ParallaxControls) {
  const camera = typeof controls === 'number' ? { ...neutralCamera(), strengthPx: controls } : controls;
  return cameraFrame(source, depth, loopCameraAt(camera, phase));
}
function decodeRifeFrame(tensor: ImageTensor | undefined, width: number, height: number): ImageData {
  if (!tensor || tensor.data.length !== width * height * 3) throw new Error('RIFE returned an unexpected frame.');
  const image = new ImageData(width, height), area = width * height;
  for (let i = 0; i < area; i++) {
    for (let channel = 0; channel < 3; channel++) image.data[i * 4 + channel] = Math.max(0, Math.min(255, Math.round(tensor.data[channel * area + i] * 255)));
    image.data[i * 4 + 3] = 255;
  }
  return image;
}

function assertRifeFrames(first: ImageData, last: ImageData) {
  if (first.width !== last.width || first.height !== last.height || first.width % 32 || first.height % 32) throw new Error('RIFE frames must have matching dimensions divisible by 32.');
}

export async function interpolateRife(folder: FileSystemDirectoryHandle, first: ImageData, last: ImageData, position: number, onBackend?: (backend: 'WebGPU' | 'WASM') => void): Promise<ImageData> {
  assertRifeFrames(first, last);
  return withSession(folder, 'rife', async (ort, session) => {
    const dims = [1, 3, first.height, first.width];
    const result = await session.run({ img0: new ort.Tensor('float32', planes(first, false), dims), img1: new ort.Tensor('float32', planes(last, false), dims), timestep: new ort.Tensor('float32', new Float32Array([position]), [1]) });
    return decodeRifeFrame(result.output as ImageTensor | undefined, first.width, first.height);
  }, onBackend);
}

export async function interpolateRifeSequence(folder: FileSystemDirectoryHandle, first: ImageData, last: ImageData, multiplier: 2 | 4 | 8, onFrame?: (index: number, total: number, frame: ImageData) => void, signal?: AbortSignal, onBackend?: (backend: 'WebGPU' | 'WASM') => void): Promise<ImageData[]> {
  return interpolateRifeBatch(folder, [first, last], multiplier, onFrame, signal, onBackend);
}

export async function interpolateRifeBatch(folder: FileSystemDirectoryHandle, keyframes: ImageData[], multiplier: 2 | 4 | 8, onFrame?: (index: number, total: number, frame: ImageData) => void, signal?: AbortSignal, onBackend?: (backend: 'WebGPU' | 'WASM') => void): Promise<ImageData[]> {
  if (keyframes.length < 2 || keyframes.length > 6) throw new Error('Choose 2–6 ordered images for interpolation.');
  for (let index = 1; index < keyframes.length; index++) assertRifeFrames(keyframes[index - 1], keyframes[index]);
  if (![2, 4, 8].includes(multiplier)) throw new Error('Choose a supported frame multiplier.');
  return withSession(folder, 'rife', async (ort, session) => {
    const dims = [1, 3, keyframes[0].height, keyframes[0].width];
    const frames = [keyframes[0]];
    const total = (keyframes.length - 1) * (multiplier - 1);
    let completed = 0;
    for (let segment = 0; segment < keyframes.length - 1; segment++) {
      if (signal?.aborted) throw signal.reason;
      const img0 = new ort.Tensor('float32', planes(keyframes[segment], false), dims);
      const img1 = new ort.Tensor('float32', planes(keyframes[segment + 1], false), dims);
      for (let index = 1; index < multiplier; index++) {
        if (signal?.aborted) throw signal.reason;
        const result = await session.run({ img0, img1, timestep: new ort.Tensor('float32', new Float32Array([index / multiplier]), [1]) });
        if (signal?.aborted) throw signal.reason;
        const frame = decodeRifeFrame(result.output as ImageTensor | undefined, keyframes[0].width, keyframes[0].height);
        frames.push(frame);
        onFrame?.(++completed, total, frame);
      }
      frames.push(keyframes[segment + 1]);
    }
    return frames;
  }, onBackend);
}

export type FrameSource = ImageData[] | { count: number; frame: (index: number) => ImageData };
export type VideoRecordingOptions = { format?: VideoExportFormat; videoBitsPerSecond?: number };
export async function recordFrames(frames: FrameSource, fps: number, onFrame?: (index: number) => void, signal?: AbortSignal, options: VideoRecordingOptions = {}) {
  const count = Array.isArray(frames) ? frames.length : frames.count;
  if (!Number.isInteger(count) || count < 1) throw new Error('No frames to record.');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('Frame rate must be positive.');
  if (options.videoBitsPerSecond !== undefined && (!Number.isInteger(options.videoBitsPerSecond) || options.videoBitsPerSecond < 250_000 || options.videoBitsPerSecond > 12_000_000)) throw new Error('Video bitrate must be between 0.25 and 12 Mbps.');
  const first = Array.isArray(frames) ? frames[0] : frames.frame(0);
  const canvas = document.createElement('canvas'); canvas.width = first.width; canvas.height = first.height;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream || !('MediaRecorder' in window)) throw new Error('This browser cannot record a canvas video.');
  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  if (!track?.requestFrame) {
    stream.getTracks().forEach(item => item.stop());
    stream = canvas.captureStream(fps);
    track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  }
  const format = options.format || 'auto';
  const candidates = format === 'webm' ? WEBM_RECORDER_FORMATS : format === 'mp4' ? MP4_RECORDER_FORMATS : [...WEBM_RECORDER_FORMATS, ...MP4_RECORDER_FORMATS];
  let mime: string | undefined;
  try { mime = candidates.find(type => MediaRecorder.isTypeSupported(type)); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  if (!mime) { stream.getTracks().forEach(track => track.stop()); throw new Error(`This browser cannot encode ${format === 'auto' ? 'WebM or MP4' : format.toUpperCase()} video.`); }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: options.videoBitsPerSecond }); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  const chunks: Blob[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error('Video recording failed.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mime }));
  });
  try {
    recorder.start();
    const recordingStart = performance.now();
    const frameIntervalMs = 1000 / fps;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw signal.reason;
      const frame = i === 0 ? first : Array.isArray(frames) ? frames[i] : frames.frame(i);
      if (frame.width !== first.width || frame.height !== first.height) throw new Error('Video frames must have matching dimensions.');
      context.putImageData(frame, 0, 0);
      track.requestFrame?.();
      onFrame?.(i + 1);
      // Pace against a fixed clock so rendering time does not accumulate
      // on top of every frame interval.
      const remainingMs = recordingStart + (i + 1) * frameIntervalMs - performance.now();
      await new Promise(resolve => setTimeout(resolve, Math.max(0, remainingMs)));
    }
    // MediaRecorder can omit the last requested canvas frame until it sees one
    // more changed frame. A one-pixel tail flushes the real ending into WebM.
    if (signal?.aborted) throw signal.reason;
    const corner = context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data;
    context.fillStyle = corner[0] + corner[1] + corner[2] > 382 ? '#000' : '#fff';
    context.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
    track.requestFrame?.();
    // Allow the browser's capture track to deliver the tail frame before
    // stopping. An 8 ms wait intermittently dropped it in Chrome.
    await new Promise(resolve => setTimeout(resolve, Math.max(50, Math.min(125, 1000 / fps))));
    recorder.stop();
    return { blob: await finished, recorderVideoBitsPerSecond: recorder.videoBitsPerSecond };
  } finally { if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach(track => track.stop()); }
}
