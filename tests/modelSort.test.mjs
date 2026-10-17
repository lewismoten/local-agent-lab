import assert from 'node:assert/strict';
import test from 'node:test';
import { compareModelNames } from '../src/modelSort.ts';

test('sorts model labels without case differences affecting order', () => {
  const labels = ['qwen 10', 'Bonsai 2', 'granite 4', 'Qwen 2', 'Gemma 3', 'bonsai 1'];
  assert.deepEqual(labels.sort(compareModelNames), [
    'bonsai 1', 'Bonsai 2', 'Gemma 3', 'granite 4', 'Qwen 2', 'qwen 10',
  ]);
});
