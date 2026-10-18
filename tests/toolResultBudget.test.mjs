import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolResultLimiter, toolResultBudget } from '../src/toolResultBudget.ts';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';

test('tool outputs share a context-sized budget and explain when a read is shortened', () => {
  const small = toolResultBudget(4096, 512, 'System', [{ content: 'Read source' }], []);
  const large = toolResultBudget(16384, 512, 'System', [{ content: 'Read source' }], []);
  assert.ok(small > 0 && small < 12000);
  assert.equal(large, 12000);
  const limit = createToolResultLimiter(small);
  const first = limit('x'.repeat(12000));
  assert.equal(first.length, small);
  assert.match(first, /Request a smaller range/);
  assert.match(limit('more'), /context is full/);
  assert.equal(limit('still more'), '');
});

test('an exhausted tiny context gets one notice, not one notice per tool call', () => {
  const limit = createToolResultLimiter(0);
  assert.match(limit('first result'), /context is full/);
  assert.equal(limit('second result'), '');
  assert.equal(limit('third result'), '');
});

test('remote coding tool loop limits large file reads before sending them back to a small model', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const message = requests.length === 1
      ? { role: 'assistant', content: '', tool_calls: [
        { id: 'one', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
        { id: 'two', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
      ] }
      : { role: 'assistant', content: 'I found the relevant code.' };
    return { ok: true, json: async () => ({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  };
  try {
    const config = { id: 'local', label: 'Local', provider: 'compatible', model: 'test', endpoint: 'http://localhost:1234/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 512, contextWindow: 4096 };
    const tools = { definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }], execute: async () => 'x'.repeat(12000) };
    const result = await remoteToolComplete(config, [{ role: 'user', content: 'Read both files' }], 'Help with code', undefined, tools);
    assert.equal(result.text, 'I found the relevant code.');
    const responses = requests[1].messages.filter(message => message.role === 'tool');
    assert.equal(responses.length, 2);
    assert.match(responses[0].content, /Request a smaller range/);
    assert.match(responses[1].content, /context is full/);
    assert.ok(responses[0].content.length < 12000);
  } finally { globalThis.fetch = originalFetch; }
});
