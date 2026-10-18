import assert from 'node:assert/strict';
import test from 'node:test';
import { saveVisualArtifact } from '../src/visualArtifactProvenance.ts';

function memoryFolder() {
  const files = new Map();
  const directory = prefix => ({
    async getDirectoryHandle(name) { return directory(`${prefix}${name}/`); },
    async getFileHandle(name) {
      const path = `${prefix}${name}`;
      return {
        async createWritable() { return {
          async write(blob) { files.set(path, blob); },
          async close() {},
        }; },
      };
    },
  });
  return { root: directory(''), files };
}

test('a visual output and its sidecar retain independent paths and pinned dependencies', async () => {
  const { root, files } = memoryFolder();
  const modelPackage = { path: 'models/Test', files: [{ path: 'models/Test/weights.onnx', sha256: 'abc' }] };
  await saveVisualArtifact(root, 'media/meshes/sample.glb', new Blob(['mesh']),
    { kind: 'mesh', generatedAt: '2026-10-18T00:00:00Z', modelPackage, modelRequired: true });
  assert.equal(await files.get('media/meshes/sample.glb').text(), 'mesh');
  const sidecar = JSON.parse(await files.get('media/meshes/sample.glb.meta.json').text());
  assert.equal(sidecar.artifactPath, 'media/meshes/sample.glb');
  assert.equal(sidecar.fileBytes, 4);
  assert.deepEqual(sidecar.modelPackage, modelPackage);
});
