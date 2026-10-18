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

function elements(bytes: Uint8Array, start: number, end: number): Element[] {
  const found: Element[] = [];
  let offset = start;
  while (offset < end) {
    const id = vint(bytes, offset, end, false);
    const size = vint(bytes, offset + id.length, end, true);
    const body = offset + id.length + size.length;
    const finish = size.unknown ? end : body + size.value;
    if (finish > end || finish < body) throw new Error('Invalid WebM element size.');
    found.push({ id: id.value, start: body, end: finish });
    offset = finish;
  }
  return found;
}

function unsigned(bytes: Uint8Array, start: number, end: number) {
  let value = 0;
  for (let index = start; index < end; index++) value = value * 256 + bytes[index];
  return value;
}

function blockTimecode(bytes: Uint8Array, block: Element) {
  const track = vint(bytes, block.start, block.end, true);
  const offset = block.start + track.length;
  if (offset + 3 > block.end) throw new Error('Incomplete WebM block.');
  const raw = (bytes[offset] << 8) | bytes[offset + 1];
  const flags = bytes[offset + 2];
  if (flags & 0x06) throw new Error('Laced WebM blocks are not measured.');
  return raw < 0x8000 ? raw : raw - 0x10000;
}

/** Reads the video frame timestamps from a MediaRecorder WebM without decoding frames. */
export async function measureWebmTiming(blob: Blob): Promise<VideoTiming> {
  if (blob.size > 50_000_000) throw new Error('WebM timing analysis exceeds its 50 MB limit.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const segment = elements(bytes, 0, bytes.length).find(item => item.id === 0x18538067);
  if (!segment) throw new Error('WebM segment missing.');
  const children = elements(bytes, segment.start, segment.end);
  const info = children.find(item => item.id === 0x1549a966);
  const scaleElement = info && elements(bytes, info.start, info.end).find(item => item.id === 0x2ad7b1);
  const nanosecondsPerTick = scaleElement ? unsigned(bytes, scaleElement.start, scaleElement.end) : 1_000_000;
  const ticks: number[] = [];
  for (const cluster of children.filter(item => item.id === 0x1f43b675)) {
    const parts = elements(bytes, cluster.start, cluster.end);
    const clock = parts.find(item => item.id === 0xe7);
    const base = clock ? unsigned(bytes, clock.start, clock.end) : 0;
    for (const part of parts) {
      if (part.id === 0xa3) ticks.push(base + blockTimecode(bytes, part));
      if (part.id === 0xa0) for (const nested of elements(bytes, part.start, part.end)) {
        if (nested.id === 0xa1) ticks.push(base + blockTimecode(bytes, nested));
      }
    }
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
    minFrameIntervalMs: Math.round(Math.min(...intervals)),
    maxFrameIntervalMs: Math.round(Math.max(...intervals)),
    frameTimestampsMs,
  };
}
