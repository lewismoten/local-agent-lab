import assert from 'node:assert/strict';
import test from 'node:test';
import { joinOpenVoiceSegments, planOpenVoiceSegments } from '../src/openVoiceSegments.ts';

const rate = 22050;

test('long audio splits near quiet points and each request stays below 30 seconds', () => {
  const audio = new Float32Array(65 * rate).fill(0.4);
  for (const second of [16, 32]) audio.fill(0, Math.round((second - 0.3) * rate), Math.round((second + 0.3) * rate));
  const segments = planOpenVoiceSegments(audio, 'pauses');
  assert.equal(segments.length, 4);
  assert.ok(segments.every(segment => (segment.end - segment.start) / rate < 30));
  assert.ok(segments.every((segment, index) => index === 0 || segment.start < segment.coreStart));
  assert.equal(segments[0].start, 0);
  assert.equal(segments.at(-1).end, audio.length);
  assert.ok(segments.some(segment => Math.abs(segment.coreEnd / rate - 16) < 0.35));
  assert.ok(segments.some(segment => Math.abs(segment.coreEnd / rate - 32) < 0.35));
});

test('converted overlapping parts join without doubling audio at the boundary', () => {
  const audio = new Float32Array(42 * rate).fill(0.2);
  const segments = planOpenVoiceSegments(audio, 'even');
  const parts = segments.map(segment => new Float32Array(segment.end - segment.start).fill(0.4));
  const joined = joinOpenVoiceSegments(segments, parts, audio.length);
  assert.equal(joined.length, audio.length);
  for (const position of [0, segments[0].coreEnd - 1, segments[0].coreEnd, segments[0].coreEnd + 1, audio.length - 1]) {
    assert.ok(Math.abs(joined[position] - 0.4) < 0.0001, `unexpected value at ${position}`);
  }
});

test('short audio remains a single unchanged part', () => {
  const audio = new Float32Array(rate);
  const segments = planOpenVoiceSegments(audio, 'pauses');
  assert.equal(segments.length, 1);
  assert.equal(joinOpenVoiceSegments(segments, [audio], audio.length), audio);
});
