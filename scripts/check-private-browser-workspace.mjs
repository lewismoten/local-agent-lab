/** Run against a disposable incognito Chrome page with --remote-debugging-port=9245. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9245);
const base = process.env.APP_URL || 'http://127.0.0.1:5197/';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in a disposable incognito Chrome profile on debugging port ${port}.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(message.error) : waiter.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30_000);
  pending.set(id, {
    resolve: value => { clearTimeout(timer); resolve(value); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Page.enable');
  await waitFor("!!document.querySelector('.harness')", 'private workspace UI');
  const phase = process.env.PRIVATE_PHASE || 'full';
  if (phase === 'verify-empty') {
    const missing = await evaluate(`(async () => {
      const storage = await import('/src/storage.ts');
      const folder = await storage.browserFiles();
      try { await storage.readBlob(folder, 'checks/private-browser-smoke.txt'); return false; }
      catch (error) { if (error?.name !== 'NotFoundError') throw error; return true; }
    })()`);
    assert.equal(missing, true, 'incognito data survived after all private Chrome windows closed');
    console.log('Incognito browser storage was empty after closing and reopening the private session.');
  } else {
    const first = await evaluate(`(async () => {
      const storage = await import('/src/storage.ts');
      const folder = await storage.browserFiles();
      if (!folder) throw new Error('Browser storage is unavailable in this private session.');
      const path = 'checks/private-browser-smoke.txt';
      await storage.writeBlob(folder, path, new Blob(['private workspace smoke']));
      const saved = await (await storage.readBlob(folder, path)).text();
      return { saved, folderPicker: typeof showDirectoryPicker === 'function' };
    })()`);
    assert.equal(first.saved, 'private workspace smoke');

    if (phase === 'leave-file') {
      console.log('Saved private file. Close every Chrome window for this profile, then relaunch and run PRIVATE_PHASE=verify-empty.');
    } else {
      const requireMissingPicker = process.env.REQUIRE_MISSING_PICKER === '1';
      if (requireMissingPicker) assert.equal(first.folderPicker, false, 'browser flag did not remove the folder picker');
      else await call('Page.addScriptToEvaluateOnNewDocument', {
        source: "Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });",
      });
      await call('Page.reload', { ignoreCache: true });
      const fallback = await waitFor(`(() => {
        const workspace = document.querySelector('.harness-workspace');
        return workspace && typeof showDirectoryPicker !== 'function' && document.querySelector('.harness')
          ? { label: workspace.textContent, picker: typeof showDirectoryPicker }
          : null;
      })()`, 'restricted-picker fallback');
      assert.equal(fallback.picker, 'undefined');
      assert.ok(fallback.label.includes('Browser storage') || fallback.label.includes('Browser files'), fallback.label);
      const persisted = await evaluate(`(async () => {
        const storage = await import('/src/storage.ts');
        const folder = await storage.browserFiles();
        const path = 'checks/private-browser-smoke.txt';
        const value = await (await storage.readBlob(folder, path)).text();
        await storage.removeBlob(folder, path);
        return value;
      })()`);
      assert.equal(persisted, first.saved);
      console.log(JSON.stringify({ browserStorage: 'wrote, reloaded, read, and removed', pickerRestriction: requireMissingPicker ? 'browser feature disabled' : 'simulated missing API', fallback: 'browser storage shown', originalFolderPicker: first.folderPicker }));
    }
  }
} finally {
  socket.close();
}
