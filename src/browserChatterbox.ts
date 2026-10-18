import { assertSpeechFiles } from './speechAssets.ts';
import { CHATTERBOX_ENGINE_ASSETS, speechModel, type SpeechModelId } from './speechManifest.ts';

type Message = { type: 'ready' | 'progress' | 'chunk' | 'done' | 'error'; requestId?: number | null; message?: string; data?: Float32Array; sampleRate?: number; device?: string };
type Pending = { chunks: Float32Array[]; progress?: (message: string) => void; onChunk?: (audio: Float32Array, sampleRate: number) => void; resolve: (value: Float32Array[]) => void; reject: (error: Error) => void };
type ChatterboxId = Extract<SpeechModelId, 'chatterbox_q4f16' | 'chatterbox_turbo_q4f16'>;
let current: { folder: FileSystemDirectoryHandle; modelId: ChatterboxId; worker: Worker; urls: string[]; pending: Map<number, Pending> } | null = null;
let nextId = 0;
export const isChatterboxLoadedFrom = (folder: FileSystemDirectoryHandle, modelId: ChatterboxId) => current?.folder === folder && current.modelId === modelId;

export function unloadChatterbox() {
  const old = current; current = null;
  if (!old) return;
  old.worker.terminate();
  for (const pending of old.pending.values()) pending.reject(new DOMException('Speech generation stopped.', 'AbortError'));
  for (const url of old.urls) URL.revokeObjectURL(url);
}

export async function loadChatterbox(folder: FileSystemDirectoryHandle, modelId: ChatterboxId, progress?: (message: string) => void) {
  if (isChatterboxLoadedFrom(folder, modelId)) return;
  unloadChatterbox();
  const { engineFiles, modelFiles } = await assertSpeechFiles(folder, modelId);
  const urls: string[] = [];
  const url = (file: File) => { const value = URL.createObjectURL(file); urls.push(value); return value; };
  const engine = new Map(CHATTERBOX_ENGINE_ASSETS.map((asset, index) => [asset.name, url(engineFiles[index])]));
  const model = new Map(speechModel(modelId).assets.map((asset, index) => [asset.name, url(modelFiles[index])]));
  const files: Record<string, string> = {};
  for (const [name, value] of model) if (!name.startsWith('LICENSE') && name !== 'MODEL-CARD.md') files[name.endsWith('.onnx') || name.endsWith('.onnx_data') ? `onnx/${name}` : name] = value;
  const worker = new Worker(new URL('./chatterboxWorker.ts', import.meta.url), { type: 'module' });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<Message>) => {
        const value = event.data;
        if (value.type === 'progress') progress?.(value.message || 'Loading Chatterbox…');
        else if (value.type === 'ready') { progress?.(`Loaded on ${value.device === 'webgpu' ? 'WebGPU' : 'WebAssembly'}.`); resolve(); }
        else if (value.type === 'error') reject(new Error(value.message || 'Chatterbox could not load.'));
      };
      worker.onerror = event => reject(new Error(event.message || 'Chatterbox worker failed.'));
      worker.postMessage({ type: 'init', runtimeUrl: engine.get('transformers.web.js'), ortUrl: engine.get('ort.webgpu.bundle.min.mjs'), wasmUrl: engine.get('ort-wasm-simd-threaded.asyncify.wasm'), files, modelId: modelId === 'chatterbox_q4f16' ? 'onnx-community/chatterbox-ONNX' : 'ResembleAI/chatterbox-turbo-ONNX' });
    });
    const pending = new Map<number, Pending>();
    current = { folder, modelId, worker, urls, pending };
    worker.onmessage = (event: MessageEvent<Message>) => {
      const value = event.data;
      const entry = value.requestId == null ? null : pending.get(value.requestId);
      if (value.type === 'progress') {
        if (entry) entry.progress?.(value.message || 'Generating speech…');
        else if (value.requestId == null) progress?.(value.message || 'Loading Chatterbox…');
      }
      if (!entry) return;
      if (value.type === 'chunk' && value.data) { entry.chunks.push(value.data); entry.onChunk?.(value.data, value.sampleRate || 24000); }
      else if (value.type === 'done') { pending.delete(value.requestId!); entry.resolve(entry.chunks); }
      else if (value.type === 'error') { pending.delete(value.requestId!); entry.reject(new Error(value.message || 'Chatterbox generation failed.')); }
    };
    worker.onerror = event => { for (const entry of pending.values()) entry.reject(new Error(event.message || 'Chatterbox worker failed.')); pending.clear(); unloadChatterbox(); };
  } catch (error) { worker.terminate(); for (const value of urls) URL.revokeObjectURL(value); throw error; }
}

function wav(chunks: Float32Array[], rate: number): Blob {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + count * 2); const view = new DataView(buffer);
  for (const [start, word] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < word.length; i++) view.setUint8(start + i, word.charCodeAt(i));
  view.setUint32(4, buffer.byteLength - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { const n = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, Math.round(n < 0 ? n * 32768 : n * 32767), true); offset += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function generateChatterbox(folder: FileSystemDirectoryHandle, modelId: ChatterboxId, text: string, sample: Blob | undefined, exaggeration: number, progress?: (message: string) => void, onChunk?: (audio: Float32Array, sampleRate: number) => void) {
  if (!sample) throw new Error('Select a saved voice recording for Chatterbox.');
  if (!isChatterboxLoadedFrom(folder, modelId)) await loadChatterbox(folder, modelId, progress);
  const session = current;
  if (!session) throw new Error('Chatterbox is not loaded.');
  progress?.('Encoding voice sample…');
  const context = new AudioContext();
  let audio: Float32Array;
  try {
    const decoded = await context.decodeAudioData(await sample.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 24000), 24000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(); audio = rendered.getChannelData(0).slice();
  } finally { await context.close(); }
  if (!audio.length) throw new Error('The selected voice recording contains no audio.');
  const requestId = ++nextId;
  progress?.('Generating speech…');
  const chunks = await new Promise<Float32Array[]>((resolve, reject) => {
    session.pending.set(requestId, { chunks: [], progress, onChunk, resolve, reject });
    session.worker.postMessage({ type: 'generate', requestId, text, audio, ...(modelId === 'chatterbox_q4f16' ? { exaggeration } : {}) }, [audio.buffer]);
  });
  if (!chunks.length) throw new Error('Chatterbox returned no audio.');
  return wav(chunks, 24000);
}
