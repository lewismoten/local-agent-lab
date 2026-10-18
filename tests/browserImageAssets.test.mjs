import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BROWSER_IMAGE_MODEL_ASSETS, transferBrowserImageAsset } from '../src/browserImageAssets.ts';
import { modelDownloadManager } from '../src/modelDownloadSession.ts';

test('SD 1.5 saves the text encoder provenance and license notice before its weights', () => {
  const notice = BROWSER_IMAGE_MODEL_ASSETS.findIndex(asset => asset.name === 'Text_Encoder_LICENSE.txt');
  const weights = BROWSER_IMAGE_MODEL_ASSETS.findIndex(asset => asset.name === 'text-encoder.onnx');
  assert.ok(notice >= 0 && notice < weights);
  assert.match(BROWSER_IMAGE_MODEL_ASSETS[notice].url, /microsoft\/stable-diffusion-v1\.5-webnn/);
});

function memoryDirectory() {
  const files = new Map();
  return {
    files,
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name) && !create) throw new DOMException('Missing', 'NotFoundError');
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        getFile: async () => new File([files.get(name)], name),
        createWritable: async ({ keepExistingData = false } = {}) => {
          let data = keepExistingData ? files.get(name).slice() : new Uint8Array();
          let cursor = 0;
          return {
            seek: async position => { cursor = position; },
            write: async value => {
              const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
              const next = new Uint8Array(Math.max(data.length, cursor + bytes.length));
              next.set(data); next.set(bytes, cursor); data = next; cursor += bytes.length;
            },
            close: async () => { files.set(name, data); },
          };
        },
      };
    },
    async removeEntry(name) { files.delete(name); },
  };
}

for (const { name, label, url, size } of [
  { name: 'SCRIBBLER-LICENSE.txt', label: 'Scribbler license', url: 'https://raw.githubusercontent.com/example/LICENSE', size: 24 },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', label: 'ONNX WebAssembly', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm', size: 9 * 1024 * 1024 },
]) {
  test(`${label} downloads from byte zero without a range header`, async () => {
    const bytes = new Uint8Array(size); bytes.set([0, 97, 115, 109]);
    const dir = memoryDirectory();
    const originalFetch = globalThis.fetch;
    const speed = modelDownloadManager.getSnapshot().speedLimit;
    modelDownloadManager.setSpeedLimit(0);
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers, undefined);
      return new Response(bytes, { status: 200 });
    };
    try {
      await transferBrowserImageAsset(dir, 'engine', {
        name, label, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      }, new AbortController().signal, 0);
      assert.deepEqual(dir.files.get(name), bytes);
      assert.equal(dir.files.has(`${name}.download.json`), false);
    } finally {
      globalThis.fetch = originalFetch;
      modelDownloadManager.setSpeedLimit(speed);
    }
  });
}
