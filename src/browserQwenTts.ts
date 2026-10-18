import { assertSpeechFiles } from './speechAssets.ts';
import { QWEN_TTS_ENGINE_ASSETS, speechModel } from './speechManifest.ts';

export type QwenSpeechProgress = { part: number; parts: number; framesGenerated: number };
type Message = { type: 'ready' | 'progress' | 'chunk' | 'done' | 'error'; requestId?: number | null; message?: string; data?: Float32Array; sampleRate?: number; speakerReference?: boolean; truncated?: boolean; part?: number; parts?: number; framesGenerated?: number };
type Pending = { chunks: Float32Array[]; sampleRate: number; onChunk?: (audio: Float32Array, sampleRate: number) => void; progress?: (message: string) => void; onGenerationProgress?: (value: QwenSpeechProgress) => void; resolve: (value: { chunks: Float32Array[]; sampleRate: number }) => void; reject: (error: Error) => void };
let current: { folder: FileSystemDirectoryHandle; worker: Worker; urls: string[]; pending: Map<number, Pending>; speakerReference: boolean } | null = null;
let nextId = 0;
export const isQwenTtsLoadedFrom = (folder: FileSystemDirectoryHandle) => current?.folder === folder;
export function unloadQwenTts() {
  const old = current; current = null;
  if (!old) return;
  old.worker.terminate();
  for (const entry of old.pending.values()) entry.reject(new DOMException('Speech generation stopped.', 'AbortError'));
  for (const url of old.urls) URL.revokeObjectURL(url);
}

export async function loadQwenTts(folder: FileSystemDirectoryHandle, progress?: (message: string) => void) {
  if (current?.folder === folder) return;
  if (!crossOriginIsolated) throw new Error('Qwen3-TTS needs a cross-origin-isolated page for its memory64 browser engine.');
  unloadQwenTts();
  const { engineFiles, modelFiles } = await assertSpeechFiles(folder, 'qwen3_tts_17b_q4');
  const urls: string[] = [];
  const url = (file: File) => { const value = URL.createObjectURL(file); urls.push(value); return value; };
  const engine = new Map(QWEN_TTS_ENGINE_ASSETS.map((asset, index) => [asset.name, url(engineFiles[index])]));
  // Emscripten's pthread loader resolves its sibling module relative to import.meta.url.
  // A workspace Blob URL has no relative directory, so load the same pinned module URL.
  const coreSource = await engineFiles[QWEN_TTS_ENGINE_ASSETS.findIndex(asset => asset.name === 'llama_webgpu_core_mem64.js')].text();
  const workerReference = 'new URL("llama_webgpu_core_mem64.js",import.meta.url)';
  if (!coreSource.includes(workerReference)) throw new Error('The saved Qwen3-TTS engine changed and cannot be adapted safely.');
  const coreUrl = URL.createObjectURL(new Blob([coreSource.replace(workerReference, 'import.meta.url')], { type: 'text/javascript' }));
  urls.push(coreUrl);
  engine.set('llama_webgpu_core_mem64.js', coreUrl);
  const model = new Map(speechModel('qwen3_tts_17b_q4').assets.map((asset, index) => [asset.name, url(modelFiles[index])]));
  const worker = new Worker(new URL('./qwenTtsWorker.ts', import.meta.url), { type: 'module' });
  try {
    let speakerReference = false;
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<Message>) => {
        const value = event.data;
        if (value.type === 'progress') progress?.(value.message || 'Loading Qwen3-TTS…');
        else if (value.type === 'ready') { speakerReference = !!value.speakerReference; resolve(); }
        else if (value.type === 'error') reject(new Error(value.message || 'Qwen3-TTS could not load.'));
      };
      worker.onerror = event => reject(new Error(event.message || 'Qwen3-TTS worker failed.'));
      worker.postMessage({ type: 'init', bridgeUrl: engine.get('llama_webgpu_bridge.js'), coreUrl: engine.get('llama_webgpu_core_mem64.js'), wasmUrl: engine.get('llama_webgpu_core_mem64.wasm'), modelUrl: model.get('Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf'), projectorUrl: model.get('mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf') });
    });
    const pending = new Map<number, Pending>();
    current = { folder, worker, urls, pending, speakerReference };
    worker.onmessage = (event: MessageEvent<Message>) => {
      const value = event.data;
      const entry = value.requestId == null ? null : pending.get(value.requestId);
      if (value.type === 'progress') {
        if (entry) {
          entry.progress?.(value.message || 'Generating speech…');
          if (value.part && value.parts) entry.onGenerationProgress?.({ part: value.part, parts: value.parts, framesGenerated: value.framesGenerated || 0 });
        } else if (value.requestId == null) progress?.(value.message || 'Loading Qwen3-TTS…');
      }
      if (!entry) return;
      if (value.type === 'chunk' && value.data && value.sampleRate) { entry.chunks.push(value.data); entry.sampleRate = value.sampleRate; entry.onChunk?.(value.data, value.sampleRate); }
      else if (value.type === 'done') { pending.delete(value.requestId!); entry.resolve({ chunks: entry.chunks, sampleRate: entry.sampleRate }); }
      else if (value.type === 'error') { pending.delete(value.requestId!); entry.reject(new Error(value.message || 'Qwen3-TTS generation failed.')); }
    };
    worker.onerror = event => { for (const entry of pending.values()) entry.reject(new Error(event.message || 'Qwen3-TTS worker failed.')); pending.clear(); unloadQwenTts(); };
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

async function referenceWav(sample: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await sample.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 24000), 24000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return new Uint8Array(await wav([rendered.getChannelData(0)], 24000).arrayBuffer());
  } finally { await context.close(); }
}

export async function generateQwenTts(folder: FileSystemDirectoryHandle, text: string, sample: Blob | undefined, progress?: (message: string) => void, onChunk?: (audio: Float32Array, sampleRate: number) => void, onGenerationProgress?: (value: QwenSpeechProgress) => void) {
  if (current?.folder !== folder) await loadQwenTts(folder, progress);
  const session = current;
  if (!session) throw new Error('Qwen3-TTS is not loaded.');
  if (sample && !session.speakerReference) throw new Error('This Qwen3-TTS runtime does not support reference audio.');
  const speakerAudio = sample ? await referenceWav(sample) : undefined;
  const requestId = ++nextId;
  progress?.('Generating speech…');
  const output = await new Promise<{ chunks: Float32Array[]; sampleRate: number }>((resolve, reject) => {
    session.pending.set(requestId, { chunks: [], sampleRate: 0, onChunk, progress, onGenerationProgress, resolve, reject });
    session.worker.postMessage({ type: 'generate', requestId, text, language: 'en', speakerAudio, maxFrames: 192 }, speakerAudio ? [speakerAudio.buffer] : []);
  });
  if (!output.chunks.length || !output.sampleRate) throw new Error('Qwen3-TTS returned no audio.');
  return wav(output.chunks, output.sampleRate);
}
