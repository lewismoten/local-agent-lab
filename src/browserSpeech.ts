import { withLocalModelMemory } from './localModelMemory.ts';
import { assertSpeechFiles } from './speechAssets.ts';
import { KOKORO_BUILT_IN_VOICES, SPEECH_ENGINE_ASSETS, speechModel, type SpeechModelId } from './speechManifest.ts';
import { unloadLocalOllama } from './localOllama.ts';
import { generateKokoro, isKokoroLoadedFrom, loadKokoro, unloadKokoro } from './browserKokoro.ts';
import { generateChatterbox, isChatterboxLoadedFrom, loadChatterbox, unloadChatterbox } from './browserChatterbox.ts';
import { generateQwenTts, isQwenTtsLoadedFrom, loadQwenTts, unloadQwenTts, type QwenSpeechProgress } from './browserQwenTts.ts';
import { convertOpenVoice, isOpenVoiceLoadedFrom, loadOpenVoice, unloadOpenVoice } from './browserOpenVoice.ts';
import type { OpenVoiceSplitMode } from './openVoiceSegments.ts';

type Pocket = {
  options: Record<string, unknown>;
  sampleRate: number;
  predefinedVoices: string[];
  load: (progress?: (value: { type: string; label?: string; loaded?: number; total?: number; status?: string }) => void) => Promise<unknown>;
  loadVoice: (name: string) => Promise<string>;
  cloneVoice: (audio: Float32Array, options: { inputSampleRate: number }) => Promise<string>;
  generate: (text: string, options: { voice: string; onChunk: (audio: Float32Array) => void }) => Promise<unknown>;
  stop: () => Promise<void>;
  destroy: () => void;
};
type Status = { state: 'idle' | 'loading' | 'ready' | 'error'; model: SpeechModelId | null; message: string; voices: string[] };
let status: Status = { state: 'idle', model: null, message: '', voices: [] };
const listeners = new Set<() => void>();
const publish = (next: Status) => { status = next; listeners.forEach(listener => listener()); };
export const getBrowserSpeechStatus = () => status;
export const subscribeBrowserSpeech = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let loaded: { folder: FileSystemDirectoryHandle; model: SpeechModelId; pocket: Pocket; urls: string[] } | null = null;
let activeSpeechGeneration: { stopped: boolean; cancel: () => void; controller: AbortController } | null = null;
export const isBrowserSpeechLoadedFrom = (folder: FileSystemDirectoryHandle, model: SpeechModelId) => status.state === 'ready' && (model === 'kokoro_q8' ? isKokoroLoadedFrom(folder) : model === 'chatterbox_turbo_q4f16' || model === 'chatterbox_q4f16' ? isChatterboxLoadedFrom(folder, model) : model === 'qwen3_tts_17b_q4' ? isQwenTtsLoadedFrom(folder) : model === 'openvoice_v2_q8' ? isOpenVoiceLoadedFrom(folder) : loaded?.folder === folder && loaded.model === model);
const moduleUrl = (source: string) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

export async function unloadBrowserSpeech() {
  const old = loaded; loaded = null;
  unloadKokoro();
  unloadChatterbox();
  unloadQwenTts();
  unloadOpenVoice();
  old?.pocket.destroy();
  for (const url of old?.urls || []) URL.revokeObjectURL(url);
  publish({ state: 'idle', model: null, message: '', voices: [] });
}

export async function stopBrowserSpeech() {
  const generation = activeSpeechGeneration;
  if (!generation || generation.stopped) return;
  generation.stopped = true;
  generation.controller.abort();
  generation.cancel();
  // Terminating the worker also stops a generation that is stuck inside ONNX.
  // PocketTTS.destroy() does not reject its pending request, so the caller races
  // that request against the cancellation promise below.
  if (loaded || status.model === 'kokoro_q8' || status.model === 'chatterbox_turbo_q4f16' || status.model === 'chatterbox_q4f16' || status.model === 'qwen3_tts_17b_q4' || status.model === 'openvoice_v2_q8') await unloadBrowserSpeech();
}

