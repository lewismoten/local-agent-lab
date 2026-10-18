import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { createConversation } from '../src/harnessData.ts';
import { journalDate, journalTarget, journalTopics } from '../src/harnessJournal.ts';
import { browserJournalTools, journalEnabledReview } from '../src/harnessJournalTools.ts';
import { selectHarnessToolDefinitions } from '../src/harnessToolSelection.ts';
import { toolPermission } from '../src/harnessToolPermissions.ts';
import { authorizeToolCall } from '../src/harnessToolApprovals.ts';
import { readBlob, writeBlob } from '../src/storage.ts';

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

const indexPath = 'harness/journal/index.json';
const dayPath = date => `harness/journal/days/${date}.json`;
const message = (id, content, createdAt, role = 'user', toolEvents = []) => ({ id, role, content, createdAt, toolEvents });

test('journal is opt-in, persists daily facts, and pauses without losing prior entries', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('journal-opt-in', folder);
  let conversation = createConversation('home');
  await store.updateSessions('home', () => [conversation]);
  const first = await store.appendConversationMessage(conversation, message('first-message', 'Plan the parser', '2026-10-18T10:00:00.000Z'));
  assert.equal(first.journalWarning, undefined);
  assert.equal(folder.children.get('harness').children.has('journal'), false);
  conversation = first.meta;

  const enabled = await store.setJournalEnabled(true);
  const date = journalDate('2026-10-18T10:01:00.000Z', enabled.timeZone);
  const second = await store.appendConversationMessage(conversation, message('second-message', 'Parser complete', '2026-10-18T10:01:00.000Z', 'assistant', ['write_file: src/parser.ts']));
  assert.equal(second.journalWarning, undefined);
  assert.deepEqual((await store.journalIndex()).dates, [date]);
  assert.deepEqual((await store.journalDay(date)).facts.map(fact => fact.id), ['second-message']);
  assert.deepEqual((await store.journalDay(date)).facts[0].toolActions, ['write_file: src/parser.ts']);

  await store.setJournalEnabled(false);
  await store.appendConversationMessage(second.meta, message('third-message', 'Next step', '2026-10-18T10:02:00.000Z'));
  assert.deepEqual((await new HarnessStore('journal-opt-in', folder).journalDay(date)).facts.map(fact => fact.id), ['second-message']);
});

test('journal serializes simultaneous facts and retries an existing day without duplicating a message', async () => {
  const store = new HarnessStore('journal-concurrent', new MemoryDirectory());
  await store.setJournalEnabled(true);
  const conversation = createConversation('home', 'agent-1');
  const at = '2026-10-18T11:00:00.000Z';
  const one = { ...message('agent-one', 'Read the tests', at), seq: 0 };
  const two = { ...message('agent-two', 'Fixed the tests', at, 'assistant'), seq: 1 };
  await Promise.all([store.recordJournalMessage(conversation, one), store.recordJournalMessage(conversation, two)]);
  await store.recordJournalMessage(conversation, one);
  const date = journalDate(at, (await store.journalIndex()).timeZone);
  assert.deepEqual((await store.journalDay(date)).facts.map(fact => fact.id), ['agent-one', 'agent-two']);
  assert.deepEqual((await store.journalIndex()).dates, [date]);
  assert.equal((await store.journalDay(date)).facts[0].agentId, 'agent-1');
});

test('journal links follow a conversation moved more than once', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('journal-moves', folder);
  await store.setJournalEnabled(true);
  const original = createConversation('home');
  await store.recordJournalMessage(original, { ...message('move-fact', 'Investigate code', '2026-10-18T11:00:00.000Z'), seq: 0 });
  const second = { ...original, projectId: 'project-two', id: 'copied-second' };
  const third = { ...original, projectId: 'project-three', id: 'copied-third' };
  await store.remapJournalConversation(original, second);
  await store.remapJournalConversation(second, third);
  const reopened = new HarnessStore('journal-moves', folder);
  assert.deepEqual(journalTarget(await reopened.journalIndex(), original.projectId, original.id), { projectId: third.projectId, sessionId: third.id });
  const date = journalDate('2026-10-18T11:00:00.000Z', (await reopened.journalIndex()).timeZone);
  assert.equal((await reopened.journalDay(date)).facts[0].projectId, 'home');
});

test('journal uses workspace time zone and source-linked chapter summaries', () => {
  const at = '2026-10-18T00:30:00.000Z';
  assert.equal(journalDate(at, 'UTC'), '2026-10-18');
  assert.equal(journalDate(at, 'America/New_York'), '2026-10-17');
  const conversation = { ...createConversation('home', 'agent-1'), title: 'Parser review', segments: [{
    id: 'segment-1', chapterId: 'chapter-1', title: 'Review', summary: 'The parser tests were repaired.', tags: ['Parser'],
    startSeq: 2, endSeq: 4, startAt: '2026-10-17T23:00:00.000Z', endAt: '2026-10-18T01:00:00.000Z',
  }] };
  const day = { version: 1, date: '2026-10-17', updatedAt: at, facts: [{ id: 'fact-1', projectId: 'home', sessionId: conversation.id,
    sessionTitle: conversation.title, agentId: 'agent-1', seq: 3, at, role: 'assistant', excerpt: 'Fixed it', toolActions: ['write_file: parser.ts'] }] };
  const [topic] = journalTopics(day, { home: 'Home' }, [conversation], { 'agent-1': 'Ada' }, 'America/New_York');
  assert.equal(topic.chapterSeq, 2);
  assert.equal(topic.firstSeq, 3);
  assert.equal(topic.lastSeq, 3);
  assert.match(topic.prose, /Ada worked on Parser review/);
  assert.match(topic.prose, /parser tests were repaired/);
  assert.match(topic.prose, /write file/);
});

