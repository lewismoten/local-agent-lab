import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { engineAssetFiles, engineDirectory, engineSavedBytes, legacyEngineFileCount, organizeEngineFiles } from '../src/engineFolders.ts';
import { getPrismEngineDownload, PRISM_ASSETS, prismEngineManager, assertPrismEngineFiles } from '../src/prismEngine.ts';
import { getWllamaEngineDownload, WLLAMA_ASSETS, wllamaEngineManager, assertWllamaEngineFiles } from '../src/wllamaEngine.ts';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, needleAssetsManager } from '../src/needleAssets.ts';

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
  };
}

test('flat Wllama, PrismML, and Needle engine files move into separate folders', async () => {
  const root = directory();
  const engines = await root.getDirectoryHandle('engines', { create: true });
  const cases = [
    ['Wllama', 'wllama-test.wasm'],
    ['PrismML', 'prism-test.ts'],
    ['Needle', 'needle-test.wasm'],
  ];
  for (const [group, name] of cases) {
    const bytes = new TextEncoder().encode(group);
    engines.files.set(name, new File([bytes], name));
    const assets = [{ name, bytes: bytes.length, sha256: '', url: '', label: group }];
    assert.equal((await engineAssetFiles(root, group, assets, async (dir, asset) => {
      try { return await (await dir.getFileHandle(asset.name)).getFile(); } catch { return null; }
    }))[0]?.size, bytes.length);
    assert.equal(await organizeEngineFiles(root, group, assets, `${group}-queue.json`), 1);
    assert.equal(await (await (await engineDirectory(root, group)).getFileHandle(name)).getFile().then(file => file.text()), group);
    assert.equal(await engineSavedBytes(root, group, assets), bytes.length);
    assert.equal(engines.files.has(name), false);
  }
});

test('a paused engine download keeps its bytes and resume record when organized', async () => {
  const root = directory();
  const engines = await root.getDirectoryHandle('engines', { create: true });
  engines.files.set('runtime.wasm', new File(['part'], 'runtime.wasm'));
  engines.files.set('runtime.wasm.download.json', new File(['{"url":"https://example.test/runtime.wasm"}'], 'runtime.wasm.download.json'));
  engines.files.set('engine-queue.json', new File(['{"queued":true}'], 'engine-queue.json'));
  const assets = [{ name: 'runtime.wasm', bytes: 10, sha256: '', url: '', label: 'runtime' }];
  assert.equal(await legacyEngineFileCount(root, ['runtime.wasm', 'runtime.wasm.download.json', 'engine-queue.json']), 3);
  assert.equal(await organizeEngineFiles(root, 'Needle', assets, 'engine-queue.json'), 3);
  const nested = await engineDirectory(root, 'Needle');
  assert.equal(await (await (await nested.getFileHandle('runtime.wasm')).getFile()).text(), 'part');
  assert.match(await (await (await nested.getFileHandle('runtime.wasm.download.json')).getFile()).text(), /example\.test/);
  assert.equal(await legacyEngineFileCount(root, ['runtime.wasm', 'runtime.wasm.download.json', 'engine-queue.json']), 0);
});

test('a drive that denies deletion still leaves a usable organized engine copy', async () => {
  const root = directory();
  const engines = await root.getDirectoryHandle('engines', { create: true });
  engines.files.set('runtime.wasm', new File(['ready'], 'runtime.wasm'));
  engines.removeEntry = async () => { throw new DOMException('Read only', 'NoModificationAllowedError'); };
  const assets = [{ name: 'runtime.wasm', bytes: 5, sha256: '', url: '', label: 'runtime' }];
  assert.equal(await organizeEngineFiles(root, 'Needle', assets, 'engine-queue.json'), 0);
  assert.equal(await (await (await engineDirectory(root, 'Needle')).getFileHandle('runtime.wasm')).getFile().then(file => file.text()), 'ready');
  assert.equal(await legacyEngineFileCount(root, ['runtime.wasm']), 1);
});

test('installed engine checks keep working before and after moving flat files', async () => {
  const root = directory();
  const engines = await root.getDirectoryHandle('engines', { create: true });
  const groups = [
    ['Wllama', WLLAMA_ASSETS, 'wllama-queue.json'],
    ['PrismML', PRISM_ASSETS, 'prism-bonsai-queue.json'],
    ['Needle', NEEDLE_ENGINE_ASSETS, 'needle-rs-queue.json'],
  ];
  const original = groups.flatMap(([, assets]) => assets.map(asset => ({ asset, bytes: asset.bytes, sha256: asset.sha256 })));
  try {
    for (const [, assets] of groups) for (const asset of assets) {
      const data = new TextEncoder().encode(`test ${asset.name}`);
      asset.bytes = data.length;
      asset.sha256 = createHash('sha256').update(data).digest('hex');
      engines.files.set(asset.name, new File([data], asset.name));
    }
    await Promise.all([wllamaEngineManager.discover(root), prismEngineManager.discover(root), needleAssetsManager.discover(root)]);
    assert.equal(getWllamaEngineDownload().installed, true);
    assert.equal(getPrismEngineDownload().installed, true);
    assert.equal(getNeedleAssets().installed.engine, true);
    for (const [group, assets, queue] of groups) await organizeEngineFiles(root, group, assets, queue);
    await Promise.all([wllamaEngineManager.discover(root), prismEngineManager.discover(root), needleAssetsManager.discover(root)]);
    assert.equal(getWllamaEngineDownload().installed, true);
    assert.equal(getPrismEngineDownload().installed, true);
    assert.equal(getNeedleAssets().installed.engine, true);
    assert.ok((await assertWllamaEngineFiles(root)).wasm);
    assert.ok(await assertPrismEngineFiles(root));
  } finally {
    for (const { asset, bytes, sha256 } of original) Object.assign(asset, { bytes, sha256 });
  }
});
