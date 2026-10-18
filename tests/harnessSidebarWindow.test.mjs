import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarScrollForSelection, sidebarSessionWindow, SIDEBAR_SESSION_HEIGHT, sortedSidebarSessions } from '../src/harnessSidebarWindow.ts';

test('sidebar keeps pinned conversations ahead of recent sessions', () => {
  const sessions = [
    { id: 'old', pinned: false, updatedAt: '2026-01-01' },
    { id: 'pinned', pinned: true, updatedAt: '2025-01-01' },
    { id: 'new', pinned: false, updatedAt: '2026-02-01' },
  ];
  assert.deepEqual(sortedSidebarSessions(sessions).map(item => item.id), ['pinned', 'new', 'old']);
  assert.equal(sessions[0].id, 'old');
});

test('thousands of sidebar sessions render a small visible window', () => {
  const first = sidebarSessionWindow(10_000, 0, 560);
  assert.equal(first.start, 0);
  assert.ok(first.end < 30);
  const middle = sidebarSessionWindow(10_000, 5000 * SIDEBAR_SESSION_HEIGHT, 560);
  assert.ok(middle.start <= 5000 && middle.end > 5000);
  assert.ok(middle.end - middle.start < 30);
  assert.equal(middle.height, 10_000 * SIDEBAR_SESSION_HEIGHT);
});

test('opening an old conversation scrolls its row into view', () => {
  assert.equal(sidebarScrollForSelection(1000, 0, 560), (1001 * SIDEBAR_SESSION_HEIGHT) - 560);
  assert.equal(sidebarScrollForSelection(1000, 1000 * SIDEBAR_SESSION_HEIGHT, 560), 1000 * SIDEBAR_SESSION_HEIGHT);
  assert.equal(sidebarScrollForSelection(0, 500, 560), 0);
  assert.equal(sidebarScrollForSelection(-1, 500, 560), 500);
});
