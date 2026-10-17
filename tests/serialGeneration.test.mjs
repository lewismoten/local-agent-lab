import test from 'node:test';
import assert from 'node:assert/strict';
import { runSerialGeneration, waitForSerialGeneration } from '../src/serialGeneration.ts';

test('browser generations wait for the previous run to finish', async () => {
  let releaseFirst;
  const firstFinished = new Promise(resolve => { releaseFirst = resolve; });
  const events = [];
  const first = runSerialGeneration(async () => { events.push('first start'); await firstFinished; events.push('first end'); });
  const second = runSerialGeneration(async () => { events.push('second start'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first start']);
  releaseFirst();
  await Promise.all([first, second, waitForSerialGeneration()]);
  assert.deepEqual(events, ['first start', 'first end', 'second start']);
});

test('failed or cancelled generations release the next queued run', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(runSerialGeneration(async () => { throw new Error('should not run'); }, cancelled.signal));
  await assert.rejects(runSerialGeneration(async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await runSerialGeneration(async () => 'ready'), 'ready');
});
