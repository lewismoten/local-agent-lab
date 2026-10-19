import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBrowserStorageRoom, storageCapacity } from '../src/storageCapacity.ts';
import { writeBlob } from '../src/storage.ts';

function withNavigator(storage, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage } });
  return Promise.resolve().then(run).finally(() => {
    if (prior) Object.defineProperty(globalThis, 'navigator', prior);
    else delete globalThis.navigator;
  });
}

test('browser storage checks only additional bytes before opening a writer', async () => {
  let writerOpened = false;
  let content = '12345';
  const folder = {
    kind: 'directory',
    async isSameEntry(other) { return other === folder; },
    async getDirectoryHandle(name) { if (name !== 'local-agent-lab') throw new DOMException('Missing', 'NotFoundError'); return folder; },
    async getFileHandle(name, options) {
      if (name !== 'file.bin' || content === null && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return { async getFile() { return new File([content || ''], name); }, async createWritable() {
        writerOpened = true;
        return { async write(blob) { content = await blob.text(); }, async close() {} };
      } };
    },
  };
  await withNavigator({ getDirectory: async () => folder, estimate: async () => ({ quota: 100, usage: 96 }) }, async () => {
    assert.deepEqual(await storageCapacity(folder), { kind: 'browser', availableBytes: 4, quotaBytes: 100, usedBytes: 96 });
    await writeBlob(folder, 'file.bin', new Blob(['12345678'])); // 3 additional bytes
    assert.equal(content, '12345678');
    writerOpened = false;
    await assert.rejects(writeBlob(folder, 'file.bin', new Blob(['1234567890123'])), error => error.name === 'QuotaExceededError');
    assert.equal(writerOpened, false);
  });
});

test('a selected external folder is not judged by the browser origin quota', async () => {
  const browserFolder = { async getDirectoryHandle() { return browserFolder; } };
  const external = { async isSameEntry() { return false; } };
  await withNavigator({ getDirectory: async () => browserFolder, estimate: async () => ({ quota: 100, usage: 100 }) }, async () => {
    assert.deepEqual(await storageCapacity(external), { kind: 'external-or-unknown', availableBytes: null });
    await assertBrowserStorageRoom(external, 1_000_000);
  });
});
