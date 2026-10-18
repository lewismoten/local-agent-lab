import test from 'node:test';
import assert from 'node:assert/strict';
import { responseDiagnostic } from '../src/harnessResponseDiagnostics.ts';

test('response diagnostic records submitted prompt and returned thinking without API credentials', () => {
  const config = { provider: 'compatible', runtimePreset: 'bonsai2', thinkingTokens: 128, apiKey: 'private-key', endpoint: 'http://localhost', model: 'bonsai', maxOutputTokens: 512 };
  const stamp = { profileId: 'test', provider: 'compatible', model: 'bonsai', thinking: '128 tokens', contextWindow: 4096, maxOutputTokens: 512 };
  const report = responseDiagnostic(config, stamp, { system: 'Use tools carefully.', turns: [{ role: 'user', content: 'Hello' }] }, { text: 'Hi', thinkingText: 'Considered the greeting.', inputTokens: 12, outputTokens: 3, rounds: [{ request: { model: 'bonsai', temperature: 1, seed: 42, messages: [{ role: 'user', content: 'Hello' }] }, response: { text: 'Hi', thinking: 'Considered the greeting.' } }] }, 990, 3.2);
  assert.equal(report.output.thinking, 'Considered the greeting.');
  assert.equal(report.input.turns[0].content, 'Hello');
  assert.equal(report.sampling.temperature, 1);
  assert.equal(report.sampling.seed, 42);
  assert.equal(report.usage.observedTokensPerSecond, 3.2);
  assert.equal(report.rounds[0].response.thinking, 'Considered the greeting.');
  assert.ok(!JSON.stringify(report).includes('private-key'));
});

test('response diagnostic does not invent sampling values omitted by a runtime', () => {
  const config = { provider: 'compatible', runtimePreset: 'bonsai2', thinkingTokens: 128, apiKey: '', endpoint: 'http://localhost', model: 'bonsai', maxOutputTokens: 512 };
  const stamp = { profileId: 'test', provider: 'compatible', model: 'bonsai', thinking: '128 tokens', contextWindow: 4096, maxOutputTokens: 512 };
  const prompt = { system: 'Help.', turns: [{ role: 'user', content: 'Hello' }] };
  const report = responseDiagnostic(config, stamp, prompt, { text: 'Hi', rounds: [{ request: { model: 'bonsai' }, response: { text: 'Hi' } }] }, 100);
  assert.equal(report.sampling.seed, null);
  assert.equal(report.sampling.temperature, null);
  assert.match(report.sampling.note, /runtime default/i);
});

test('response diagnostic refers to per-round requests when sampling changes', () => {
  const config = { provider: 'browser', apiKey: '', endpoint: '', model: 'local.gguf', maxOutputTokens: 512 };
  const stamp = { profileId: 'test', provider: 'browser', model: 'local.gguf', thinking: 'none', contextWindow: 4096, maxOutputTokens: 512 };
  const prompt = { system: 'Help.', turns: [{ role: 'user', content: 'Hello' }] };
  const report = responseDiagnostic(config, stamp, prompt, { text: 'Hi', rounds: [
    { request: { temperature: 0.2 }, response: { text: '' } },
    { request: { temperature: 0.7 }, response: { text: 'Hi' } },
  ] }, 100);
  assert.equal(report.sampling.temperature, null);
  assert.match(report.sampling.note, /varied between model rounds/i);
});
