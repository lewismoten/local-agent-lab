import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTags, conversationHasTag, conversationTagCloud, findConversationTopic, titleCaseTag } from '../src/harnessData.ts';
import { recentTimelineTopics } from '../src/harnessTimeline.ts';

const session = (id, tags, segmentTags = []) => ({ id, tags, segments: segmentTags.map(tag => ({ tags: [tag] })) });

test('tag cloud counts conversations, ranks frequent topics, and uses legacy chapter tags', () => {
  const sessions = [
    session('a', ['Coding', 'Coding', 'Research']),
    session('b', ['Coding']),
    session('c', [], ['Research']),
  ];
  assert.deepEqual(conversationTagCloud(sessions), [
    { tag: 'Coding', count: 2, level: 1 },
    { tag: 'Research', count: 2, level: 1 },
  ]);
});

test('clicking a tag filters that exact topic rather than a similar title or tag', () => {
  assert.equal(conversationHasTag(session('a', ['AI']), 'AI'), true);
  assert.equal(conversationHasTag(session('b', ['Aiming']), 'AI'), false);
  assert.equal(conversationHasTag(session('c', [], ['AI']), 'ai'), true);
  assert.equal(conversationHasTag(session('d', ['Coding'], ['Legacy Topic']), 'legacy topic'), true);
});

test('topic search finds compacted summaries and opens the relevant original chapter', () => {
  const archive = { title: 'Build notes', preview: 'Latest unrelated message', tags: ['Code'], segments: [
    { title: 'Caching', tags: ['Performance'], summary: 'We chose a two-hour eviction policy.', startSeq: 48 },
  ] };
  assert.deepEqual(findConversationTopic(archive, 'eviction'), { excerpt: 'Caching: We chose a two-hour eviction policy.', seq: 48 });
  assert.deepEqual(findConversationTopic(archive, 'performance', true), { excerpt: 'Caching: We chose a two-hour eviction policy.', seq: 48 });
  assert.equal(findConversationTopic(archive, 'perform', true), null);
});

test('topic search opens the most recent matching chapter in a long conversation', () => {
  const archive = { title: 'Project history', preview: 'Latest notes', tags: [], segments: [
    { title: 'Caching', tags: ['Performance'], summary: 'Initial cache plan.', startSeq: 12 },
    { title: 'Caching', tags: ['Performance'], summary: 'Revised the cache plan.', startSeq: 96 },
  ] };
  assert.deepEqual(findConversationTopic(archive, 'caching'), { excerpt: 'Caching: Revised the cache plan.', seq: 96 });
  assert.deepEqual(findConversationTopic(archive, 'performance', true), { excerpt: 'Caching: Revised the cache plan.', seq: 96 });
});

test('topic tags retain Unicode initials and collapse case variants', () => {
  assert.equal(titleCaseTag('école et mémoire'), 'École Et Mémoire');
  assert.deepEqual(cleanTags(['API', 'api', 'École', 'école', 'Research'], 2), ['API', 'École']);
  assert.deepEqual(cleanTags(['Research'], 0), []);
});

test('topic timeline keeps only the requested newest topics and preserves tie order', () => {
  const sessions = Array.from({ length: 20 }, (_, group) => ({ id: `session-${group}`, segments: Array.from({ length: 80 }, (_, index) => ({
    id: `${group}-${index}`, startAt: new Date(2026, 0, 1, 0, 0, (group * 80 + index) % 113).toISOString(),
  })) }));
  const expected = sessions.flatMap(meta => meta.segments.map(segment => ({ meta, segment })))
    .sort((a, b) => b.segment.startAt.localeCompare(a.segment.startAt)).slice(0, 30).map(item => item.segment.id);
  const page = recentTimelineTopics(sessions, 30);
  assert.equal(page.total, 1600);
  assert.equal(page.items.length, 30);
  assert.deepEqual(page.items.map(item => item.segment.id), expected);
  assert.equal(recentTimelineTopics(sessions, 0).items.length, 0);
});
