import test from 'node:test';
import assert from 'node:assert/strict';
import { continuesChapter, groupChapters } from '../src/harnessChapters.ts';

test('a multi-part chapter keeps each summary and original message location', () => {
  const segments = [
    { id: 'a', chapterId: 'topic', title: 'Search', summary: 'Chose a compact index.', tags: ['Index'], startSeq: 0, endSeq: 8, startAt: '2026-01-01', endAt: '2026-01-02' },
    { id: 'b', chapterId: 'topic', title: 'Search', summary: 'Verified a missing chunk.', tags: ['Recovery'], startSeq: 9, endSeq: 17, startAt: '2026-01-03', endAt: '2026-01-04' },
    { id: 'c', chapterId: 'new-topic', title: 'Models', summary: 'Tested a local model.', tags: ['Local AI'], startSeq: 18, endSeq: 25, startAt: '2026-01-05', endAt: '2026-01-06' },
  ];
  const chapters = groupChapters(segments);
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters[0].entries.map(part => [part.startSeq, part.summary]), [[0, 'Chose a compact index.'], [9, 'Verified a missing chunk.']]);
  assert.equal(chapters[0].parts, 2);
  assert.equal(chapters[0].endSeq, 17);
  assert.match(chapters[0].searchText, /compact index/);
  assert.match(chapters[0].searchText, /missing chunk/);
  assert.deepEqual(chapters[1].entries.map(part => part.startSeq), [18]);
});

test('fallback chapter detection groups a continuing topic but separates a new one', () => {
  const previous = { title: 'Workspace Search Index', tags: ['Conversation Search', 'Index'], summary: 'Built the first index.' };
  assert.equal(continuesChapter(previous, 'Workspace Search Index Recovery', ['Search', 'Recovery']), true);
  assert.equal(continuesChapter(previous, 'Image Generation Pipeline', ['Images', 'Pipeline']), false);
  assert.equal(continuesChapter(undefined, 'Workspace Search Index', ['Search']), false);
  assert.equal(continuesChapter({ ...previous, title: 'Browser Model Setup', tags: ['Model'] }, 'Browser Model Download', ['Model']), false);
});
