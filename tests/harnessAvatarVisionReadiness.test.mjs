import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarVisionSetupMessage } from '../src/harnessAvatarVisionReadiness.ts';

test('vision tagging distinguishes a saved test from a loaded projector', () => {
  const status = state => ({ state, path: state === 'empty' ? '' : 'models/vision.gguf', message: '' });
  assert.match(avatarVisionSetupMessage(status('empty'), false), /past vision test.*does not keep the model loaded/i);
  assert.match(avatarVisionSetupMessage(status('loading'), false), /still loading/i);
  assert.match(avatarVisionSetupMessage(status('ready'), false), /without a working vision projector/i);
  assert.match(avatarVisionSetupMessage(status('error'), false), /failed to load/i);
  assert.equal(avatarVisionSetupMessage(status('ready'), true), '');
});
