import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { defaultIdentities, identityAvatarPath } from '../src/harnessData.ts';
import { identityAvatarPrompt, identityDraft, validIdentityAvatarPath } from '../src/harnessIdentityAvatar.ts';
import { scanGeneratedImageFiles } from '../src/harnessGeneratedImageIndex.ts';
import { writeBlob } from '../src/storage.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name, { type: this.blob.type }); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async *entries() { yield* this.children.entries(); }
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

test('older generated PNG, JPEG, WebP, AVIF, and GIF files are linked without copying image bodies', async () => {
  const folder = new MemoryDirectory();
  const prefix = 'harness/projects/book/library/generated/';
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), new Uint8Array(20_000_000)], { type: 'image/png' });
  await writeBlob(folder, `${prefix}old-cover.png`, png);
  await writeBlob(folder, `${prefix}old-photo.jpg`, new Blob([new Uint8Array([255, 216, 255, 1, 2])], { type: 'image/jpeg' }));
  await writeBlob(folder, `${prefix}old-texture.webp`, new Blob([new TextEncoder().encode('RIFF1234WEBP')], { type: 'image/webp' }));
  await writeBlob(folder, `${prefix}old-animation.gif`, new Blob([new TextEncoder().encode('GIF89a')], { type: 'image/gif' }));
  await writeBlob(folder, `${prefix}old-scene.avif`, new Blob([new Uint8Array([0, 0, 0, 12]), new TextEncoder().encode('ftypavif')], { type: 'image/avif' }));
  await writeBlob(folder, `${prefix}fake.png`, new Blob(['not an image'], { type: 'image/png' }));
  const store = new HarnessStore('older-images', folder);
  const found = await scanGeneratedImageFiles(folder, new Set());
  assert.equal(found.length, 5);
  assert.equal(found.find(item => item.path.endsWith('old-cover.png')).bytes, png.size);
  assert.deepEqual(await store.linkGeneratedImageFiles(found), { added: 5, linked: 0 });
  const reopened = new HarnessStore('older-images', folder);
  const assets = await reopened.avatarLibrary();
  assert.equal(assets.length, 5);
  const cover = assets.find(asset => asset.path?.endsWith('old-cover.png'));
  assert.equal(cover.fileBytes, png.size);
  assert.equal((await reopened.avatarAsset(cover.id)).size, png.size);
  assert.equal((await scanGeneratedImageFiles(folder, new Set(assets.map(asset => asset.path)))).length, 0);
  assert.deepEqual(await reopened.linkGeneratedImageFiles(found), { added: 0, linked: 0 });
});

test('older inspector, motion, chat, and character images retain their source paths', async () => {
  const folder = new MemoryDirectory();
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
  const paths = [
    'outputs/images/old-inspector.png',
    'sources/generated/motion-first-frame-old.png',
    'assets/chat/12345678-abcd.png',
    'assets/characters/mira/12345678-abcd-generated.png',
  ];
  const inspectorPath = paths[0];
  for (const path of paths) await writeBlob(folder, path, image);
  await writeBlob(folder, 'assets/characters/mira/12345678-abcd-upload.png', image);
  await writeBlob(folder, 'outputs/images/old-inspector.json', new Blob([JSON.stringify({ imagePath: inspectorPath, prompt: 'A green leaf', imageModel: 'Tiny-SD', generatedAt: '2026-01-02T00:00:00.000Z' })], { type: 'application/json' }));
  const found = await scanGeneratedImageFiles(folder, new Set());
  assert.deepEqual(found.map(item => item.path).sort(), [...paths].sort());
  assert.equal(found.find(item => item.path === inspectorPath).prompt, 'A green leaf');
  const store = new HarnessStore('older-surfaces', folder);
  assert.deepEqual(await store.linkGeneratedImageFiles(found), { added: 4, linked: 0 });
  const asset = (await new HarnessStore('older-surfaces', folder).avatarLibrary()).find(item => item.path === inspectorPath);
  assert.equal(asset.prompt, 'A green leaf');
  assert.ok(asset.tags.includes('Tiny-SD'));
  assert.equal(asset.createdAt, '2026-01-02T00:00:00.000Z');
});

test('an inspector output already saved by the image recorder links to one tile across reloads', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('shared-output', folder);
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' });
  const prompt = 'A teal circuit garden';
  const saved = await store.saveAvatarAsset(image, { title: 'Generated · Fixture image', tags: ['Generated', 'Fixture image'], source: 'generated', prompt });
  const outputPath = 'outputs/images/recorder-copy.png';
  await writeBlob(folder, outputPath, image);
  await writeBlob(folder, 'outputs/images/recorder-copy.json', new Blob([JSON.stringify({ imagePath: outputPath, prompt, imageModel: 'Fixture image', generatedAt: saved.createdAt })]));
  let found = await scanGeneratedImageFiles(folder, new Set());
  assert.deepEqual(await store.linkGeneratedImageFiles(found), { added: 0, linked: 1 });
  const reopened = new HarnessStore('shared-output', folder);
  const assets = await reopened.avatarLibrary();
  assert.equal(assets.length, 1);
  assert.deepEqual(assets[0].relatedPaths, [outputPath]);
  assert.equal((await reopened.avatarAsset(saved.id)).size, image.size);
  const known = new Set(assets.flatMap(asset => [asset.path, ...(asset.relatedPaths || [])].filter(Boolean)));
  found = await scanGeneratedImageFiles(folder, known);
  assert.equal(found.length, 0);
  assert.deepEqual(await reopened.linkGeneratedImageFiles(await scanGeneratedImageFiles(folder, new Set())), { added: 0, linked: 0 });

  const changedPath = 'outputs/images/different-image.png';
  const changed = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 4])], { type: 'image/png' });
  await writeBlob(folder, changedPath, changed);
  await writeBlob(folder, 'outputs/images/different-image.json', new Blob([JSON.stringify({ imagePath: changedPath, prompt, imageModel: 'Fixture image', generatedAt: saved.createdAt })]));
  assert.deepEqual(await reopened.linkGeneratedImageFiles(await scanGeneratedImageFiles(folder, known)), { added: 1, linked: 0 });
  assert.equal((await reopened.avatarLibrary()).length, 2);
});

test('oversized new generated image keeps its original file and library link', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('large-images', folder);
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), new Uint8Array(20_000_001)], { type: 'image/png' });
  const asset = await store.saveOriginalGeneratedAsset(image, { title: 'Large scene', tags: ['Generated'], source: 'generated', prompt: 'A city at night' });
  assert.equal(asset.fileBytes, image.size);
  assert.match(asset.path, /^harness\/images\/originals\/.+\.png$/);
  const reopened = new HarnessStore('large-images', folder);
  const saved = (await reopened.avatarLibrary()).find(item => item.id === asset.id);
  assert.equal(saved.prompt, 'A city at night');
  assert.equal((await reopened.avatarAsset(asset.id)).size, image.size);
  await assert.rejects(store.saveOriginalGeneratedAsset(new Blob(['fake'], { type: 'image/png' }), { title: 'Invalid', tags: [], source: 'generated' }), /unsupported format/);
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
