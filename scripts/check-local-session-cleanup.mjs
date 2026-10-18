/** Run only against a fresh disposable Chrome profile. This deletes app data in that profile. */
import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9245);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
  .find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in a fresh disposable Chrome profile first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 160; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await waitFor("!!document.querySelector('.harness-end-session')", 'workspace controls');
  await evaluate(`(async () => {
    localStorage.setItem('model-download-queue', 'private');
    localStorage.setItem('other-app-keep', 'preserved');
    sessionStorage.setItem('browser-model-tab', 'catalog');
    sessionStorage.setItem('other-tab-keep', 'preserved');
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle('local-agent-lab', { create: true });
    const file = await app.getFileHandle('cleanup-check.txt', { create: true });
    const writer = await file.createWritable(); await writer.write('private'); await writer.close();
    const other = await root.getDirectoryHandle('unrelated-check', { create: true });
    const kept = await other.getFileHandle('keep.txt', { create: true });
    const keepWriter = await kept.createWritable(); await keepWriter.write('preserved'); await keepWriter.close();
    await caches.open('local-agent-lab-shell-cleanup-check');
    await caches.open('unrelated-cache-check');
    return true;
  })()`);
  await evaluate("document.querySelector('.harness-end-session').click(); true");
  const dialog = await waitFor("document.querySelector('.harness-confirm-dialog[open]')?.textContent", 'confirmation dialog');
  assert.match(dialog, /Files on a connected drive remain there/);
  await evaluate("document.querySelector('.harness-confirm-dialog .danger').click(); true");
  await waitFor("location.pathname.endsWith('/session-ended.html') && document.querySelector('#state')?.textContent?.includes('Browser data cleared')", 'cleanup completion');
  const result = await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    let appExists = true;
    try { await root.getDirectoryHandle('local-agent-lab'); } catch (error) { if (error.name === 'NotFoundError') appExists = false; else throw error; }
    const other = await root.getDirectoryHandle('unrelated-check');
    const otherText = await (await (await other.getFileHandle('keep.txt')).getFile()).text();
    const databases = (await indexedDB.databases()).map(item => item.name);
    const names = await caches.keys();
    return { appExists, otherText, databases, names, ownedLocal: localStorage.getItem('model-download-queue'),
      otherLocal: localStorage.getItem('other-app-keep'), ownedSession: sessionStorage.getItem('browser-model-tab'),
      otherSession: sessionStorage.getItem('other-tab-keep'), status: document.querySelector('#state').textContent };
  })()`);
  assert.equal(result.appExists, false);
  assert.equal(result.otherText, 'preserved');
  assert.equal(result.ownedLocal, null);
  assert.equal(result.ownedSession, null);
  assert.equal(result.otherLocal, 'preserved');
  assert.equal(result.otherSession, 'preserved');
  assert.ok(!result.databases.some(name => ['local-agent-lab', 'rivers-of-memory', 'rivers-story-chat'].includes(name)));
  assert.ok(!result.names.some(name => name.startsWith('local-agent-lab-shell-')));
  assert.ok(result.names.includes('unrelated-cache-check'));
  console.log(JSON.stringify(result, null, 2));
} finally { socket.close(); }
