import test from 'node:test';
import assert from 'node:assert/strict';
import { carryForwardContext, compactionWindows, contextHeadTail, fallbackCompactionSummary, fallbackWindowSummary, toolActivityText } from '../src/harnessCompaction.ts';

const record = (seq, role, content) => ({ id: String(seq), seq, role, content, createdAt: '2026-01-01T00:00:00.000Z' });

test('compaction windows cover long exchanges in order without dropping early decisions', () => {
  const messages = [
    record(0, 'user', 'Use SQLite for the project index.'),
    record(1, 'assistant', 'I will store the index on the selected USB drive.'),
    record(2, 'user', 'A'.repeat(1300) + 'Keep the cache portable.'),
  ];
  const windows = compactionWindows(messages, 360);
  assert.ok(windows.length > 1);
  assert.ok(windows.every(window => window.text.length <= 360));
  assert.equal(windows[0].startSeq, 0);
  assert.equal(windows.at(-1).endSeq, 2);
  assert.match(windows[0].text, /SQLite/);
  assert.match(windows.at(-1).text, /Keep the cache portable/);
  const slices = [...windows.flatMap(window => [...window.text.matchAll(/USER #2: \[characters (\d+)–(\d+)\] ([^\n]*)/g)])];
  assert.equal(slices.map(match => match[3]).join(''), messages[2].content);
});

test('fallback summary admits that exact details require archived history', () => {
  const summary = fallbackCompactionSummary([
    record(4, 'user', 'Set up a portable repository.'),
    record(5, 'assistant', 'Created the initial files.'),
    record(6, 'user', 'Remember to keep the project offline.'),
  ]);
  assert.match(summary, /Archived 3 messages/);
  assert.match(summary, /Verify exact details with history tools/);
  assert.match(summary, /portable repository/);
  assert.match(summary, /offline/);
});

test('fallback keeps early and late messages within its compact budget', () => {
  const messages = [record(0, 'user', 'Initial architecture choice: SQLite'),
    ...Array.from({ length: 12 }, (_, index) => record(index + 1, index % 2 ? 'assistant' : 'user', `Middle exchange ${index} ${'x'.repeat(300)}`)),
    record(13, 'assistant', 'Final change: added offline cache')];
  const summary = fallbackCompactionSummary(messages);
  assert.ok(summary.length <= 700);
  assert.match(summary, /SQLite/);
  assert.match(summary, /offline cache/);
});

test('fallback keeps a middle decision and its path when later chatter crowds it out', () => {
  const messages = [
    record(0, 'user', 'Build a browser coding assistant.'),
    record(1, 'assistant', 'Starting the interface.'),
    record(2, 'user', 'We decided to use SQLite in data/index.sqlite for the project index.'),
    ...Array.from({ length: 10 }, (_, index) => record(index + 3, index % 2 ? 'assistant' : 'user', `Routine exchange ${index}: ${'x'.repeat(180)}`)),
    record(13, 'user', 'Next, add a way to search older sessions.'),
  ];
  const summary = fallbackCompactionSummary(messages);
  assert.ok(summary.length <= 700);
  assert.match(summary, /SQLite/);
  assert.match(summary, /data\/index\.sqlite/);
  assert.match(summary, /search older sessions/);
  assert.match(summary, /user #2:/);
});

test('window fallback retains both the opening and closing details', () => {
  const source = `Use SQLite. ${'x'.repeat(500)} Keep the USB cache portable.`;
  const summary = fallbackWindowSummary(source, 100);
  assert.ok(summary.length <= 100);
  assert.match(summary, /Use SQLite/);
  assert.match(summary, /Keep the USB cache portable/);
});

test('compaction records file-changing tool actions without copying read results', () => {
  const changed = { ...record(3, 'assistant', 'Done.'), toolEvents: [
    'read_file: The entire document is long and unrelated.',
    'write_file: Wrote repositories/demo/src/cache.ts (120 bytes).',
    'git_commit: Committed abcdef123456.',
    'git_create_branch: Created local branch feature/cache.',
    'git_init: Initialized Git in Demo.',
  ] };
  const activity = toolActivityText(changed.toolEvents);
  assert.match(activity, /cache\.ts/);
  assert.match(activity, /git_commit/);
  assert.match(activity, /git_create_branch/);
  assert.match(activity, /git_init/);
  assert.doesNotMatch(activity, /entire document/);
  assert.match(compactionWindows([changed], 360)[0].text, /Tool actions: write_file/);
  const messages = [
    record(0, 'user', 'Work on the cache.'),
    record(1, 'assistant', 'Starting.'),
    changed,
    ...Array.from({ length: 8 }, (_, index) => record(index + 4, 'user', `Routine question ${index}: ${'x'.repeat(120)}`)),
    record(12, 'assistant', 'Ready for the next task.'),
  ];
  assert.match(fallbackCompactionSummary(messages), /cache\.ts/);
});

test('rolling context keeps an early decision and the newest unresolved task', () => {
  let context = 'Decided to keep the index in data/index.sqlite on the USB drive.';
  for (let index = 0; index < 9; index++) context = carryForwardContext(context, `Routine part ${index}: discussed interface details. ${'x'.repeat(550)}`);
  context = carryForwardContext(context, 'Next: fix the offline cache in src/cache.ts.');
  assert.match(context, /data\/index\.sqlite/);
  assert.match(context, /fix the offline cache in src\/cache\.ts/);
  assert.ok(context.length <= 1600);
  assert.equal((context.match(/Earlier notes \(verify if superseded\):/g) || []).length, 1);
});

test('a model carry replaces superseded notes and a narrow excerpt keeps both ends', () => {
  const context = carryForwardContext('Use SQLite for the index.', 'Switched the index to IndexedDB.', 'Use IndexedDB for the index; SQLite was superseded.');
  assert.match(context, /Use IndexedDB/);
  assert.match(context, /Latest part: Switched/);
  assert.ok(contextHeadTail(`Durable: keep the USB drive portable. ${'x'.repeat(900)} Latest: update src/cache.ts.`, 150).includes('USB drive portable'));
  assert.ok(contextHeadTail(`Durable: keep the USB drive portable. ${'x'.repeat(900)} Latest: update src/cache.ts.`, 150).includes('src/cache.ts'));
});
