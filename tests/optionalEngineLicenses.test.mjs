import test from 'node:test';
import assert from 'node:assert/strict';
import { KOKORO_ENGINE_ASSETS } from '../src/speechManifest.ts';
import { TRANSCRIPTION_ENGINE_ASSETS } from '../src/transcriptionManifest.ts';

function licenseBeforeRuntime(assets, licenseName, runtimeName) {
  const license = assets.findIndex(asset => asset.name === licenseName);
  const runtime = assets.findIndex(asset => asset.name === runtimeName);
  assert.ok(license >= 0, `${licenseName} must be saved with the engine`);
  assert.ok(runtime > license, `${licenseName} must download before ${runtimeName}`);
  assert.match(assets[license].sha256, /^[a-f0-9]{64}$/);
}

test('Kokoro downloads licenses for its bundled code before runtime files', () => {
  for (const name of ['LICENSE-Transformers-Apache-2.0.txt', 'LICENSE-Phonemizer-Apache-2.0.txt', 'LICENSE-ONNX-Runtime-MIT.txt']) {
    licenseBeforeRuntime(KOKORO_ENGINE_ASSETS, name, 'kokoro.web.js');
  }
});

test('transcription downloads ONNX Runtime MIT terms before the engine', () => {
  licenseBeforeRuntime(TRANSCRIPTION_ENGINE_ASSETS, 'LICENSE-ONNX-Runtime-MIT.txt', 'transformers.min.js');
});
