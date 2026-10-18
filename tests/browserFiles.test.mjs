import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFiles, hasWritableFolderPermission } from '../src/storage.ts';

async function withStorage(storage, work) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage } });
  try { return await work(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
}

test('writable browser file storage is offered after a write and remove probe', async () => {
  const files = new Map();
  const folder = {
    async getFileHandle(name, options) {
      assert.equal(options.create, true);
      files.set(name, '');
      return { async createWritable() { return { async write(value) { files.set(name, value); }, async close() {} }; } };
    },
    async removeEntry(name) { files.delete(name); },
  };
  const root = { async getDirectoryHandle(name, options) { assert.equal(name, 'local-agent-lab'); assert.equal(options.create, true); return folder; } };
  await withStorage({ getDirectory: async () => root }, async () => {
    assert.equal(await browserFiles(), folder);
    assert.equal(files.size, 0);
  });
});

test('browser file storage is hidden when writable streams are unavailable', async () => {
  const root = { async getDirectoryHandle() { return { async getFileHandle() { return {}; } }; } };
  await withStorage({ getDirectory: async () => root }, async () => assert.equal(await browserFiles(), null));
  await withStorage({}, async () => assert.equal(await browserFiles(), null));
});

test('checking a remembered folder never requests permission during startup', async () => {
  let requests = 0;
  const handle = {
    async queryPermission(options) { assert.deepEqual(options, { mode: 'readwrite' }); return 'prompt'; },
    async requestPermission() { requests++; return 'granted'; },
  };
  assert.equal(await hasWritableFolderPermission(handle), false);
  assert.equal(requests, 0);
  handle.queryPermission = async () => 'granted';
  assert.equal(await hasWritableFolderPermission(handle), true);
  assert.equal(requests, 0);
});
