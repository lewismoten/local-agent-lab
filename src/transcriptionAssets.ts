import { sha256 } from '@noble/hashes/sha2.js';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { showToast } from './toastStore.ts';
import { SHERPA_ARCHIVE_NAME, SHERPA_EXTRACTED_ASSETS, TRANSCRIPTION_MODELS, transcriptionAssets, transcriptionModel, transcriptionTotal, type TranscriptionAsset, type TranscriptionKind } from './transcriptionManifest.ts';
import { extractSherpaArchive } from './sherpaArchive.ts';
type State = { folder: FileSystemDirectoryHandle | null; active: TranscriptionKind | null; queue: TranscriptionKind[]; paused: boolean; installed: Record<TranscriptionKind, boolean>; checked: Record<TranscriptionKind, boolean>; saved: Record<TranscriptionKind, number>; sherpaArchiveReady: boolean; current: string; error: string };
const emptyFlags = () => Object.fromEntries(['engine', ...TRANSCRIPTION_MODELS.map(model => model.id)].map(kind => [kind, false])) as Record<TranscriptionKind, boolean>;
const emptySaved = () => Object.fromEntries(['engine', ...TRANSCRIPTION_MODELS.map(model => model.id)].map(kind => [kind, 0])) as Record<TranscriptionKind, number>;
let state: State = { folder: null, active: null, queue: [], paused: false, installed: emptyFlags(), checked: emptyFlags(), saved: emptySaved(), sherpaArchiveReady: false, current: '', error: '' };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getTranscriptionAssets = () => state;
export const subscribeTranscriptionAssets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const assets = transcriptionAssets;
export async function transcriptionDirectory(folder: FileSystemDirectoryHandle, kind: TranscriptionKind, create = false) {
  const root = await folder.getDirectoryHandle(kind === 'engine' ? 'engines' : 'models', { create });
  return root.getDirectoryHandle(kind === 'engine' ? 'Transformers-ASR' : transcriptionModel(kind).path.slice('models/'.length), { create });
}
async function fileAt(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    const parts = name.split('/'); let here = dir;
    for (const part of parts.slice(0, -1)) here = await here.getDirectoryHandle(part);
    return await (await here.getFileHandle(parts.at(-1)!)).getFile();
  } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
}
async function fileHandle(dir: FileSystemDirectoryHandle, name: string) {
  const parts = name.split('/'); let here = dir;
  for (const part of parts.slice(0, -1)) here = await here.getDirectoryHandle(part, { create: true });
  return here.getFileHandle(parts.at(-1)!, { create: true });
}
async function hash(file: Blob) {
  const digest = sha256.create();
  for (let offset = 0; offset < file.size; offset += 8 * 1048576) digest.update(new Uint8Array(await file.slice(offset, offset + 8 * 1048576).arrayBuffer()));
  return [...digest.digest()].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function verified(dir: FileSystemDirectoryHandle, asset: TranscriptionAsset) {
  const file = await fileAt(dir, asset.name);
  if (!file || file.size !== asset.bytes) return false;
  const proof = await fileAt(dir, `${asset.name}.verified.json`);
  if (proof) try {
    const saved = JSON.parse(await proof.text()) as { sha256: string; size: number; modified: number };
    if (saved.sha256 === asset.sha256 && saved.size === file.size && saved.modified === file.lastModified) return true;
  } catch { /* Rehash. */ }
  if (await hash(file) !== asset.sha256) return false;
  const writer = await (await fileHandle(dir, `${asset.name}.verified.json`)).createWritable();
  await writer.write(JSON.stringify({ sha256: asset.sha256, size: file.size, modified: file.lastModified })); await writer.close();
  return true;
}
export async function assertTranscriptionFiles(folder: FileSystemDirectoryHandle, model: TranscriptionKind = 'whisper') {
  for (const kind of model === 'sherpa' ? ['sherpa'] as const : ['engine', model] as const) {
    const dir = await transcriptionDirectory(folder, kind);
    for (const asset of assets(kind)) if (!await verified(dir, asset)) throw new Error(`Download and verify the transcription ${kind} first.`);
  }
  if (model === 'sherpa' && !await sherpaExtracted(folder)) throw new Error('Unpack the Sherpa streaming model first.');
}
export async function sherpaExtracted(folder: FileSystemDirectoryHandle) {
  try {
    const modelDir = await transcriptionDirectory(folder, 'sherpa');
    const engineDir = await (await folder.getDirectoryHandle('engines')).getDirectoryHandle('Sherpa-ONNX-ASR');
    if (!await verified(engineDir, assets('sherpa')[0])) return false;
    for (const asset of SHERPA_EXTRACTED_ASSETS) if (!await verified(asset.name.endsWith('.data') ? modelDir : engineDir, asset)) return false;
    return true;
  } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return false; throw error; }
}
let aborter: AbortController | null = null;
let running: Promise<void> | null = null;
let discovery: Promise<void> | null = null;
async function throttle(bytes: number, signal: AbortSignal) {
  let remaining = bytes;
  while (remaining > 0) {
    if (signal.aborted) throw new DOMException('Paused', 'AbortError');
    const speed = modelDownloadManager.getSnapshot().speedLimit;
    if (!speed) return;
    const delay = Math.min(100, remaining / (speed * 1048576) * 1000);
    const before = performance.now();
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, delay); const stop = () => { clearTimeout(timer); reject(new DOMException('Paused', 'AbortError')); }; signal.addEventListener('abort', stop, { once: true }); });
    remaining -= (performance.now() - before) * speed * 1048576 / 1000;
  }
}
async function downloadAsset(dir: FileSystemDirectoryHandle, kind: TranscriptionKind, asset: TranscriptionAsset, base: number, signal: AbortSignal) {
  if (await verified(dir, asset)) return;
  const existing = await fileAt(dir, asset.name);
  const recordName = `${asset.name}.download.json`;
  const record = await fileAt(dir, recordName);
  let offset = 0;
  if (existing && record && existing.size < asset.bytes) try {
    const saved = JSON.parse(await record.text()) as TranscriptionAsset;
    if (saved.url === asset.url && saved.sha256 === asset.sha256 && saved.bytes === asset.bytes) offset = existing.size;
  } catch { /* Restart unverified partial. */ }
  const response = await fetch(asset.url, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`${asset.name} download failed (${response.status}).`);
  if (response.status === 206) {
    const range = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== asset.bytes) throw new Error(`${asset.name} could not resume safely.`);
  } else if (response.status === 200) offset = 0;
  else throw new Error(`${asset.name} returned an unexpected range.`);
  const recordWriter = await (await fileHandle(dir, recordName)).createWritable();
  await recordWriter.write(JSON.stringify(asset)); await recordWriter.close();
  const handle = await fileHandle(dir, asset.name);
  let writer: FileSystemWritableFileStream | null = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset) await writer.seek(offset);
  let count = offset; let checkpoint = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (signal.aborted) throw new DOMException('Paused', 'AbortError');
      if (count + value.byteLength > asset.bytes) throw new Error(`${asset.name} exceeded its pinned size.`);
      await writer.write(value); count += value.byteLength; checkpoint += value.byteLength;
      publish({ saved: { ...state.saved, [kind]: base + count }, current: asset.name });
      await throttle(value.byteLength, signal);
      if (checkpoint >= 16 * 1048576) { await writer.close(); writer = await handle.createWritable({ keepExistingData: true }); await writer.seek(count); checkpoint = 0; }
    }
    await writer.close(); writer = null;
    if (count !== asset.bytes || !await verified(dir, asset)) throw new Error(`${asset.name} failed its integrity check.`);
    const parts = recordName.split('/'); let parent = dir;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    await parent.removeEntry(parts.at(-1)!).catch(() => {});
  } finally { await writer?.close().catch(() => {}); }
}
async function next(folder: FileSystemDirectoryHandle) {
  if (running || state.paused || state.folder !== folder || !state.queue.length) return;
  const [kind, ...queue] = state.queue; aborter = new AbortController(); const signal = aborter.signal;
  publish({ active: kind, queue, error: '', current: '' });
  running = (async () => {
    try {
      const dir = await transcriptionDirectory(folder, kind, true); let base = 0;
      if (kind === 'sherpa' && !await verified(dir, assets('sherpa').find(asset => asset.name === SHERPA_ARCHIVE_NAME)!)) throw new Error('Import the Sherpa archive to continue.');
      for (const asset of assets(kind)) { if (signal.aborted) throw signal.reason; await downloadAsset(dir, kind, asset, base, signal); base += asset.bytes; publish({ saved: { ...state.saved, [kind]: base } }); }
      if (kind === 'sherpa' && !await sherpaExtracted(folder)) {
        publish({ current: 'Unpacking Sherpa model…' });
        await extractSherpaArchive(folder, dir, signal);
        if (!await sherpaExtracted(folder)) throw new Error('Sherpa files failed their integrity check.');
      }
      publish({ active: null, installed: { ...state.installed, [kind]: true }, checked: { ...state.checked, [kind]: true }, current: '' });
      showToast(`${kind === 'engine' ? 'Transcription engine' : transcriptionModel(kind).label} finished downloading.`);
    } catch (error) {
      publish({ active: null, queue: [kind, ...state.queue], paused: true, error: signal.aborted ? '' : error instanceof Error ? error.message : String(error) });
      if (!signal.aborted) showToast(`Transcription download failed: ${state.error}`, 'error');
    } finally { aborter = null; running = null; void next(folder); }
  })();
}
export const transcriptionAssetsManager = {
  async importSherpaArchive(folder: FileSystemDirectoryHandle, file: File) {
    if (running || state.active) throw new Error('Wait for the current transcription download to finish.');
    const archive = assets('sherpa').find(asset => asset.name === SHERPA_ARCHIVE_NAME)!;
    if (file.size !== archive.bytes || await hash(file) !== archive.sha256) throw new Error('This is not the pinned Sherpa Zipformer archive.');
    const dir = await transcriptionDirectory(folder, 'sherpa', true);
    const handle = await fileHandle(dir, archive.name);
    const writer = await handle.createWritable();
    try {
      for (let offset = 0; offset < file.size; offset += 8 * 1048576) await writer.write(await file.slice(offset, offset + 8 * 1048576).arrayBuffer());
    } finally { await writer.close(); }
    if (!await verified(dir, archive)) throw new Error('The imported Sherpa archive failed verification.');
    if (state.folder !== folder) await this.discover(folder);
    publish({ saved: { ...state.saved, sherpa: archive.bytes }, sherpaArchiveReady: true });
    this.queue(folder, 'sherpa');
    if (state.paused) this.resume(folder);
  },
  async discover(folder: FileSystemDirectoryHandle): Promise<void> {
    if (running) { await running; return this.discover(folder); }
    if (discovery) { await discovery; if (state.folder === folder) return; }
    const task = (async () => {
      publish({ folder, installed: emptyFlags(), checked: emptyFlags(), saved: emptySaved(), sherpaArchiveReady: false, error: '' });
      for (const kind of ['engine', ...TRANSCRIPTION_MODELS.map(model => model.id)] as TranscriptionKind[]) {
        let complete = true, bytes = 0;
        try { const dir = await transcriptionDirectory(folder, kind); for (const asset of assets(kind)) { const file = await fileAt(dir, asset.name); bytes += Math.min(asset.bytes, file?.size || 0); const valid = await verified(dir, asset); if (!valid) complete = false; if (kind === 'sherpa' && asset.name === SHERPA_ARCHIVE_NAME) publish({ sherpaArchiveReady: valid }); } if (kind === 'sherpa' && !await sherpaExtracted(folder)) complete = false; }
        catch (error) { complete = false; if (!(error instanceof DOMException && error.name === 'NotFoundError')) publish({ error: error instanceof Error ? error.message : String(error) }); }
        if (state.folder !== folder) return;
        publish({ installed: { ...state.installed, [kind]: complete }, checked: { ...state.checked, [kind]: true }, saved: { ...state.saved, [kind]: bytes } });
      }
    })(); discovery = task; try { await task; } finally { if (discovery === task) discovery = null; }
  },
  queue(folder: FileSystemDirectoryHandle, kind: TranscriptionKind) {
    if (state.folder && state.folder !== folder && running) throw new Error('Another workspace has an active transcription download.');
    if (state.folder !== folder) publish({ folder, queue: [], paused: false, installed: emptyFlags(), checked: emptyFlags(), saved: emptySaved(), sherpaArchiveReady: false });
    if (state.installed[kind] || state.active === kind || state.queue.includes(kind)) return;
    publish({ queue: [...state.queue, kind] }); void next(folder);
  },
  pause() { publish({ paused: true }); aborter?.abort(); },
  resume(folder: FileSystemDirectoryHandle) { if (state.folder !== folder) return; publish({ paused: false, error: '' }); void next(folder); },
  total: transcriptionTotal,
};
