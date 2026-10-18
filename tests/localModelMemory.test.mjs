import test from 'node:test';
import assert from 'node:assert/strict';
import { withLocalModelMemory } from '../src/localModelMemory.ts';

test('an image load waits for the active local model operation to finish', async () => {
  let finishText;
  const textFinished = new Promise(resolve => { finishText = resolve; });
  const events = [];
  const text = withLocalModelMemory(async () => { events.push('text start'); await textFinished; events.push('text end'); });
  const image = withLocalModelMemory(async () => { events.push('image start'); });
  await new Promise(resolve => setTimeout(resolve, 0));
  try { assert.deepEqual(events, ['text start']); }
  finally { finishText(); }
  await Promise.all([text, image]);
  assert.deepEqual(events, ['text start', 'text end', 'image start']);
});

test('a failed local model operation releases the next switch', async () => {
  await assert.rejects(withLocalModelMemory(async () => { throw new Error('load failed'); }), /load failed/);
  assert.equal(await withLocalModelMemory(async () => 'ready'), 'ready');
});

test('browser runtime work stays serialized across tabs, including after a failure', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: exclusiveLocks() } });
  try {
    const firstTab = await import('../src/localModelMemory.ts?tab=first');
    const secondTab = await import('../src/localModelMemory.ts?tab=second');
    const order = [];
    let finish;
    const first = firstTab.withLocalModelMemory(async () => {
      order.push('first:start');
      await new Promise(resolve => { finish = resolve; });
      order.push('first:end');
      throw new Error('runtime failed');
    });
    const second = secondTab.withLocalModelMemory(async () => { order.push('second'); return 'ready'; });
    for (let attempt = 0; attempt < 10 && !order.length; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
    try { assert.deepEqual(order, ['first:start']); }
    finally { finish?.(); }
    await assert.rejects(first, /runtime failed/);
    assert.equal(await second, 'ready');
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('local runtime queue remains usable without Web Locks', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const memory = await import('../src/localModelMemory.ts?tab=fallback');
    const order = [];
    const first = memory.withLocalModelMemory(async () => { order.push('first'); return 1; });
    const second = memory.withLocalModelMemory(async () => { order.push('second'); return 2; });
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ['first', 'second']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

function exclusiveLocks() {
  const held = new Set();
  const queues = new Map();
  const pump = name => {
    if (held.has(name)) return;
    const queue = queues.get(name) || [];
    const entry = queue.shift();
    if (!entry) return;
    held.add(name);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    Promise.resolve().then(entry.callback).then(entry.resolve, entry.reject).finally(() => {
      held.delete(name);
      pump(name);
    });
  };
  return {
    isHeld: name => held.has(name),
    request(name, optionsOrCallback, maybeCallback) {
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      const callback = maybeCallback || optionsOrCallback;
      return new Promise((resolve, reject) => {
        const queue = queues.get(name) || [];
        queues.set(name, queue);
        const entry = {
          callback, resolve, reject, signal: options.signal,
          onAbort: () => {
            const index = queue.indexOf(entry);
            if (index >= 0) queue.splice(index, 1);
            reject(options.signal.reason);
          },
        };
        if (options.signal?.aborted) { entry.onAbort(); return; }
        options.signal?.addEventListener('abort', entry.onAbort, { once: true });
        queue.push(entry);
        pump(name);
      });
    },
  };
}

test('an explicit unload releases residency without another queued operation', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const locks = exclusiveLocks();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  try {
    const memory = await import('../src/localModelMemory.ts?tab=manual-unload');
    let loaded = false;
    memory.registerResidentModel('fake', () => loaded, async () => { loaded = false; });
    await memory.withLocalModelMemory(async () => { loaded = true; });
    assert.equal(locks.isHeld('local-agent-lab:resident-model'), true);

    loaded = false;
    memory.notifyResidentModelUnloaded();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(locks.isHeld('local-agent-lab:resident-model'), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('unloading during a model switch retains residency until the switch finishes', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const locks = exclusiveLocks();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  try {
    const memory = await import('../src/localModelMemory.ts?tab=switch-unload');
    let loaded = false;
    memory.registerResidentModel('fake', () => loaded, async () => { loaded = false; });
    await memory.withLocalModelMemory(async () => { loaded = true; });
    await memory.withLocalModelMemory(async () => {
      loaded = false;
      memory.notifyResidentModelUnloaded();
      assert.equal(locks.isHeld('local-agent-lab:resident-model'), true);
      loaded = true;
    });
    assert.equal(locks.isHeld('local-agent-lab:resident-model'), true);
    loaded = false;
    memory.notifyResidentModelUnloaded();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(locks.isHeld('local-agent-lab:resident-model'), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('a second tab asks an idle tab to unload its resident browser model', async () => {
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const broadcastBefore = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  const channels = new Set();
  class Channel {
    constructor(name) { this.name = name; this.listeners = new Set(); channels.add(this); }
    addEventListener(_type, listener) { this.listeners.add(listener); }
    postMessage(data) {
      queueMicrotask(() => { for (const channel of channels) if (channel !== this && channel.name === this.name) for (const listener of channel.listeners) listener({ data }); });
    }
    close() { channels.delete(this); }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: exclusiveLocks() } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: Channel });
  try {
    const first = await import('../src/localModelMemory.ts?tab=resident-a');
    const second = await import('../src/localModelMemory.ts?tab=resident-b');
    let firstLoaded = false, secondLoaded = false;
    first.registerResidentModel('fake', () => firstLoaded, async () => { firstLoaded = false; });
    second.registerResidentModel('fake', () => secondLoaded, async () => { secondLoaded = false; });
    await first.withLocalModelMemory(async () => { firstLoaded = true; });
    assert.equal(firstLoaded, true);
    await second.withLocalModelMemory(async () => { assert.equal(firstLoaded, false); secondLoaded = true; });
    assert.equal(secondLoaded, true);
    await second.withLocalModelMemory(async () => { secondLoaded = false; });
  } finally {
    for (const channel of channels) channel.close();
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore); else delete globalThis.navigator;
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore); else delete globalThis.window;
    if (broadcastBefore) Object.defineProperty(globalThis, 'BroadcastChannel', broadcastBefore); else delete globalThis.BroadcastChannel;
  }
});

test('an unresponsive resident tab fails clearly and a later retry can proceed', async () => {
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const timeoutBefore = globalThis.setTimeout;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: exclusiveLocks() } });
  globalThis.setTimeout = (callback, delay, ...args) => timeoutBefore(callback, delay === 15_000 ? 15 : delay, ...args);
  try {
    const first = await import('../src/localModelMemory.ts?tab=unresponsive-a');
    const second = await import('../src/localModelMemory.ts?tab=unresponsive-b');
    let loaded = false;
    first.registerResidentModel('fake', () => loaded, async () => { loaded = false; });
    await first.withLocalModelMemory(async () => { loaded = true; });
    await assert.rejects(second.withLocalModelMemory(async () => 'never'), /Another tab still holds a browser model/);
    await first.withLocalModelMemory(async () => { loaded = false; });
    assert.equal(await second.withLocalModelMemory(async () => 'ready'), 'ready');
  } finally {
    globalThis.setTimeout = timeoutBefore;
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore); else delete globalThis.navigator;
  }
});
