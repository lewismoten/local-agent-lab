import { ensureModelLicenseFiles } from './modelLicenses.ts';
import { modelDownloadDirectory, modelFolderName, modelLogicalPath } from './modelFolders.ts';

export type DownloadProgress = { bytes: number; total: number; resumed: boolean };
export type PartialModel = { name: string; url: string; bytes: number; total: number };
type DownloadRecord = { url: string; total: number; etag?: string; lastModified?: string };
const CHECKPOINT_BYTES = 32 * 1024 * 1024;
const MIB = 1048576;
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Download paused', 'AbortError')); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new DOMException('Download paused', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
});
// Read the limit throughout a chunk's delay so a running download responds to changes.
async function throttleChunk(bytes: number, getMaxMiBps: () => number, signal?: AbortSignal) {
  let remaining = bytes;
  while (remaining > 0) {
    const limit = getMaxMiBps();
    if (!Number.isFinite(limit) || limit <= 0) return;
    const duration = Math.min(100, remaining / (limit * MIB) * 1000);
    const started = performance.now();
    await wait(duration, signal);
    remaining -= (performance.now() - started) * limit * MIB / 1000;
  }
}
const contentRange = (value: string | null) => {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null;
};
const isMissing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const maybeFile = async (dir: FileSystemDirectoryHandle, name: string): Promise<File | null> => {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch (error) { if (isMissing(error)) return null; throw error; }
};
async function saveRecord(dir: FileSystemDirectoryHandle, name: string, record: DownloadRecord) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(JSON.stringify(record, null, 2));
  await writer.close();
}
export async function incompleteModels(folder: FileSystemDirectoryHandle): Promise<Set<string>> {
  const dir = await folder.getDirectoryHandle('models', { create: true });
  const names = new Set<string>();
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file' && name.endsWith('.download.json')) names.add(name.slice(0, -'.download.json'.length));
    if (handle.kind === 'directory') for await (const [child, entry] of (handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind === 'file' && child.endsWith('.download.json')) names.add(child.slice(0, -'.download.json'.length));
    }
  }
  return names;
}
export async function listPartialModels(folder: FileSystemDirectoryHandle): Promise<PartialModel[]> {
  const dir = await folder.getDirectoryHandle('models', { create: true });
  const results: PartialModel[] = [];
  for (const name of await incompleteModels(folder)) {
    try {
      const location = await maybeFile(dir, `${name}.download.json`) ? dir : await dir.getDirectoryHandle(modelFolderName(name));
      const record = JSON.parse(await (await (await location.getFileHandle(`${name}.download.json`)).getFile()).text()) as DownloadRecord;
      const file = await maybeFile(location, name);
      if (typeof record.url === 'string' && Number.isFinite(record.total)) results.push({ name, url: record.url, bytes: file?.size || 0, total: record.total });
    } catch { /* A damaged sidecar can be discarded manually. */ }
  }
  return results;
}
export async function discardPartialModel(folder: FileSystemDirectoryHandle, modelName: string) {
  const dir = await folder.getDirectoryHandle('models', { create: true });
  const nested = await dir.getDirectoryHandle(modelFolderName(modelName)).catch(error => { if (isMissing(error)) return null; throw error; });
  for (const location of [dir, nested].filter((item): item is FileSystemDirectoryHandle => !!item)) for (const name of [modelName, `${modelName}.download.json`]) {
    try { await location.removeEntry(name); } catch (error) { if (!isMissing(error)) throw error; }
  }
}
export async function downloadModelToFolder(folder: FileSystemDirectoryHandle, rawUrl: string, maxMiBps: number | (() => number), onProgress: (value: DownloadProgress) => void, signal?: AbortSignal): Promise<string> {
  const getMaxMiBps = typeof maxMiBps === 'function' ? maxMiBps : () => maxMiBps;
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Use an HTTPS GGUF download URL.');
  const name = decodeURIComponent(url.pathname.split('/').pop() || '');
  if (!/^[\w.()-]+\.gguf$/i.test(name)) throw new Error('The download URL must end in a .gguf filename.');
  await ensureModelLicenseFiles(folder, url.href);
  const dir = await modelDownloadDirectory(folder, name);
  const recordName = `${name}.download.json`;
  const existing = await maybeFile(dir, name);
  const recordFile = await maybeFile(dir, recordName);
  const previous = recordFile ? JSON.parse(await recordFile.text()) as DownloadRecord : null;
  if (previous && previous.url !== url.href) throw new Error('This partial file belongs to another URL. Use its original URL or discard the partial download.');
  // A one-byte probe establishes the remote total without fetching a whole model into memory.
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
  if (!probe.ok) throw new Error(`Could not inspect model download (${probe.status}).`);
  const probeRange = contentRange(probe.headers.get('Content-Range'));
  if (probe.status === 206 && !probeRange) { await probe.body?.cancel(); throw new Error('The server did not expose Content-Range. Safe resume is unavailable for this URL.'); }
  const total = probeRange?.total || Number(probe.headers.get('Content-Length'));
  const rangeSupported = probe.status === 206 && probeRange?.start === 0;
  const etag = probe.headers.get('ETag') || undefined;
  const lastModified = probe.headers.get('Last-Modified') || undefined;
  await probe.body?.cancel();
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('The server did not expose the model size. Choose a host that provides Content-Range or Content-Length.');
  if (total > 2_000_000_000) throw new Error('This GGUF is over the 2 GB browser limit. Choose a smaller file.');
  if (previous && previous.total !== total) throw new Error('The remote file size changed. Discard the partial download before starting again.');
  if (previous?.etag && etag && previous.etag !== etag) throw new Error('The remote model changed (ETag differs). Discard the partial download before starting again.');
  if (previous?.lastModified && lastModified && previous.lastModified !== lastModified) throw new Error('The remote model changed. Discard the partial download before starting again.');
  let bytes = existing?.size || 0;
  if (bytes > total) throw new Error('The local file is larger than the remote model. Discard the partial download before starting again.');
  if (bytes === total) {
    await ensureModelLicenseFiles(folder, url.href);
    if (recordFile) await dir.removeEntry(recordName);
    onProgress({ bytes, total, resumed: true });
    return modelLogicalPath(name);
  }
  if (bytes && !rangeSupported) throw new Error('This server does not support byte ranges, so the partial model cannot safely resume. Use a range-capable URL or discard the partial download.');
  if (bytes) {
    const prefixSize = Math.min(bytes, 65536);
    const prefixResponse = await fetch(url, { headers: { Range: `bytes=0-${prefixSize - 1}` }, signal });
    const prefixRange = contentRange(prefixResponse.headers.get('Content-Range'));
    if (prefixResponse.status !== 206 || prefixRange?.start !== 0 || prefixRange.end !== prefixSize - 1) throw new Error('Could not verify the existing model prefix. The partial file was left untouched.');
    const local = new Uint8Array(await existing!.slice(0, prefixSize).arrayBuffer());
    const remote = new Uint8Array(await prefixResponse.arrayBuffer());
    if (local.length !== remote.length || local.some((value, index) => value !== remote[index])) throw new Error('The existing file does not match this URL. Its bytes were left untouched.');
  }
  await saveRecord(dir, recordName, { url: url.href, total, etag, lastModified });
  const response = await fetch(url, { headers: bytes ? { Range: `bytes=${bytes}-`, ...(previous?.etag ? { 'If-Range': previous.etag } : previous?.lastModified ? { 'If-Range': previous.lastModified } : {}) } : {}, signal });
  const range = contentRange(response.headers.get('Content-Range'));
  if (bytes ? response.status !== 206 || range?.start !== bytes || range.total !== total : !response.ok || (response.status === 206 && (range?.start !== 0 || range.total !== total))) {
    await response.body?.cancel();
    throw new Error('The server did not return the requested byte range. The partial file was left untouched.');
  }
  if (!response.body) throw new Error('The server returned no download stream.');
  const handle = await dir.getFileHandle(name, { create: true });
  const reader = response.body.getReader();
  let writer: FileSystemWritableFileStream | null = null;
  let committed = bytes;
  const startingBytes = bytes;
  let lastProgressAt = 0;
  const report = (force = false) => {
    const time = performance.now();
    if (force || time - lastProgressAt >= 200 || bytes === total) {
      onProgress({ bytes, total, resumed: startingBytes > 0 });
      lastProgressAt = time;
    }
  };
  try {
    writer = await handle.createWritable({ keepExistingData: bytes > 0 });
    if (bytes) await writer.seek(bytes);
    report(true);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new DOMException('Download paused', 'AbortError');
      if (bytes + value.byteLength > total) throw new Error('The server sent more bytes than expected. Download stopped.');
      await writer.write(value);
      bytes += value.byteLength;
      report();
      await throttleChunk(value.byteLength, getMaxMiBps, signal);
      if (bytes - committed >= CHECKPOINT_BYTES) {
        await writer.close(); committed = bytes;
        writer = await handle.createWritable({ keepExistingData: true });
        await writer.seek(bytes);
      }
    }
    await writer.close(); writer = null;
    if (bytes !== total) throw new Error(`Only ${bytes} of ${total} bytes arrived. Run Download again to resume.`);
    await ensureModelLicenseFiles(folder, url.href);
    await dir.removeEntry(recordName);
    return modelLogicalPath(name);
  } catch (error) {
    // Closing commits the last successful bytes; aborting would discard them.
    if (writer) await writer.close().catch(() => {});
    report(true);
    throw error;
  } finally { await reader.cancel().catch(() => {}); }
}

