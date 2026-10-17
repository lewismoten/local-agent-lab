import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from '../src/router.ts';
test('page and dialog are restored from URL hash', () => {
  assert.deepEqual(parseRoute('#/sources?dialog=ai'), { view: 'sources', dialog: 'ai', intent: null });
  assert.deepEqual(parseRoute('#/books?dialog=help'), { view: 'books', dialog: 'help', intent: null });
  assert.deepEqual(parseRoute('#/characters?dialog=ai&intent=image'), { view: 'characters', dialog: 'ai', intent: 'image' });
  assert.deepEqual(parseRoute('#/settings'), { view: 'settings', dialog: null, intent: null });
  assert.deepEqual(parseRoute('#/story-profile'), { view: 'story-profile', dialog: null, intent: null });
  assert.deepEqual(parseRoute('#/ai-profiles?dialog=ai'), { view: 'ai-profiles', dialog: 'ai', intent: null });
  assert.deepEqual(parseRoute('#/project-files'), { view: 'project-files', dialog: null, intent: null });
  assert.deepEqual(parseRoute('#/unknown?dialog=other'), { view: 'chat', dialog: null, intent: null });
});
