import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore, openFolderWorkspace } from '../src/harnessStore.ts';
import { addSearchBits, createConversation, createManifest, MESSAGE_CHUNK_SIZE } from '../src/harnessData.ts';
import { shouldMigrateLegacySettings, workspaceSettings } from '../src/harnessSettings.ts';
import { readBlob, writeBlob } from '../src/storage.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() {
    return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} };
  }
}

class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
    return entry;
  }
  async removeEntry(name, options = {}) {
    const entry = this.children.get(name);
    if (!entry) throw new DOMException('Missing entry', 'NotFoundError');
    if (entry.kind === 'directory' && entry.children.size && !options.recursive) throw new DOMException('Directory is not empty', 'InvalidModificationError');
    this.children.delete(name);
  }
}

const message = (index, role = 'user') => ({ id: `message-${index}`, role, content: `Message ${index}`, createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString() });

test('opening a newer workspace leaves its manifest intact', async () => {
  const folder = new MemoryDirectory();
  const path = 'harness/workspace.json';
  const original = JSON.stringify({ version: 2, id: 'future-workspace', projects: [{ id: 'home' }] });
  await writeBlob(folder, path, new Blob([original]));
  await assert.rejects(openFolderWorkspace(folder), /unsupported format/);
  assert.equal(await (await readBlob(folder, path)).text(), original);
});

test('an existing malformed workspace is not replaced with a new one', async () => {
  const folder = new MemoryDirectory();
  const path = 'harness/workspace.json';
  await writeBlob(folder, path, new Blob(['null']));
  await assert.rejects(openFolderWorkspace(folder), /unsupported format/);
  assert.equal(await (await readBlob(folder, path)).text(), 'null');

  const store = new HarnessStore('existing-workspace', folder);
  await writeBlob(folder, path, new Blob([JSON.stringify({ version: 1, id: 'existing-workspace', projects: [] })]));
  await assert.rejects(store.manifest(), /unsupported format/);
  assert.deepEqual(JSON.parse(await (await readBlob(folder, path)).text()).projects, []);
});

test('an older workspace opens with missing optional settings defaulted in memory', async () => {
  const folder = new MemoryDirectory();
  const path = 'harness/workspace.json';
  const original = createManifest('older-workspace');
  delete original.modelPreferences;
  delete original.identities;
  delete original.agents;
  delete original.workspaceToolAccess;
  const raw = JSON.stringify(original);
  await writeBlob(folder, path, new Blob([raw]));
  const opened = await openFolderWorkspace(folder);
  assert.equal(opened.manifest.id, 'older-workspace');
  assert.deepEqual(opened.manifest.modelPreferences.chat, []);
  assert.ok(opened.manifest.identities.length);
  assert.deepEqual(opened.manifest.agents, []);
  assert.equal(opened.manifest.workspaceToolAccess, 'full');
  assert.equal(await (await readBlob(folder, path)).text(), raw);
});

test('workspace model access stays read-only after reopening the same portable folder', async () => {
  const folder = new MemoryDirectory();
  const opened = await openFolderWorkspace(folder);
  await opened.store.updateManifest(current => ({ ...current, workspaceToolAccess: 'read-only' }));
  const reopened = await openFolderWorkspace(folder);
  assert.equal(reopened.manifest.workspaceToolAccess, 'read-only');
});

test('recovers a chunk write that was interrupted before conversation metadata was saved', async () => {
  const store = new HarnessStore('recovery-test', new MemoryDirectory());
  const saved = createConversation('home');
  const updated = await store.appendMessage(saved, message(0));
  const recovered = await store.recoverConversation(saved);
  assert.equal(recovered.messageCount, 1);
  assert.equal(recovered.preview, 'Message 0');
  assert.deepEqual((await store.messages(recovered)).map(item => item.content), ['Message 0']);
  assert.deepEqual(await store.recoverConversation(updated), updated);
  const next = await store.appendMessage(recovered, message(1, 'assistant'));
  assert.equal(next.messageCount, 2);
});

