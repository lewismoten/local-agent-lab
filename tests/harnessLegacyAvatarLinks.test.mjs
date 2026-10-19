import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLegacyAvatarLinks } from '../src/harnessLegacyAvatarLinks.ts';
import { identityAvatarPath } from '../src/harnessData.ts';

const identity = id => ({ id, name: id, avatarPath: identityAvatarPath(id) });
const asset = id => ({ id, title: id, tags: [] });

test('legacy avatar scan links only unique exact PNG bytes', async () => {
  const images = new Map([
    ['ada', new Blob(['same-image'])], ['mira', new Blob(['duplicate-image'])], ['quill', new Blob(['unmatched-image'])],
  ]);
  const saved = new Map([
    ['one', new Blob(['same-image'])], ['two', new Blob(['duplicate-image'])],
    ['three', new Blob(['duplicate-image'])], ['other', new Blob(['different'])],
  ]);
  const store = { identityAvatar: async id => images.get(id) || null, avatarAsset: async id => saved.get(id) || null };
  const progress = [];
  const scan = await scanLegacyAvatarLinks(store, [...saved.keys()].map(asset), ['ada', 'mira', 'quill', 'niko'].map(identity), undefined,
    (done, total) => progress.push([done, total]));
  assert.deepEqual(scan.unique.map(item => [item.identity.id, item.assetIds]), [['ada', ['one']]]);
  assert.deepEqual(scan.ambiguous.map(item => [item.identity.id, item.assetIds.sort()]), [['mira', ['three', 'two']]]);
  assert.deepEqual(scan.missing.map(item => item.id).sort(), ['niko', 'quill']);
  assert.deepEqual(progress.at(-1), [8, 8]);
});

test('legacy avatar scan skips already linked identities and stops before writes', async () => {
  const store = { identityAvatar: async () => { throw new Error('Should not read'); }, avatarAsset: async () => { throw new Error('Should not read'); } };
  const skipped = await scanLegacyAvatarLinks(store, [asset('one')], [{ ...identity('ada'), avatarAssetId: 'one' }]);
  assert.equal(skipped.scannedAssets, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(scanLegacyAvatarLinks(store, [asset('one')], [identity('ada')], abort.signal), /stopped/);
});
