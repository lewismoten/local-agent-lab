import { BlobByteReader } from './blobByteReader.ts';

export type VideoTiming = {
  durationSeconds: number;
  encodedFrames: number;
  effectiveFps: number;
  minFrameIntervalMs: number;
  maxFrameIntervalMs: number;
  frameTimestampsMs: number[];
};

export function videoTimingWarnings(timing: VideoTiming, requestedFrames: number, fps: number): string[] {
  const expectedSeconds = requestedFrames / fps;
  return [
    timing.durationSeconds > expectedSeconds + Math.max(.25, expectedSeconds * .1) ? 'Video runs longer than the selected frame timing.' : '',
    timing.encodedFrames < requestedFrames + 1 ? 'Fewer frames were encoded than requested, including the final flush frame.' : '',
    timing.maxFrameIntervalMs > 1500 / fps ? 'Uneven frame timing is visible in the encoded clip.' : '',
  ].filter(Boolean);
}

type Element = { id: number; start: number; end: number };

function vint(bytes: Uint8Array, offset: number, limit: number, size: boolean) {
  const first = bytes[offset];
  if (first === undefined) throw new Error('Incomplete WebM element.');
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || offset + length > limit) throw new Error('Invalid WebM element length.');
  let value = size ? first & ((1 << (8 - length)) - 1) : first;
  for (let index = 1; index < length; index++) value = value * 256 + bytes[offset + index];
  const unknown = size && value === 2 ** (7 * length) - 1;
  return { value, length, unknown };
}

async function* elements(reader: BlobByteReader, start: number, end: number): AsyncGenerator<Element> {
  let offset = start;
  let count = 0;
  while (offset < end) {
    if (++count > 1_000_000) throw new Error('Too many WebM elements.');
    const header = await reader.read(offset, Math.min(16, end - offset));
    const id = vint(header, 0, header.length, false);
    const size = vint(header, id.length, header.length, true);
    const body = offset + id.length + size.length;
    const finish = size.unknown ? end : body + size.value;
    if (!Number.isSafeInteger(finish) || finish > end || finish < body) throw new Error('Invalid WebM element size.');
    yield { id: id.value, start: body, end: finish };
    offset = finish;
  }
}

async function unsigned(reader: BlobByteReader, start: number, end: number) {
  if (end - start > 8) throw new Error('Invalid WebM timing value.');
  const bytes = await reader.read(start, end - start);
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

async function blockTimecode(reader: BlobByteReader, block: Element) {
  const bytes = await reader.read(block.start, Math.min(11, block.end - block.start));
  const track = vint(bytes, 0, bytes.length, true);
  const offset = track.length;
  if (offset + 3 > bytes.length) throw new Error('Incomplete WebM block.');
  const raw = (bytes[offset] << 8) | bytes[offset + 1];
  const flags = bytes[offset + 2];
  if (flags & 0x06) throw new Error('Laced WebM blocks are not measured.');
  return raw < 0x8000 ? raw : raw - 0x10000;
}

/** Reads the video frame timestamps from a MediaRecorder WebM without decoding frames. */
export async function measureWebmTiming(blob: Blob): Promise<VideoTiming> {
  const reader = new BlobByteReader(blob);
  let segment: Element | undefined;
  for await (const item of elements(reader, 0, blob.size)) if (item.id === 0x18538067) { segment = item; break; }
  if (!segment) throw new Error('WebM segment missing.');
  let nanosecondsPerTick = 1_000_000;
  const ticks: number[] = [];
  for await (const child of elements(reader, segment.start, segment.end)) {
    if (child.id === 0x1549a966) {
      for await (const item of elements(reader, child.start, child.end))
        if (item.id === 0x2ad7b1) nanosecondsPerTick = await unsigned(reader, item.start, item.end);
    }
    if (child.id !== 0x1f43b675) continue;
    let base = 0;
    const local: number[] = [];
    for await (const part of elements(reader, child.start, child.end)) {
      if (part.id === 0xe7) base = await unsigned(reader, part.start, part.end);
      if (part.id === 0xa3) local.push(await blockTimecode(reader, part));
      if (part.id === 0xa0) for await (const nested of elements(reader, part.start, part.end)) {
        if (nested.id === 0xa1) local.push(await blockTimecode(reader, nested));
      }
      if (ticks.length + local.length > 100_000) throw new Error('Too many WebM frame timestamps.');
    }
    for (const offset of local) ticks.push(base + offset);
  }
  if (ticks.length < 2 || !Number.isFinite(nanosecondsPerTick) || nanosecondsPerTick <= 0) throw new Error('WebM frame timing missing.');
  const frameTimestampsMs = ticks.map(tick => Math.round(tick * nanosecondsPerTick / 1_000_000 * 1000) / 1000).sort((a, b) => a - b);
  const intervals = frameTimestampsMs.slice(1).map((time, index) => time - frameTimestampsMs[index]);
  const durationMs = frameTimestampsMs.at(-1)! - frameTimestampsMs[0];
  if (durationMs <= 0) throw new Error('WebM timestamps do not advance.');
  return {
    durationSeconds: Math.round(durationMs) / 1000,
    encodedFrames: frameTimestampsMs.length,
    effectiveFps: Math.round((frameTimestampsMs.length - 1) / durationMs * 1000 * 100) / 100,
    minFrameIntervalMs: Math.round(intervals.reduce((smallest, interval) => Math.min(smallest, interval), Infinity)),
    maxFrameIntervalMs: Math.round(intervals.reduce((largest, interval) => Math.max(largest, interval), 0)),
    frameTimestampsMs,
  };
}
