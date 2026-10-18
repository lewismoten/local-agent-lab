import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';
import { requestToolsTool } from '../src/harnessToolDiscovery.ts';

const statusTool = { type: 'function', function: { name: 'git_status', description: 'Read local Git status.', parameters: { type: 'object', properties: {} } } };

test('remote provider receives newly discovered tools on its next round', async () => {
  const originalFetch = globalThis.fetch;
  const offered = [];
  const responses = [
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'one', function: { name: 'request_tools', arguments: '{"category":"git"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'two', function: { name: 'git_status', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { role: 'assistant', content: 'Repository is clean.' }, finish_reason: 'stop' }] },
  ];
  globalThis.fetch = async (_url, options) => {
    offered.push(JSON.parse(options.body).tools.map(tool => tool.function.name));
    return { ok: true, json: async () => responses.shift() };
  };
  try {
    const tools = {
      definitions: [requestToolsTool],
      execute: async name => {
        if (name === 'request_tools') { tools.definitions = [statusTool]; return 'Enabled git_status'; }
        if (name === 'git_status') return 'clean';
        throw new Error('Unexpected tool');
      },
    };
    const result = await remoteToolComplete({ provider: 'compatible', endpoint: 'http://example.test/v1', apiKey: 'secret-api-key', model: 'test', maxOutputTokens: 256, contextWindow: 4096, effort: 'default' }, [{ role: 'user', content: 'Check Git status' }], 'Be concise.', undefined, tools);
    assert.deepEqual(offered, [['request_tools'], ['git_status'], ['git_status']]);
    assert.equal(result.text, 'Repository is clean.');
    assert.ok(result.toolEvents.some(event => event.startsWith('git_status: clean')));
    assert.equal(result.rounds.length, 3);
    assert.equal(result.rounds[0].response.toolCalls[0].name, 'request_tools');
    assert.equal(result.rounds[0].toolResults[0].content, 'Enabled git_status');
    assert.equal(result.rounds[1].request.messages.at(-1).content, 'Enabled git_status');
    assert.equal(result.rounds[2].request.messages.at(-1).content, 'clean');
    assert.ok(!JSON.stringify(result.rounds).includes('secret-api-key'));
  } finally { globalThis.fetch = originalFetch; }
});
