import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMemoryTools } from '../src/harnessMemoryTools.ts';
import { selectHarnessToolDefinitions } from '../src/harnessToolSelection.ts';
import { memoryDraftFromToolEvent } from '../src/harnessMemoryDraft.ts';

const memory = (id, scope, ownerId, title, content) => ({ id, scope, ownerId, title, content, tags: [title], updatedAt: '2026-01-01T00:00:00Z' });
const records = [
  memory('global', 'global', '', 'Cache policy', 'Use the portable cache.'),
  memory('project', 'project', 'home', 'Search index', 'Keep the search index on the drive. ' + 'x'.repeat(900)),
  memory('other', 'project', 'secret', 'Secret search index', 'Do not disclose this private project.'),
  memory('session', 'session', 'current', 'Search decision', 'Use exact matching for this conversation.'),
  memory('old-session', 'session', 'elsewhere', 'Search decision', 'Private to another conversation.'),
];
const store = { memory: async () => records };
const scope = { projects: [{ id: 'home' }], workspaceAccess: false, defaultProjectId: 'home' };
const meta = { id: 'current', projectId: 'home' };

test('memory lookup returns only global, allowed-project, and current-session notes', async () => {
  const tools = browserMemoryTools(store, meta, scope);
  const result = JSON.parse(await tools.execute('search_memory', { query: 'search index' }));
  assert.deepEqual(result.matches.map(item => item.id), ['project', 'session']);
  assert.equal(result.matches[0].moreContent, true);
  assert.ok(result.matches[0].excerpt.length <= 360);
  assert.equal(result.matches[0].category, 'General');
  await assert.rejects(tools.execute('read_memory', { id: 'other' }), /allowed scope/);
  await assert.rejects(tools.execute('read_memory', { id: 'old-session' }), /allowed scope/);
  await assert.rejects(tools.execute('search_memory', { project: 'secret', query: 'search' }), /outside the agent/);
});

test('a model can page through one memory without receiving the whole store', async () => {
  const tools = browserMemoryTools(store, meta, scope);
  const first = JSON.parse(await tools.execute('read_memory', { id: 'project', offset: 0, length: 100 }));
  assert.equal(first.content.length, 100);
  assert.equal(first.nextOffset, 100);
  const last = JSON.parse(await tools.execute('read_memory', { id: 'project', offset: 100, length: 4000 }));
  assert.equal(last.nextOffset, null);
  await assert.rejects(tools.execute('read_memory', { id: 'project', length: 5000 }), /1 to 4000/);
});

test('small contexts expose memory lookup for memory questions without carrying it on coding requests', () => {
  const definitions = browserMemoryTools(store, meta, scope).definitions;
  const names = request => selectHarnessToolDefinitions(definitions, request, 4096).map(item => item.function.name);
  assert.deepEqual(names('What did we decide about the search index?'), ['search_memory', 'read_memory']);
  assert.deepEqual(names('Fix src/app.ts'), []);
});

test('a model can propose a memory draft without writing to saved memory', async () => {
  let reads = 0;
  const tools = browserMemoryTools({ memory: async () => { reads++; return records; } }, meta, scope);
  const result = await tools.execute('propose_memory', { title: 'Editor preference', content: 'Prefer short diffs.', scope: 'project', category: 'Preferences', tags: 'Coding, Workflow' });
  const draft = memoryDraftFromToolEvent(`memory_draft: ${result}`);
  assert.deepEqual(draft, { title: 'Editor preference', content: 'Prefer short diffs.', scope: 'project', category: 'Preferences', tags: 'Coding, Workflow' });
  assert.equal(reads, 0);
  assert.equal(memoryDraftFromToolEvent('propose_memory: queued'), null);
  assert.equal(memoryDraftFromToolEvent('memory_draft: {bad json}'), null);
  await assert.rejects(tools.execute('propose_memory', { title: '', content: 'x' }), /title up to 100/);
  assert.ok(selectHarnessToolDefinitions(tools.definitions, 'Please remember this preference', 4096).some(item => item.function.name === 'propose_memory'));
});