test('response diagnostics stay beside their message when a conversation is copied', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('diagnostic-copy', folder);
  const report = { version: 1, createdAt: '2026-01-01T00:00:00Z', model: { provider: 'browser', model: 'test' }, input: { system: 'Be concise.', turns: [{ role: 'user', content: 'Hello' }], note: 'Initial prompt.' }, output: { text: 'Hi', thinking: null, toolEvents: [] }, usage: { inputTokens: 5, outputTokens: 1, elapsedMs: 200, observedTokensPerSecond: 5 }, sampling: { seed: null, temperature: null, note: 'Runtime default.' } };
  const source = createConversation('home');
  await store.saveResponseDiagnostic('home', source.id, 'answer-1', report);
  const first = await store.appendMessage(source, { ...message(0, 'assistant'), id: 'answer-1', hasDiagnostics: true });
  const report2 = { ...report, version: 2, rounds: [{ request: { model: 'test', messages: [{ role: 'user', content: 'Hello' }] }, response: { text: 'Hi' } }] };
  await store.saveResponseDiagnostic('home', source.id, 'answer-2', report2);
  const saved = await store.appendMessage(first, { ...message(1, 'assistant'), id: 'answer-2', hasDiagnostics: true });
  const copied = await store.copyConversation(saved, 'second-project');
  assert.deepEqual(await store.responseDiagnostic('second-project', copied.id, 'answer-1'), report);
  assert.deepEqual(await store.responseDiagnostic('second-project', copied.id, 'answer-2'), report2);
  assert.ok((await store.messages(copied)).every(item => item.hasDiagnostics));
});

test('completed portable history packs survive reopen, search, and copying', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('packed-history', folder);
  const source = createConversation('home');
  const total = MESSAGE_CHUNK_SIZE * 16;
  for (let number = 0; number < 16; number++) {
    const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, offset) => {
      const seq = number * MESSAGE_CHUNK_SIZE + offset;
      return { ...message(seq), seq, content: seq === 12 ? 'old unique fact' : `Message ${seq}` };
    });
    await writeBlob(folder, `harness/projects/home/sessions/${source.id}/chunks/${String(number).padStart(6, '0')}.json`, new Blob([JSON.stringify(chunk)]));
  }
  const meta = { ...source, messageCount: total };
  const packed = await store.packCompletedChunks(meta);
  assert.deepEqual(packed, { groups: 1, removed: 16 });
  await assert.rejects(readBlob(folder, `harness/projects/home/sessions/${source.id}/chunks/000000.json`), { name: 'NotFoundError' });
  assert.ok((await readBlob(folder, `harness/projects/home/sessions/${source.id}/packs/000000.json`)).size > 0);
  const reopened = new HarnessStore('packed-history', folder);
  assert.equal((await reopened.messages(meta, 0, 1))[0].content, 'Message 0');
  assert.equal((await reopened.searchMessages(meta, 'old unique fact'))[0].seq, 12);
  await assert.rejects(reopened.copyConversation(meta, 'stopped', done => { if (done === 1) throw new Error('Stop packed copy'); }), /Stop packed copy/);
  const stoppedSessions = await folder.getDirectoryHandle('harness').then(d => d.getDirectoryHandle('projects')).then(d => d.getDirectoryHandle('stopped')).then(d => d.getDirectoryHandle('sessions'));
  assert.equal(stoppedSessions.children.size, 0);
  const copied = await reopened.copyConversation(meta, 'copy');
  assert.equal((await reopened.messages(copied, total - 1, total))[0].seq, total - 1);
  assert.ok((await readBlob(folder, `harness/projects/copy/sessions/${copied.id}/packs/000000.json`)).size > 0);
});

test('an interrupted pack cleanup keeps messages readable and can be retried', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('pack-recovery', folder);
  const source = createConversation('home');
  const total = MESSAGE_CHUNK_SIZE * 16;
  for (let number = 0; number < 16; number++) {
    const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, offset) => {
      const seq = number * MESSAGE_CHUNK_SIZE + offset;
      return { ...message(seq), seq };
    });
    await writeBlob(folder, `harness/projects/home/sessions/${source.id}/chunks/${String(number).padStart(6, '0')}.json`, new Blob([JSON.stringify(chunk)]));
  }
  const chunksDirectory = await folder.getDirectoryHandle('harness').then(d => d.getDirectoryHandle('projects')).then(d => d.getDirectoryHandle('home')).then(d => d.getDirectoryHandle('sessions')).then(d => d.getDirectoryHandle(source.id)).then(d => d.getDirectoryHandle('chunks'));
  const remove = chunksDirectory.removeEntry.bind(chunksDirectory);
  chunksDirectory.removeEntry = async name => { if (name === '000001.json') throw new DOMException('USB removal interrupted cleanup', 'NotAllowedError'); return remove(name); };
  const meta = { ...source, messageCount: total };
  await assert.rejects(store.packCompletedChunks(meta), /USB removal interrupted cleanup/);
  const reopened = new HarnessStore('pack-recovery', folder);
  assert.equal((await reopened.messages(meta)).length, total);
  chunksDirectory.removeEntry = remove;
  const remainingPath = `harness/projects/home/sessions/${source.id}/chunks/000001.json`;
  const original = await (await readBlob(folder, remainingPath)).text();
  const altered = JSON.parse(original);
  altered[0].content = 'Changed after packing';
  await writeBlob(folder, remainingPath, new Blob([JSON.stringify(altered)]));
  await assert.rejects(reopened.packCompletedChunks(meta), /differs from its pack/);
  await writeBlob(folder, remainingPath, new Blob([original]));
  assert.deepEqual(await reopened.packCompletedChunks(meta), { groups: 1, removed: 15 });
  assert.equal((await new HarnessStore('pack-recovery', folder).messages(meta)).length, total);
});

