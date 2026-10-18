import { assertTranscriptionFiles, transcriptionDirectory } from './transcriptionAssets.ts';
import { withLocalModelMemory } from './localModelMemory.ts';
import { showToast } from './toastStore.ts';
import { writeBlob } from './storage.ts';
import { transcriptionModel, type TranscriptionModelId } from './transcriptionManifest.ts';

type Status = { folder: FileSystemDirectoryHandle | null; state: 'idle' | 'loading' | 'ready' | 'transcribing' | 'error'; message: string; progress: number | null };
let status: Status = { folder: null, state: 'idle', message: '', progress: null };
const listeners = new Set<() => void>();
const publish = (patch: Partial<Status>) => { status = { ...status, ...patch }; listeners.forEach(listener => listener()); };
export const getBrowserTranscriptionStatus = () => status;
export const subscribeBrowserTranscription = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let transcriber: ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> }>) & { dispose: () => Promise<void> } | null = null;
let sherpa: import('./sherpaTranscription.ts').SherpaTranscriber | null = null;
let urls: string[] = [];
let currentFolder: FileSystemDirectoryHandle | null = null;
let currentModel: TranscriptionModelId | null = null;
const files = new Map<string, File>();
async function getFile(dir: FileSystemDirectoryHandle, name: string) {
  const parts = name.split('/'); let here = dir;
  for (const part of parts.slice(0, -1)) here = await here.getDirectoryHandle(part);
  return (await here.getFileHandle(parts.at(-1)!)).getFile();
}
async function release() {
  await transcriber?.dispose(); transcriber = null; currentFolder = null; currentModel = null; files.clear();
  sherpa?.dispose(); sherpa = null;
  for (const url of urls) URL.revokeObjectURL(url); urls = [];
  publish({ folder: null, state: 'idle', message: '', progress: null });
}
export async function unloadBrowserTranscription() { await release(); }
export const isBrowserTranscriptionLoadedFrom = (folder: FileSystemDirectoryHandle, model: TranscriptionModelId = 'whisper') => currentFolder === folder && currentModel === model && !!(transcriber || sherpa);
export async function loadBrowserTranscription(folder: FileSystemDirectoryHandle, model: TranscriptionModelId = 'whisper') {
  return withLocalModelMemory(async () => {
    if (isBrowserTranscriptionLoadedFrom(folder, model)) return;
    publish({ folder, state: 'loading', message: 'Checking saved files…', progress: null });
    try {
      await release(); await assertTranscriptionFiles(folder, model);
      await (await import('./browserSpeech.ts')).unloadBrowserSpeech();
      await (await import('./browserImage.ts')).unloadBrowserImageModel();
      await (await import('./browserModel.ts')).unloadBrowserModel();
      await (await import('./needleRuntime.ts')).unloadNeedle();
      const selected = transcriptionModel(model);
      if (model === 'sherpa') {
        publish({ folder, state: 'loading', message: 'Loading Sherpa streaming engine…', progress: null });
        sherpa = await (await import('./sherpaTranscription.ts')).SherpaTranscriber.create(folder);
        currentFolder = folder; currentModel = model;
        publish({ folder, state: 'ready', message: `${selected.label} is ready.`, progress: null });
        return;
      }
      const modelDir = await transcriptionDirectory(folder, model);
      const engineDir = await transcriptionDirectory(folder, 'engine');
      const runtimeFiles = await Promise.all(['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'transformers.min.js'].map(name => getFile(engineDir, name)));
      urls = runtimeFiles.map(file => URL.createObjectURL(file));
      const { env, pipeline } = await import(/* @vite-ignore */ urls[2]) as {
        env: { allowLocalModels: boolean; allowRemoteModels: boolean; useBrowserCache: boolean; useCustomCache: boolean; backends: { onnx: { wasm: { wasmPaths: { mjs: string; wasm: string }; numThreads: number } } }; customCache: unknown };
        pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
      };
      env.allowLocalModels = true; env.allowRemoteModels = false; env.useBrowserCache = false; env.useCustomCache = true;
      if (!env.backends.onnx.wasm) throw new Error('ONNX WebAssembly runtime is unavailable.');
      env.backends.onnx.wasm.wasmPaths = { mjs: urls[0], wasm: urls[1] };
      env.backends.onnx.wasm.numThreads = 1;
      env.customCache = {
        async match(request: string | Request) {
          const name = String(typeof request === 'string' ? request : request.url);
          const marker = `${selected.repo}/`; const at = name.indexOf(marker);
          if (at < 0) return undefined;
          const path = name.slice(at + marker.length).replace(/^resolve\/[^/]+\//, '');
          if (!/^[A-Za-z0-9_.\-/]+$/.test(path) || path.includes('..')) return undefined;
          let file = files.get(path);
          if (!file) { try { file = await getFile(modelDir, path); files.set(path, file); } catch { return undefined; } }
          return new Response(file, { headers: { 'Content-Length': String(file.size) } });
        },
        async put() { /* Files are pinned and downloaded explicitly before loading. */ },
      } as typeof env.customCache;
      publish({ folder, state: 'loading', message: `Loading ${selected.label}…`, progress: null });
      transcriber = await pipeline('automatic-speech-recognition', selected.repo, {
        device: 'wasm', dtype: 'q8', revision: selected.revision,
        progress_callback: (data: { status: string; progress?: number; file?: string }) => { if (data.status === 'progress' && typeof data.progress === 'number') publish({ progress: data.progress, message: `Loading ${data.file || selected.label}…` }); },
      }) as unknown as typeof transcriber;
      publish({ folder, state: 'loading', message: 'Checking inference…', progress: null });
      await transcriber!(new Float32Array(16000), { max_new_tokens: 16 });
      currentFolder = folder; currentModel = model;
      publish({ folder, state: 'ready', message: `${selected.label} is ready.`, progress: null });
    } catch (error) {
      await release(); const message = error instanceof Error ? error.message : String(error);
      publish({ folder, state: 'error', message, progress: null }); throw error;
    }
  });
}
async function decodeAudio(file: File) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 60 * 60) throw new Error('Choose audio shorter than one hour.');
    const samples = Math.ceil(buffer.duration * 16000);
    const offline = new OfflineAudioContext(1, samples, 16000);
    const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
    const resampled = await offline.startRendering();
    return { audio: resampled.getChannelData(0), duration: buffer.duration };
  } finally { await context.close(); }
}
export type TranscriptionResult = { text: string; chunks: Array<{ text: string; timestamp: [number, number | null] }>; savedPath: string };
export type TranscriptionSegment = TranscriptionResult['chunks'][number];
export async function transcribeBrowserSamples(folder: FileSystemDirectoryHandle, samples: Float32Array, sampleRate: number, offsetSeconds = 0, model: TranscriptionModelId = 'whisper') {
  return withLocalModelMemory(async () => {
    if (!isBrowserTranscriptionLoadedFrom(folder, model)) throw new Error(`Load ${transcriptionModel(model).label} first.`);
    const length = Math.max(1, Math.round(samples.length * 16000 / sampleRate));
    const audio = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const source = i * sampleRate / 16000;
      const left = Math.min(samples.length - 1, Math.floor(source));
      const next = Math.min(samples.length - 1, left + 1);
      audio[i] = samples[left] * (1 - (source - left)) + samples[next] * (source - left);
    }
    publish({ state: 'transcribing', message: `Transcribing microphone audio…`, progress: null });
    try {
      if (model === 'sherpa') return { text: await sherpa!.feed(audio), chunks: [] };
      const result = await transcriber!(audio, model === 'wav2vec2' ? {} : { return_timestamps: true });
      return {
        text: result.text?.trim() || '',
        chunks: (result.chunks || []).map(chunk => ({ ...chunk, timestamp: [chunk.timestamp[0] + offsetSeconds, chunk.timestamp[1] == null ? null : chunk.timestamp[1] + offsetSeconds] as [number, number | null] })),
      };
    } finally { publish({ state: 'ready', message: `${transcriptionModel(model).label} is ready.`, progress: null }); }
  });
}
export async function finishBrowserTranscriptionSamples(folder: FileSystemDirectoryHandle, model: TranscriptionModelId) {
  if (model !== 'sherpa') return '';
  if (!isBrowserTranscriptionLoadedFrom(folder, model) || !sherpa) throw new Error('Load Sherpa first.');
  return sherpa.finish();
}
export async function saveBrowserTranscript(folder: FileSystemDirectoryHandle, source: string, text: string, chunks: TranscriptionSegment[], recording?: Blob, model: TranscriptionModelId = 'whisper') {
  const stem = source.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 70) || 'audio';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const savedPath = `transcripts/${stem}-${stamp}.md`;
  const formatTime = (seconds: number | null) => seconds == null ? '?' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const segments = chunks.length ? `\n## Timed segments\n\n${chunks.map(chunk => `[${formatTime(chunk.timestamp[0])}–${formatTime(chunk.timestamp[1])}] ${chunk.text.trim()}`).join('\n\n')}\n` : '';
  let recordingPath = '';
  if (recording?.size) {
    const extension = recording.type.includes('webm') ? 'webm' : recording.type.includes('mp4') ? 'm4a' : 'audio';
    recordingPath = `audio/recordings/${stem}-${stamp}.${extension}`;
    await writeBlob(folder, recordingPath, recording);
  }
  const body = `# Transcript: ${source}\n\nSource: ${source}${recordingPath ? `\nRecording: ${recordingPath}` : ''}\nModel: ${transcriptionModel(model).path}\nCreated: ${new Date().toISOString()}\n\n${text}\n${segments}`;
  await writeBlob(folder, savedPath, new Blob([body], { type: 'text/markdown' }));
  showToast(`Transcript saved to ${savedPath}.`);
  return savedPath;
}
export async function transcribeBrowserAudio(folder: FileSystemDirectoryHandle, file: File, model: TranscriptionModelId = 'whisper'): Promise<TranscriptionResult> {
  return withLocalModelMemory(() => transcribeBrowserAudioInternal(folder, file, model));
}
async function transcribeBrowserAudioInternal(folder: FileSystemDirectoryHandle, file: File, model: TranscriptionModelId): Promise<TranscriptionResult> {
  if (!isBrowserTranscriptionLoadedFrom(folder, model)) throw new Error(`Load ${transcriptionModel(model).label} first.`);
  publish({ state: 'transcribing', message: 'Decoding audio…', progress: null });
  try {
    const { audio, duration } = await decodeAudio(file);
    publish({ message: `Transcribing ${Math.round(duration)} seconds…`, progress: null });
    const result = model === 'sherpa'
      ? { text: await sherpa!.transcribe(audio), chunks: [] }
      : await transcriber!(audio, model === 'wav2vec2' ? { chunk_length_s: 30, stride_length_s: 5 } : { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const text = result.text?.trim(); if (!text) throw new Error(`${transcriptionModel(model).label} returned no transcript.`);
    const chunks = result.chunks || [];
    const savedPath = await saveBrowserTranscript(folder, file.name, text, chunks, undefined, model);
    publish({ state: 'ready', message: 'Transcript saved.', progress: null });
    return { text, chunks, savedPath };
  } catch (error) {
    publish({ state: 'ready', message: error instanceof Error ? error.message : String(error), progress: null }); throw error;
  }
}
