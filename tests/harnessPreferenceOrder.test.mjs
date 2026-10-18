import test from 'node:test';
import assert from 'node:assert/strict';
import { moveVisiblePreference, orderedPreferenceIds, visiblePreferenceIds } from '../src/harnessData.ts';
import { canRunProfile, profileConfirmationKey } from '../src/harnessProfileEligibility.ts';

test('changing generation limits keeps a tested model confirmed but changing its endpoint does not', () => {
  const selected = { id: 'browser', provider: 'browser', model: 'models/chat.gguf', endpoint: '', runtimePreset: '', apiKey: '', contextWindow: 4096, maxOutputTokens: 1024, browserThinkingMode: 'none' };
  const key = profileConfirmationKey(selected);
  assert.equal(profileConfirmationKey({ ...selected, contextWindow: 8192, maxOutputTokens: 4096, browserThinkingMode: 'heavy' }), key);
  assert.notEqual(profileConfirmationKey({ ...selected, model: 'models/other.gguf' }), key);
  const remote = { ...selected, provider: 'openai', endpoint: 'http://localhost:8000/v1', apiKey: 'one' };
  assert.notEqual(profileConfirmationKey({ ...remote, endpoint: 'http://localhost:9000/v1' }), profileConfirmationKey(remote));
  assert.notEqual(profileConfirmationKey({ ...remote, apiKey: 'two' }), profileConfirmationKey(remote));
});

test('saved image priority comes before the current service and does not duplicate it', () => {
  assert.deepEqual(orderedPreferenceIds(['tiny-sd', 'browser-sd15'], 'browser-sd15'), ['tiny-sd', 'browser-sd15']);
  assert.deepEqual(orderedPreferenceIds(['tiny-sd'], 'browser-sd15'), ['tiny-sd', 'browser-sd15']);
  assert.deepEqual(orderedPreferenceIds([], 'browser-sd15'), ['browser-sd15']);
  assert.deepEqual(orderedPreferenceIds(['none', 'tiny-sd', 'tiny-sd'], 'none'), ['tiny-sd']);
});

test('a previously confirmed browser model can reload as a fallback only with its workspace', () => {
  const browser = { provider: 'browser' };
  const remote = { provider: 'ollama' };
  assert.equal(canRunProfile(browser, false, true, true), true);
  assert.equal(canRunProfile(browser, false, true, false), false);
  assert.equal(canRunProfile(browser, false, false, true), false);
  assert.equal(canRunProfile(remote, false, true, true), false);
  assert.equal(canRunProfile(remote, true, true, false), true);
});

test('the active project model appears once and moving fallbacks preserves it for other projects', () => {
  const saved = ['ollama', 'browser', 'compatible'];
  assert.deepEqual(visiblePreferenceIds(saved, 'browser'), ['ollama', 'compatible']);
  const moved = moveVisiblePreference(saved, 'browser', 1, -1);
  assert.deepEqual(moved, ['compatible', 'ollama', 'browser']);
  assert.deepEqual(orderedPreferenceIds(moved, 'browser'), ['compatible', 'ollama', 'browser']);
  assert.deepEqual(visiblePreferenceIds(moved, 'ollama'), ['compatible', 'browser']);
  assert.equal(moveVisiblePreference(saved, 'browser', 0, -1), saved);
});
