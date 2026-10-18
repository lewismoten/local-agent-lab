import assert from 'node:assert/strict';
import test from 'node:test';
import { readBlob, writeBlob } from '../src/storage.ts';

const missing = () => new DOMException('Entry no longer exists.', 'NotFoundError');
class Directory {
  constructor(stats) { this.stats = stats; this.alive = true; this.directories = new Map(); this.files = new Map(); }
  async getDirectoryHandle(name, options = {}) {
    this.stats.lookups++;
    if (!this.alive) throw missing();
    let next = this.directories.get(name);
    if (!next && options.create) { next = new Directory(this.stats); this.directories.set(name, next); }
    if (!next) throw missing();
    return next;
  }
  async getFileHandle(name, options = {}) {
    if (!this.alive || !options.create && !this.files.has(name)) throw missing();
    return {
      getFile: async () => {
        if (!this.alive || !this.files.has(name)) throw missing();
        return new File([this.files.get(name)], name);
      },
      createWritable: async () => {
        if (!this.alive) throw missing();
        let value;
        return { write: async blob => { if (!this.alive) throw missing(); value = blob; }, close: async () => { if (!this.alive) throw missing(); this.files.set(name, value); } };
      },
    };
  }
  async removeEntry(name) {
    const child = this.directories.get(name);
    if (child) { child.alive = false; this.directories.delete(name); }
    else this.files.delete(name);
  }
}

test('reuses directory handles and recovers after a folder is replaced', async () => {
  const stats = { lookups: 0 };
  const root = new Directory(stats);
  await writeBlob(root, 'harness/sessions/one.json', new Blob(['one']));
  const firstLookups = stats.lookups;
  await writeBlob(root, 'harness/sessions/two.json', new Blob(['two']));
  assert.equal(stats.lookups, firstLookups);
  assert.equal(await (await readBlob(root, 'harness/sessions/one.json')).text(), 'one');

  await root.removeEntry('harness');
  await writeBlob(root, 'harness/sessions/three.json', new Blob(['three']));
  assert.equal(await (await readBlob(root, 'harness/sessions/three.json')).text(), 'three');

  await root.removeEntry('harness');
  const newHarness = await root.getDirectoryHandle('harness', { create: true });
  const newSessions = await newHarness.getDirectoryHandle('sessions', { create: true });
  newSessions.files.set('four.json', new Blob(['four']));
  assert.equal(await (await readBlob(root, 'harness/sessions/four.json')).text(), 'four');
  await assert.rejects(readBlob(root, 'harness/sessions/three.json'), { name: 'NotFoundError' });
});