test('unsupported journal data is retained while the conversation message still saves', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('journal-malformed', folder);
  const conversation = createConversation('home');
  await store.updateSessions('home', () => [conversation]);
  await store.setJournalEnabled(true);
  const date = journalDate('2026-10-18T12:00:00.000Z', (await store.journalIndex()).timeZone);
  const unsupported = JSON.stringify({ version: 2, date, facts: [{ id: 'future' }] });
  await writeBlob(folder, dayPath(date), new Blob([unsupported]));
  const saved = await store.appendConversationMessage(conversation, message('safe-message', 'Still saved', '2026-10-18T12:00:00.000Z'));
  assert.match(saved.journalWarning, /journal update failed/);
  assert.equal((await store.messages(saved.meta))[0].content, 'Still saved');
  assert.equal(await (await readBlob(folder, dayPath(date))).text(), unsupported);
});

test('journal tools show only allowed projects and follow move permissions', async () => {
  const store = new HarnessStore('journal-tools', new MemoryDirectory());
  await store.setJournalEnabled(true);
  const at = '2026-10-18T12:00:00.000Z';
  const source = createConversation('home');
  await store.recordJournalMessage(source, { ...message('home-entry', 'Fix the build', at), seq: 0 });
  const other = createConversation('private');
  await store.recordJournalMessage(other, { ...message('private-entry', 'Private plan', at), seq: 0 });
  const date = journalDate(at, (await store.journalIndex()).timeZone);
  const homeScope = { projects: [{ id: 'home', name: 'Home' }], defaultProjectId: 'home', workspaceAccess: false };
  const home = browserJournalTools(store, homeScope);
  assert.deepEqual(home.definitions.map(item => item.function.name), ['get_journal_settings', 'list_journal_days', 'read_journal_day']);
  assert.deepEqual(selectHarnessToolDefinitions(home.definitions, 'Show my journal today', 8192, [], 1024).map(item => item.function.name), ['list_journal_days', 'read_journal_day']);
  const listed = JSON.parse(await home.execute('list_journal_days', { before: date }));
  assert.deepEqual(listed.dates, [{ date, messages: 1 }]);
  const read = JSON.parse(await home.execute('read_journal_day', { date }));
  assert.equal(read.topics.length, 1);
  assert.match(read.topics[0].summary, /Fix the build/);
  assert.doesNotMatch(JSON.stringify(read), /Private plan/);
  await assert.rejects(home.execute('read_journal_day', { project: 'private', date }), /outside/);

  const destination = { ...source, projectId: 'private', id: 'moved-home' };
  await store.remapJournalConversation(source, destination);
  assert.deepEqual(JSON.parse(await home.execute('read_journal_day', { date })).topics, []);
  const privateScope = { projects: [{ id: 'private', name: 'Private' }], defaultProjectId: 'private', workspaceAccess: false };
  const visible = JSON.parse(await browserJournalTools(store, privateScope).execute('read_journal_day', { date }));
  assert.equal(visible.topics.length, 2);
  assert.ok(visible.topics.some(topic => topic.session === destination.id));
});

test('journal recording tool requires a reviewed workspace setting and rejects stale or read-only changes', async () => {
  const store = new HarnessStore('journal-setting-tool', new MemoryDirectory());
  const manifest = await store.manifest();
  const scope = { projects: manifest.projects, defaultProjectId: 'home', workspaceAccess: false };
  const tools = browserJournalTools(store, scope, undefined, true);
  assert.equal(toolPermission(scope, 'set_journal_enabled'), 'ask');
  assert.ok(selectHarnessToolDefinitions(tools.definitions, 'Turn on journal recording', 8192, [], 1024).some(item => item.function.name === 'set_journal_enabled'));
  assert.deepEqual((await journalEnabledReview(store, true)).current, false);
  await assert.rejects(journalEnabledReview(store, 'true'), /true or false/);
  await assert.rejects(tools.execute('set_journal_enabled', { enabled: true }), /Review the current/);
  let reviewed;
  await authorizeToolCall({ scope, name: 'set_journal_enabled', arguments: await journalEnabledReview(store, true), projectId: 'home', sessionKey: 'chat', runGrants: new Set(), approve: async request => { reviewed = request.arguments; return true; } });
  assert.deepEqual(reviewed, { scope: 'Entire workspace', current: false, requested: true, effect: 'Start recording short local facts from future chat and agent messages.' });
  assert.equal(JSON.parse(await tools.execute('set_journal_enabled', { enabled: true, __reviewedCurrent: reviewed.current })).enabled, true);
  assert.equal(JSON.parse(await tools.execute('get_journal_settings', {})).enabled, true);
  await store.setJournalEnabled(false);
  await assert.rejects(tools.execute('set_journal_enabled', { enabled: false, __reviewedCurrent: true }), /changed during review/);
  await store.updateManifest(current => ({ ...current, workspaceToolAccess: 'read-only' }));
  await assert.rejects(tools.execute('set_journal_enabled', { enabled: true, __reviewedCurrent: false }), /read-only/);
  await store.updateManifest(current => ({ ...current, workspaceToolAccess: 'full', projects: current.projects.map(project => project.id === 'home' ? { ...project, toolAccess: 'read-only' } : project) }));
  await assert.rejects(tools.execute('set_journal_enabled', { enabled: true, __reviewedCurrent: false }), /read-only/);
  assert.equal((await store.journalIndex()).enabled, false);
});
