import assert from 'node:assert/strict';
import test from 'node:test';
import { missingVisualDependencies, visualDependencyPaths } from '../src/visualDependencies.ts';

const model = { path: 'models/Test', files: [
  { path: 'models/Test/weights.onnx', sha256: 'a' },
  { path: 'models/Test/config.json', sha256: 'b' },
] };
const engine = { path: 'engines/Test', files: [{ path: 'engines/Test/runtime.wasm', sha256: 'c' }] };

function folderWith(paths, denied = false) {
  const files = new Set(paths);
  const directory = path => ({
    async getDirectoryHandle(name) { return directory(`${path}${name}/`); },
    async getFileHandle(name) {
      if (denied) throw new DOMException('Read denied', 'NotAllowedError');
      if (!files.has(`${path}${name}`)) throw new DOMException('Missing', 'NotFoundError');
      return { async getFile() { return new File(['ok'], name); } };
    },
  });
  return directory('');
}

test('collects unique relative model and engine paths from saved visual provenance', () => {
  const report = { modelPackage: model, runtimePackage: engine, inputImageProvenance: { modelPackage: model } };
  assert.deepEqual(visualDependencyPaths(report), [
    'models/Test/weights.onnx', 'models/Test/config.json', 'engines/Test/runtime.wasm',
  ]);
});

test('reports only missing referenced files without reading model bytes', async () => {
  const report = { modelPackage: model, runtimePackage: engine };
  const folder = folderWith(['models/Test/weights.onnx', 'engines/Test/runtime.wasm']);
  assert.deepEqual(await missingVisualDependencies(folder, report), ['models/Test/config.json']);
});

test('does not call a permission failure a missing model', async () => {
  await assert.rejects(missingVisualDependencies(folderWith([], true), { modelPackage: model }),
    error => error instanceof DOMException && error.name === 'NotAllowedError');
});