test('a completed message group packs automatically after the session index is saved', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('automatic-pack', folder);
  const source = createConversation('home');
  const finalSeq = MESSAGE_CHUNK_SIZE * 16 - 1;
  for (let number = 0; number < 16; number++) {
    const chunk = Array.from({ length: number === 15 ? MESSAGE_CHUNK_SIZE - 1 : MESSAGE_CHUNK_SIZE }, (_, offset) => {
      const seq = number * MESSAGE_CHUNK_SIZE + offset;
      return { ...message(seq), seq };
    });
    await writeBlob(folder, `harness/projects/home/sessions/${source.id}/chunks/${String(number).padStart(6, '0')}.json`, new Blob([JSON.stringify(chunk)]));
  }
  const before = { ...source, messageCount: finalSeq };
  await store.updateSessions('home', () => [before]);
  const result = await store.appendConversationMessage(before, message(finalSeq));
  assert.equal(result.meta.messageCount, finalSeq + 1);
  assert.ok((await readBlob(folder, `harness/projects/home/sessions/${source.id}/packs/000000.json`)).size > 0);
  const reopened = new HarnessStore('automatic-pack', folder);
  assert.equal((await reopened.messages(result.meta, finalSeq, finalSeq + 1))[0].seq, finalSeq);
  const next = await reopened.appendMessage(result.meta, message(finalSeq + 1));
  assert.equal((await reopened.messages(next, finalSeq, finalSeq + 2)).length, 2);
});

test('recovers a trailing message after crossing a chunk boundary', async () => {
  const store = new HarnessStore('boundary-test', new MemoryDirectory());
  let saved = createConversation('home');
  for (let index = 0; index < MESSAGE_CHUNK_SIZE; index++) saved = await store.appendMessage(saved, message(index));
  await store.appendMessage(saved, message(MESSAGE_CHUNK_SIZE));
  const recovered = await store.recoverConversation(saved);
  assert.equal(recovered.messageCount, MESSAGE_CHUNK_SIZE + 1);
  assert.equal((await store.recentMessages(recovered, 1))[0]?.content, `Message ${MESSAGE_CHUNK_SIZE}`);
});

test('does not count a noncontiguous trailing record', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('gap-test', folder);
  const saved = createConversation('home');
  let chunk = folder;
  for (const part of ['harness', 'projects', 'home', 'sessions', saved.id, 'chunks']) chunk = await chunk.getDirectoryHandle(part, { create: true });
  const file = await chunk.getFileHandle('000000.json', { create: true });
  const writer = await file.createWritable();
  await writer.write(new Blob([JSON.stringify([{ ...message(2), seq: 2 }])]));
  await writer.close();
  assert.equal((await store.recoverConversation(saved)).messageCount, 0);
});

test('missing archived messages stop a read before they can be compacted away', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('missing-history-test', folder);
  let saved = createConversation('home');
  for (let index = 0; index < MESSAGE_CHUNK_SIZE + 1; index++) saved = await store.appendMessage(saved, message(index));
  let chunks = folder;
  for (const part of ['harness', 'projects', 'home', 'sessions', saved.id, 'chunks']) chunks = await chunks.getDirectoryHandle(part);
  await chunks.removeEntry('000000.json');
  await assert.rejects(store.messages(saved, 0, saved.messageCount), /history is incomplete/);
  assert.deepEqual((await store.messages(saved, MESSAGE_CHUNK_SIZE)).map(item => item.seq), [MESSAGE_CHUNK_SIZE]);
});

test('full-text search reports a missing candidate chunk instead of silently returning no match', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('missing-search-test', folder);
  const saved = await store.appendMessage(createConversation('home'), { ...message(0), content: 'A silver comet crosses the sky.' });
  let chunks = folder;
  for (const part of ['harness', 'projects', 'home', 'sessions', saved.id, 'chunks']) chunks = await chunks.getDirectoryHandle(part);
  await chunks.removeEntry('000000.json');
  await assert.rejects(store.searchMessages(saved, 'silver'), /history is incomplete/);
});

