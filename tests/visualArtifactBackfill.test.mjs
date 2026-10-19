import assert from 'node:assert/strict';
import test from 'node:test';
import { backfillVisualArtifactSidecars, planVisualArtifactBackfill } from '../src/visualArtifactBackfill.ts';

const hash = 'a'.repeat(64);
const modelPackage = { path: 'models/Test', files: [{ path: 'models/Test/weights.onnx', sha256: hash }] };
const runtimePackage = { path: 'engines/Test', files: [{ path: 'engines/Test/runtime.wasm', sha256: hash }] };

function workspace(tree) {
  const directory = items => ({
    kind: 'directory',
    async getDirectoryHandle(name, options) {
      if (items[name] === undefined && options?.create) items[name] = {};
      if (!items[name] || typeof items[name] !== 'object') throw new DOMException('Missing', 'NotFoundError');
      return directory(items[name]);
    },
    async getFileHandle(name, options) {
      if (items[name] === undefined && options?.create) items[name] = '';
      if (typeof items[name] !== 'string') throw new DOMException('Missing', 'NotFoundError');
      return fileHandle(items, name);
    },
    async *entries() {
      for (const [name, value] of Object.entries(items)) yield [name,
        typeof value === 'string' ? fileHandle(items, name) : directory(value)];
    },
  });
  const fileHandle = (items, name) => ({
    kind: 'file', async getFile() { return new File([items[name]], name); },
    async createWritable() { return { async write(blob) { items[name] = await blob.text(); }, async close() {} }; },
  });
  return directory(tree);
}

test('restores only existing media with a unique pinned report', async () => {
  const report = { checkedAt: '2026-10-17T00:00:00.000Z', modelPackage, runtimePackage,
    inputs: { firstFrame: 'start.png' }, videoPath: 'media/videos/clip.webm', plyPath: 'media/meshes/model.ply', glbPath: 'media/meshes/model.glb' };
  const tree = { models: { Test: { diagnostics: { 'run-video.json': JSON.stringify(report) } } },
    media: { videos: { 'clip.webm': 'video' }, meshes: { 'model.ply': 'mesh' } } };
  const root = workspace(tree);
  const plan = await planVisualArtifactBackfill(root);
  assert.deepEqual(plan.map(item => item.artifactPath).sort(), ['media/meshes/model.ply', 'media/videos/clip.webm']);
  assert.equal(await backfillVisualArtifactSidecars(root), 2);
  const sidecar = JSON.parse(tree.media.meshes['model.ply.meta.json']);
  assert.equal(sidecar.fileBytes, 4);
  assert.equal(sidecar.sourceReportPath, 'models/Test/diagnostics/run-video.json');
  assert.deepEqual(sidecar.modelPackage, modelPackage);
  assert.deepEqual(sidecar.runtimePackage, runtimePackage);
  assert.equal(sidecar.source.name, 'start.png');
  assert.equal(await backfillVisualArtifactSidecars(root), 0);
  assert.equal(tree.media.meshes['model.glb.meta.json'], undefined);
});

test('preserves user sidecars and skips unpinned or ambiguous reports', async () => {
  const base = { checkedAt: '2026-10-17T00:00:00.000Z', modelPackage, svgPath: 'media/vectors/shape.svg' };
  const tree = { models: { Test: { diagnostics: {
    'first-vector.json': JSON.stringify(base),
    'second-vector.json': JSON.stringify(base),
    'bad-mesh.json': JSON.stringify({ ...base, modelPackage: { ...modelPackage, files: [{ path: 'models/Test/weights.onnx', sha256: '' }] }, plyPath: 'media/meshes/bad.ply' }),
    'safe-pose.json': JSON.stringify({ ...base, posePath: 'media/poses/pose.json' }),
  } } }, media: { vectors: { 'shape.svg': '<svg/>' }, meshes: { 'bad.ply': 'mesh' }, poses: {
    'pose.json': '{}', 'pose.json.meta.json': '{"mine":true}',
  } } };
  const root = workspace(tree);
  assert.deepEqual(await planVisualArtifactBackfill(root), []);
  assert.equal(await backfillVisualArtifactSidecars(root), 0);
  assert.equal(tree.media.poses['pose.json.meta.json'], '{"mine":true}');
});
