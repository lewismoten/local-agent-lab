import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUseIndex } from '../src/harnessImageUse.ts';

test('image library groups actual references and retains unused images', async () => {
  const assets = [
    { id: 'avatar', tags: ['Avatar'], packId: 'pack' },
    { id: 'shared', tags: [] },
    { id: 'journal', tags: [] },
    { id: 'unused', tags: [] },
  ];
  const store = {
    surfaceArtwork: async () => ({ version: 1, items: { 'achievement:first': { assetId: 'shared', prompt: '' }, 'project:home': { assetId: 'shared', prompt: '' } } }),
    journalStyleSettings: async () => ({ version: 1, iconAssetIds: { blog: 'journal' } }),
    journalIndex: async () => ({ version: 1, dates: ['2026-10-19'] }),
    journalRenderings: async () => ({ version: 1, artworkAssetId: 'shared' }),
    manifest: async () => ({ identities: [{ avatarAssetId: 'avatar' }], userProfile: {} }),
  };
  const uses = await imageUseIndex(store, assets);
  assert.deepEqual([...uses.get('avatar')], ['Avatars']);
  assert.deepEqual([...uses.get('shared')].sort(), ['Achievements', 'Journals', 'Projects']);
  assert.deepEqual([...uses.get('journal')], ['Journals']);
  assert.deepEqual([...uses.get('unused')], ['Other']);
});
