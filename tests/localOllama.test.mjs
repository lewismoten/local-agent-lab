import test from 'node:test';
import assert from 'node:assert/strict';
import { noteLocalOllamaUse, unloadLocalOllama } from '../src/localOllama.ts';

test('only a model used through local Ollama is unloaded', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return { ok: true }; };
  try {
    noteLocalOllamaUse('https://remote.example', 'remote-model');
    await unloadLocalOllama();
    assert.equal(calls.length, 0);
    noteLocalOllamaUse('http://localhost:11434', 'story-model');
    await unloadLocalOllama();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'http://localhost:11434/api/generate');
    assert.deepEqual(JSON.parse(calls[0][1].body), { model: 'story-model', prompt: '', keep_alive: 0, stream: false });
    await unloadLocalOllama();
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
