import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryPromptExcerpt, relatedMemory } from '../src/harnessMemoryPrompt.ts';

test('one long memory cannot crowd out the other selected scopes', () => {
  const memories = [
    { scope: 'global', title: 'Preferences', tags: ['Style'], content: 'A'.repeat(2000) },
    { scope: 'project', title: 'Repository', tags: ['Code'], content: 'Use TypeScript for this project.' },
    { scope: 'session', title: 'Decision', tags: ['Tests'], content: 'Keep the original regression case.' },
  ];
  const text = memoryPromptExcerpt(memories, 360);
  assert.ok(text.length <= 360);
  assert.match(text, /\[global: Preferences/);
  assert.match(text, /\[project: Repository/);
  assert.match(text, /Use TypeScript/);
  assert.match(text, /\[session: Decision/);
  assert.match(text, /Keep the original/);
});

test('unused space from short memories goes to a longer relevant memory', () => {
  const text = memoryPromptExcerpt([
    { scope: 'session', title: 'Short', tags: [], content: 'yes' },
    { scope: 'project', title: 'Long', tags: [], content: 'B'.repeat(300) },
  ], 220);
  assert.ok(text.length <= 220);
  assert.match(text, /Short\] yes/);
  assert.ok((text.match(/B/g) || []).length > 130);
});

test('retrieval keeps useful project and session memories when many global memories match', () => {
  const record = (id, scope, ownerId, title, content) => ({ id, scope, ownerId, title, content, tags: [], updatedAt: `2026-01-${String(Number(id.slice(1)) + 1).padStart(2, '0')}T00:00:00Z` });
  const records = Array.from({ length: 7 }, (_, index) => record(`g${index}`, 'global', '', 'Coding', 'Coding preference'));
  records.push(record('p8', 'project', 'my-project', 'Coding setup', 'Use TypeScript'));
  records.push(record('s9', 'session', 'my-session', 'Decision', 'Keep the chosen test case'));
  const picked = relatedMemory(records, 'my-project', 'my-session', 'coding');
  assert.equal(picked.length, 5);
  assert.ok(picked.some(item => item.scope === 'project'));
  assert.ok(picked.some(item => item.scope === 'session'));
  assert.ok(picked.some(item => item.scope === 'global'));
  assert.ok(!picked.some(item => item.ownerId === 'other-project'));
});

test('project memory remains available when the next request uses different words', () => {
  const records = [
    { id: 'project-note', scope: 'project', ownerId: 'my-project', title: 'Repository choice', content: 'Use TypeScript for this project.', tags: [], updatedAt: '2026-01-01' },
    { id: 'other-note', scope: 'project', ownerId: 'other-project', title: 'Unrelated', content: 'Private to another project.', tags: [], updatedAt: '2026-01-02' },
  ];
  assert.deepEqual(relatedMemory(records, 'my-project', 'session-a', 'How should I name this feature?').map(item => item.id), ['project-note']);
});

test('common words and substrings do not crowd a relevant memory into a small prompt', () => {
  const records = [
    { id: 'r1', scope: 'global', ownerId: '', title: 'Theater rehearsal', content: 'Catalog the cast.', tags: [], updatedAt: '2026-01-03' },
    { id: 'r2', scope: 'global', ownerId: '', title: 'Cache policy', content: 'Keep cache data on the drive.', tags: [], updatedAt: '2026-01-01' },
    { id: 'r3', scope: 'global', ownerId: '', title: 'Theater lighting', content: 'Keep the stage dark.', tags: [], updatedAt: '2026-01-02' },
  ];
  assert.deepEqual(relatedMemory(records, 'project', 'session', 'Where is the cache?', 5).map(item => item.id), ['r2']);
  assert.deepEqual(relatedMemory(records, 'project', 'session', 'How should this work?', 5).map(item => item.id), ['r1']);
});
