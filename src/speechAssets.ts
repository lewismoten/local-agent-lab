import { sha256 } from '@noble/hashes/sha2.js';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { showToast } from './toastStore.ts';
import { CHATTERBOX_ENGINE_ASSETS, KOKORO_ENGINE_ASSETS, OPENVOICE_ENGINE_ASSETS, QWEN_TTS_ENGINE_ASSETS, SPEECH_ENGINE_ASSETS, SPEECH_MODELS, speechModel, type SpeechAsset, type SpeechModelId } from './speechManifest.ts';

export type SpeechGroup = 'engine' | 'kokoro_engine' | 'chatterbox_engine' | 'qwen_engine' | 'openvoice_engine' | SpeechModelId;
type State = { folder: FileSystemDirectoryHandle | null; active: SpeechGroup | null; queue: SpeechGroup[]; paused: boolean; checked: Record<SpeechGroup, boolean>; installed: Record<SpeechGroup, boolean>; saved: Record<SpeechGroup, number>; checkErrors: Partial<Record<SpeechGroup, string>>; current: string; error: string; revision: number };
const empty = <T>(value: T): Record<SpeechGroup, T> => ({ engine: value, kokoro_engine: value, chatterbox_engine: value, qwen_engine: value, openvoice_engine: value, 'english_2026-04': value, german: value, spanish: value, kokoro_q8: value, chatterbox_q4f16: value, chatterbox_turbo_q4f16: value, qwen3_tts_17b_q4: value, openvoice_v2_q8: value });
let state: State = { folder: null, active: null, queue: [], paused: false, checked: empty(false), installed: empty(false), saved: empty(0), checkErrors: {}, current: '', error: '', revision: 0 };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getSpeechAssets = () => state;
export const subscribeSpeechAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const speechAssets = (group: SpeechGroup) => group === 'engine' ? SPEECH_ENGINE_ASSETS : group === 'kokoro_engine' ? KOKORO_ENGINE_ASSETS : group === 'chatterbox_engine' ? CHATTERBOX_ENGINE_ASSETS : group === 'qwen_engine' ? QWEN_TTS_ENGINE_ASSETS : group === 'openvoice_engine' ? OPENVOICE_ENGINE_ASSETS : speechModel(group).assets;
export const speechTotal = (group: SpeechGroup) => speechAssets(group).reduce((sum, asset) => sum + asset.bytes, 0);
export async function speechDirectory(folder: FileSystemDirectoryHandle, group: SpeechGroup, create = false) {
  const engine = group === 'engine' || group === 'kokoro_engine' || group === 'chatterbox_engine' || group === 'qwen_engine' || group === 'openvoice_engine';
  const parent = await folder.getDirectoryHandle(engine ? 'engines' : 'models', { create });
  return parent.getDirectoryHandle(group === 'engine' ? 'Pocket-TTS' : group === 'kokoro_engine' ? 'Kokoro' : group === 'chatterbox_engine' ? 'Chatterbox' : group === 'qwen_engine' ? 'Qwen3-TTS' : group === 'openvoice_engine' ? 'OpenVoice' : speechModel(group).path.slice('models/'.length), { create });
}
const absent = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
async function maybeFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); }
  catch (error) { if (absent(error)) return null; throw error; }
}
async function digest(file: Blob) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) hash.update(new Uint8Array(await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer()));
  return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function writeText(dir: FileSystemDirectoryHandle, name: string, value: string) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(value); await writer.close();
}
async function verified(dir: FileSystemDirectoryHandle, asset: SpeechAsset): Promise<File | null> {
  const file = await maybeFile(dir, asset.name);
  if (!file || file.size !== asset.bytes) return null;
  if (file.size > 16 * 1024 * 1024) {
    const sidecar = await maybeFile(dir, `${asset.name}.verified.json`);
    if (sidecar) try {
      const proof = JSON.parse(await sidecar.text()) as { sha256: string; size: number; lastModified: number };
      if (proof.sha256 === asset.sha256 && proof.size === file.size && proof.lastModified === file.lastModified) return file;
    } catch { /* Rehash a damaged proof. */ }
  }
  if (await digest(file) !== asset.sha256) return null;
  if (file.size > 16 * 1024 * 1024) await writeText(dir, `${asset.name}.verified.json`, JSON.stringify({ sha256: asset.sha256, size: file.size, lastModified: file.lastModified })).catch(() => {});
  return file;
}
export async function assertSpeechFiles(folder: FileSystemDirectoryHandle, group: SpeechModelId) {
  const engineGroup = speechModel(group).engine === 'kokoro' ? 'kokoro_engine' : speechModel(group).engine === 'chatterbox' ? 'chatterbox_engine' : speechModel(group).engine === 'qwen' ? 'qwen_engine' : speechModel(group).engine === 'openvoice' ? 'openvoice_engine' : 'engine';
  const engine = await speechDirectory(folder, engineGroup);
  const model = await speechDirectory(folder, group);
  const engineFiles = await Promise.all(speechAssets(engineGroup).map(asset => verified(engine, asset)));
  const modelFiles = await Promise.all(speechModel(group).assets.map(asset => verified(model, asset)));
  if (engineFiles.some(file => !file) || modelFiles.some(file => !file) || !await maybeFile(model, 'NOTICE.txt')) throw new Error('Download the selected speech engine and model first.');
  return { engineFiles: engineFiles as File[], modelFiles: modelFiles as File[] };
}
let aborter: AbortController | null = null;
let activeTask: Promise<void> | null = null;
let discovery: { folder: FileSystemDirectoryHandle; promise: Promise<void> } | null = null;
async function throttle(bytes: number, signal: AbortSignal) {
  let remaining = bytes;
  while (remaining > 0) {
    if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
    const speed = modelDownloadManager.getSnapshot().speedLimit;
    if (!speed) return;
    const delay = Math.min(100, remaining / (speed * 1048576) * 1000);
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, delay);
      const stop = () => { clearTimeout(timer); reject(new DOMException('Download paused', 'AbortError')); };
      signal.addEventListener('abort', stop, { once: true });
    });
    remaining -= (performance.now() - start) * speed * 1048576 / 1000;
  }
}
async function transfer(dir: FileSystemDirectoryHandle, group: SpeechGroup, asset: SpeechAsset, base: number, signal: AbortSignal) {
  if (await verified(dir, asset)) return;
  const prior = await maybeFile(dir, asset.name);
  const resumable = asset.url.startsWith('https://huggingface.co/');
  const recordName = `${asset.name}.download.json`;
  const record = await maybeFile(dir, recordName);
  let offset = 0;
  if (resumable && prior && record && prior.size < asset.bytes) {
    try {
      const proof = JSON.parse(await record.text()) as SpeechAsset;
      if (proof.url === asset.url && proof.bytes === asset.bytes && proof.sha256 === asset.sha256) offset = prior.size;
    } catch { /* Restart an unknown partial. */ }
  }
  const response = await fetch(asset.url, resumable ? { signal, headers: { Range: `bytes=${offset}-` } } : { signal });
  if (!response.ok || !response.body) throw new Error(`${asset.name} download failed (${response.status}).`);
  if (response.status === 206) {
    const range = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== asset.bytes) throw new Error(`${asset.name} could not resume safely.`);
  } else if (response.status === 200) offset = 0;
  else throw new Error(`${asset.name} returned an unexpected range.`);
  await writeText(dir, recordName, JSON.stringify(asset));
  const handle = await dir.getFileHandle(asset.name, { create: true });
  let writer: FileSystemWritableFileStream | null = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset) await writer.seek(offset);
  let count = offset;
  let checkpoint = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (signal.aborted) throw new DOMException('Download paused', 'AbortError');
      if (count + value.byteLength > asset.bytes) throw new Error(`${asset.name} exceeded its pinned size.`);
      await writer.write(value); count += value.byteLength; checkpoint += value.byteLength;
      publish({ saved: { ...state.saved, [group]: base + count }, current: asset.name });
      await throttle(value.byteLength, signal);
      if (checkpoint >= 16 * 1024 * 1024) { await writer.close(); writer = await handle.createWritable({ keepExistingData: true }); await writer.seek(count); checkpoint = 0; }
    }
    await writer.close(); writer = null;
    if (count !== asset.bytes || !await verified(dir, asset)) throw new Error(`${asset.name} failed its size or integrity check.`);
    await dir.removeEntry(recordName).catch(() => {});
  } finally { await writer?.close().catch(() => {}); }
}
async function startNext(folder: FileSystemDirectoryHandle) {
  if (activeTask || state.paused || state.folder !== folder || !state.queue.length) return;
  const [group, ...queue] = state.queue;
  aborter = new AbortController();
  const signal = aborter.signal;
  publish({ active: group, queue, current: '', error: '' });
  activeTask = (async () => {
    try {
      const dir = await speechDirectory(folder, group, true);
      let base = 0;
      for (const asset of speechAssets(group)) { if (signal.aborted) throw signal.reason; await transfer(dir, group, asset, base, signal); base += asset.bytes; publish({ saved: { ...state.saved, [group]: base } }); }
      if (group !== 'engine' && group !== 'kokoro_engine' && group !== 'chatterbox_engine' && group !== 'qwen_engine' && group !== 'openvoice_engine') await writeText(dir, 'NOTICE.txt', group === 'kokoro_q8' ? 'Kokoro 82M v1.0 ONNX by hexgrad and ONNX Community. Apache License 2.0. See LICENSE-Apache-2.0.txt and MODEL-CARD.md.\n' : group === 'chatterbox_q4f16' ? 'Chatterbox by Resemble AI; ONNX export by ONNX Community. MIT License. See LICENSE-MIT.txt and MODEL-CARD.md.\n' : group === 'chatterbox_turbo_q4f16' ? 'Chatterbox Turbo by Resemble AI. MIT License. See LICENSE-MIT.txt and MODEL-CARD.md.\n' : group === 'qwen3_tts_17b_q4' ? 'Qwen3-TTS by Qwen/Alibaba Cloud; GGUF conversion by ggml-org. Apache License 2.0. See LICENSE-Apache-2.0.txt.\n' : group === 'openvoice_v2_q8' ? 'OpenVoice V2 by MyShell.ai; ONNX conversion by TigreGotico. MIT License. See LICENSE-MIT.txt, MODEL-CARD.md, and PROVENANCE.md.\n' : `Pocket TTS ONNX ${group}\nModel: https://huggingface.co/vlapky/pocket-tts-onnx\nOriginal model: https://huggingface.co/kyutai/pocket-tts\nCredit: Kyutai and the ONNX export contributors. Licensed under CC BY 4.0.\nSee MODEL-CARD.md for use restrictions and attribution details.\n`);
      publish({ installed: { ...state.installed, [group]: true }, checked: { ...state.checked, [group]: true }, active: null, current: '', revision: state.revision + 1 });
      showToast(`${group === 'engine' ? 'Pocket TTS engine' : group === 'kokoro_engine' ? 'Kokoro engine' : group === 'chatterbox_engine' ? 'Chatterbox engine' : group === 'qwen_engine' ? 'Qwen3-TTS engine' : group === 'openvoice_engine' ? 'OpenVoice engine' : speechModel(group).label} finished downloading.`);
    } catch (error) {
      const paused = signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      publish({ active: null, queue: [group, ...state.queue], paused: true, error: paused ? '' : message, revision: state.revision + 1 });
      if (!paused) showToast(`Speech download failed: ${message}`, 'error');
    } finally { aborter = null; activeTask = null; void startNext(folder); }
  })();
}
export const speechAssetsManager = {
  async discover(folder: FileSystemDirectoryHandle): Promise<void> {
    if (activeTask) { await activeTask; return this.discover(folder); }
    if (discovery) {
      if (discovery.folder === folder) return discovery.promise;
      await discovery.promise.catch(() => {});
      return this.discover(folder);
    }
    const promise = (async () => {
      const sameFolder = state.folder === folder;
      publish({ folder, active: null, queue: sameFolder ? state.queue : [], paused: sameFolder && state.paused, checked: empty(false), installed: empty(false), saved: empty(0), checkErrors: {}, current: '', error: '' });
      for (const group of ['engine', 'kokoro_engine', 'chatterbox_engine', 'qwen_engine', 'openvoice_engine', ...SPEECH_MODELS.map(model => model.id)] as SpeechGroup[]) {
        let bytes = 0;
        let complete = true;
        try {
          const dir = await speechDirectory(folder, group);
          for (const asset of speechAssets(group)) { const file = await maybeFile(dir, asset.name); bytes += Math.min(asset.bytes, file?.size || 0); if (!await verified(dir, asset)) complete = false; }
          if (group !== 'engine' && group !== 'kokoro_engine' && group !== 'chatterbox_engine' && group !== 'qwen_engine' && group !== 'openvoice_engine' && !await maybeFile(dir, 'NOTICE.txt')) complete = false;
        } catch (error) {
          complete = false;
          if (!absent(error)) publish({ checkErrors: { ...state.checkErrors, [group]: error instanceof Error ? error.message : String(error) } });
        }
        if (state.folder !== folder) return;
        publish({ checked: { ...state.checked, [group]: true }, installed: { ...state.installed, [group]: complete }, saved: { ...state.saved, [group]: bytes } });
      }
      publish({ revision: state.revision + 1 });
    })();
    discovery = { folder, promise };
    try { await promise; } finally { if (discovery?.promise === promise) discovery = null; }
  },
  queue(folder: FileSystemDirectoryHandle, group: SpeechGroup) {
    if (state.folder && state.folder !== folder && activeTask) throw new Error('Another workspace has an active speech download.');
    if (state.folder !== folder) publish({ folder, queue: [], checked: empty(false), installed: empty(false), saved: empty(0), paused: false });
    if (state.installed[group] || state.active === group || state.queue.includes(group)) return;
    publish({ queue: [...state.queue, group] }); void startNext(folder);
  },
  pause() { publish({ paused: true }); aborter?.abort(); },
  async pauseAndWait() { this.pause(); await Promise.all([activeTask, discovery?.promise.catch(() => {})]); },
  resume(folder: FileSystemDirectoryHandle) { if (state.folder !== folder) return; publish({ paused: false, error: '' }); void startNext(folder); },
};
