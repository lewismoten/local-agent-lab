import type { VideoTiming } from './webmTiming.ts';

type Box = { type: string; start: number; end: number };
type Sample = { pts: number; duration: number };

function read32(view: DataView, at: number, end: number) {
  if (at < 0 || at + 4 > end) throw new Error('Incomplete MP4 timing field.');
  return view.getUint32(at, false);
}

function boxes(view: DataView, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at < end) {
    if (at + 8 > end) throw new Error('Incomplete MP4 box header.');
    let size = read32(view, at, end);
    const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at + 4, 4));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new Error('Incomplete large MP4 box header.');
      size = Number(view.getBigUint64(at + 8, false));
      header = 16;
    } else if (size === 0) size = end - at;
    if (!Number.isSafeInteger(size) || size < header || at + size > end) throw new Error('Invalid MP4 box size.');
    found.push({ type, start: at + header, end: at + size });
    if (found.length > 100_000) throw new Error('Too many MP4 boxes.');
    at += size;
  }
  return found;
}

function child(view: DataView, parent: Box, type: string) {
  return boxes(view, parent.start, parent.end).find(box => box.type === type);
}

function fullBox(view: DataView, box: Box) {
  const value = read32(view, box.start, box.end);
  return { version: value >>> 24, flags: value & 0xffffff };
}

function u64(view: DataView, at: number, end: number) {
  if (at + 8 > end) throw new Error('Incomplete MP4 timing field.');
  const value = Number(view.getBigUint64(at, false));
  if (!Number.isSafeInteger(value)) throw new Error('MP4 timestamp exceeds safe range.');
  return value;
}

function videoTrack(view: DataView, movie: Box) {
  for (const track of boxes(view, movie.start, movie.end).filter(box => box.type === 'trak')) {
    const media = child(view, track, 'mdia');
    const handler = media && child(view, media, 'hdlr');
    if (!media || !handler || handler.start + 12 > handler.end) continue;
    const kind = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + handler.start + 8, 4));
    if (kind !== 'vide') continue;
    if (child(view, track, 'edts')) throw new Error('MP4 edit-list timing is not yet supported.');
    const header = child(view, track, 'tkhd');
    const mediaHeader = child(view, media, 'mdhd');
    if (!header || !mediaHeader) throw new Error('MP4 video track header missing.');
    const id = read32(view, header.start + (fullBox(view, header).version === 1 ? 20 : 12), header.end);
    const mediaVersion = fullBox(view, mediaHeader).version;
    const timescale = read32(view, mediaHeader.start + (mediaVersion === 1 ? 20 : 12), mediaHeader.end);
    const mediaDuration = mediaVersion === 1 ? u64(view, mediaHeader.start + 24, mediaHeader.end) : read32(view, mediaHeader.start + 16, mediaHeader.end);
    if (!id || !timescale) throw new Error('Invalid MP4 video timescale or track ID.');
    const sampleTable = child(view, child(view, media, 'minf') || media, 'stbl');
    return { id, timescale, mediaDuration, sampleTable };
  }
  throw new Error('MP4 video track missing.');
}

function flatSamples(view: DataView, table: Box | undefined): Sample[] {
  const timing = table && child(view, table, 'stts');
  if (!timing) return [];
  const count = read32(view, timing.start + 4, timing.end);
  if (count > 100_000 || timing.start + 8 + count * 8 > timing.end) throw new Error('Invalid MP4 sample timing table.');
  const samples: Sample[] = [];
  let decode = 0;
  for (let index = 0; index < count; index++) {
    const at = timing.start + 8 + index * 8;
    const runCount = read32(view, at, timing.end);
    const duration = read32(view, at + 4, timing.end);
    if (!duration || samples.length + runCount > 100_000) throw new Error('Invalid MP4 sample duration.');
    for (let item = 0; item < runCount; item++) { samples.push({ pts: decode, duration }); decode += duration; }
  }
  const sizes = table && child(view, table, 'stsz');
  if (sizes && read32(view, sizes.start + 8, sizes.end) !== samples.length) throw new Error('MP4 sample count mismatch.');
  const composition = table && child(view, table, 'ctts');
  if (composition && samples.length) {
    const count = read32(view, composition.start + 4, composition.end);
    if (count > 100_000 || composition.start + 8 + count * 8 > composition.end) throw new Error('Invalid MP4 composition table.');
    let sample = 0;
    for (let index = 0; index < count; index++) {
      const at = composition.start + 8 + index * 8;
      const runCount = read32(view, at, composition.end);
      const offset = fullBox(view, composition).version === 1 ? view.getInt32(at + 4, false) : read32(view, at + 4, composition.end);
      if (sample + runCount > samples.length) throw new Error('MP4 composition count mismatch.');
      for (let item = 0; item < runCount; item++) samples[sample++].pts += offset;
    }
    if (sample !== samples.length) throw new Error('MP4 composition count mismatch.');
  }
  return samples;
}

