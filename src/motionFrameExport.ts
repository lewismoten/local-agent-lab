import { strToU8, Zip, ZipPassThrough } from 'fflate';
import { readBlob, writeStream } from './storage.ts';
import type { FrameSource } from './motionRuntime.ts';

export function framePngBlob(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode a frame.')), 'image/png'));
}

export async function saveFrameSequenceZip(folder: FileSystemDirectoryHandle, path: string, frames: FrameSource, fps: number, signal?: AbortSignal, onFrame?: (index: number, count: number) => void): Promise<File> {
  const count = Array.isArray(frames) ? frames.length : frames.count;
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(fps) || fps <= 0) throw new Error('Invalid frame sequence.');
  const frameAt = (index: number) => Array.isArray(frames) ? frames[index] : frames.frame(index);
  const first = frameAt(0);
  await writeStream(folder, path, async writer => {
    let resolveFinished!: () => void;
    let rejectFinished!: (error: unknown) => void;
    const finished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
    let writes = Promise.resolve();
    const archive = new Zip((error, chunk, final) => {
      if (error) { rejectFinished(error); return; }
      writes = writes.then(() => writer.write(new Uint8Array(chunk)));
      void writes.catch(rejectFinished);
      if (final) void writes.then(resolveFinished, rejectFinished);
    });
    const add = (name: string, bytes: Uint8Array) => {
      const entry = new ZipPassThrough(name);
      archive.add(entry);
      entry.push(bytes, true);
    };
    try {
      add('sequence.json', strToU8(JSON.stringify({ version: 1, fps, frameCount: count, width: first.width, height: first.height }, null, 2)));
      await writes;
      for (let index = 0; index < count; index++) {
        if (signal?.aborted) throw signal.reason;
        const frame = index === 0 ? first : frameAt(index);
        if (frame.width !== first.width || frame.height !== first.height) throw new Error('Frame dimensions changed during export.');
        const png = await framePngBlob(frame);
        add(`frames/${String(index + 1).padStart(6, '0')}.png`, new Uint8Array(await png.arrayBuffer()));
        await writes;
        onFrame?.(index + 1, count);
      }
      if (signal?.aborted) throw signal.reason;
      archive.end();
      await finished;
    } catch (error) { archive.terminate(); throw error; }
  });
  return readBlob(folder, path);
}