test('a short-term search upgrades a full legacy chunk after verifying original messages', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('short-search-test', folder);
  const initial = createConversation('home');
  const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, index) => ({ ...message(index), seq: index, content: index === 7 ? 'AI planning note' : `Message ${index}` }));
  const root = `harness/projects/home/sessions/${initial.id}`;
  await writeBlob(folder, `${root}/chunks/000000.json`, new Blob([JSON.stringify(chunk)]));
  const emptyV3 = 'v3:' + btoa(String.fromCharCode(...new Uint8Array(256)));
  const legacy = chunk.reduce((bits, item) => addSearchBits(bits, item.content), emptyV3);
  await writeBlob(folder, `${root}/search/000000.json`, new Blob([JSON.stringify({ version: 1, chunks: [legacy] })]));
  const meta = { ...initial, messageCount: MESSAGE_CHUNK_SIZE };
  assert.deepEqual((await store.searchMessages(meta, 'AI')).map(item => item.seq), [7]);
  const upgraded = JSON.parse(await (await readBlob(folder, `${root}/search/000000.json`)).text());
  assert.match(upgraded.chunks[0], /^v6:/);
  assert.deepEqual(await store.searchMessages(meta, 'ZZ'), []);
});

test('search upgrades a saturated small index after reading a long chunk', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('adaptive-search-test', folder);
  const initial = createConversation('home');
  const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, index) => ({ ...message(index), seq: index, content: Array.from({ length: 100 }, (_, word) => `token${(index * 100 + word).toString(36)}`).join(' ') }));
  const root = `harness/projects/home/sessions/${initial.id}`;
  await writeBlob(folder, `${root}/chunks/000000.json`, new Blob([JSON.stringify(chunk)]));
  const oldFull = 'v4:' + btoa(String.fromCharCode(...new Uint8Array(256).fill(255)));
  await writeBlob(folder, `${root}/search/000000.json`, new Blob([JSON.stringify({ version: 1, chunks: [oldFull] })]));
  const meta = { ...initial, messageCount: MESSAGE_CHUNK_SIZE };
  assert.deepEqual(await store.searchMessages(meta, 'cosmicstarship'), []);
  const upgraded = JSON.parse(await (await readBlob(folder, `${root}/search/000000.json`)).text());
  assert.ok(atob(upgraded.chunks[0].slice(3)).length > 256);
  assert.deepEqual(await store.searchMessages(meta, 'cosmicstarship'), []);
});

test('search finds a saved file action through a legacy content-only index', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('legacy-tool-search-test', folder);
  const initial = createConversation('home');
  const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, index) => ({ ...message(index), seq: index,
    content: `Ordinary response ${index}`,
    toolEvents: index === 9 ? ['write_file: Wrote repositories/demo/src/cache.ts (120 bytes).', 'read_file: secret notes'] : [],
  }));
  const root = `harness/projects/home/sessions/${initial.id}`;
  await writeBlob(folder, `${root}/chunks/000000.json`, new Blob([JSON.stringify(chunk)]));
  const legacy = chunk.reduce((bits, item) => addSearchBits(bits, item.content), '');
  const oldV4 = `v4:${legacy.slice(3)}`;
  await writeBlob(folder, `${root}/search/000000.json`, new Blob([JSON.stringify({ version: 1, chunks: [oldV4] })]));
  const meta = { ...initial, messageCount: MESSAGE_CHUNK_SIZE, searchBits: oldV4 };
  assert.deepEqual((await store.searchMessages(meta, 'cache.ts')).map(item => item.seq), [9]);
  assert.deepEqual(await store.searchMessages(meta, 'secret notes'), []);
  const upgraded = JSON.parse(await (await readBlob(folder, `${root}/search/000000.json`)).text());
  assert.match(upgraded.chunks[0], /^v6:/);
});

test('search finds repository initialization even when an older index omitted it', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('git-init-search-test', folder);
  const initial = createConversation('home');
  const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, index) => ({ ...message(index), seq: index,
    content: `Ordinary response ${index}`,
    toolEvents: index === 4 ? ['git_init: Initialized Git in Demo.'] : [],
  }));
  const root = `harness/projects/home/sessions/${initial.id}`;
  await writeBlob(folder, `${root}/chunks/000000.json`, new Blob([JSON.stringify(chunk)]));
  const oldIndex = 'v5:' + btoa(String.fromCharCode(...new Uint8Array(256)));
  await writeBlob(folder, `${root}/search/000000.json`, new Blob([JSON.stringify({ version: 1, chunks: [oldIndex] })]));
  const meta = { ...initial, messageCount: MESSAGE_CHUNK_SIZE, searchBits: oldIndex };
  assert.deepEqual((await store.searchMessages(meta, 'Initialized Git')).map(item => item.seq), [4]);
  const upgraded = JSON.parse(await (await readBlob(folder, `${root}/search/000000.json`)).text());
  assert.match(upgraded.chunks[0], /^v6:/);
});

