import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportAvatarPack, importAvatarPack } from '../src/harnessAvatarPackTransfer.ts';
import { createAvatarAsset, validAvatarLibrary, avatarAssetMatches } from '../src/harnessAvatarLibrary.ts';

test('named avatar pack carries image bytes and labels across export and import', async () => {
  const bytes = await readFile(new URL('../docs/logo-256.png', import.meta.url));
  const blob = new Blob([bytes], { type: 'image/png' });
  const asset = createAvatarAsset({ title: 'Pilot', tags: ['Space'], source: 'generated', prompt: 'Original pilot', packId: 'pack-one', packName: 'Space crew' });
  assert.ok(validAvatarLibrary({ version: 1, assets: [asset] }));
  assert.ok(avatarAssetMatches(asset, 'space crew'));
  const text = await exportAvatarPack('Space crew', [asset], async id => id === asset.id ? blob : null);
  const imported = importAvatarPack(JSON.parse(text));
  assert.equal(imported.name, 'Space crew');
  assert.equal(imported.avatars.length, 1);
  assert.deepEqual(imported.avatars[0].input, { title: 'Pilot', tags: ['Space'], source: 'generated', prompt: 'Original pilot' });
  assert.deepEqual(new Uint8Array(await imported.avatars[0].image.arrayBuffer()), new Uint8Array(bytes));
});

test('avatar pack import rejects unexpected format and invalid image bytes', async () => {
  assert.throws(() => importAvatarPack({ format: 'other', version: 1, name: 'Pack', avatars: [] }), /unsupported format/);
  assert.throws(() => importAvatarPack({ format: 'local-agent-lab-avatar-pack', version: 1, name: 'Pack', avatars: [
    { title: 'Bad', tags: [], source: 'uploaded', image: 'data:image/png;base64,' + btoa('not a PNG') },
  ] }), /not a supported PNG/);
});
