import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PRISM_ASSETS, getPrismEngineDownload, prismEngineManager, transferAsset } from '../src/prismEngine.ts';
import { WLLAMA_ASSETS } from '../src/wllamaEngine.ts';
import { modelDownloadManager } from '../src/modelDownloadSession.ts';

class MemoryDirectory {
  files = new Map();
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name) && !create) throw new DOMException('Missing', 'NotFoundError');
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    return {
      getFile: async () => new File([this.files.get(name)], name),
      createWritable: async ({ keepExistingData = false } = {}) => {
        let data = keepExistingData ? this.files.get(name).slice() : new Uint8Array();
        let cursor = 0;
        return {
          seek: async position => { cursor = position; },
          write: async value => {
            const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value);
            const next = new Uint8Array(Math.max(data.length, cursor + bytes.length));
            next.set(data); next.set(bytes, cursor); data = next; cursor += bytes.length;
          },
          close: async () => { this.files.set(name, data); },
        };
      },
    };
  }
  async removeEntry(name) { if (!this.files.delete(name)) throw new DOMException('Missing', 'NotFoundError'); }
}

test('engine manifest downloads licenses before source and contains only upstream URLs', () => {
  assert.equal(PRISM_ASSETS[0].name, 'prism-bonsai-LICENSE.txt');
  assert.equal(PRISM_ASSETS[1].name, 'prism-bonsai-NOTICE.txt');
  assert.equal(PRISM_ASSETS.at(-1).name, 'prism-bonsai-kernels.ts');
  assert.ok(PRISM_ASSETS.every(asset => asset.url.startsWith('https://') && !asset.url.includes('/public/')));
});

test('Wllama is an optional upstream download with its license first', () => {
  assert.equal(WLLAMA_ASSETS[0].name, 'wllama-LICENCE.txt');
  assert.ok(WLLAMA_ASSETS.every(asset => asset.url.startsWith('https://') && !asset.url.includes('/public/')));
});

test('PrismML discovery checks a connected folder before reporting missing files and does not create it', async () => {
  let release;
  let reads = 0;
  const folder = { getDirectoryHandle: async (_name, options) => {
    assert.equal(options, undefined);
    if (++reads === 1) await new Promise(resolve => { release = resolve; });
    throw new DOMException('Missing', 'NotFoundError');
  } };
  const checking = prismEngineManager.discover(folder);
  assert.equal(getPrismEngineDownload().status, 'checking');
  assert.equal(getPrismEngineDownload().folder, folder);
  release();
  await checking;
  assert.equal(getPrismEngineDownload().status, 'idle');
  assert.equal(getPrismEngineDownload().installed, false);
});

test('an engine license downloads when CORS hides Content-Length', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode('license text');
  const asset = { name: 'LICENSE.txt', label: 'Test license', url: 'https://example.test/LICENSE', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const dir = new MemoryDirectory();
  modelDownloadManager.setSpeedLimit(0);
  globalThis.fetch = async () => new Response(bytes);
  try {
    await transferAsset(dir, asset, 0, new AbortController().signal);
    assert.deepEqual(dir.files.get(asset.name), bytes);
  } finally { globalThis.fetch = originalFetch; modelDownloadManager.setSpeedLimit(0.25); }
});

test('an interrupted engine source download resumes from saved bytes and verifies its hash', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode('downloaded TypeScript source');
  const asset = { name: 'fixture.ts', label: 'Test source', url: 'https://example.test/fixture.ts', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const dir = new MemoryDirectory();
  modelDownloadManager.setSpeedLimit(0);
  let first = true;
  globalThis.fetch = async (_url, options = {}) => {
    if (first) {
      first = false;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 8)); setTimeout(() => controller.error(new Error('Connection lost')), 0); } }), { headers: { 'Content-Length': String(bytes.length) } });
    }
    assert.equal(options.headers?.Range, 'bytes=8-');
    return new Response(bytes.slice(8), { status: 206, headers: { 'Content-Range': `bytes 8-${bytes.length - 1}/${bytes.length}` } });
  };
  try {
    await assert.rejects(transferAsset(dir, asset, 0, new AbortController().signal), /Connection lost/);
    assert.equal(dir.files.get(asset.name).length, 8);
    assert.ok(dir.files.has(`${asset.name}.download.json`));
    await transferAsset(dir, asset, 0, new AbortController().signal);
    assert.deepEqual(dir.files.get(asset.name), bytes);
    assert.equal(dir.files.has(`${asset.name}.download.json`), false);
  } finally { globalThis.fetch = originalFetch; modelDownloadManager.setSpeedLimit(0.25); }
});

test('a corrupt resumed asset retries from byte zero without deleting files', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode('correct Needle model bytes');
  const asset = { name: 'needle.cact', label: 'Needle weights', url: 'https://example.test/needle.cact', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const dir = new MemoryDirectory();
  dir.files.set(asset.name, new TextEncoder().encode('broken'));
  dir.files.set(`${asset.name}.download.json`, new TextEncoder().encode('{}'));
  dir.removeEntry = async () => { throw new DOMException('Modifications are not allowed', 'NoModificationAllowedError'); };
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(options.headers?.Range || 'full');
    return options.headers?.Range
      ? new Response(bytes.slice(6), { status: 206, headers: { 'Content-Range': `bytes 6-${bytes.length - 1}/${bytes.length}` } })
      : new Response(bytes);
  };
  try {
    modelDownloadManager.setSpeedLimit(0);
    await transferAsset(dir, asset, 0, new AbortController().signal);
    assert.deepEqual(requests, ['bytes=6-', 'full']);
    assert.deepEqual(dir.files.get(asset.name), bytes);
    assert.ok(dir.files.has(`${asset.name}.download.json`));
  } finally { globalThis.fetch = originalFetch; modelDownloadManager.setSpeedLimit(0.25); }
});

test('a hidden resume range restarts from the full response', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode('test asset contents');
  const asset = { name: 'fixture.ts', label: 'Test source', url: 'https://example.test/fixture.ts', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const dir = new MemoryDirectory();
  dir.files.set(asset.name, bytes.slice(0, 4));
  dir.files.set(`${asset.name}.download.json`, new TextEncoder().encode('{}'));
  let calls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    calls++;
    if (calls === 1) {
      assert.equal(options.headers?.Range, 'bytes=4-');
      return new Response(bytes.slice(4), { status: 206 });
    }
    assert.equal(options.headers?.Range, undefined);
    return new Response(bytes);
  };
  try {
    modelDownloadManager.setSpeedLimit(0);
    await transferAsset(dir, asset, 0, new AbortController().signal);
    assert.equal(calls, 2);
    assert.deepEqual(dir.files.get(asset.name), bytes);
  } finally { globalThis.fetch = originalFetch; modelDownloadManager.setSpeedLimit(0.25); }
});
