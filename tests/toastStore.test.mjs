import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissToast, getToasts, showToast } from '../src/toastStore.ts';

test('completion notifications queue when several jobs finish together', () => {
  const ids = Array.from({ length: 5 }, (_, index) => showToast(`Job ${index + 1} complete.`));
  assert.deepEqual(getToasts().slice(0, 4).map(toast => toast.message), [
    'Job 1 complete.', 'Job 2 complete.', 'Job 3 complete.', 'Job 4 complete.',
  ]);
  dismissToast(ids[0]);
  assert.deepEqual(getToasts().slice(0, 4).map(toast => toast.message), [
    'Job 2 complete.', 'Job 3 complete.', 'Job 4 complete.', 'Job 5 complete.',
  ]);
  ids.slice(1).forEach(dismissToast);
});