test('conversation search pages through older matches without rereading displayed hits', async () => {
  const store = new HarnessStore('paged-search-test', new MemoryDirectory());
  let meta = createConversation('home');
  for (let index = 0; index < 31; index++) meta = await store.appendMessage(meta, { ...message(index), content: `Needle in message ${index}` });
  const first = await store.searchMessages(meta, 'needle', 12);
  const second = await store.searchMessages(meta, 'needle', 12, first.at(-1).seq);
  const third = await store.searchMessages(meta, 'needle', 12, second.at(-1).seq);
  assert.deepEqual([...first, ...second, ...third].map(item => item.seq), Array.from({ length: 31 }, (_, index) => 30 - index));
  assert.deepEqual(await store.searchMessages(meta, 'needle', 12, third.at(-1).seq), []);
});

test('workspace model choices travel with the folder without API keys', async () => {
  const folder = new MemoryDirectory();
  const first = new HarnessStore('portable-test', folder);
  const profile = { id: 'browser', label: 'Browser', provider: 'browser', model: 'models/Qwen3.gguf', endpoint: '', apiKey: 'private-key', effort: 'default', thinkingTokens: 0, maxOutputTokens: 1024, contextWindow: 4096 };
  const image = { preset: 'openai', provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'image-key' };
  await first.saveSettings(workspaceSettings([profile], 'browser', image, 72));
  const second = new HarnessStore('portable-test', folder);
  const loaded = await second.settings();
  assert.equal(loaded?.profiles[0]?.model, profile.model);
  assert.equal(loaded?.selectedProfileId, 'browser');
  assert.equal(loaded?.imageConfig.preset, 'openai');
  assert.equal(loaded?.compactionAt, 72);
  assert.equal(loaded?.profiles[0]?.apiKey, '');
  assert.equal(loaded?.imageConfig.apiKey, '');
  const raw = await (await (await folder.getDirectoryHandle('harness')).getFileHandle('settings.json')).getFile();
  assert.equal((await raw.text()).includes('private-key'), false);
  assert.equal((await raw.text()).includes('image-key'), false);
});

test('legacy machine profiles migrate only into the browser workspace', () => {
  assert.equal(shouldMigrateLegacySettings('browser-home', false, true), true);
  assert.equal(shouldMigrateLegacySettings('portable-usb', false, true), false);
  assert.equal(shouldMigrateLegacySettings('browser-home', true, true), false);
  assert.equal(shouldMigrateLegacySettings('browser-home', false, false), false);
});

test('chat drafts stay with their conversation in the portable workspace', async () => {
  const folder = new MemoryDirectory();
  const first = new HarnessStore('draft-test', folder);
  await first.saveDraft('home', 'conversation-a', 'Unsent code idea');
  await first.saveDraft('home', 'conversation-b', 'A separate question');
  const reopened = new HarnessStore('draft-test', folder);
  assert.equal(await reopened.draft('home', 'conversation-a'), 'Unsent code idea');
  assert.equal(await reopened.draft('home', 'conversation-b'), 'A separate question');
  assert.equal(await reopened.draft('home', 'new'), '');
  await reopened.saveDraft('home', 'conversation-a', '');
  assert.equal(await first.draft('home', 'conversation-a'), '');
});

test('file editor drafts stay in their project and area across workspace reopen', async () => {
  const folder = new MemoryDirectory();
  const first = new HarnessStore('editor-draft-test', folder);
  const draft = { path: 'src/app.ts', text: 'export const value = 2;', basePath: 'src/app.ts', baseText: 'export const value = 1;' };
  await first.saveFileEditorDraft('home', 'files', draft);
  const reopened = new HarnessStore('editor-draft-test', folder);
  assert.deepEqual(await reopened.fileEditorDraft('home', 'files'), draft);
  assert.deepEqual(await reopened.fileEditorDraft('home', 'library'), { path: '', text: '', basePath: '', baseText: '' });
  assert.deepEqual(await reopened.fileEditorDraft('other', 'files'), { path: '', text: '', basePath: '', baseText: '' });
  await reopened.saveFileEditorDraft('home', 'files', { path: '', text: '', basePath: '', baseText: '' });
  assert.equal((await first.fileEditorDraft('home', 'files')).text, '');
});

