import test from 'node:test';
import assert from 'node:assert/strict';
import { streamCompatibleChat } from '../src/compatibleChatStream.ts';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';
import { complete } from '../src/ai.ts';

const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
const sse = chunks => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
}), { headers: { 'Content-Type': 'text/event-stream' } });

test('compatible chat stream reconstructs text, thinking, tool arguments, and usage across chunks', async () => {
  const originalFetch = globalThis.fetch;
  const progress = [];
  globalThis.fetch = async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return sse([
      event({ choices: [{ delta: { reasoning_content: 'Check ' } }] }),
      event({ choices: [{ delta: { reasoning_content: 'file.', content: 'Found ' } }] }).slice(0, 17),
      event({ choices: [{ delta: { reasoning_content: 'file.', content: 'Found ' } }] }).slice(17),
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } }] } }] }),
      event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: 'tool_calls' }] }),
      event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
      event('[DONE]'),
    ]);
  };
  try {
    const result = await streamCompatibleChat('http://localhost/v1/chat/completions', {}, { model: 'test', max_tokens: 64 }, undefined, update => progress.push(update));
    assert.equal(result.streamed, true);
    assert.equal(result.body.choices[0].message.content, 'Found ');
    assert.equal(result.body.choices[0].message.reasoning_content, 'Check file.');
    assert.equal(result.body.choices[0].message.tool_calls[0].function.arguments, '{"path":"a.ts"}');
    assert.equal(result.body.usage.completion_tokens, 7);
    assert.equal(progress.at(-1).visibleText, 'Found ');
    assert.equal(progress.at(-1).reasoningText, 'Check file.');
  } finally { globalThis.fetch = originalFetch; }
});

test('compatible chat executes a streamed tool only after a complete response', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [], previews = [];
  let executed = 0;
  globalThis.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? sse([
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] } }] }),
      event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), event('[DONE]'),
    ]) : sse([event({ choices: [{ delta: { content: 'The file is readable.' }, finish_reason: 'stop' }] }), event('[DONE]')]);
  };
  try {
    const result = await remoteToolComplete({ provider: 'compatible', endpoint: 'http://localhost/v1', model: 'test', contextWindow: 4096, maxOutputTokens: 64, effort: 'default' }, [{ role: 'user', content: 'Read a file' }], 'Help.', undefined, {
      definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }],
      execute: async () => { executed++; return 'content'; },
    }, update => previews.push(update.visibleText));
    assert.equal(executed, 1);
    assert.equal(result.text, 'The file is readable.');
    assert.equal(result.rounds.length, 2);
    assert.equal(result.rounds[1].request.messages.at(-1).content, 'content');
    assert.equal(requests[0].stream, true);
    assert.ok(previews.includes('The file is readable.'));
  } finally { globalThis.fetch = originalFetch; }
});

test('an interrupted compatible stream cannot trigger a tool', async () => {
  const originalFetch = globalThis.fetch;
  let executed = 0;
  globalThis.fetch = async () => sse([event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'write_file', arguments: '{"path":"a.ts"}' } }] } }] })]);
  try {
    await assert.rejects(remoteToolComplete({ provider: 'compatible', endpoint: 'http://localhost/v1', model: 'test', contextWindow: 4096, maxOutputTokens: 64, effort: 'default' }, [{ role: 'user', content: 'Write a file' }], 'Help.', undefined, {
      definitions: [{ type: 'function', function: { name: 'write_file', description: 'Write a file.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
      execute: async () => { executed++; return 'written'; },
    }, () => {}), /closed its stream before completion/);
    assert.equal(executed, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a server that rejects streaming falls back to a single JSON request', async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_, options) => {
    sent.push(JSON.parse(options.body));
    return sent.length === 1 ? new Response('stream unsupported', { status: 400 }) : Response.json({ choices: [{ message: { role: 'assistant', content: 'Ready' } }] });
  };
  try {
    const result = await streamCompatibleChat('http://localhost/v1/chat/completions', {}, { model: 'test', max_tokens: 64 });
    assert.equal(result.streamed, false);
    assert.equal(result.body.choices[0].message.content, 'Ready');
    assert.equal(sent[0].stream, true);
    assert.equal(sent[1].stream, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('ordinary compatible chat shows visible text before the final answer', async () => {
  const originalFetch = globalThis.fetch;
  const previews = [];
  globalThis.fetch = async () => sse([
    event({ choices: [{ delta: { content: 'Hello' } }] }),
    event({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }),
    event('[DONE]'),
  ]);
  try {
    const result = await complete({ provider: 'compatible', endpoint: 'http://localhost/v1', model: 'test', maxOutputTokens: 64, effort: 'default' }, [{ role: 'user', content: 'Say hello' }], 'Be concise.', undefined, undefined, update => previews.push(update.visibleText));
    assert.equal(result.text, 'Hello world');
    assert.deepEqual(previews, ['Hello', 'Hello world']);
    assert.equal(result.rounds[0].request.stream, true);
  } finally { globalThis.fetch = originalFetch; }
});
