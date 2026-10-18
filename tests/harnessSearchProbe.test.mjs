import test from 'node:test';
import assert from 'node:assert/strict';
import { addSearchBits, chunkSearchBits, chunkSearchIndexNeedsUpgrade, createSearchTermProbe, mayContainTerms } from '../src/harnessData.ts';

test('one decoded chunk index ranks multiple query terms without dropping a real match', () => {
  const bits = chunkSearchBits([{ content: 'A silver comet crosses the blue sky.' }]);
  const probe = createSearchTermProbe(['silver', 'comet', 'orchid']);
  assert.equal(probe(bits), 2);
  assert.equal(mayContainTerms(bits, 'silver comet'), true);
  assert.equal(mayContainTerms(bits, 'orchid'), false);
});

test('unknown or damaged indexes remain searchable until original text can verify them', () => {
  const probe = createSearchTermProbe(['silver', 'comet']);
  assert.equal(probe('unindexed'), 2);
  assert.equal(probe('v3:%%%'), 2);
  assert.equal(probe(''), 2);
});

test('new indexes filter two-character queries while older content-only indexes remain searchable', () => {
  const current = chunkSearchBits([{ content: 'AI agents build a parser.' }]);
  assert.match(current, /^v6:/);
  assert.equal(mayContainTerms(current, 'AI'), true);
  assert.equal(mayContainTerms(current, 'ZZ'), false);
  assert.equal(createSearchTermProbe(['AI', 'ZZ'])(current), 1);

  const oldEmpty = 'v3:' + btoa(String.fromCharCode(...new Uint8Array(256)));
  const old = addSearchBits(oldEmpty, 'AI agents build a parser.');
  assert.match(old, /^v3:/);
  assert.equal(mayContainTerms(old, 'AI'), true); // v3 cannot safely filter bigrams.
  assert.equal(mayContainTerms(old, 'parser'), true);
  assert.equal(mayContainTerms(old, 'orchid'), true); // Old indexes omit tool actions.
  assert.equal(createSearchTermProbe(['AI', 'orchid'])(old), 2);
});

test('long message chunks use a larger filter while old small filters remain safe to upgrade', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({ content: Array.from({ length: 100 }, (_, word) => `token${(index * 100 + word).toString(36)}`).join(' ') }));
  const bits = chunkSearchBits(messages);
  assert.equal(atob(bits.slice(3)).length, 2048);
  assert.equal(mayContainTerms(bits, 'cosmicstarship'), false);
  const oldFull = 'v4:' + btoa(String.fromCharCode(...new Uint8Array(256).fill(255)));
  assert.equal(mayContainTerms(oldFull, 'cosmicstarship'), true);
  assert.equal(chunkSearchIndexNeedsUpgrade(oldFull, messages), true);
  assert.equal(chunkSearchIndexNeedsUpgrade(bits, messages), false);
  assert.equal(chunkSearchIndexNeedsUpgrade('v4:%%%', messages), true);
  const olderToolIndex = 'v5:' + btoa(String.fromCharCode(...new Uint8Array(256)));
  assert.equal(createSearchTermProbe(['git_init'])(olderToolIndex), 1);
  assert.equal(chunkSearchIndexNeedsUpgrade(olderToolIndex, messages), true);
});

test('the current index includes saved file actions but excludes read-only tool output', () => {
  const bits = chunkSearchBits([{ content: 'Done.', toolEvents: [
    'write_file: Wrote repositories/demo/src/cache.ts (120 bytes).',
    'git_init: Initialized Git in Demo.',
    'read_file: Secret content from private notes.',
  ] }]);
  assert.equal(mayContainTerms(bits, 'cache.ts'), true);
  assert.equal(mayContainTerms(bits, 'Initialized Git'), true);
  assert.equal(mayContainTerms(bits, 'private notes'), false);
});
