import { assertSpeechFiles } from './speechAssets.ts';
import { KOKORO_ENGINE_ASSETS, speechModel } from './speechManifest.ts';

type WorkerMessage = { type: 'ready' | 'progress' | 'chunk' | 'done' | 'error'; requestId?: number | null; message?: string; data?: Float32Array; sampleRate?: number };
type Pending = { chunks: Float32Array[]; sampleRate: number; onChunk?: (audio: Float32Array, sampleRate: number) => void; resolve: (value: { chunks: Float32Array[]; sampleRate: number }) => void; reject: (reason: Error) => void };
let current: { folder: FileSystemDirectoryHandle; worker: Worker; urls: string[]; pending: Map<number, Pending> } | null = null;
let nextRequestId = 0;
export const isKokoroLoadedFrom = (folder: FileSystemDirectoryHandle) => current?.folder === folder;
export function unloadKokoro() {
  const old = current; current = null;
  if (!old) return;
  old.worker.terminate();
  for (const entry of old.pending.values()) entry.reject(new DOMException('Speech generation stopped.', 'AbortError'));
  old.pending.clear();
  for (const url of old.urls) URL.revokeObjectURL(url);
}
export async function loadKokoro(folder: FileSystemDirectoryHandle, progress?: (message: string) => void) {
  if (current?.folder === folder) return;
  unloadKokoro();
  const { engineFiles, modelFiles } = await assertSpeechFiles(folder, 'kokoro_q8');
  const urls: string[] = [];
  const fileUrl = (file: File) => { const url = URL.createObjectURL(file); urls.push(url); return url; };
  const engine = new Map(KOKORO_ENGINE_ASSETS.map((asset, index) => [asset.name, fileUrl(engineFiles[index])]));
  const model = new Map(speechModel('kokoro_q8').assets.map((asset, index) => [asset.name, fileUrl(modelFiles[index])]));
  const files: Record<string, string> = {
    'config.json': model.get('config.json')!, 'tokenizer.json': model.get('tokenizer.json')!,
    'tokenizer_config.json': model.get('tokenizer_config.json')!,
    'onnx/model_quantized.onnx': model.get('model_quantized.onnx')!,
    'voices/af_heart.bin': model.get('af_heart.bin')!,
    'voices/af_bella.bin': model.get('af_bella.bin')!,
    'voices/am_michael.bin': model.get('am_michael.bin')!,
    'voices/bf_emma.bin': model.get('bf_emma.bin')!,
  };
  const worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const value = event.data;
        if (value.type === 'progress') progress?.(value.message || 'Loading Kokoro…');
        else if (value.type === 'ready') resolve();
        else if (value.type === 'error') reject(new Error(value.message || 'Kokoro could not load.'));
      };
      worker.onerror = event => reject(new Error(event.message || 'Kokoro worker failed.'));
      worker.postMessage({ type: 'init', engineUrl: engine.get('kokoro.web.js'), wasmMjsUrl: engine.get('ort-wasm-simd-threaded.jsep.mjs'), wasmUrl: engine.get('ort-wasm-simd-threaded.jsep.wasm'), files });
    });
    const pending = new Map<number, Pending>();
    current = { folder, worker, urls, pending };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const value = event.data;
      if (value.type === 'progress') progress?.(value.message || 'Generating speech…');
      const entry = value.requestId != null ? pending.get(value.requestId) : null;
      if (!entry) return;
      if (value.type === 'chunk' && value.data && value.sampleRate) {
        if (entry.sampleRate && entry.sampleRate !== value.sampleRate) { pending.delete(value.requestId!); entry.reject(new Error('Kokoro changed sample rate during generation.')); return; }
        entry.sampleRate = value.sampleRate;
        entry.chunks.push(value.data);
        entry.onChunk?.(value.data, value.sampleRate);
      } else if (value.type === 'done') { pending.delete(value.requestId!); entry.resolve({ chunks: entry.chunks, sampleRate: entry.sampleRate }); }
      else if (value.type === 'error') { pending.delete(value.requestId!); entry.reject(new Error(value.message || 'Kokoro generation failed.')); }
    };
    worker.onerror = event => { for (const entry of pending.values()) entry.reject(new Error(event.message || 'Kokoro worker failed.')); pending.clear(); unloadKokoro(); };
  } catch (error) { worker.terminate(); for (const url of urls) URL.revokeObjectURL(url); throw error; }
}
export async function generateKokoro(folder: FileSystemDirectoryHandle, text: string, voice: string, progress?: (message: string) => void, onChunk?: (audio: Float32Array, sampleRate: number) => void) {
  if (current?.folder !== folder) await loadKokoro(folder, progress);
  const session = current;
  if (!session) throw new Error('Kokoro is not loaded.');
  const requestId = ++nextRequestId;
  const output = await new Promise<{ chunks: Float32Array[]; sampleRate: number }>((resolve, reject) => {
    session.pending.set(requestId, { chunks: [], sampleRate: 0, onChunk, resolve, reject });
    session.worker.postMessage({ type: 'generate', text, voice, requestId });
  });
  if (!output.chunks.length || !output.sampleRate) throw new Error('Kokoro returned no audio samples.');
  return pcmWav(output.chunks, output.sampleRate);
}
function pcmWav(chunks: Float32Array[], sampleRate: number) {
  const count = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  for (const [offset, word] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < word.length; i++) view.setUint8(offset + i, word.charCodeAt(i));
  view.setUint32(4, bytes.byteLength - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, count * 2, true);
  let index = 0;
  for (const chunk of chunks) for (const sample of chunk) view.setInt16(44 + index++ * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  return new Blob([bytes], { type: 'audio/wav' });
}
