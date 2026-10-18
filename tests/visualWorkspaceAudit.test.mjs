import assert from 'node:assert/strict';
import test from 'node:test';
import { auditVisualWorkspace } from '../src/visualWorkspaceAudit.ts';
import { visualArtifactSidecarPath } from '../src/visualArtifactProvenance.ts';

function workspace(tree) {
  const directory = items => ({
    kind: 'directory',
    async getDirectoryHandle(name) {
      if (!items[name] || typeof items[name] !== 'object') throw new DOMException('Missing', 'NotFoundError');
      return directory(items[name]);
    },
    async getFileHandle(name) {
      if (typeof items[name] !== 'string') throw new DOMException('Missing', 'NotFoundError');
      return { kind: 'file', async getFile() { return new File([items[name]], name); } };
    },
    async *entries() {
      for (const [name, value] of Object.entries(items)) yield [name,
        typeof value === 'string' ? { kind: 'file', async getFile() { return new File([value], name); } } : directory(value)];
    },
  });
  return directory(tree);
}

test('reopened visual report flags its own path and saved output', async () => {
  const report = {
    result: 'passed', outputPath: 'outputs/images/leaf.png',
    modelPackage: { path: 'models/Test', files: [{ path: 'models/Test/weights.onnx', sha256: 'a' }] },
    runtimePackage: { path: 'engines/Test', files: [{ path: 'engines/Test/runtime.wasm', sha256: 'b' }] },
  };
  const root = workspace({ models: { Test: { diagnostics: { 'test-image.json': JSON.stringify(report) } } },
    outputs: { images: { 'leaf.png': 'image' } } });
  const audit = await auditVisualWorkspace(root);
  assert.equal(audit.checkedRecords, 1);
  assert.deepEqual(audit.issues, [
    { artifactPath: 'models/Test/diagnostics/test-image.json', missingPaths: ['models/Test/weights.onnx', 'engines/Test/runtime.wasm'] },
    { artifactPath: 'outputs/images/leaf.png', missingPaths: ['models/Test/weights.onnx', 'engines/Test/runtime.wasm'] },
  ]);
});

test('older visual records without file provenance remain unverified', async () => {
  const root = workspace({ models: { Test: { diagnostics: { 'test-image.json': JSON.stringify({ result: 'passed' }), 'test-text.json': '{}' } } } });
  const audit = await auditVisualWorkspace(root);
  assert.equal(audit.checkedRecords, 0);
  assert.equal(audit.withoutProvenance, 1);
  assert.deepEqual(audit.issues, []);
});

test('mesh formats keep distinct sidecars and each output gets its own warning', async () => {
  assert.equal(visualArtifactSidecarPath('media/meshes/model.ply'), 'media/meshes/model.ply.meta.json');
  assert.equal(visualArtifactSidecarPath('media/meshes/model.glb'), 'media/meshes/model.glb.meta.json');
  const makeSidecar = artifactPath => JSON.stringify({ artifactPath, modelRequired: true,
    modelPackage: { path: 'models/Test', files: [{ path: 'models/Test/weights.onnx', sha256: 'a' }] } });
  const root = workspace({ media: { meshes: {
    'model.ply': 'ply', 'model.glb': 'glb',
    'model.ply.meta.json': makeSidecar('media/meshes/model.ply'),
    'model.glb.meta.json': makeSidecar('media/meshes/model.glb'),
  } } });
  const audit = await auditVisualWorkspace(root);
  assert.equal(audit.checkedRecords, 2);
  assert.ok(audit.issues.some(item => item.artifactPath === 'media/meshes/model.ply'));
  assert.ok(audit.issues.some(item => item.artifactPath === 'media/meshes/model.glb'));
});

test('a conversion with no model dependency is verified without a missing warning', async () => {
  const root = workspace({ media: { meshes: { 'import.glb.meta.json': JSON.stringify({ artifactPath: 'media/meshes/import.glb', modelRequired: false }) } } });
  const audit = await auditVisualWorkspace(root);
  assert.equal(audit.checkedRecords, 1);
  assert.equal(audit.withoutProvenance, 0);
  assert.deepEqual(audit.issues, []);
});
