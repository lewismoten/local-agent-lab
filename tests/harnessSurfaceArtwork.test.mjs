import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { modelFamilyArtworkEntry, modelFamilyArtworkKey, suggestedSurfaceArtworkPrompt, validSurfaceArtwork } from '../src/harnessSurfaceArtwork.ts';
import { createConversation } from '../src/harnessData.ts';

class FileHandle {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class DirectoryHandle {
  kind = 'directory'; children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) { item = new DirectoryHandle(); this.children.set(name, item); }
    if (!item || item.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return item;
  }
  async getFileHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) { item = new FileHandle(name); this.children.set(name, item); }
    if (!item || item.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return item;
  }
  async removeEntry(name) {
    if (!this.children.delete(name)) throw new DOMException('Missing', 'NotFoundError');
  }
}

test('catalog artwork uses stable keys and reusable workspace assets', async () => {
  const folder = new DirectoryHandle();
  const store = new HarnessStore('surface-artwork', folder);
  const asset = await store.saveAvatarAsset(new Blob(['image'], { type: 'image/png' }),
    { title: 'Model icon', tags: ['Model'], source: 'generated' });
  const key = 'model:gguf:qwen3-1.7b';
  const prompt = suggestedSurfaceArtworkPrompt('Qwen 3', 'text model');
  await Promise.all([store.saveSurfaceArtwork(key, asset.id, prompt), store.saveSurfaceArtwork('model:image:tiny-sd', asset.id, prompt)]);
  const reopened = new HarnessStore('surface-artwork', folder);
  assert.equal((await reopened.surfaceArtwork()).items[key].assetId, asset.id);
  assert.equal(Object.keys((await reopened.surfaceArtwork()).items).length, 2);
  await reopened.saveSurfaceArtwork(key, null, '');
  assert.equal((await reopened.surfaceArtwork()).items[key], undefined);
  assert.ok(await reopened.avatarAsset(asset.id));
  await assert.rejects(reopened.saveSurfaceArtwork('model:gguf:bad', 'missing', ''), /no longer in the image library/);
  assert.equal(validSurfaceArtwork({ version: 1, items: { '../escape': { assetId: asset.id, prompt } } }), false);
});

test('model variants share a family icon and older per-model keys retire atomically', async () => {
  const folder = new DirectoryHandle();
  const store = new HarnessStore('family-artwork', folder);
  const first = await store.saveAvatarAsset(new Blob(['first'], { type: 'image/png' }), { title: 'First icon', tags: ['Model'], source: 'uploaded' });
  const second = await store.saveAvatarAsset(new Blob(['second'], { type: 'image/png' }), { title: 'Second icon', tags: ['Model'], source: 'uploaded' });
  const oldKeys = ['model:gguf:qwen25-15b', 'model:gguf:qwen3-17b'];
  const familyKey = modelFamilyArtworkKey('gguf', 'Qwen');
  assert.equal(familyKey, 'model-family:gguf:qwen');
  await store.saveSurfaceArtwork(oldKeys[0], first.id, 'Older prompt');
  let map = await store.surfaceArtwork();
  assert.equal(modelFamilyArtworkEntry(map, familyKey, oldKeys)?.assetId, first.id);
  map = await store.saveSurfaceArtwork(familyKey, second.id, 'Family prompt', oldKeys);
  assert.equal(modelFamilyArtworkEntry(map, familyKey, oldKeys)?.assetId, second.id);
  assert.equal(map.items[oldKeys[0]], undefined);
  const reopened = new HarnessStore('family-artwork', folder);
  assert.equal(modelFamilyArtworkEntry(await reopened.surfaceArtwork(), familyKey, oldKeys)?.assetId, second.id);
  map = await reopened.saveSurfaceArtwork(familyKey, null, '', oldKeys);
  assert.equal(modelFamilyArtworkEntry(map, familyKey, oldKeys), undefined);
  await assert.rejects(reopened.saveSurfaceArtwork('model:gguf:qwen3-17b', second.id, '', oldKeys), /Invalid older model icon keys/);
});

test('copied conversation keeps its icon and discarded copy removes only its reference', async () => {
  const store = new HarnessStore('conversation-artwork-copy', new DirectoryHandle());
  const asset = await store.saveAvatarAsset(new Blob(['icon'], { type: 'image/png' }),
    { title: 'Conversation icon', tags: ['Conversation'], source: 'uploaded' });
  const source = createConversation('home');
  await store.saveSurfaceArtwork(`conversation:${source.id}`, asset.id, 'Original icon prompt');
  const copied = await store.copyConversation(source, 'second-project');
  const saved = await store.surfaceArtwork();
  assert.equal(saved.items[`conversation:${copied.id}`].assetId, asset.id);
  assert.equal(saved.items[`conversation:${copied.id}`].prompt, 'Original icon prompt');
  await store.discardUnlistedCopy(copied);
  const after = await store.surfaceArtwork();
  assert.equal(after.items[`conversation:${copied.id}`], undefined);
  assert.equal(after.items[`conversation:${source.id}`].assetId, asset.id);
  assert.ok(await store.avatarAsset(asset.id));
});

test('stopped conversation copy leaves only the source icon reference', async () => {
  const store = new HarnessStore('stopped-conversation-artwork', new DirectoryHandle());
  const asset = await store.saveAvatarAsset(new Blob(['icon'], { type: 'image/png' }),
    { title: 'Source icon', tags: ['Conversation'], source: 'uploaded' });
  const source = await store.appendMessage(createConversation('home'), {
    id: crypto.randomUUID(), role: 'user', content: 'Keep this source.', createdAt: new Date().toISOString(), seq: 0,
  });
  await store.saveSurfaceArtwork(`conversation:${source.id}`, asset.id, 'Source prompt');
  await assert.rejects(store.copyConversation(source, 'second-project', done => {
    if (done === 1) throw new Error('Stop copy');
  }), /Stop copy/);
  assert.deepEqual(Object.keys((await store.surfaceArtwork()).items), [`conversation:${source.id}`]);
});
