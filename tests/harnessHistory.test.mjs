import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHistoryTools, recallHistory } from '../src/harnessHistory.ts';
import { HarnessStore } from '../src/harnessStore.ts';
import { addSearchBits, createConversation } from '../src/harnessData.ts';

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
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
    return entry;
  }
}

const message = { id: 'older-answer', seq: 7, role: 'assistant', createdAt: '2026-01-05T12:00:00.000Z', content: 'We chose a two-hour cache eviction policy for the offline project.' };
const archived = {
  id: 'conversation', projectId: 'home', activeFrom: 10,
  segments: [{ id: 'segment', chapterId: 'chapter', title: 'Project Setup', summary: 'Configured the offline project.', tags: ['Setup'], startSeq: 0, endSeq: 9, startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-05T12:00:00.000Z' }],
};

test('history recall finds an original detail omitted from compacted chapter metadata', async () => {
  const searched = [];
  const store = { async searchMessages(_meta, term, limit, beforeSeq, fromSeq) {
    searched.push({ term, limit, beforeSeq, fromSeq });
    return term === 'eviction' ? [message] : [];
  } };
  const excerpt = await recallHistory(store, archived, 'What was the cache eviction policy?');
  assert.match(excerpt, /Project Setup · message #7/);
  assert.match(excerpt, /two-hour cache eviction policy/);
  assert.deepEqual(searched, [{ term: 'eviction', limit: 1, beforeSeq: 10, fromSeq: 0 }]);
});

test('history recall quotes a saved file action when the assistant text omitted its path', async () => {
  const action = { ...message, content: 'I updated the module.', toolEvents: ['write_file: Wrote repositories/demo/src/cache.ts (120 bytes).'] };
  const store = { async searchMessages() { return [action]; } };
  const excerpt = await recallHistory(store, archived, 'Where was cache.ts changed?');
  assert.match(excerpt, /repositories\/demo\/src\/cache\.ts/);
});

test('history recall does not fabricate an excerpt when neither metadata nor messages match', async () => {
  const store = { async searchMessages() { return []; } };
  assert.equal(await recallHistory(store, archived, 'Where is the configuration checksum?'), '');
});

test('history recall skips terms ruled out by the conversation index', async () => {
  const calls = [];
  const meta = { ...archived, searchBits: addSearchBits('', 'cache eviction policy') };
  const store = { async searchMessages(_meta, term) { calls.push(term); return term === 'eviction' ? [message] : []; } };
  const excerpt = await recallHistory(store, meta, 'unrelatedLongerTerm eviction');
  assert.match(excerpt, /message #7/);
  assert.deepEqual(calls, ['eviction']);
});

test('history recall verifies elsewhere when a related chapter has no matching original message', async () => {
  const meta = { ...archived, activeFrom: 20, segments: [
    { ...archived.segments[0], title: 'Cache Design', summary: 'Outlined cache settings.' },
    { ...archived.segments[0], id: 'later', chapterId: 'later', title: 'Runtime Changes', summary: 'Made runtime updates.', startSeq: 10, endSeq: 19 },
  ] };
  const calls = [];
  const store = { async searchMessages(_meta, term, _limit, beforeSeq, fromSeq) {
    calls.push({ term, beforeSeq, fromSeq });
    return beforeSeq === 20 && fromSeq === 0 && term === 'eviction' ? [{ ...message, seq: 15 }] : [];
  } };
  const excerpt = await recallHistory(store, meta, 'What was the cache eviction policy?');
  assert.match(excerpt, /Runtime Changes · message #15/);
  assert.match(excerpt, /two-hour cache eviction policy/);
  assert.ok(calls.some(call => call.beforeSeq === 10 && call.fromSeq === 0));
  assert.ok(calls.some(call => call.beforeSeq === 20 && call.fromSeq === 0));
});

test('history recall verifies a specific detail after a broad chapter match', async () => {
  const meta = { ...archived, searchBits: addSearchBits('', 'cache eviction policy'), segments: [
    { ...archived.segments[0], title: 'Cache Design', summary: 'Discussed the cache.', tags: ['Cache'] },
  ] };
  const calls = [];
  const store = { async searchMessages(_meta, term) {
    calls.push(term);
    if (term === 'cache') return [{ ...message, content: 'The cache policy was reviewed for local files.' }];
    if (term === 'eviction') return [message];
    return [];
  } };
  const excerpt = await recallHistory(store, meta, 'What was the cache eviction policy?');
  assert.match(excerpt, /The cache policy was reviewed for local files/);
  assert.match(excerpt, /two-hour cache eviction policy/);
  assert.deepEqual(calls, ['cache', 'eviction']);
});

test('history fallback retrieves an archived detail through the real chunk index', async () => {
  const store = new HarnessStore('history-integration', new MemoryDirectory());
  let meta = createConversation('home');
  for (let seq = 0; seq < 24; seq++) meta = await store.appendMessage(meta, {
    id: `message-${seq}`, role: seq === 7 ? 'assistant' : 'user',
    content: seq === 7 ? 'We selected a two-hour cache eviction policy for offline sessions.' : `Ordinary discussion ${seq}`,
    createdAt: new Date(Date.UTC(2026, 0, 5, 12, 0, seq)).toISOString(),
  });
  meta = { ...meta, activeFrom: 24, segments: [{ ...archived.segments[0], endSeq: 23 }] };
  const excerpt = await recallHistory(store, meta, 'What was the cache eviction policy?');
  assert.match(excerpt, /message #7/);
  assert.match(excerpt, /two-hour cache eviction policy/);
});

test('a brief continuation recalls the last original task and reply after compaction', async () => {
  const store = new HarnessStore('recent-exchange', new MemoryDirectory());
  let meta = createConversation('home');
  meta = await store.appendMessage(meta, { id: 'old', role: 'user', content: 'Explain a historical detail.', createdAt: '2026-01-01T00:00:00.000Z' });
  meta = await store.appendMessage(meta, { id: 'task', role: 'user', content: 'Fix the cache bug in src/cache.ts and update tests.', createdAt: '2026-01-02T00:00:00.000Z' });
  meta = await store.appendMessage(meta, { id: 'answer', role: 'assistant', content: 'I found the cache bug. I can patch src/cache.ts and run a syntax check.', createdAt: '2026-01-02T00:01:00.000Z' });
  meta = { ...meta, activeFrom: 3, segments: [{ ...archived.segments[0], endSeq: 2 }] };
  const excerpt = await recallHistory(store, meta, 'Go ahead.');
  assert.match(excerpt, /Fix the cache bug in src\/cache\.ts/);
  assert.match(excerpt, /I can patch src\/cache\.ts/);
  assert.doesNotMatch(excerpt, /historical detail/);
  assert.ok(excerpt.length <= 1600);
});

test('a specific new question still uses topic search rather than the latest exchange', async () => {
  const calls = [];
  const store = {
    async messages() { throw new Error('Recent exchange should not be read.'); },
    async searchMessages(_meta, term) { calls.push(term); return term === 'eviction' ? [message] : []; },
  };
  const excerpt = await recallHistory(store, archived, 'What was the eviction policy?');
  assert.match(excerpt, /two-hour cache eviction policy/);
  assert.ok(calls.includes('eviction'));
});

test('recent topic summary remains available when the tail has only tool messages', async () => {
  const meta = { ...archived, activeFrom: 50, segments: [{ ...archived.segments[0], summary: 'Fix the cache bug in src/cache.ts; tests still need updating.', endSeq: 49 }] };
  const store = { async messages() { return Array.from({ length: 16 }, (_, index) => ({ ...message, seq: 34 + index, role: 'tool', content: 'Tool output.' })); } };
  const excerpt = await recallHistory(store, meta, 'Continue.');
  assert.match(excerpt, /tests still need updating/);
  assert.ok(excerpt.length <= 1600);
});

test('history read returns a concise record of archived file changes', async () => {
  const changed = { ...message, seq: 7, content: 'Updated the cache.', toolEvents: [
    'read_file: long source content',
    'write_file: Wrote repositories/demo/src/cache.ts (120 bytes).',
  ] };
  const store = { async messages() { return [changed]; } };
  const tools = browserHistoryTools(store, archived);
  const result = await tools.execute('read_history', { from_seq: 7, count: 1 });
  assert.match(result, /Tool actions: write_file/);
  assert.match(result, /cache\.ts/);
  assert.doesNotMatch(result, /long source content/);
});

test('a smaller fallback can search and read omitted active turns before compaction', async () => {
  const calls = [];
  const recent = { ...message, seq: 3, content: 'Use the existing cache key for the new implementation.' };
  const store = {
    async searchMessages(_meta, query, _limit, beforeSeq) { calls.push({ query, beforeSeq }); return [recent]; },
    async messages(_meta, from, to) { calls.push({ from, to }); return [recent]; },
  };
  const tools = browserHistoryTools(store, { ...archived, activeFrom: 0, messageCount: 8, segments: [] }, undefined, true);
  assert.ok(tools);
  assert.match(await tools.execute('search_history', { query: 'cache key' }), /existing cache key/);
  assert.match(await tools.execute('read_history', { from_seq: 3, count: 1 }), /existing cache key/);
  assert.deepEqual(calls, [{ query: 'cache key', beforeSeq: 8 }, { from: 3, to: 4 }]);
});
