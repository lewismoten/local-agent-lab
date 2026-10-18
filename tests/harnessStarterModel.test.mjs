import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readySoleInstalledChatModel, soleInstalledChatModel } from '../src/harnessStarterModel.ts';
import { WLLAMA_ASSETS } from '../src/wllamaEngine.ts';

function directory() {
  const files = new Map();
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
    async getFileHandle(name) {
      if (!files.has(name)) throw new DOMException('Missing', 'NotFoundError');
      return { kind: 'file', getFile: async () => files.get(name) };
    },
    async *entries() {
      for (const [name, file] of files) yield [name, { kind: 'file', getFile: async () => file }];
      for (const [name, dir] of dirs) yield [name, dir];
    },
  };
}

test('startup adopts only one complete chat GGUF and never treats a partial or projector as chat', async () => {
  const root = directory();
  assert.equal(await soleInstalledChatModel(root), null);
  const models = await root.getDirectoryHandle('models', { create: true });
  models.files.set('custom.gguf', new File(['weights'], 'custom.gguf'));
  models.files.set('custom.gguf.download.json', new File(['partial'], 'custom.gguf.download.json'));
  assert.equal(await soleInstalledChatModel(root), null);
  models.files.delete('custom.gguf.download.json');
  models.files.set('custom-mmproj-Q8.gguf', new File(['projector'], 'custom-mmproj-Q8.gguf'));
  assert.equal(await soleInstalledChatModel(root), 'models/custom.gguf');
  models.files.set('second.gguf', new File(['weights'], 'second.gguf'));
  assert.equal(await soleInstalledChatModel(root), null);
  models.files.delete('second.gguf');
  const wrongFolder = await models.getDirectoryHandle('unrelated', { create: true });
  wrongFolder.files.set('hidden.gguf', new File(['weights'], 'hidden.gguf'));
  assert.equal(await soleInstalledChatModel(root), 'models/custom.gguf');
});

test('a truncated catalog GGUF is not offered as the only local chat model', async () => {
  const root = directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  models.files.set('Qwen3-1.7B-Q4_K_M.gguf', new File(['partial'], 'Qwen3-1.7B-Q4_K_M.gguf'));
  assert.equal(await soleInstalledChatModel(root), null);
});

test('startup waits for a valid license and engine before selecting an existing GGUF', async () => {
  const root = directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  models.files.set('custom.gguf', new File(['weights'], 'custom.gguf'));
  assert.equal(await readySoleInstalledChatModel(root), null);
  models.files.set('custom.gguf.LICENSE.txt', new File(['Terms for this custom model'], 'custom.gguf.LICENSE.txt'));
  assert.equal(await readySoleInstalledChatModel(root), null);
  const engines = await root.getDirectoryHandle('engines', { create: true });
  const original = WLLAMA_ASSETS.map(asset => ({ asset, bytes: asset.bytes, sha256: asset.sha256 }));
  try {
    for (const asset of WLLAMA_ASSETS) {
      const data = new TextEncoder().encode(`test ${asset.name}`);
      asset.bytes = data.length;
      asset.sha256 = createHash('sha256').update(data).digest('hex');
      engines.files.set(asset.name, new File([data], asset.name));
    }
    assert.equal(await readySoleInstalledChatModel(root), 'models/custom.gguf');
  } finally {
    for (const item of original) { item.asset.bytes = item.bytes; item.asset.sha256 = item.sha256; }
  }
});
