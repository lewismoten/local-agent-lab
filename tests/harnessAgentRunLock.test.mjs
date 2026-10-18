import test from 'node:test';
import assert from 'node:assert/strict';
import { withAgentRunLock, withIdleAgentLock } from '../src/harnessAgentRunLock.ts';

test('only one tab runs a due agent and stale schedules are skipped', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const held = new Set();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name, options, callback) {
      if (options.ifAvailable && held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); }
      finally { held.delete(name); }
    },
  } } });
  try {
    const due = { id: 'ada', schedule: 'interval', paused: false, nextRunAt: new Date(Date.now() - 1000).toISOString() };
    const manifest = { agents: [due] };
    const store = { workspaceId: 'test-workspace', manifest: async () => manifest };
    let finish;
    const first = withAgentRunLock(store, due, false, async () => {
      await new Promise(resolve => { finish = resolve; });
      manifest.agents = [{ ...due, nextRunAt: new Date(Date.now() + 300_000).toISOString() }];
      return 'ran';
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(await withAgentRunLock(store, due, false, async () => 'duplicate'), null);
    finish();
    assert.equal(await first, 'ran');
    assert.equal(await withAgentRunLock(store, due, false, async () => 'stale'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('a changed pending event does not run from an older tab snapshot', async () => {
  const old = { id: 'ada', schedule: 'event', paused: false, nextRunAt: new Date(Date.now() - 1000).toISOString(), pendingEvents: [{ id: 'old' }] };
  const store = { workspaceId: 'events', manifest: async () => ({ agents: [{ ...old, pendingEvents: [{ id: 'new' }] }] }) };
  assert.equal(await withAgentRunLock(store, old, false, async () => 'ran'), null);
});

test('a persisted run claim holds the schedule for review after an interrupted run', async () => {
  const due = { id: 'ada', schedule: 'event', paused: false, nextRunAt: new Date(Date.now() - 1000).toISOString(), pendingEvents: [{ id: 'event-1' }], runClaim: { id: 'run-1', startedAt: '2026-01-01T00:00:00Z', projectId: 'home', eventId: 'event-1' } };
  const store = { workspaceId: 'claim-test', manifest: async () => ({ agents: [due] }) };
  assert.equal(await withAgentRunLock(store, due, false, async () => 'duplicate'), null);
  assert.equal(await withAgentRunLock(store, due, true, async () => 'duplicate'), null);
  assert.equal(due.pendingEvents.length, 1);
});

test('an interrupted claim cannot be cleared while its agent is running in another tab', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const held = new Set();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name, options, callback) {
      if (options.ifAvailable && held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); }
      finally { held.delete(name); }
    },
  } } });
  try {
    let release;
    const running = withIdleAgentLock('claim-test', 'ada', () => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(await withIdleAgentLock('claim-test', 'ada', async () => 'cleared'), null);
    release('finished');
    assert.equal(await running, 'finished');
    assert.equal(await withIdleAgentLock('claim-test', 'ada', async () => 'cleared'), 'cleared');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});
