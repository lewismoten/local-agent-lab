import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_CATALOG } from '../src/catalogModels.ts';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, NEEDLE_MODEL_ASSETS, needleAssetsManager } from '../src/needleAssets.ts';

test('MiniCPM5 browser GGUFs fit the file cap and start without confirmed badges', () => {
  const models = MODEL_CATALOG.filter(model => model.id.startsWith('minicpm5-'));
  assert.equal(models.length, 2);
  for (const model of models) {
    assert.equal(model.runtime, 'browser');
    assert.ok(model.bytes < 2_000_000_000);
    assert.equal(model.browserChecks, undefined);
    assert.match(model.url, /huggingface\.co\/openbmb\/MiniCPM5-/);
  }
});

test('Needle engine and all three model generations save their licenses before binaries', () => {
  assert.equal(NEEDLE_ENGINE_ASSETS[0].name, 'needle-rs-LICENSE.txt');
  assert.equal(NEEDLE_ENGINE_ASSETS[1].name, 'needle-rs-NOTICE.txt');
  for (const version of ['needle', 'needle2', 'needle3']) {
    const files = NEEDLE_MODEL_ASSETS[version];
    assert.match(files[0].name, /LICENSE\.txt$/);
    for (const asset of files) {
      assert.ok(asset.bytes > 0);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
  }
});

test('another Needle model can be queued while one is downloading', async () => {
  let releaseFolder;
  let reads = 0;
  const folder = {
    getDirectoryHandle() {
      if (++reads === 1) return new Promise(resolve => { releaseFolder = resolve; });
      return Promise.reject(new DOMException('Missing', 'NotFoundError'));
    },
  };
  await needleAssetsManager.download(folder, 'needle3');
  await needleAssetsManager.download(folder, 'needle');
  assert.equal(getNeedleAssets().active, 'needle3');
  assert.deepEqual(getNeedleAssets().queue, ['needle']);
  needleAssetsManager.pause();
  releaseFolder({});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(getNeedleAssets().active, null);
  assert.deepEqual(getNeedleAssets().queue, ['needle3', 'needle']);
  assert.equal(getNeedleAssets().queuePaused, true);
});

test('Needle discovery exposes file checking before declaring models absent', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const folder = {
    async getDirectoryHandle() { await gate; throw new DOMException('Missing', 'NotFoundError'); },
  };
  const discovery = needleAssetsManager.discover(folder);
  assert.equal(getNeedleAssets().folder, folder);
  assert.equal(getNeedleAssets().checked.engine, false);
  release();
  await discovery;
  assert.deepEqual(getNeedleAssets().checked, { engine: true, needle: true, needle2: true, needle3: true });
  assert.deepEqual(getNeedleAssets().installed, { engine: false, needle: false, needle2: false, needle3: false });
});
