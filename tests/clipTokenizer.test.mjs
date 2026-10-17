import assert from 'node:assert/strict';
import test from 'node:test';
import { clipTokenizer } from '../src/clipTokenizer.ts';

test('browser CLIP tokenizer merges whole whitespace tokens and pads to 77 positions', async () => {
  const tokenize = clipTokenizer({ model: {
    vocab: { a: 1, 'b</w>': 2, 'ab</w>': 3, 'a</w>': 4, '<|endoftext|>': 99 },
    merges: ['a b</w>'],
  } });
  const ids = Array.from((await tokenize('AB a')).input_ids.data);
  assert.equal(ids.length, 77);
  assert.deepEqual(ids.slice(0, 4), [3, 4, 99, 99]);
  assert.ok(ids.slice(2).every(id => id === 99));
});

test('browser CLIP tokenizer rejects missing model data', () => {
  assert.throws(() => clipTokenizer({}), /invalid/);
});