function fragmentSamples(view: DataView, root: Box[], movie: Box, trackId: number): Sample[] {
  let defaultDuration = 0;
  const extendsBox = child(view, movie, 'mvex');
  if (extendsBox) for (const entry of boxes(view, extendsBox.start, extendsBox.end).filter(box => box.type === 'trex')) {
    if (read32(view, entry.start + 4, entry.end) === trackId) defaultDuration = read32(view, entry.start + 12, entry.end);
  }
  const samples: Sample[] = [];
  for (const fragment of root.filter(box => box.type === 'moof')) {
    for (const traf of boxes(view, fragment.start, fragment.end).filter(box => box.type === 'traf')) {
      const header = child(view, traf, 'tfhd');
      if (!header || read32(view, header.start + 4, header.end) !== trackId) continue;
      const flags = fullBox(view, header).flags;
      let at = header.start + 8;
      if (flags & 0x000001) at += 8;
      if (flags & 0x000002) at += 4;
      let fallback = defaultDuration;
      if (flags & 0x000008) { fallback = read32(view, at, header.end); at += 4; }
      if (flags & 0x000010) at += 4;
      if (flags & 0x000020) at += 4;
      if (at > header.end) throw new Error('Invalid MP4 track fragment header.');
      const decodeBox = child(view, traf, 'tfdt');
      if (!decodeBox) throw new Error('MP4 fragment decode time missing.');
      let decode = fullBox(view, decodeBox).version === 1 ? u64(view, decodeBox.start + 4, decodeBox.end) : read32(view, decodeBox.start + 4, decodeBox.end);
      for (const run of boxes(view, traf.start, traf.end).filter(box => box.type === 'trun')) {
        const { version, flags } = fullBox(view, run);
        const count = read32(view, run.start + 4, run.end);
        if (count > 100_000 || samples.length + count > 100_000) throw new Error('Too many MP4 samples.');
        let offset = run.start + 8;
        if (flags & 0x000001) offset += 4;
        if (flags & 0x000004) offset += 4;
        for (let index = 0; index < count; index++) {
          const duration = flags & 0x000100 ? read32(view, offset, run.end) : fallback;
          if (flags & 0x000100) offset += 4;
          if (flags & 0x000200) offset += 4;
          if (flags & 0x000400) offset += 4;
          const composition = flags & 0x000800 ? version === 1 ? view.getInt32(offset, false) : read32(view, offset, run.end) : 0;
          if (flags & 0x000800) offset += 4;
          if (!duration || offset > run.end) throw new Error('Invalid MP4 fragment sample.');
          samples.push({ pts: decode + composition, duration });
          decode += duration;
        }
      }
    }
  }
  return samples;
}

/** Reads video sample timing from bounded MP4 files produced by MediaRecorder. */
export async function measureMp4Timing(blob: Blob): Promise<VideoTiming> {
  if (blob.size > 50_000_000) throw new Error('MP4 timing analysis exceeds its 50 MB limit.');
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const root = boxes(view, 0, buffer.byteLength);
  const movie = root.find(box => box.type === 'moov');
  if (!movie) throw new Error('MP4 movie header missing.');
  const track = videoTrack(view, movie);
  const fragmented = root.some(box => box.type === 'moof');
  const samples = fragmented ? fragmentSamples(view, root, movie, track.id) : flatSamples(view, track.sampleTable);
  if (samples.length < 2) throw new Error('MP4 frame timing missing.');
  samples.sort((a, b) => a.pts - b.pts);
  const first = samples[0].pts;
  const last = samples.at(-1)!.pts;
  const end = samples.reduce((latest, sample) => Math.max(latest, sample.pts + sample.duration), -Infinity);
  const durationMs = (fragmented || !track.mediaDuration ? end - first : track.mediaDuration) * 1000 / track.timescale;
  const intervals = samples.slice(1).map((sample, index) => (sample.pts - samples[index].pts) * 1000 / track.timescale);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || intervals.some(interval => interval <= 0)) throw new Error('Invalid MP4 frame timestamps.');
  return {
    durationSeconds: Math.round(durationMs) / 1000,
    encodedFrames: samples.length,
    effectiveFps: Math.round((samples.length - 1) * track.timescale / (last - first) * 100) / 100,
    minFrameIntervalMs: Math.round(intervals.reduce((smallest, interval) => Math.min(smallest, interval), Infinity)),
    maxFrameIntervalMs: Math.round(intervals.reduce((largest, interval) => Math.max(largest, interval), 0)),
    frameTimestampsMs: samples.map(sample => Math.round((sample.pts - first) * 1000 / track.timescale * 1000) / 1000),
  };
}
