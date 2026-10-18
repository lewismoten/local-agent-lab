import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { createConversation } from '../src/harnessData.ts';
import { browserTopicTools } from '../src/harnessTopicTools.ts';
import { selectHarnessToolDefinitions } from '../src/harnessToolSelection.ts';
import { discoverToolCategory } from '../src/harnessToolDiscovery.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
}

const scope = { projects: [{ id: 'home', name: 'Home' }], defaultProjectId: 'home', workspaceAccess: false };

test('topic tools list scoped tags and point to matching conversation chapters', async () => {
  const store = new HarnessStore('topic-tools', new MemoryDirectory());
  const first = { ...createConversation('home'), title: 'Parser work', tags: ['TypeScript', 'Parser'], updatedAt: '2026-10-18T14:00:00Z' };
  const second = { ...createConversation('home'), title: 'Review work', tags: ['typescript'], updatedAt: '2026-10-18T15:00:00Z', segments: [{
    id: 'part-1', chapterId: 'chapter-1', title: 'Parser review', summary: 'Checked the parser.', tags: ['Parser'],
    startSeq: 14, endSeq: 19, startAt: '2026-10-18T13:00:00Z', endAt: '2026-10-18T14:00:00Z',
  }] };
  const secret = { ...createConversation('private'), title: 'Hidden work', tags: ['Parser'] };
  await store.updateSessions('home', () => [first, second]);
  await store.updateSessions('private', () => [secret]);
  const tools = browserTopicTools(store, scope);
  assert.deepEqual(tools.definitions.map(item => item.function.name), ['list_project_tags', 'find_tagged_conversations']);
  const tags = JSON.parse(await tools.execute('list_project_tags', {}));
  assert.deepEqual(tags.tags, [{ tag: 'Parser', conversations: 2 }, { tag: 'TypeScript', conversations: 2 }]);
  const found = JSON.parse(await tools.execute('find_tagged_conversations', { tag: 'parser' }));
  assert.deepEqual(found.conversations.map(item => item.title), ['Review work', 'Parser work']);
  assert.equal(found.conversations[0].chapterSeq, 14);
  assert.doesNotMatch(JSON.stringify(found), /Hidden work/);
  await assert.rejects(tools.execute('list_project_tags', { project: 'private' }), /outside/);
  await assert.rejects(tools.execute('find_tagged_conversations', { tag: 'p' }), /2 to 40/);
});

test('topic tools remain discoverable on small requests and support cancellation', async () => {
  const controller = new AbortController();
  const tools = browserTopicTools({ sessions: async () => [] }, scope, controller.signal);
  assert.deepEqual(selectHarnessToolDefinitions(tools.definitions, 'Show the tag cloud', 8192, [], 1024).map(item => item.function.name), ['list_project_tags', 'find_tagged_conversations']);
  assert.ok(discoverToolCategory(tools.definitions, 'topics', '', 'Find a topic', 8192, 1024).some(item => item.function.name === 'find_tagged_conversations'));
  controller.abort();
  await assert.rejects(tools.execute('list_project_tags', {}), /Abort|stopped|abort/i);
});
