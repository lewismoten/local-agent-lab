import test from 'node:test';
import assert from 'node:assert/strict';
import { streamOllamaChat } from '../src/ollamaChatStream.ts';
import { remoteToolComplete } from '../src/remoteToolCompletion.ts';

const stream = chunks => new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  },
});
const reply = chunks => new Response(stream(chunks), { headers: { 'Content-Type': 'application/x-ndjson' } });
const line = value => JSON.stringify(value) + '\n';

test('Ollama stream joins split NDJSON and reports only visible text', async () => {
  const oldFetch = globalThis.fetch;
  const progress = [];
  globalThis.fetch = async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return reply([
      line({ message: { thinking: 'I am thinking' }, done: false }),
      '{"message":{"content":"Hel',
      'lo"},"done":false}\n',
      line({ message: { content: ' world' }, done: false }),
      line({ message: {}, done: true, prompt_eval_count: 18, eval_count: 3 }),
    ]);
  };
  try {
    const result = await streamOllamaChat('http://localhost:11434', { model: 'test', options: { num_predict: 32 } }, undefined, value => progress.push(value));
    assert.equal(result.message.content, 'Hello world');
    assert.equal(result.message.thinking, 'I am thinking');
    assert.equal(result.eval_count, 3);
    assert.deepEqual(progress.map(item => item.visibleText), ['', 'Hello', 'Hello world', 'Hello world']);
    assert.equal(progress[0].reasoningText, 'I am thinking');
    assert.equal(progress.at(-1).outputTokens, 3);
  } finally { globalThis.fetch = oldFetch; }
});

test('Ollama tool stream retains calls and streams the answer after the tool', async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  const progress = [];
  let executed = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'test:latest' }] });
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) return reply([
      line({ message: { tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/main.tsx' } } }] }, done: false }),
      line({ message: {}, done: true, eval_count: 8 }),
    ]);
    return reply([
      line({ message: { content: 'The file ' }, done: false }),
      line({ message: { content: 'is readable.' }, done: false }),
      line({ message: {}, done: true, eval_count: 5 }),
    ]);
  };
  try {
    const result = await remoteToolComplete({ provider: 'ollama', endpoint: 'http://localhost:11434', model: 'test', contextWindow: 4096, maxOutputTokens: 64, thinkingTokens: 0 }, [{ role: 'user', content: 'Read a file' }], 'You are helpful.', undefined, {
      definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }],
      execute: async () => { executed++; return 'content'; },
    }, value => progress.push(value.visibleText));
    assert.equal(executed, 1);
    assert.equal(result.text, 'The file is readable.');
    assert.deepEqual(progress, ['', 'The file ', 'The file is readable.', 'The file is readable.']);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.at(-1).content, 'content');
    assert.equal(requests[0].stream, true);
  } finally { globalThis.fetch = oldFetch; }
});

test('Ollama never executes a tool call from a response stopped at its output limit', async () => {
  const oldFetch = globalThis.fetch;
  let executed = 0;
  globalThis.fetch = async url => String(url).endsWith('/api/tags')
    ? Response.json({ models: [{ name: 'test:latest' }] })
    : reply([
      line({ message: { tool_calls: [{ function: { name: 'write_file', arguments: { path: 'src/main.tsx', content: 'partial' } } }] }, done: false }),
      line({ message: {}, done: true, done_reason: 'length', eval_count: 64 }),
    ]);
  try {
    await assert.rejects(remoteToolComplete({ provider: 'ollama', endpoint: 'http://localhost:11434', model: 'test', contextWindow: 4096, maxOutputTokens: 64, thinkingTokens: 0 }, [{ role: 'user', content: 'Write a file' }], 'You are helpful.', undefined, {
      definitions: [{ type: 'function', function: { name: 'write_file', description: 'Write a file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }],
      execute: async () => { executed++; return 'written'; },
    }), /stopped before finishing its tool calls/);
    assert.equal(executed, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('Ollama stream rejects a truncated response', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => reply([line({ message: { content: 'partial' }, done: false })]);
  try {
    await assert.rejects(streamOllamaChat('http://localhost:11434', { model: 'test' }), /before finishing/);
  } finally { globalThis.fetch = oldFetch; }
});

test('Ollama stream stops after cancellation and keeps the visible prefix available', async () => {
  const oldFetch = globalThis.fetch;
  const controller = new AbortController();
  const visible = [];
  globalThis.fetch = async () => reply([
    line({ message: { content: 'first part' }, done: false }),
    line({ message: { content: 'second part' }, done: false }),
    line({ message: {}, done: true }),
  ]);
  try {
    await assert.rejects(streamOllamaChat('http://localhost:11434', { model: 'test' }, controller.signal, value => {
      visible.push(value.visibleText);
      controller.abort();
    }), error => error.name === 'AbortError');
    assert.deepEqual(visible, ['first part']);
  } finally { globalThis.fetch = oldFetch; }
});
