import test from 'node:test';
import assert from 'node:assert/strict';

function lockManager() {
  let held = false;
  const pending = [];
  const next = () => {
    if (held) return;
    const entry = pending.shift();
    if (!entry) return;
    held = true;
    entry.signal?.removeEventListener('abort', entry.onAbort);
    Promise.resolve().then(entry.callback).then(entry.resolve, entry.reject).finally(() => {
      held = false;
      next();
    });
  };
  return {
    request(_name, options, callback) {
      return new Promise((resolve, reject) => {
        const entry = {
          callback, resolve, reject, signal: options.signal,
          onAbort: () => {
            const index = pending.indexOf(entry);
            if (index >= 0) pending.splice(index, 1);
            reject(options.signal.reason || new DOMException('Cancelled.', 'AbortError'));
          },
        };
        if (options.signal?.aborted) { entry.onAbort(); return; }
        options.signal?.addEventListener('abort', entry.onAbort, { once: true });
        pending.push(entry);
        next();
      });
    },
  };
}

test('model work is serialized across tabs and local chat keeps priority', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: lockManager() } });
  try {
    const firstTab = await import('../src/harnessLease.ts?tab=first');
    const secondTab = await import('../src/harnessLease.ts?tab=second');
    const releaseFirst = await firstTab.acquireModel('chat:first');
    const order = [];
    const background = secondTab.acquireModel('agent:background').then(release => { order.push('background'); return release; });
    const chat = secondTab.acquireModel('chat:second').then(release => { order.push('chat'); return release; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(order, []);
    assert.deepEqual(secondTab.getModelLease(), { owner: 'chat:second', waiting: 1 });
    releaseFirst();
    const releaseChat = await chat;
    assert.deepEqual(order, ['chat']);
    releaseChat();
    const releaseBackground = await background;
    assert.deepEqual(order, ['chat', 'background']);
    releaseBackground();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(secondTab.getModelLease(), { owner: null, waiting: 0 });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('a cancelled cross-tab lock wait does not strand the next request', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: lockManager() } });
  try {
    const firstTab = await import('../src/harnessLease.ts?tab=holder');
    const secondTab = await import('../src/harnessLease.ts?tab=cancelled');
    const releaseFirst = await firstTab.acquireModel('chat:first');
    const controller = new AbortController();
    const cancelled = secondTab.acquireModel('agent:cancelled', controller.signal);
    const next = secondTab.acquireModel('agent:next');
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(secondTab.getModelLease().owner, 'agent:next');
    releaseFirst();
    const releaseNext = await next;
    releaseNext();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('the in-tab queue still works when Web Locks are unavailable', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const lease = await import('../src/harnessLease.ts?tab=no-locks');
    const releaseFirst = await lease.acquireModel('agent:first');
    const order = [];
    const background = lease.acquireModel('agent:second').then(release => { order.push('agent'); return release; });
    const chat = lease.acquireModel('chat:next').then(release => { order.push('chat'); return release; });
    releaseFirst();
    const releaseChat = await chat;
    assert.deepEqual(order, ['chat']);
    releaseChat();
    const releaseBackground = await background;
    assert.deepEqual(order, ['chat', 'agent']);
    releaseBackground();
    assert.deepEqual(lease.getModelLease(), { owner: null, waiting: 0 });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});
