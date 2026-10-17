import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_ENGINE_CONTEXT_LIMIT, MIN_BROWSER_CONTEXT, browserContextLimit, browserContextWindow } from '../src/browserContext.ts';
import { MODEL_CATALOG } from '../src/catalogModels.ts';

test('browser context uses the lesser of the engine and catalog model limits', () => {
  const short = MODEL_CATALOG.find(model => model.contextTokens === 4096);
  const long = MODEL_CATALOG.find(model => model.contextTokens > BROWSER_ENGINE_CONTEXT_LIMIT);
  assert.ok(short && long);
  assert.equal(browserContextLimit(`models/${short.name}`), 4096);
  assert.equal(browserContextLimit(`models/${long.name}`), BROWSER_ENGINE_CONTEXT_LIMIT);
  assert.equal(browserContextLimit('models/custom.gguf'), BROWSER_ENGINE_CONTEXT_LIMIT);
  assert.equal(browserContextWindow(`models/${short.name}`, 16384), 4096);
  assert.equal(browserContextWindow(`models/${long.name}`, 8192), 8192);
  assert.equal(browserContextWindow(`models/${long.name}`, 10), MIN_BROWSER_CONTEXT);
});
