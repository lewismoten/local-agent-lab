import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { defaultIdentities, identityAvatarPath } from '../src/harnessData.ts';
import { identityAvatarPrompt, identityDraft, validIdentityAvatarPath } from '../src/harnessIdentityAvatar.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name, { type: this.blob.type }); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
}

test('private identity drafts choose distinct icons and unique names', () => {
  const presets = defaultIdentities();
  assert.deepEqual(presets.map(identity => identity.icon), ['code', 'compass', 'shield']);
  const draft = identityDraft(0, ['Vega', 'vega 2'], '2026-10-18T00:00:00.000Z');
  assert.equal(draft.name, 'Vega 3');
  assert.equal(draft.icon, 'robot');
  assert.equal(draft.createdAt, draft.updatedAt);
  assert.match(identityAvatarPrompt(draft), /fictional software builder named Vega 3/);
  assert.match(identityAvatarPrompt(draft), /expressive robot head/);
  assert.match(identityAvatarPrompt({ ...draft, icon: 'shield' }), /protective shield emblem/);
});

test('avatar PNG stays in the folder and can be read from a reopened workspace', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('avatars', folder);
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  const path = await store.saveIdentityAvatar('private-identity', image);
  assert.equal(path, identityAvatarPath('private-identity'));
  assert.equal(validIdentityAvatarPath({ id: 'private-identity', avatarPath: path }), true);
  assert.equal(validIdentityAvatarPath({ id: 'private-identity', avatarPath: '../other.png' }), false);
  const reopened = new HarnessStore('avatars', folder);
  assert.deepEqual(new Uint8Array(await (await reopened.identityAvatar('private-identity')).arrayBuffer()), new Uint8Array(await image.arrayBuffer()));
  assert.equal(await reopened.identityAvatar('missing'), null);
});

test('avatar storage rejects paths, wrong formats, and oversize files', async () => {
  const store = new HarnessStore('avatars', new MemoryDirectory());
  await assert.rejects(store.saveIdentityAvatar('../private', new Blob(['x'], { type: 'image/png' })), /identifier/);
  await assert.rejects(store.saveIdentityAvatar('private', new Blob(['x'], { type: 'image/jpeg' })), /PNG/);
  await assert.rejects(store.saveIdentityAvatar('private', new Blob([new Uint8Array(512_001)], { type: 'image/png' })), /500 KB/);
});

test('saved avatar assets are reusable across identities and keep searchable tags', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('avatars', folder);
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  const asset = await store.saveAvatarAsset(image, { title: 'Robot guide', source: 'generated', tags: ['robot', 'cyberpunk'], originIdentityId: 'ada', prompt: 'A luminous robot guide' });
  assert.deepEqual(asset.tags, ['Robot', 'Cyberpunk']);
  const reopened = new HarnessStore('avatars', folder);
  assert.equal((await reopened.avatarLibrary())[0].id, asset.id);
  assert.deepEqual(new Uint8Array(await (await reopened.avatarAsset(asset.id)).arrayBuffer()), new Uint8Array(await image.arrayBuffer()));
  await reopened.updateAvatarAsset(asset.id, 'Night guide', ['teal', 'robot']);
  assert.equal((await store.avatarLibrary())[0].title, 'Night guide');
  await assert.rejects(reopened.updateAvatarAsset('missing', 'No', []), /no longer/);
});

test('image library keeps a larger PNG, favorites, and named collections after reopening', async () => {
  const folder = new MemoryDirectory();
  const first = new HarnessStore('images', folder);
  const image = new Blob([new Uint8Array(600_000)], { type: 'image/png' });
  const asset = await first.saveAvatarAsset(image, { title: 'Landscape', source: 'generated', tags: ['Generated'] });
  await first.updateAvatarAsset(asset.id, 'Landscape', asset.tags, true, ['Scenes', 'scenes', 'Reference']);
  const reopened = new HarnessStore('images', folder);
  const saved = (await reopened.avatarLibrary()).find(item => item.id === asset.id);
  assert.equal(saved.favorite, true);
  assert.deepEqual(saved.collections, ['scenes', 'Reference']);
  assert.equal((await reopened.avatarAsset(asset.id)).size, 600_000);
});
