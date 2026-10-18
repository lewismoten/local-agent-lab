import { assertSpeechFiles } from './speechAssets.ts';
import { OPENVOICE_ENGINE_ASSETS, speechModel } from './speechManifest.ts';
import { joinOpenVoiceSegments, planOpenVoiceSegments, type OpenVoiceSplitMode } from './openVoiceSegments.ts';

type Message = { type: 'ready' | 'progress' | 'done' | 'error'; requestId?: number | null; message?: string; data?: Float32Array };
type Pending = { progress?: (message: string) => void; resolve: (value: Float32Array) => void; reject: (error: Error) => void };
let current: { folder: FileSystemDirectoryHandle; worker: Worker; urls: string[]; pending: Map<number, Pending> } | null = null;
let nextId = 0;
export const isOpenVoiceLoadedFrom = (folder: FileSystemDirectoryHandle) => current?.folder === folder;
export function unloadOpenVoice() {
  const old = current; current = null;
  if (!old) return;
  old.worker.terminate();
  for (const item of old.pending.values()) item.reject(new DOMException('Voice conversion stopped.', 'AbortError'));
  for (const url of old.urls) URL.revokeObjectURL(url);
}
export async function loadOpenVoice(folder: FileSystemDirectoryHandle, progress?: (message: string) => void) {
  if (current?.folder === folder) return;
  unloadOpenVoice();
  const { engineFiles, modelFiles } = await assertSpeechFiles(folder, 'openvoice_v2_q8');
  const urls: string[] = [];
  const url = (file: File) => { const value = URL.createObjectURL(file); urls.push(value); return value; };
  const engine = new Map(OPENVOICE_ENGINE_ASSETS.map((asset, index) => [asset.name, url(engineFiles[index])]));
  const model = new Map(speechModel('openvoice_v2_q8').assets.map((asset, index) => [asset.name, url(modelFiles[index])]));
  const worker = new Worker(new URL('./openVoiceWorker.ts', import.meta.url), { type: 'module' });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<Message>) => {
        const value = event.data;
        if (value.type === 'progress') progress?.(value.message || 'Loading OpenVoice…');
        else if (value.type === 'ready') resolve();
        else if (value.type === 'error') reject(new Error(value.message || 'OpenVoice could not load.'));
      };
      worker.onerror = event => reject(new Error(event.message || 'OpenVoice worker failed.'));
      worker.postMessage({ type: 'init', ortUrl: engine.get('ort.webgpu.min.mjs'), wasmMjsUrl: engine.get('ort-wasm-simd-threaded.jsep.mjs'), wasmUrl: engine.get('ort-wasm-simd-threaded.jsep.wasm'), encoderUrl: model.get('tone_ref_encoder_q8.onnx'), converterUrl: model.get('tone_converter_q8.onnx') });
    });
    const pending = new Map<number, Pending>();
    current = { folder, worker, urls, pending };
    worker.onmessage = (event: MessageEvent<Message>) => {
      const value = event.data;
      const item = value.requestId == null ? null : pending.get(value.requestId);
      if (value.type === 'progress') {
        if (item) item.progress?.(value.message || 'Converting voice…');
        else if (value.requestId == null) progress?.(value.message || 'Loading OpenVoice…');
      }
      if (!item) return;
      if (value.type === 'done' && value.data) { pending.delete(value.requestId!); item.resolve(value.data); }
      else if (value.type === 'error') { pending.delete(value.requestId!); item.reject(new Error(value.message || 'Voice conversion failed.')); }
    };
    worker.onerror = event => { for (const item of pending.values()) item.reject(new Error(event.message || 'OpenVoice worker failed.')); pending.clear(); unloadOpenVoice(); };
  } catch (error) { worker.terminate(); for (const value of urls) URL.revokeObjectURL(value); throw error; }
}
async function mono22050(file: Blob, kind: 'source' | 'reference') {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration < 0.25 || decoded.duration > (kind === 'source' ? 600 : 30)) throw new Error(kind === 'source' ? 'Source speech must be 0.25 seconds to 10 minutes long.' : 'Reference voice must be 0.25 to 30 seconds long.');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 22050), 22050);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally { await context.close(); }
}
function wav(audio: Float32Array) {
  const bytes = new ArrayBuffer(44 + audio.length * 2), view = new DataView(bytes);
  for (const [offset, word] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < word.length; i++) view.setUint8(offset + i, word.charCodeAt(i));
  view.setUint32(4, bytes.byteLength - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 22050, true); view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, audio.length * 2, true);
  audio.forEach((value, index) => { const n = Math.max(-1, Math.min(1, value)); view.setInt16(44 + index * 2, Math.round(n < 0 ? n * 32768 : n * 32767), true); });
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function convertOpenVoice(folder: FileSystemDirectoryHandle, sourceFile: Blob, referenceFile: Blob, progress?: (message: string) => void, splitMode: OpenVoiceSplitMode = 'pauses', signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (current?.folder !== folder) await loadOpenVoice(folder, progress);
  const session = current;
  if (!session) throw new Error('OpenVoice is not loaded.');
  const source = await mono22050(sourceFile, 'source');
  signal?.throwIfAborted();
  const reference = await mono22050(referenceFile, 'reference');
  signal?.throwIfAborted();
  progress?.(splitMode === 'pauses' ? 'Finding pauses…' : 'Splitting source audio…');
  const segments = planOpenVoiceSegments(source, splitMode);
  const batchId = ++nextId;
  const converted: Float32Array[] = [];
  for (const [index, segment] of segments.entries()) {
    signal?.throwIfAborted();
    const requestId = ++nextId;
    const part = source.slice(segment.start, segment.end);
    const prefix = `Part ${index + 1}/${segments.length}`;
    progress?.(`${prefix} · converting…`);
    const audio = await new Promise<Float32Array>((resolve, reject) => {
      session.pending.set(requestId, { progress: message => progress?.(`${prefix} · ${message}`), resolve, reject });
      const message = { type: 'convert', requestId, batchId, source: part, ...(index === 0 ? { reference } : {}) };
      session.worker.postMessage(message, index === 0 ? [part.buffer, reference.buffer] : [part.buffer]);
    });
    converted.push(audio);
  }
  signal?.throwIfAborted();
  progress?.('Joining converted audio…');
  return wav(joinOpenVoiceSegments(segments, converted, source.length));
}
