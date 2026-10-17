import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CATALOG } from '../src/catalogModels.ts';
import { BONSAI_2_Q2_BROWSER_WARNING, GRANITE_40_WARNING, isBonsai2BrowserUnsupported, isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from '../src/modelCompatibility.ts';

test('Granite 4.1 replaces the incompatible Granite 4.0 catalog option', () => {
  assert.equal(MODEL_CATALOG.some(model => model.version === '4.0' && model.family === 'Granite'), false);
  const granite = MODEL_CATALOG.find(model => model.id === 'granite41-3b');
  assert.equal(granite.name, 'granite-4.1-3b-Q3_K_M.gguf');
  assert.equal(granite.bytes, 1725577824);
  assert.ok(granite.bytes < 2_000_000_000);
});

test('Bonsai 2 files are routed to the PrismML browser runtime', () => {
  assert.equal(isBonsai2BrowserUnsupported('models/Ternary-Bonsai-2-2B-Q2_0.gguf'), true);
  assert.equal(isBonsai2BrowserUnsupported('https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/resolve/main/Ternary-Bonsai-2-2B-PQ2_0.gguf'), true);
  assert.equal(isBonsai2BrowserUnsupported('models/Bonsai-8B-Q1_0.gguf'), false);
  assert.equal(isBonsai2Q2BrowserUnsupported('models/Ternary-Bonsai-2-2B-Q2_0.gguf'), true);
  assert.equal(isBonsai2Q2BrowserUnsupported('models/Ternary-Bonsai-2-2B-PTQ1_0.gguf'), false);
  assert.equal(BONSAI_2_Q2_BROWSER_WARNING, 'This GGUF is not supported by the browser engine.');
});

test('manual Granite 4.0 GGUF URLs and local paths trigger a compatibility warning', () => {
  assert.equal(GRANITE_40_WARNING, 'granite-4.0-1b-Q4_K_M.gguf was tested and failed during inference. It is not supported.');
  assert.equal(isKnownIncompatibleGranite('https://huggingface.co/ibm-granite/granite-4.0-1b-GGUF/resolve/main/granite-4.0-1b-Q4_K_M.gguf?download=true'), true);
  assert.equal(isKnownIncompatibleGranite('models/granite-4.0-1b-Q4_K_M.gguf'), true);
  assert.equal(isKnownIncompatibleGranite('models/granite-4.1-3b-Q3_K_M.gguf'), false);
  assert.equal(isKnownIncompatibleGranite('models/granite-4.0-350m-Q4_K_M.gguf'), false);
});
