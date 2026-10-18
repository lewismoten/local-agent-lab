import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTION_MODELS, motionModelForPath, motionTotal, assertMotionFiles } from '../src/motionAssets.ts';
import { modelTypeForPath } from '../src/modelTypes.ts';

test('browser graphics downloads pin licenses before binaries and fit the file cap', () => {
  for (const id of ['pose', 'pose_engine', 'vector', 'vector_engine', 'tripo']) {
    const model = MOTION_MODELS[id];
    assert.match(model.assets[0].name, /^LICENSE/);
    assert.ok(motionTotal(id) < 2_000_000_000);
    for (const asset of model.assets) {
      assert.ok(asset.bytes > 0);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.match(asset.url, /^https:\/\//);
    }
  }
  assert.equal(MOTION_MODELS.tripo.assets[0].name, 'LICENSE-TripoSR.txt');
  assert.equal(MOTION_MODELS.tripo.assets[1].name, 'LICENSE-DINO.txt');
});

test('graphics models appear in their local model type', () => {
  for (const [id, type] of [['pose', 'pose'], ['vector', 'vector'], ['tripo', 'mesh']]) {
    const path = MOTION_MODELS[id].path;
    assert.equal(motionModelForPath(path), id);
    assert.equal(modelTypeForPath(path), type);
  }
  assert.equal(motionModelForPath(MOTION_MODELS.pose_engine.path), null);
});

test('pose inference cannot start when its saved license is missing', async () => {
  const folder = {
    async getDirectoryHandle() { return this; },
    async getFileHandle() { throw new DOMException('Not found', 'NotFoundError'); },
  };
  await assert.rejects(assertMotionFiles(folder, 'pose'), /license first/);
});
