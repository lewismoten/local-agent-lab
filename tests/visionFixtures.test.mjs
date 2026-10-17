import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMicroText, analyzeReferencePhoto, createMicroTextRows, drawEan13, ean13Bits } from '../src/visionFixtures.ts';

test('synthetic EAN-13 fixture has valid guards and check digit', () => {
  const bars = ean13Bits('5901234123457');
  assert.equal(bars.length, 95);
  assert.equal(bars.slice(0, 3), '101');
  assert.equal(bars.slice(45, 50), '01010');
  assert.equal(bars.slice(-3), '101');
  assert.throws(() => ean13Bits('5901234123458'), /checksum/);
});

test('barcode image draws only bars, without readable digits', () => {
  let bars = 0;
  const context = { fillRect: () => { bars++; }, fillText: () => { throw new Error('Barcode digits must not be printed.'); } };
  drawEan13(context, '5901234123457', 105, 65);
  assert.ok(bars > 40);
});

test('microtext rows use unique words and report the smallest correctly read size', () => {
  const rows = createMicroTextRows(() => 0);
  assert.deepEqual(rows.map(row => row.sizePx), [28, 22, 18, 14, 10, 7]);
  assert.equal(new Set(rows.flatMap(row => row.words)).size, 12);
  const result = analyzeMicroText(`${rows[0].words[0]} ${rows[4].words[1]}`, rows);
  assert.equal(result.passed, true);
  assert.match(result.detail, /Smallest text read: 10px/);
  assert.deepEqual(result.sizeResults.map(row => row.matched.length), [1, 0, 0, 0, 1, 0]);
});

test('real-photo analysis distinguishes broad recognition from finer details', () => {
  const broad = analyzeReferencePhoto('A man and dog are outside; the man wears sunglasses.');
  assert.equal(broad.passed, true);
  assert.match(broad.detail, /not whether every claim is visible/);
  assert.equal(broad.keywordResults.find(item => item.label === 'face or facial detail').matched, true);
  assert.equal(broad.keywordResults.find(item => item.label === 'red overhead covering').matched, false);
  const detailed = analyzeReferencePhoto('A bearded man in sunglasses and a graphic t-shirt is beside a corgi. Trees and blue sky are behind a red roof, a cupcake decoration, a checkered wall, an open door, and a white table.');
  for (const label of ['face or facial detail', 'outdoors', 'ice cream or dessert', 'red overhead covering', 'door or opening', 'table or counter', 'checkerboard pattern']) {
    assert.equal(detailed.keywordResults.find(item => item.label === label).matched, true, label);
  }
  assert.equal(analyzeReferencePhoto('The sky is blue with some clouds.').keywordResults.find(item => item.label === 'blue sky or sunshine').matched, true);
  assert.equal(detailed.keywordResults.some(item => item.label === 'open dog mouth' || item.label === 'green animal-like graphic'), false);
});
