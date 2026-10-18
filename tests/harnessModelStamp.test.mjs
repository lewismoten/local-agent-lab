import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStamp, modelStampDetails, modelStampLabel } from '../src/harnessModelStamp.ts';

test('saved browser replies retain known version, packing, engine, and settings', () => {
  const stamp = modelStamp({ id: 'browser', label: 'My private model', provider: 'browser', model: 'models/Qwen3.5-2B-Q4_K_M.gguf', endpoint: '', apiKey: 'secret-key', effort: 'default', thinkingTokens: 0, browserThinkingMode: 'medium', maxOutputTokens: 2048, contextWindow: 4096 });
  assert.equal(stamp.version, '3.5');
  assert.equal(stamp.parametersB, 2);
  assert.equal(stamp.quantization, 'Q4_K_M');
  assert.equal(stamp.engine, 'Wllama Wasm');
  assert.equal(stamp.thinking, 'medium');
  assert.match(modelStampLabel(stamp), /Qwen3\.5 2B/);
  assert.match(modelStampDetails(stamp), /Model ID\/file: models\/Qwen3\.5-2B-Q4_K_M\.gguf/);
  assert.equal(JSON.stringify(stamp).includes('secret-key'), false);
});

test('older replies and private server profiles remain readable without catalog claims', () => {
  const old = { profileId: 'browser', provider: 'browser', model: 'models/custom.gguf', thinking: 'none', contextWindow: 4096, maxOutputTokens: 512 };
  assert.equal(modelStampLabel(old), 'custom.gguf');
  assert.match(modelStampDetails(old), /Provider: browser/);
  const remote = modelStamp({ id: 'local', label: 'Home server', provider: 'compatible', model: 'my-model:latest', endpoint: 'http://localhost:1234/v1', apiKey: 'secret-key', effort: 'high', thinkingTokens: 0, maxOutputTokens: 2048, contextWindow: 8192 });
  assert.equal(remote.engine, 'OpenAI-compatible server');
  assert.equal(remote.version, undefined);
  assert.equal(JSON.stringify(remote).includes('secret-key'), false);
});
