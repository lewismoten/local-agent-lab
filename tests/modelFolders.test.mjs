import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { getNeedleAssets, listPresentNeedleModels, NEEDLE_MODEL_ASSETS, NEEDLE_MODEL_PATHS, needleAssetsManager, readNeedleWeight } from '../src/needleAssets.ts';
import { organizeFlatGgufModels, modelFolderName } from '../src/modelFolders.ts';
import { readBlob } from '../src/storage.ts';

function directory(initial = {}) {
  const files = new Map(Object.entries(initial));
  const dirs = new Map();
  return {
    files, dirs, kind: 'directory',
    async getDirectoryHandle(name, options = {}) {
      if (!dirs.has(name)) {
        if (!options.create) throw new DOMException('Missing', 'NotFoundError');
        dirs.set(name, directory());
      }
      return dirs.get(name);
    },
    async getFileHandle(name, options = {}) {
      if (!files.has(name) && !options.create) throw new DOMException('Missing', 'NotFoundError');
      return {
        kind: 'file',
        async getFile() { return files.get(name) || new File([], name); },
        async createWritable() {
          const chunks = [];
          const stream = new WritableStream({ write(chunk) { chunks.push(chunk); }, close() { files.set(name, new File(chunks, name)); } });
          stream.write = async chunk => { chunks.push(chunk); };
          stream.close = async () => { files.set(name, new File(chunks, name)); };
          return stream;
        },
      };
    },
    async removeEntry(name) {
      if (!files.delete(name) && !dirs.delete(name)) throw new DOMException('Missing', 'NotFoundError');
    },
    async *entries() {
      for (const [name] of files) yield [name, { kind: 'file', getFile: async () => files.get(name) }];
      for (const [name, dir] of dirs) yield [name, dir];
    },
  };
}

test('complete flat Needle files remain installed after refresh and move without downloading', async () => {
  const assets = NEEDLE_MODEL_ASSETS.needle2;
  const original = assets.map(asset => ({ bytes: asset.bytes, sha256: asset.sha256 }));
  const root = directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  try {
    for (const [index, asset] of assets.entries()) {
      const bytes = new TextEncoder().encode(`needle test ${index}`);
      asset.bytes = bytes.length;
      asset.sha256 = createHash('sha256').update(bytes).digest('hex');
      const name = index === 0 ? 'needle2.cact.LICENSE.txt' : asset.name;
      models.files.set(name, new File([bytes], name));
    }
    assert.deepEqual(await listPresentNeedleModels(root), [NEEDLE_MODEL_PATHS.needle2]);
    await needleAssetsManager.discover(root);
    assert.equal(getNeedleAssets().installed.needle2, true);
    assert.deepEqual(await listPresentNeedleModels(root), [NEEDLE_MODEL_PATHS.needle2]);
    assert.equal((await readNeedleWeight(root, 'needle2')).size, assets[1].bytes);
    assert.equal((await needleAssetsManager.organize(root)), 1);
    assert.ok((await (await models.getDirectoryHandle('Needle-2')).getFileHandle('LICENSE.txt')));
    assert.equal(models.files.has('needle2.cact'), false);
    await needleAssetsManager.discover(root);
    assert.equal(getNeedleAssets().installed.needle2, true);
    assert.deepEqual(await listPresentNeedleModels(root), [NEEDLE_MODEL_PATHS.needle2]);
    assert.equal((await readNeedleWeight(root, 'needle2')).size, assets[1].bytes);
    assert.equal(NEEDLE_MODEL_PATHS.needle2, 'models/Needle-2/needle2.cact');
  } finally {
    assets.forEach((asset, index) => Object.assign(asset, original[index]));
  }
});

test('organizer keeps GGUF and sidecars together and logical reads survive the move', async () => {
  const root = directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  const name = 'example-Q4_K_M.gguf';
  models.files.set(name, new File(['weights'], name));
  models.files.set(`${name}.LICENSE.txt`, new File(['license'], `${name}.LICENSE.txt`));
  models.files.set(`${name}.SOURCE.txt`, new File(['source'], `${name}.SOURCE.txt`));
  assert.equal(await organizeFlatGgufModels(root), 1);
  const nested = await models.getDirectoryHandle(modelFolderName(name));
  assert.equal((await (await nested.getFileHandle('LICENSE.txt')).getFile()).size, 7);
  assert.equal(await (await readBlob(root, `models/${name}`)).text(), 'weights');
  assert.equal(models.files.has(name), false);
});
