import test from 'node:test';
import assert from 'node:assert/strict';
import { streamOpenAIResponse } from '../src/openAIResponseStream.ts';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';
import { complete } from '../src/ai.ts';

const event = value => `data: ${JSON.stringify(value)}\n\n`;
const sse = chunks => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
}), { headers: { 'Content-Type': 'text/event-stream' } });
const profile = { provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey: 'test-secret', model: 'test', contextWindow: 4096, maxOutputTokens: 64, effort: 'default' };
const message = text => ({ type: 'message', content: [{ type: 'output_text', text }] });
const finished = output => ({ status: 'completed', output, usage: { input_tokens: 11, output_tokens: 7 } });

test('Responses SSE streams visible text and reasoning across network chunks', async () => {
  const originalFetch = globalThis.fetch;
  const progress = [];
  const delta = event({ type: 'response.output_text.delta', delta: 'Hello' });
  globalThis.fetch = async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return sse([
      event({ type: 'response.reasoning_summary_text.delta', delta: 'Short summary.' }),
      delta.slice(0, 12), delta.slice(12),
      event({ type: 'response.output_text.delta', delta: ' world' }),
      event({ type: 'response.completed', response: finished([message('Hello world')]) }),
    ]);
  };
  try {
    const result = await streamOpenAIResponse('https://api.openai.com/v1/responses', 'test-secret', { model: 'test', max_output_tokens: 64 }, undefined, update => progress.push(update));
    assert.equal(result.body.output[0].content[0].text, 'Hello world');
    assert.equal(result.reasoningText, 'Short summary.');
    assert.ok(progress.some(update => update.visibleText === 'Hello'));
    assert.equal(progress.at(-1).outputTokens, 7);
    assert.equal(progress.at(-1).reasoningText, 'Short summary.');
  } finally { globalThis.fetch = originalFetch; }
});

test('ordinary OpenAI chat uses the completed response and records streamed trace', async () => {
  const originalFetch = globalThis.fetch;
  const previews = [];
  globalThis.fetch = async () => sse([
    event({ type: 'response.output_text.delta', delta: 'Ready.' }),
    event({ type: 'response.completed', response: finished([message('Ready.')]) }),
  ]);
  try {
    const result = await complete(profile, [{ role: 'user', content: 'Say ready' }], 'Be brief.', undefined, undefined, update => previews.push(update.visibleText));
    assert.equal(result.text, 'Ready.');
    assert.equal(result.inputTokens, 11);
    assert.equal(result.rounds[0].request.stream, true);
    assert.ok(previews.includes('Ready.'));
  } finally { globalThis.fetch = originalFetch; }
});

test('OpenAI tool calls execute only after a completed response', async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  let executed = 0;
  globalThis.fetch = async (_, options) => {
    sent.push(JSON.parse(options.body));
    return sent.length === 1 ? sse([
      event({ type: 'response.function_call_arguments.delta', delta: '{"path":"a.ts"}' }),
      event({ type: 'response.completed', response: finished([{ type: 'function_call', call_id: 'one', name: 'read_file', arguments: '{"path":"a.ts"}' }]) }),
    ]) : sse([
      event({ type: 'response.output_text.delta', delta: 'The file is readable.' }),
      event({ type: 'response.completed', response: finished([message('The file is readable.')]) }),
    ]);
  };
  try {
    const result = await remoteToolComplete(profile, [{ role: 'user', content: 'Read a file' }], 'Help.', undefined, {
      definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }],
      execute: async () => { executed++; return 'content'; },
    }, () => {});
    assert.equal(executed, 1);
    assert.equal(result.text, 'The file is readable.');
    assert.equal(result.rounds.length, 2);
    assert.equal(sent[1].input.at(-1).output, 'content');
    assert.equal(result.rounds[0].request.stream, true);
    assert.equal(JSON.stringify(result.rounds).includes('test-secret'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('truncated OpenAI stream cannot execute a tool', async () => {
  const originalFetch = globalThis.fetch;
  let executed = 0;
  globalThis.fetch = async () => sse([
    event({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'one', name: 'write_file', arguments: '{"path":"a.ts"}' } }),
  ]);
  try {
    await assert.rejects(remoteToolComplete(profile, [{ role: 'user', content: 'Write a file' }], 'Help.', undefined, {
      definitions: [{ type: 'function', function: { name: 'write_file', description: 'Write a file.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
      execute: async () => { executed++; return 'written'; },
    }, () => {}), /closed its stream before completing/);
    assert.equal(executed, 0);
  } finally { globalThis.fetch = originalFetch; }
});
