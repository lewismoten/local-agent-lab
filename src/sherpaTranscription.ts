import { transcriptionDirectory } from './transcriptionAssets.ts';

type Reply = { id: number; text?: string; error?: string };

const workerSource = String.raw`
let recognizer;
let micStream;
let micFinal = '';
const files = [];
function clean(text) { return String(text || '').trim(); }
function decode(stream) {
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  return clean(recognizer.getResult(stream).text);
}
function feedMicrophone(samples) {
  if (!micStream) micStream = recognizer.createStream();
  micStream.acceptWaveform(16000, samples);
  const current = decode(micStream);
  if (recognizer.isEndpoint(micStream)) {
    if (current) micFinal = [micFinal, current].filter(Boolean).join(' ');
    recognizer.reset(micStream);
    return micFinal;
  }
  return [micFinal, current].filter(Boolean).join(' ');
}
function finishMicrophone() {
  if (!micStream) return micFinal;
  micStream.acceptWaveform(16000, new Float32Array(8000));
  micStream.inputFinished();
  const current = decode(micStream);
  if (current) micFinal = [micFinal, current].filter(Boolean).join(' ');
  micStream.free(); micStream = null;
  const text = micFinal; micFinal = '';
  return text;
}
function transcribeFile(samples) {
  const stream = recognizer.createStream();
  let text = '';
  try {
    for (let offset = 0; offset < samples.length; offset += 16000) {
      stream.acceptWaveform(16000, samples.subarray(offset, offset + 16000));
      const current = decode(stream);
      if (recognizer.isEndpoint(stream)) {
        if (current) text = [text, current].filter(Boolean).join(' ');
        recognizer.reset(stream);
      }
    }
    stream.acceptWaveform(16000, new Float32Array(8000));
    stream.inputFinished();
    const final = decode(stream);
    return [text, final].filter(Boolean).join(' ');
  } finally { stream.free(); }
}
self.onmessage = async event => {
  const { id, action } = event.data;
  try {
    if (action === 'load') {
      const { helper, loader, wasm, data } = event.data;
      for (const file of [helper, loader, wasm, data]) files.push(URL.createObjectURL(file));
      self.Module = {
        locateFile(path) {
          if (path.endsWith('.wasm')) return files[2];
          if (path.endsWith('.data')) return files[3];
          return path;
        },
        onRuntimeInitialized() {
          try {
            recognizer = createOnlineRecognizer(self.Module);
            if (!recognizer?.handle) throw new Error('Sherpa recognizer could not initialize.');
            self.postMessage({ id, text: 'ready' });
          } catch (error) { self.postMessage({ id, error: String(error) }); }
        },
        onAbort(reason) { self.postMessage({ id, error: 'Sherpa engine aborted: ' + reason }); },
      };
      importScripts(files[0]);
      importScripts(files[1]);
      return;
    }
    if (!recognizer) throw new Error('Load the Sherpa engine first.');
    const text = action === 'mic' ? feedMicrophone(event.data.samples)
      : action === 'finish' ? finishMicrophone()
      : action === 'file' ? transcribeFile(event.data.samples)
      : '';
    self.postMessage({ id, text });
  } catch (error) { self.postMessage({ id, error: String(error) }); }
};
`;

export class SherpaTranscriber {
  private worker: Worker;
  private sourceUrl: string;
  private nextId = 0;
  private pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();

  private constructor(worker: Worker, sourceUrl: string) {
    this.worker = worker; this.sourceUrl = sourceUrl;
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const { id, text, error } = event.data;
      const request = this.pending.get(id); if (!request) return;
      this.pending.delete(id);
      if (error) request.reject(new Error(error)); else request.resolve(text || '');
    };
    worker.onerror = event => {
      for (const request of this.pending.values()) request.reject(new Error(event.message || 'Sherpa worker failed.'));
      this.pending.clear();
    };
  }

  static async create(folder: FileSystemDirectoryHandle) {
    const model = await transcriptionDirectory(folder, 'sherpa');
    const engine = await (await folder.getDirectoryHandle('engines')).getDirectoryHandle('Sherpa-ONNX-ASR');
    const file = async (dir: FileSystemDirectoryHandle, name: string) => (await dir.getFileHandle(name)).getFile();
    const [helper, loader, wasm, data] = await Promise.all([
      file(engine, 'sherpa-onnx-asr.js'), file(engine, 'sherpa-onnx-wasm-main-asr.js'),
      file(engine, 'sherpa-onnx-wasm-main-asr.wasm'), file(model, 'sherpa-onnx-wasm-main-asr.data'),
    ]);
    const sourceUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const runtime = new SherpaTranscriber(new Worker(sourceUrl), sourceUrl);
    try { await runtime.call('load', { helper, loader, wasm, data }, 120_000); return runtime; }
    catch (error) { runtime.dispose(); throw error; }
  }

  private call(action: string, extras: Record<string, unknown> = {}, timeout = 60_000) {
    const id = ++this.nextId;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Sherpa ${action} timed out.`)); }, timeout);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.worker.postMessage({ id, action, ...extras });
    });
  }

  feed(samples: Float32Array) { return this.call('mic', { samples }, 30_000); }
  finish() { return this.call('finish'); }
  transcribe(samples: Float32Array) { return this.call('file', { samples }, Math.max(60_000, samples.length / 16000 * 5000)); }
  dispose() {
    this.worker.terminate(); URL.revokeObjectURL(this.sourceUrl);
    for (const request of this.pending.values()) request.reject(new Error('Sherpa was unloaded.'));
    this.pending.clear();
  }
}
