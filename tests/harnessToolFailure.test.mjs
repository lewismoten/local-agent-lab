import test from 'node:test';
import assert from 'node:assert/strict';
import { toolFailureMessage } from '../src/harnessToolFailure.ts';
import { isMutatingToolName } from '../src/harnessToolActions.ts';

test('repository initialization prevents automatic model fallback after a partial tool run', () => {
  assert.equal(isMutatingToolName('git_init'), true);
  assert.equal(isMutatingToolName('git_status'), false);
});

test('failed model continuations identify completed file edits and their backups', () => {
  const message = toolFailureMessage(new Error('model stopped'), [
    'write_file: Wrote repositories/demo/src/app.ts (3 bytes). Previous version: harness/history/2026-01-01.bak.',
  ]);
  assert.match(message, /model stopped/);
  assert.match(message, /Completed changes: write_file: Wrote repositories\/demo\/src\/app\.ts/);
  assert.match(message, /Previous version: harness\/history\//);
});

test('a failed attempted write does not invent a completed change', () => {
  assert.doesNotMatch(toolFailureMessage('permission denied', []), /Completed changes/);
});