async function start(folder: FileSystemDirectoryHandle, model: SpeechModelId, progress?: (message: string) => void) {
  if (loaded?.folder === folder && loaded.model === model) return loaded.pocket;
  await unloadBrowserSpeech();
  publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
  const urls: string[] = [];
  let pocket: Pocket | null = null;
  try {
    const { engineFiles, modelFiles } = await assertSpeechFiles(folder, model);
    const engine = new Map(SPEECH_ENGINE_ASSETS.map((asset, index) => [asset.name, engineFiles[index]]));
    const byName = new Map(speechModel(model).assets.map((asset, index) => [asset.name, modelFiles[index]]));
    const addFile = (file: File) => { const url = URL.createObjectURL(file); urls.push(url); return url; };
    const tokenizerUrl = addFile(engine.get('tokenizer.js')!);
    const binaryUrl = addFile(engine.get('binary.js')!);
    let workerSource = await engine.get('worker.js')!.text();
    workerSource = workerSource
      .replace('from "./tokenizer.js"', `from "${tokenizerUrl}"`)
      .replace('from "./binary.js"', `from "${binaryUrl}"`)
      .replace('return `${config.modelBaseUrl}/${language}/${filename}`;', 'const localUrl = config.modelUrls?.[filename]; if (!localUrl) throw new Error(`Missing saved speech file: ${filename}`); return localUrl;')
      .replace('await import(/* @vite-ignore */ `${base}ort.min.mjs`)', 'await import(config.ortModuleUrl)')
      .replace('ort.env.wasm.wasmPaths = base;', 'ort.env.wasm.wasmPaths = config.wasmPaths;');
    if (workerSource.includes('from "./tokenizer.js"') || workerSource.includes('from "./binary.js"') || workerSource.includes('await import(/* @vite-ignore */ `${base}ort.min.mjs`)') || workerSource.includes('ort.env.wasm.wasmPaths = base;') || !workerSource.includes('Missing saved speech file')) throw new Error('The saved Pocket TTS engine changed and cannot be adapted safely.');
    const workerUrl = moduleUrl(workerSource); urls.push(workerUrl);
    const launcher = await engine.get('index.js')!.text();
    const workerReference = 'new URL("./worker.js", import.meta.url)';
    const tokenizerExport = 'export { SentencePieceTokenizer } from "./tokenizer.js";';
    const playerExport = 'export { StreamingPlayer, chunksToWavBlob } from "./player.js";';
    if (![workerReference, tokenizerExport, playerExport].every(part => launcher.includes(part))) {
      throw new Error('The saved Pocket TTS launcher changed and cannot be adapted safely.');
    }
    const source = launcher
      .replace(workerReference, JSON.stringify(workerUrl))
      .replace(tokenizerExport, '')
      .replace(playerExport, '');
    if (/\b(?:import|export)\s*(?:[^;]*?\s+from\s*)?["']\.\//.test(source)) {
      throw new Error('The saved Pocket TTS launcher contains an unresolved local module.');
    }
    const indexUrl = moduleUrl(source); urls.push(indexUrl);
    const ortModuleUrl = addFile(engine.get('ort.min.mjs')!);
    const wasmPaths = { mjs: addFile(engine.get('ort-wasm-simd-threaded.mjs')!), wasm: addFile(engine.get('ort-wasm-simd-threaded.wasm')!) };
    const modelUrls: Record<string, string> = {};
    for (const [name, file] of byName) if (name !== 'LICENSE-CC-BY-4.0.txt') modelUrls[name] = addFile(file);
    const module = await import(/* @vite-ignore */ indexUrl) as { PocketTTS: new (options: Record<string, unknown>) => Pocket };
    pocket = new module.PocketTTS({ language: model, quantized: true, voiceCloning: true, cache: false, maxThreads: 1, voicesUrl: modelUrls['voices.bin'] });
    Object.assign(pocket.options, { modelUrls, ortModuleUrl, wasmPaths });
    await pocket.load(value => { const message = value.label || value.status || value.type; publish({ state: 'loading', model, message, voices: [] }); progress?.(message); });
    loaded = { folder, model, pocket, urls };
    publish({ state: 'ready', model, message: 'Ready', voices: pocket.predefinedVoices });
    return pocket;
  } catch (error) {
    pocket?.destroy(); for (const url of urls) URL.revokeObjectURL(url);
    publish({ state: 'error', model, message: error instanceof Error ? error.message : String(error), voices: [] });
    throw error;
  }
}

async function releaseOtherModels() {
  await (await import('./browserTranscription.ts')).unloadBrowserTranscription();
  await (await import('./browserImage.ts')).unloadBrowserImageModel();
  await (await import('./browserModel.ts')).unloadBrowserModel();
  await (await import('./needleRuntime.ts')).unloadNeedle();
  await unloadLocalOllama();
}

export async function loadBrowserSpeech(folder: FileSystemDirectoryHandle, model: SpeechModelId, progress?: (message: string) => void) {
  return withLocalModelMemory(async () => {
    await releaseOtherModels();
    if (model === 'kokoro_q8') {
      await unloadBrowserSpeech();
      publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
      try { await loadKokoro(folder, message => { publish({ state: 'loading', model, message, voices: [] }); progress?.(message); }); publish({ state: 'ready', model, message: 'Ready', voices: [...KOKORO_BUILT_IN_VOICES] }); }
      catch (error) { publish({ state: 'error', model, message: error instanceof Error ? error.message : String(error), voices: [] }); throw error; }
    } else if (model === 'chatterbox_turbo_q4f16' || model === 'chatterbox_q4f16') {
      await unloadBrowserSpeech();
      publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
      try { await loadChatterbox(folder, model, message => { publish({ state: 'loading', model, message, voices: [] }); progress?.(message); }); publish({ state: 'ready', model, message: 'Ready', voices: [] }); }
      catch (error) { publish({ state: 'error', model, message: error instanceof Error ? error.message : String(error), voices: [] }); throw error; }
    } else if (model === 'qwen3_tts_17b_q4') {
      await unloadBrowserSpeech();
      publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
      try { await loadQwenTts(folder, message => { publish({ state: 'loading', model, message, voices: [] }); progress?.(message); }); publish({ state: 'ready', model, message: 'Ready', voices: [] }); }
      catch (error) { publish({ state: 'error', model, message: error instanceof Error ? error.message : String(error), voices: [] }); throw error; }
    } else if (model === 'openvoice_v2_q8') {
      await unloadBrowserSpeech();
      publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
      try { await loadOpenVoice(folder, message => { publish({ state: 'loading', model, message, voices: [] }); progress?.(message); }); publish({ state: 'ready', model, message: 'Ready', voices: [] }); }
      catch (error) { publish({ state: 'error', model, message: error instanceof Error ? error.message : String(error), voices: [] }); throw error; }
    } else await start(folder, model, progress);
  });
}

function wav(chunks: Float32Array[], sampleRate: number): Blob {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { const limited = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, Math.round(limited < 0 ? limited * 32768 : limited * 32767), true); offset += 2; }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function generateBrowserSpeech(folder: FileSystemDirectoryHandle, model: SpeechModelId, text: string, voice: string, sample?: Blob, progress?: (message: string) => void, onChunk?: (audio: Float32Array, sampleRate: number) => void, sourceAudio?: Blob, onQwenProgress?: (value: QwenSpeechProgress) => void, openVoiceSplitMode: OpenVoiceSplitMode = 'pauses', exaggeration = 0.5) {
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new DOMException('Speech generation stopped.', 'AbortError')); });
  void cancelled.catch(() => {});
  const generation = { stopped: false, cancel, controller: new AbortController() };
  activeSpeechGeneration = generation;
  const work = async () => {
    if (generation.stopped) throw new DOMException('Speech generation stopped.', 'AbortError');
    if (model === 'kokoro_q8') {
      if (!isKokoroLoadedFrom(folder)) {
        await releaseOtherModels(); await unloadBrowserSpeech();
        publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
        await loadKokoro(folder, progress);
        if (generation.stopped) { unloadKokoro(); throw new DOMException('Speech generation stopped.', 'AbortError'); }
        publish({ state: 'ready', model, message: 'Ready', voices: [...KOKORO_BUILT_IN_VOICES] });
      }
      if (generation.stopped) throw new DOMException('Speech generation stopped.', 'AbortError');
      if (sample) throw new Error('Kokoro uses built-in voices; recorded voice cloning is not supported.');
      return generateKokoro(folder, text, voice, progress, onChunk);
    }
    if (model === 'chatterbox_turbo_q4f16' || model === 'chatterbox_q4f16') {
      if (!isChatterboxLoadedFrom(folder, model)) {
        await releaseOtherModels(); await unloadBrowserSpeech();
        publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
        await loadChatterbox(folder, model, progress);
        if (generation.stopped) { unloadChatterbox(); throw new DOMException('Speech generation stopped.', 'AbortError'); }
        publish({ state: 'ready', model, message: 'Ready', voices: [] });
      }
      return generateChatterbox(folder, model, text, sample, exaggeration, progress, onChunk);
    }
    if (model === 'qwen3_tts_17b_q4') {
      if (!isQwenTtsLoadedFrom(folder)) {
        await releaseOtherModels(); await unloadBrowserSpeech();
        publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
        await loadQwenTts(folder, progress);
        if (generation.stopped) { unloadQwenTts(); throw new DOMException('Speech generation stopped.', 'AbortError'); }
        publish({ state: 'ready', model, message: 'Ready', voices: [] });
      }
      return generateQwenTts(folder, text, sample, progress, onChunk, onQwenProgress);
    }
    if (model === 'openvoice_v2_q8') {
      if (!sourceAudio || !sample) throw new Error('Choose source audio and a saved reference voice.');
      if (!isOpenVoiceLoadedFrom(folder)) {
        await releaseOtherModels(); await unloadBrowserSpeech();
        publish({ state: 'loading', model, message: 'Checking files…', voices: [] });
        await loadOpenVoice(folder, progress);
        if (generation.stopped) { unloadOpenVoice(); throw new DOMException('Voice conversion stopped.', 'AbortError'); }
        publish({ state: 'ready', model, message: 'Ready', voices: [] });
      }
      return convertOpenVoice(folder, sourceAudio, sample, progress, openVoiceSplitMode, generation.controller.signal);
    }
    if (loaded?.folder !== folder || loaded.model !== model) await releaseOtherModels();
    const pocket = await start(folder, model, progress);
    const assertRunning = () => { if (generation.stopped) throw new DOMException('Speech generation stopped.', 'AbortError'); };
    assertRunning();
    let voiceRef: string;
    if (sample) {
      progress?.('Encoding voice sample…');
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await sample.arrayBuffer());
        const mono = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) { const data = decoded.getChannelData(channel); for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels; }
        voiceRef = await pocket.cloneVoice(mono, { inputSampleRate: decoded.sampleRate });
      } finally { await context.close(); }
    } else voiceRef = await pocket.loadVoice(voice);
    assertRunning();
    const chunks: Float32Array[] = [];
    progress?.('Generating speech…');
    let generatedSamples = 0;
    await pocket.generate(text, { voice: voiceRef, onChunk: audio => { if (generation.stopped) return; chunks.push(audio.slice()); generatedSamples += audio.length; onChunk?.(audio, pocket.sampleRate); progress?.(`Generated ${Math.round(generatedSamples / pocket.sampleRate)} seconds…`); } });
    assertRunning();
    if (!chunks.length) throw new Error('The speech model returned no audio.');
    return wav(chunks, pocket.sampleRate);
  };
  try {
    const queued = withLocalModelMemory(() => Promise.race([work(), cancelled]));
    return await Promise.race([queued, cancelled]);
  } finally { if (activeSpeechGeneration === generation) activeSpeechGeneration = null; }
}
