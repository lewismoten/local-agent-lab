import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelinePage } from '../src/harnessTimeline.ts';

test('timeline can focus on visible conversations without losing an all-time comparison', () => {
  const recent = Array.from({ length: 8 }, (_, index) => ({
    id: `recent-${index}`,
    title: `Recent ${index}`,
    createdAt: `2026-10-17T${String(index + 8).padStart(2, '0')}:00:00.000Z`,
    updatedAt: `2026-10-17T${String(index + 9).padStart(2, '0')}:00:00.000Z`,
    segments: [],
  }));
  const old = { id: 'old', title: 'Old', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z', segments: [] };
  const sessions = [...recent, old];
  const focused = buildTimelinePage(sessions);
  const allTime = buildTimelinePage(sessions, 0, 8, 'all');

  assert.equal(focused.pages, 2);
  assert.deepEqual(focused.lanes.map(lane => lane.meta.id), allTime.lanes.map(lane => lane.meta.id));
  assert.ok(focused.lanes[0].width > 5, 'a recent one-hour conversation stays visible');
  assert.ok(allTime.lanes[0].width < focused.lanes[0].width, 'all-time view retains the long comparison');
  assert.equal(buildTimelinePage(sessions, 1).lanes[0].meta.id, 'old');
});