test('copying a conversation carries its unsent draft to the destination project', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('draft-copy-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.saveDraft('home', source.id, 'Continue this line of research');
  const copied = await store.copyConversation(source, 'second-project');
  assert.notEqual(copied.id, source.id);
  assert.equal(await store.draft('second-project', copied.id), 'Continue this line of research');
  assert.deepEqual((await store.messages(copied)).map(item => item.content), ['Message 0']);
  assert.equal(await store.draft('home', source.id), 'Continue this line of research');
});

test('copying a conversation keeps tool choices but resets remembered approvals', async () => {
  const store = new HarnessStore('permission-copy-test', new MemoryDirectory());
  const source = { ...createConversation('home'), toolProfileId: 'review', toolPermissions: { read_file: 'once' }, approvedTools: ['read_file'] };
  const copied = await store.copyConversation(source, 'second-project');
  assert.equal(copied.toolProfileId, 'review');
  assert.deepEqual(copied.toolPermissions, { read_file: 'once' });
  assert.deepEqual(copied.approvedTools, []);
});

test('a stale conversation cannot append after another tab changes its tool rules', async () => {
  const store = new HarnessStore('permission-stale-test', new MemoryDirectory());
  const original = createConversation('home');
  await store.updateSessions('home', () => [original]);
  await store.updateSessions('home', sessions => sessions.map(item => ({ ...item, toolPermissions: { write_file: 'deny' } })));
  await assert.rejects(store.appendConversationMessage(original, message(0)), /changed in another tab/);
});

test('stopping a large conversation copy removes partial destination chunks and preserves the source', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('copy-stop-test', folder);
  let source = createConversation('home');
  for (let index = 0; index < MESSAGE_CHUNK_SIZE + 2; index++) source = await store.appendMessage(source, message(index));
  await store.saveDraft('home', source.id, 'Keep this draft');
  const controller = new AbortController();
  await assert.rejects(store.copyConversation(source, 'second-project', done => {
    if (done === 1) controller.abort(new DOMException('Copy stopped.', 'AbortError'));
  }, controller.signal), /Copy stopped/);
  const destination = await (await (await folder.getDirectoryHandle('harness')).getDirectoryHandle('projects')).getDirectoryHandle('second-project');
  const sessions = await destination.getDirectoryHandle('sessions');
  assert.equal(sessions.children.size, 0);
  assert.equal(await store.draft('home', source.id), 'Keep this draft');
  assert.equal((await store.messages(source)).length, MESSAGE_CHUNK_SIZE + 2);
});

test('stopping after draft transfer removes the copied draft too', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('copy-draft-stop-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.saveDraft('home', source.id, 'Unsent work');
  const controller = new AbortController();
  const saveDraft = store.saveDraft.bind(store);
  store.saveDraft = async (projectId, sessionId, text) => {
    await saveDraft(projectId, sessionId, text);
    if (projectId === 'second-project') controller.abort(new DOMException('Copy stopped.', 'AbortError'));
  };
  await assert.rejects(store.copyConversation(source, 'second-project', undefined, controller.signal), /Copy stopped/);
  const destination = await (await (await folder.getDirectoryHandle('harness')).getDirectoryHandle('projects')).getDirectoryHandle('second-project');
  assert.equal((await destination.getDirectoryHandle('sessions')).children.size, 0);
  assert.equal((await destination.getDirectoryHandle('drafts')).children.size, 0);
  assert.equal(await store.draft('home', source.id), 'Unsent work');
});

test('a move keeps a source that gained a message during the copy', async () => {
  const store = new HarnessStore('move-conflict-test', new MemoryDirectory());
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.updateSessions('home', () => [source]);
  const copied = await store.copyConversation(source, 'second-project');
  await store.updateSessions('second-project', () => [copied]);
  const newer = await store.appendMessage(source, message(1));
  await store.updateSessions('home', () => [newer]);
  await assert.rejects(store.removeMovedSource(source, copied), /source was kept/);
  assert.equal((await store.sessions('home'))[0].messageCount, 2);
  assert.equal((await store.sessions('second-project'))[0].messageCount, 1);
  assert.deepEqual((await store.messages(newer)).map(item => item.content), ['Message 0', 'Message 1']);
});

