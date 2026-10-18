import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessFileDrafts } from '../src/harnessFileDrafts.ts';

const blank = () => ({ path: '', text: '', basePath: '', baseText: '' });

test('switching projects flushes unsaved file text before restoring another editor', async () => {
  const saved = new Map();
  const store = {
    async fileEditorDraft(project, area) { return saved.get(`${project}:${area}`) || blank(); },
    async saveFileEditorDraft(project, area, draft) { saved.set(`${project}:${area}`, { ...draft }); },
  };
  const manager = new HarnessFileDrafts(error => { throw error; }, 10_000);
  assert.deepEqual(await manager.open(store, 'home', 'files'), blank());
  const edit = { path: 'src/app.ts', text: 'new value', basePath: 'src/app.ts', baseText: 'old value' };
  manager.update(edit);
  assert.deepEqual(await manager.open(store, 'second', 'files'), blank());
  assert.deepEqual(saved.get('home:files'), edit);
  assert.deepEqual(await manager.open(store, 'home', 'files'), edit);
  await manager.clear();
  assert.deepEqual(saved.get('home:files'), blank());
});
