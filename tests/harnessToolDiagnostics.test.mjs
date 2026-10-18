import test from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedToolDiagnostic } from '../src/harnessToolDiagnostics.ts';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';

test('unsupported tool diagnostics keep bounded arguments and redact credential fields', () => {
  const entry = unsupportedToolDiagnostic('run_shell', { command: 'ls -la /workspace', api_key: 'private-value', nested: { password: 'hidden' }, long: 'a'.repeat(5000) });
  assert.match(entry, /run_shell/);
  assert.match(entry, /ls -la \/workspace/);
  assert.match(entry, /\[redacted\]/);
  assert.ok(!entry.includes('private-value') && !entry.includes('hidden'));
  assert.ok(entry.length < 1800);
  assert.match(unsupportedToolDiagnostic('bad_call', '{broken json'), /broken json/);
});

test('an unsupported remote tool call is logged with its arguments and never executed', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let executions = 0;
  globalThis.fetch = async () => {
    requests++;
    const message = requests === 1
      ? { role: 'assistant', content: '', tool_calls: [{ id: 'one', function: { name: 'run_shell', arguments: '{"command":"rm -rf /workspace"}' } }] }
      : { role: 'assistant', content: 'I cannot run that command.' };
    return { ok: true, json: async () => ({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  };
  try {
    const config = { id: 'local', label: 'Local', provider: 'compatible', model: 'test', endpoint: 'http://localhost:1234/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 512, contextWindow: 4096 };
    const tools = { definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }], execute: async () => { executions++; return ''; } };
    const result = await remoteToolComplete(config, [{ role: 'user', content: 'Read my project' }], 'Help with code', undefined, tools);
    assert.equal(executions, 0);
    assert.match(result.toolEvents[0], /Unsupported tool request: run_shell/);
    assert.match(result.toolEvents[0], /rm -rf \/workspace/);
    assert.equal(result.text, 'I cannot run that command.');
  } finally { globalThis.fetch = originalFetch; }
});