test('a move detects a chunk written before the source metadata caught up', async () => {
  const store = new HarnessStore('move-tail-test', new MemoryDirectory());
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.updateSessions('home', () => [source]);
  await store.appendMessage(source, message(1));
  await assert.rejects(store.removeMovedSource(source, source), /source was kept/);
  assert.equal((await store.sessions('home'))[0].messageCount, 1);
  assert.equal((await store.recoverConversation(source)).messageCount, 2);
});

test('a move removes an unchanged source after copying', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('move-success-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  const artwork = await store.saveAvatarAsset(new Blob(['icon'], { type: 'image/png' }), { title: 'Conversation icon', tags: ['Conversation'], source: 'uploaded' });
  await store.saveSurfaceArtwork(`conversation:${source.id}`, artwork.id, 'A small icon');
  await store.updateSessions('home', () => [source]);
  const copied = await store.copyConversation(source, 'second-project');
  await store.updateSessions('second-project', () => [copied]);
  assert.equal(await store.removeMovedSource(source, copied), null);
  assert.deepEqual(await store.sessions('home'), []);
  assert.deepEqual((await store.messages(copied)).map(item => item.content), ['Message 0']);
  await assert.rejects(readBlob(folder, `harness/projects/home/sessions/${source.id}/chunks/000000.json`), /Missing/);
  const icons = (await store.surfaceArtwork()).items;
  assert.equal(icons[`conversation:${source.id}`], undefined);
  assert.equal(icons[`conversation:${copied.id}`].assetId, artwork.id);
  assert.ok(await store.avatarAsset(artwork.id));
});

test('a move preserves its destination when old source file cleanup fails', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('move-cleanup-failure', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.updateSessions('home', () => [source]);
  const copied = await store.copyConversation(source, 'second-project');
  await store.updateSessions('second-project', () => [copied]);
  const sessions = await folder.getDirectoryHandle('harness').then(dir => dir.getDirectoryHandle('projects')).then(dir => dir.getDirectoryHandle('home')).then(dir => dir.getDirectoryHandle('sessions'));
  sessions.removeEntry = async () => { throw new DOMException('Drive became read-only', 'NoModificationAllowedError'); };
  assert.match(await store.removeMovedSource(source, copied), /Drive became read-only/);
  assert.deepEqual(await store.sessions('home'), []);
  assert.deepEqual((await store.messages(copied)).map(item => item.content), ['Message 0']);
});

test('a move keeps the source if another tab removes the destination before confirmation', async () => {
  const store = new HarnessStore('move-destination-conflict', new MemoryDirectory());
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.updateSessions('home', () => [source]);
  const copied = await store.copyConversation(source, 'second-project');
  await store.updateSessions('second-project', () => [copied]);
  await store.updateSessions('second-project', () => []);
  await assert.rejects(store.removeMovedSource(source, copied), /destination conversation changed.*source was kept/i);
  assert.deepEqual((await store.messages(source)).map(item => item.content), ['Message 0']);
  assert.equal((await store.sessions('home'))[0].id, source.id);
});

