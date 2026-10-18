export type OpenVoiceSplitMode = 'pauses' | 'even';
export type OpenVoiceSegment = { start: number; end: number; coreStart: number; coreEnd: number };

const RATE = 22050;
const TARGET = 20 * RATE;
const SEARCH = 2 * RATE;
const OVERLAP = Math.round(0.4 * RATE);
const HOP = Math.round(0.02 * RATE);

export function planOpenVoiceSegments(audio: Float32Array, mode: OpenVoiceSplitMode): OpenVoiceSegment[] {
  if (!audio.length) throw new Error('Source audio is empty.');
  if (audio.length <= 28 * RATE) return [{ start: 0, end: audio.length, coreStart: 0, coreEnd: audio.length }];
  const count = Math.ceil(audio.length / TARGET);
  const energy: number[] = [];
  if (mode === 'pauses') {
    for (let offset = 0; offset < audio.length; offset += HOP) {
      let sum = 0;
      for (let i = offset; i < Math.min(offset + HOP, audio.length); i++) sum += audio[i] * audio[i];
      energy.push(sum / Math.min(HOP, audio.length - offset));
    }
  }
  const cuts = [0];
  for (let part = 1; part < count; part++) {
    const target = Math.round(audio.length * part / count);
    if (mode === 'even') { cuts.push(target); continue; }
    const lo = Math.max(cuts.at(-1)! + 8 * RATE, target - SEARCH);
    const hi = Math.min(audio.length - (count - part) * 8 * RATE, target + SEARCH);
    let best = target, score = Infinity;
    for (let bin = Math.ceil(lo / HOP); bin <= Math.floor(hi / HOP); bin++) {
      // Average over 160 ms so a single quiet sample inside a word is not a break.
      let level = 0;
      for (let around = -4; around <= 4; around++) level += energy[Math.max(0, Math.min(energy.length - 1, bin + around))];
      const candidate = bin * HOP;
      const value = level / 9 + 0.0001 * Math.abs(candidate - target) / SEARCH;
      if (value < score) { score = value; best = candidate; }
    }
    cuts.push(best);
  }
  cuts.push(audio.length);
  return cuts.slice(0, -1).map((coreStart, index) => ({
    coreStart, coreEnd: cuts[index + 1],
    start: index ? Math.max(0, coreStart - OVERLAP) : 0,
    end: index < count - 1 ? Math.min(audio.length, cuts[index + 1] + OVERLAP) : audio.length,
  }));
}

export function joinOpenVoiceSegments(segments: OpenVoiceSegment[], converted: Float32Array[], total: number): Float32Array {
  if (segments.length !== converted.length || !segments.length || converted.some(part => !part.length)) throw new Error('A converted audio part is missing.');
  if (segments.length === 1) return converted[0];
  const result = new Float32Array(total);
  const weights = new Float32Array(total);
  segments.forEach((segment, partIndex) => {
    const part = converted[partIndex];
    const expected = segment.end - segment.start;
    for (let offset = 0; offset < expected; offset++) {
      const position = expected > 1 ? offset * (part.length - 1) / (expected - 1) : 0;
      const low = Math.floor(position);
      const sample = part[low] + ((part[Math.min(low + 1, part.length - 1)] - part[low]) * (position - low));
      const absolute = segment.start + offset;
      const fadeIn = segment.coreStart > segment.start ? Math.min(1, (absolute - segment.start) / (2 * (segment.coreStart - segment.start))) : 1;
      const fadeOut = segment.end > segment.coreEnd ? Math.min(1, (segment.end - absolute) / (2 * (segment.end - segment.coreEnd))) : 1;
      const weight = Math.min(fadeIn, fadeOut);
      result[absolute] += sample * weight;
      weights[absolute] += weight;
    }
  });
  for (let i = 0; i < total; i++) if (weights[i]) result[i] /= weights[i];
  return result;
}
