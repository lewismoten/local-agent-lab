import { assertMotionFiles } from './motionAssets.ts';
import { unloadBrowserImageModel } from './browserImage.ts';
import { unloadBrowserModel } from './browserModel.ts';
import { unloadBrowserSpeech } from './browserSpeech.ts';
import { unloadBrowserTranscription } from './browserTranscription.ts';
import { unloadLocalOllama } from './localOllama.ts';
import { unloadNeedle } from './needleRuntime.ts';
import { withLocalModelMemory } from './localModelMemory.ts';

export type PosePoint = { x: number; y: number; z: number; visibility?: number; presence?: number };
export type PoseFrame = { timeMs: number; landmarks: PosePoint[][]; worldLandmarks: PosePoint[][] };
type PoseResult = { landmarks: PosePoint[][]; worldLandmarks: PosePoint[][] };
type PoseTask = { detect: (image: CanvasImageSource) => PoseResult; detectForVideo: (image: CanvasImageSource, timestampMs: number) => PoseResult; setOptions: (options: { runningMode: 'VIDEO' }) => Promise<void>; close: () => void };
type PoseSdk = { FilesetResolver: { isSimdSupported: () => Promise<boolean> }; PoseLandmarker: { createFromOptions: (wasm: { wasmLoaderPath: string; wasmBinaryPath: string }, options: { baseOptions: { modelAssetBuffer: Uint8Array; delegate: 'CPU' }; runningMode: 'IMAGE'; numPoses: number }) => Promise<PoseTask> } };

export const POSE_CONNECTIONS: readonly [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32],
];

async function withPoseTask<T>(folder: FileSystemDirectoryHandle, work: (task: PoseTask) => Promise<T>): Promise<T> {
  return withLocalModelMemory(async () => {
    const [engine, model] = await Promise.all([assertMotionFiles(folder, 'pose_engine'), assertMotionFiles(folder, 'pose')]);
    await unloadBrowserImageModel();
    await unloadBrowserModel();
    await unloadNeedle();
    await unloadBrowserSpeech();
    await unloadBrowserTranscription();
    await unloadLocalOllama();
    const urls = [
      URL.createObjectURL(new Blob([engine[1]], { type: 'text/javascript' })),
      URL.createObjectURL(new Blob([engine[2]], { type: 'text/javascript' })),
      URL.createObjectURL(new Blob([engine[3]], { type: 'application/wasm' })),
      URL.createObjectURL(new Blob([engine[4]], { type: 'text/javascript' })),
      URL.createObjectURL(new Blob([engine[5]], { type: 'application/wasm' })),
    ];
    let task: PoseTask | undefined;
    try {
      const sdk = await import(/* @vite-ignore */ urls[0]) as PoseSdk;
      const simd = await sdk.FilesetResolver.isSimdSupported();
      task = await sdk.PoseLandmarker.createFromOptions({ wasmLoaderPath: simd ? urls[1] : urls[3], wasmBinaryPath: simd ? urls[2] : urls[4] }, {
        baseOptions: { modelAssetBuffer: new Uint8Array(await model[1].arrayBuffer()), delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 2,
      });
      return await work(task);
    } finally {
      task?.close();
      for (const url of urls) URL.revokeObjectURL(url);
    }
  });
}

function frame(result: PoseResult, timeMs: number): PoseFrame {
  return { timeMs, landmarks: result.landmarks, worldLandmarks: result.worldLandmarks };
}

export async function detectImagePose(folder: FileSystemDirectoryHandle, image: CanvasImageSource): Promise<PoseFrame> {
  return withPoseTask(folder, async task => frame(task.detect(image), 0));
}

export async function detectVideoPoses(folder: FileSystemDirectoryHandle, video: HTMLVideoElement, durationSeconds: number, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<PoseFrame[]> {
  return withPoseTask(folder, async task => {
    await task.setOptions({ runningMode: 'VIDEO' });
    const count = Math.min(90, Math.max(1, Math.ceil(durationSeconds * 2)));
    const frames: PoseFrame[] = [];
    for (let index = 0; index < count; index++) {
      if (signal.aborted) throw signal.reason;
      const seconds = Math.max(0, Math.min(durationSeconds - 0.001, Math.max(0.001, index / 2)));
      if (Math.abs(video.currentTime - seconds) > 0.0001 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Could not seek to a video frame.')); }, 10000);
        const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('loadeddata', done); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('Could not decode the selected video.')); };
        const aborted = () => { cleanup(); reject(signal.reason); };
        video.addEventListener('seeked', done, { once: true }); video.addEventListener('loadeddata', done, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
        video.currentTime = Math.max(0, seconds);
      });
      frames.push(frame(task.detectForVideo(video, Math.round(seconds * 1000)), Math.round(seconds * 1000)));
      progress(index + 1, count);
    }
    return frames;
  });
}

export function poseOverlay(image: CanvasImageSource, width: number, height: number, result: PoseFrame): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  context.lineWidth = Math.max(2, Math.min(width, height) / 180);
  for (const landmarks of result.landmarks) {
    context.strokeStyle = '#1eff9e'; context.fillStyle = '#ffcf33';
    for (const [a, b] of POSE_CONNECTIONS) {
      const left = landmarks[a], right = landmarks[b];
      if (!left || !right || (left.visibility ?? 1) < 0.35 || (right.visibility ?? 1) < 0.35) continue;
      context.beginPath(); context.moveTo(left.x * width, left.y * height); context.lineTo(right.x * width, right.y * height); context.stroke();
    }
    for (const point of landmarks) {
      if ((point.visibility ?? 1) < 0.35) continue;
      context.beginPath(); context.arc(point.x * width, point.y * height, context.lineWidth * 1.2, 0, Math.PI * 2); context.fill();
    }
  }
  return canvas.toDataURL('image/png');
}