test('two tabs cannot overwrite the same conversation message', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const tails = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name, callback) {
      const task = (tails.get(name) || Promise.resolve()).then(callback);
      tails.set(name, task.catch(() => {}));
      return task;
    },
  } } });
  try {
    const folder = new MemoryDirectory();
    const first = new HarnessStore('append-tabs-test', folder);
    const second = new HarnessStore('append-tabs-test', folder);
    const source = createConversation('home');
    await first.updateSessions('home', () => [source]);
    const results = await Promise.allSettled([
      first.appendConversationMessage(source, message(0)),
      second.appendConversationMessage(source, message(1)),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /changed in another tab/);
    const latest = (await first.sessions('home'))[0];
    assert.equal(latest.messageCount, 1);
    assert.equal((await first.messages(latest)).length, 1);
    const retried = await second.appendConversationMessage(latest, message(2));
    assert.equal(retried.meta.messageCount, 2);
    assert.deepEqual((await first.messages(retried.meta)).map(item => item.seq), [0, 1]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('memory updates from two tabs keep independent notes', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const tails = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name, callback) {
      const task = (tails.get(name) || Promise.resolve()).then(callback);
      tails.set(name, task.catch(() => {}));
      return task;
    },
  } } });
  try {
    const folder = new MemoryDirectory();
    const first = new HarnessStore('memory-tabs-test', folder);
    const second = new HarnessStore('memory-tabs-test', folder);
    const record = id => ({ id, scope: 'global', ownerId: '', title: id, content: id, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    await Promise.all([
      first.updateMemory(current => [...current, record('first')]),
      second.updateMemory(current => [...current, record('second')]),
    ]);
    assert.deepEqual((await first.memory()).map(item => item.id), ['first', 'second']);
    await first.updateMemory(current => current.filter(item => item.id !== 'first'));
    assert.deepEqual((await second.memory()).map(item => item.id), ['second']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('copying a conversation preserves memory added during transfer', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('memory-copy-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  const record = id => ({ id, scope: 'global', ownerId: '', title: id, content: id, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  await store.updateMemory(() => [{ ...record('source-note'), scope: 'session', ownerId: source.id }]);
  const copied = await store.copyConversation(source, 'second-project', async () => {
    await store.updateMemory(current => [...current, record('other-tab-note')]);
  });
  const notes = await store.memory();
  assert.ok(notes.some(item => item.id === 'other-tab-note'));
  assert.ok(notes.some(item => item.scope === 'session' && item.ownerId === copied.id));
});

test('stopping after copied memories are written removes the incomplete copy and its memories', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('memory-copy-stop-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.updateMemory(() => [{ id: 'source-note', scope: 'session', ownerId: source.id, title: 'Note', content: 'Keep me', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  const controller = new AbortController();
  const originalUpdate = store.updateMemory.bind(store);
  store.updateMemory = async change => {
    const result = await originalUpdate(change);
    if (!controller.signal.aborted && result.some(record => record.scope === 'session' && record.ownerId !== source.id)) controller.abort(new DOMException('Copy stopped.', 'AbortError'));
    return result;
  };
  await assert.rejects(store.copyConversation(source, 'second-project', undefined, controller.signal), /Copy stopped/);
  assert.deepEqual((await store.memory()).map(record => record.id), ['source-note']);
  const destination = await (await (await folder.getDirectoryHandle('harness')).getDirectoryHandle('projects')).getDirectoryHandle('second-project');
  assert.equal((await destination.getDirectoryHandle('sessions')).children.size, 0);
  assert.deepEqual((await store.messages(source)).map(item => item.content), ['Message 0']);
});

test('a destination index failure can discard an unpublished copy without touching the source', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('unpublished-copy-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  await store.saveDraft('home', source.id, 'Unsent work');
  await store.updateMemory(() => [{ id: 'source-note', scope: 'session', ownerId: source.id, title: 'Note', content: 'Keep me', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  const copied = await store.copyConversation(source, 'second-project');
  assert.equal(await store.discardUnlistedCopy(copied), true);
  assert.deepEqual((await store.memory()).map(record => record.id), ['source-note']);
  await assert.rejects(readBlob(folder, `harness/projects/second-project/sessions/${copied.id}/chunks/000000.json`), /NotFoundError/);
  assert.equal(await store.draft('second-project', copied.id), '');
  assert.equal(await store.draft('home', source.id), 'Unsent work');
  assert.deepEqual((await store.messages(source)).map(item => item.content), ['Message 0']);
});

test('a published destination copy is preserved if confirmation fails', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('published-copy-test', folder);
  const source = await store.appendMessage(createConversation('home'), message(0));
  const copied = await store.copyConversation(source, 'second-project');
  await store.updateSessions('second-project', () => [copied]);
  assert.equal(await store.discardUnlistedCopy(copied), false);
  assert.deepEqual((await store.messages(copied)).map(item => item.content), ['Message 0']);
});

test('an unknown settings version is not replaced with defaults', async () => {
  const folder = new MemoryDirectory();
  const harness = await folder.getDirectoryHandle('harness', { create: true });
  const file = await harness.getFileHandle('settings.json', { create: true });
  const writer = await file.createWritable();
  await writer.write(new Blob(['{"version":2,"profiles":[]}']));
  await writer.close();
  await assert.rejects(new HarnessStore('future-test', folder).settings(), /unsupported format/);
  assert.equal(await (await file.getFile()).text(), '{"version":2,"profiles":[]}');
});

test('manifest changes from two tabs keep both edits', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const tails = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name, callback) {
      const task = (tails.get(name) || Promise.resolve()).then(callback);
      tails.set(name, task.catch(() => {}));
      return task;
    },
  } } });
  try {
    const folder = new MemoryDirectory();
    const first = new HarnessStore('shared-manifest', folder);
    const second = new HarnessStore('shared-manifest', folder);
    await first.manifest();
    await Promise.all([
      first.updateManifest(current => ({ ...current, name: 'Renamed workspace' })),
      second.updateManifest(current => ({ ...current, projects: [...current.projects, { ...current.projects[0], id: 'second' }] })),
    ]);
    const saved = await first.manifest();
    assert.equal(saved.name, 'Renamed workspace');
    assert.deepEqual(saved.projects.map(project => project.id), ['home', 'second']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});
