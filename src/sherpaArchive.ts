import decompressStream from 'streaming-bz2-decompress';
import { SHERPA_ARCHIVE_NAME, SHERPA_EXTRACTED_ASSETS } from './transcriptionManifest.ts';
import { workspaceFileName } from './workspacePath.ts';

const decoder = new TextDecoder();
const prefix = 'sherpa-onnx-wasm-simd-v1.12.32-en-asr-zipformer/';

// Consume the verified upstream tar.bz2 a block at a time. Only the four pinned
// runtime files are written; the upstream demo page and scripts are ignored.
export async function extractSherpaArchive(folder: FileSystemDirectoryHandle, modelDir: FileSystemDirectoryHandle, signal: AbortSignal) {
  workspaceFileName(SHERPA_ARCHIVE_NAME);
  SHERPA_EXTRACTED_ASSETS.forEach(asset => workspaceFileName(asset.name));
  const archive = await (await modelDir.getFileHandle(SHERPA_ARCHIVE_NAME)).getFile();
  const engineRoot = await folder.getDirectoryHandle('engines', { create: true });
  const engineDir = await engineRoot.getDirectoryHandle('Sherpa-ONNX-ASR', { create: true });
  const expected = new Map(SHERPA_EXTRACTED_ASSETS.map(asset => [asset.name, asset]));
  const written = new Set<string>();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let remaining = 0;
  let padding = 0;
  let current = '';
  let writer: FileSystemWritableFileStream | null = null;
  let failed: Error | null = null;
  const append = (chunk: Uint8Array) => {
    if (!pending.length) { pending = chunk; return; }
    const joined = new Uint8Array(pending.length + chunk.length);
    joined.set(pending); joined.set(chunk, pending.length); pending = joined;
  };
  const consume = (count: number) => { pending = pending.subarray(count); };
  const process = async (chunk: Uint8Array) => {
    append(chunk);
    while (pending.length) {
      if (signal.aborted) throw new DOMException('Paused', 'AbortError');
      if (remaining) {
        const size = Math.min(remaining, pending.length);
        if (writer) await writer.write(new Uint8Array(pending.subarray(0, size)));
        consume(size); remaining -= size;
        if (!remaining) { await writer?.close(); writer = null; written.add(current); }
        continue;
      }
      if (padding) { const size = Math.min(padding, pending.length); consume(size); padding -= size; continue; }
      if (pending.length < 512) break;
      const header = pending.subarray(0, 512);
      const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '').replace(/^\.\//, '');
      const bytes = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim() || '0', 8);
      consume(512);
      if (!name) { pending = new Uint8Array(0); break; }
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 220_000_000) throw new Error('Invalid Sherpa archive entry.');
      current = name.startsWith(prefix) ? name.slice(prefix.length) : '';
      const asset = expected.get(current);
      if (asset && bytes !== asset.bytes) throw new Error(`${current} changed in the pinned Sherpa archive.`);
      if (asset) {
        const target = current.endsWith('.data') ? modelDir : engineDir;
        writer = await (await target.getFileHandle(current, { create: true })).createWritable();
      }
      remaining = bytes; padding = (512 - bytes % 512) % 512;
      if (!remaining) { await writer?.close(); writer = null; if (asset) written.add(current); }
    }
  };
  const unpack = decompressStream({
    workerCount: 0,
    onDecompressed: async (_id, data) => { if (!failed) try { await process(data); } catch (error) { failed = error instanceof Error ? error : new Error(String(error)); } },
    onError: (_id, error) => { failed = new Error(error); },
  });
  try {
    const reader = archive.stream().getReader();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if (signal.aborted) throw new DOMException('Paused', 'AbortError');
      await unpack.addData(value);
      if (failed) throw failed;
    }
    await unpack.dataFinished();
    if (failed) throw failed;
    if (writer || remaining || [...expected.keys()].some(name => !written.has(name))) throw new Error('The Sherpa archive is incomplete.');
    const license = await (await modelDir.getFileHandle('LICENSE-Apache-2.0.txt')).getFile();
    const licenseWriter = await (await engineDir.getFileHandle('LICENSE-Apache-2.0.txt', { create: true })).createWritable();
    await licenseWriter.write(license); await licenseWriter.close();
  } finally { unpack.cancel(); const openWriter = writer as FileSystemWritableFileStream | null; await openWriter?.close().catch(() => {}); }
}
