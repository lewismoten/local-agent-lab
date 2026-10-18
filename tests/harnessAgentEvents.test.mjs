import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissAgentEvent } from '../src/harnessAgentEvents.ts';

const due = '2026-10-18T12:30:00.000Z';
const events = [
  { id: 'one', projectId: 'home', description: 'First edit', createdAt: due },
  { id: 'two', projectId: 'code', description: 'Second edit', createdAt: due },
];

test('dismissing one pending event preserves the others and a user delay', () => {
  const agent = { schedule: 'event', nextRunAt: due, pendingEvents: events, pendingEvent: '' };
  const next = dismissAgentEvent(agent, 'one');
  assert.deepEqual(next.pendingEvents, [events[1]]);
  assert.equal(next.nextRunAt, due);
  assert.deepEqual(agent.pendingEvents, events);
});

test('dismissing the final event clears the event schedule', () => {
  const agent = { schedule: 'event', nextRunAt: due, pendingEvents: [events[0]], pendingEvent: '' };
  const next = dismissAgentEvent(agent, 'one');
  assert.deepEqual(next.pendingEvents, []);
  assert.equal(next.nextRunAt, '');
});

test('legacy events can be dismissed, but claimed or stale events cannot', () => {
  const legacy = { schedule: 'event', nextRunAt: due, pendingEvents: [], pendingEvent: 'Old event', pendingProjectId: 'home' };
  const next = dismissAgentEvent(legacy, 'legacy');
  assert.equal(next.pendingEvent, '');
  assert.equal(next.pendingProjectId, '');
  assert.equal(next.nextRunAt, '');
  assert.throws(() => dismissAgentEvent(legacy, 'missing'), /already handled/);
  assert.throws(() => dismissAgentEvent({ ...legacy, runClaim: { id: 'run' } }, 'legacy'), /running/);
});
