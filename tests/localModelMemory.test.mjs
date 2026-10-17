import test from 'node:test';
import assert from 'node:assert/strict';
import { withLocalModelMemory } from '../src/localModelMemory.ts';

test('an image load waits for the active local model operation to finish', async () => {
  let finishText;
  const textFinished = new Promise(resolve => { finishText = resolve; });
  const events = [];
  const text = withLocalModelMemory(async () => { events.push('text start'); await textFinished; events.push('text end'); });
  const image = withLocalModelMemory(async () => { events.push('image start'); });
  await Promise.resolve();
  assert.deepEqual(events, ['text start']);
  finishText();
  await Promise.all([text, image]);
  assert.deepEqual(events, ['text start', 'text end', 'image start']);
});

test('a failed local model operation releases the next switch', async () => {
  await assert.rejects(withLocalModelMemory(async () => { throw new Error('load failed'); }), /load failed/);
  assert.equal(await withLocalModelMemory(async () => 'ready'), 'ready');
});
