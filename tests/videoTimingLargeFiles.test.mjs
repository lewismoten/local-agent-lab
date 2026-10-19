import test from 'node:test';
import assert from 'node:assert/strict';
import { measureWebmTiming } from '../src/webmTiming.ts';
import { measureMp4Timing } from '../src/mp4Timing.ts';

const largePayload = new Uint8Array(50_100_000);
const bytes = (...values) => new Uint8Array(values);
function sizeVint(value) {
  if (value < 127) return bytes(0x80 | value);
  assert.ok(value < 2 ** 28 - 1);
  return bytes(0x10 | (value >>> 24), value >>> 16 & 255, value >>> 8 & 255, value & 255);
}
function element(id, body) {
  const content = body instanceof Blob ? body : new Blob([body]);
  return new Blob([bytes(...id), sizeVint(content.size), content]);
}
function box(type, body) {
  const content = body instanceof Blob ? body : new Blob([body]);
  const header = new ArrayBuffer(8);
  const view = new DataView(header);
  view.setUint32(0, content.size + 8, false);
  for (let index = 0; index < 4; index++) view.setUint8(4 + index, type.charCodeAt(index));
  return new Blob([header, content]);
}
function noWholeRead(blob) {
  blob.arrayBuffer = () => { throw new Error('Timing reader loaded the whole video.'); };
  return blob;
}

test('WebM timing skips a large non-timing element without reading the video body', async () => {
  const block = time => element([0xa3], bytes(0x81, 0, time, 0x80, 0));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], new Blob([
    element([0xe7], bytes(0)), block(0), block(40),
  ]));
  const video = noWholeRead(element([0x18, 0x53, 0x80, 0x67], new Blob([
    element([0xec], new Blob([largePayload])), cluster,
  ])));
  assert.ok(video.size > 50_000_000);
  const timing = await measureWebmTiming(video);
  assert.equal(timing.encodedFrames, 2);
  assert.equal(timing.durationSeconds, 0.04);
  assert.deepEqual(timing.frameTimestampsMs, [0, 40]);
});

test('MP4 timing skips large mdat and reads a movie header after it', async () => {
  const tkhd = new ArrayBuffer(16); new DataView(tkhd).setUint32(12, 1, false);
  const mdhd = new ArrayBuffer(20); const media = new DataView(mdhd);
  media.setUint32(12, 1000, false); media.setUint32(16, 3000, false);
  const hdlr = new Uint8Array(12); hdlr.set(bytes(118, 105, 100, 101), 8);
  const stts = new ArrayBuffer(16); const table = new DataView(stts);
  table.setUint32(4, 1, false); table.setUint32(8, 3, false); table.setUint32(12, 1000, false);
  const moov = box('moov', box('trak', new Blob([
    box('tkhd', tkhd), box('mdia', new Blob([
      box('hdlr', hdlr), box('mdhd', mdhd), box('minf', box('stbl', box('stts', stts))),
    ])),
  ])));
  const video = noWholeRead(new Blob([box('mdat', new Blob([largePayload])), moov], { type: 'video/mp4' }));
  assert.ok(video.size > 50_000_000);
  const timing = await measureMp4Timing(video);
  assert.equal(timing.encodedFrames, 3);
  assert.equal(timing.durationSeconds, 3);
  assert.deepEqual(timing.frameTimestampsMs, [0, 1000, 2000]);
});

test('fragmented MP4 timing reads moof samples around large mdat payloads', async () => {
  const tkhd = new ArrayBuffer(16); new DataView(tkhd).setUint32(12, 1, false);
  const mdhd = new ArrayBuffer(20); new DataView(mdhd).setUint32(12, 1000, false);
  const hdlr = new Uint8Array(12); hdlr.set(bytes(118, 105, 100, 101), 8);
  const moov = box('moov', box('trak', new Blob([
    box('tkhd', tkhd), box('mdia', new Blob([box('hdlr', hdlr), box('mdhd', mdhd)])),
  ])));
  const tfhd = new ArrayBuffer(12); const trackHeader = new DataView(tfhd);
  trackHeader.setUint32(0, 0x000008, false); trackHeader.setUint32(4, 1, false); trackHeader.setUint32(8, 1000, false);
  const tfdt = new ArrayBuffer(8);
  const trun = new ArrayBuffer(16); const run = new DataView(trun);
  run.setUint32(0, 0x000100, false); run.setUint32(4, 2, false);
  run.setUint32(8, 1000, false); run.setUint32(12, 1000, false);
  const moof = box('moof', box('traf', new Blob([
    box('tfhd', tfhd), box('tfdt', tfdt), box('trun', trun),
  ])));
  const video = noWholeRead(new Blob([moov, box('mdat', new Blob([largePayload])), moof], { type: 'video/mp4' }));
  const timing = await measureMp4Timing(video);
  assert.equal(timing.encodedFrames, 2);
  assert.equal(timing.durationSeconds, 2);
  assert.deepEqual(timing.frameTimestampsMs, [0, 1000]);
});
