import test from 'node:test';
import assert from 'node:assert/strict';
import { browserOutputSliderExponent, browserThinkingBudget, browserThinkingMode, browserThinkingOptions, supportsBrowserThinking } from '../src/browserThinking.ts';

const profile = { provider: 'browser', model: 'models/Qwen3-1.7B-Q4_K_M.gguf', maxOutputTokens: 1024, thinkingTokens: 0 };

test('browser thinking presets use a share of the current output limit', () => {
  assert.equal(browserThinkingBudget({ ...profile, browserThinkingMode: 'none' }), 0);
  assert.equal(browserThinkingBudget({ ...profile, browserThinkingMode: 'light' }), 256);
  assert.equal(browserThinkingBudget({ ...profile, browserThinkingMode: 'medium' }), 512);
  assert.equal(browserThinkingBudget({ ...profile, browserThinkingMode: 'heavy' }), 768);
  assert.equal(browserThinkingBudget({ ...profile, maxOutputTokens: 2048, browserThinkingMode: 'medium' }), 1024);
  assert.deepEqual(browserThinkingOptions({ ...profile, browserThinkingMode: 'none' }), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(browserThinkingOptions({ ...profile, browserThinkingMode: 'light' }), { chat_template_kwargs: { enable_thinking: true } });
});

test('browser output slider shows the nearest power without changing saved token limits', () => {
  assert.equal(browserOutputSliderExponent(4048), 12);
  assert.equal(browserOutputSliderExponent(4096), 12);
  assert.equal(browserOutputSliderExponent(16384), 14);
  assert.equal(browserThinkingBudget({ ...profile, maxOutputTokens: 4048, browserThinkingMode: 'light' }), 1012);
});

test('older absolute browser budgets migrate to the closest preset', () => {
  assert.equal(browserThinkingMode({ ...profile, thinkingTokens: 256 }), 'light');
  assert.equal(browserThinkingMode({ ...profile, thinkingTokens: 512 }), 'medium');
  assert.equal(browserThinkingMode({ ...profile, thinkingTokens: 768 }), 'heavy');
});

test('Qwen3.5 can select and send a thinking budget', () => {
  const qwen35 = { ...profile, model: 'models/Qwen3.5-2B-Q4_K_M.gguf', browserThinkingMode: 'heavy' };
  assert.equal(supportsBrowserThinking(qwen35), true);
  assert.equal(browserThinkingMode(qwen35), 'heavy');
  assert.equal(browserThinkingBudget(qwen35), 768);
  assert.deepEqual(browserThinkingOptions(qwen35), { chat_template_kwargs: { enable_thinking: true } });
  assert.deepEqual(browserThinkingOptions({ ...qwen35, browserThinkingMode: 'none' }), { chat_template_kwargs: { enable_thinking: false } });
});

test('undocumented models can opt into an experimental thinking probe', () => {
  const qwen25 = { ...profile, model: 'models/Qwen2.5-3B-Instruct-Q4_K_M.gguf' };
  assert.equal(supportsBrowserThinking(qwen25), true);
  assert.deepEqual(browserThinkingOptions({ ...qwen25, browserThinkingMode: 'none' }), {});
  assert.equal(browserThinkingBudget({ ...qwen25, browserThinkingMode: 'light' }), 256);
  assert.deepEqual(browserThinkingOptions({ ...qwen25, browserThinkingMode: 'light' }), { chat_template_kwargs: { enable_thinking: true } });
});
