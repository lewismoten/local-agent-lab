/** Optional browser check. Run Vite on 5198 and disposable Chrome on CDP port 9252. */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAvatarPack } from '../src/harnessAvatarPackTransfer.ts';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9252);
const downloadPath = await mkdtemp(join(tmpdir(), 'rivers-avatar-pack-transfer-'));
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error('No identities page found.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id; pending.set(next, { resolve, reject });
  socket.send(JSON.stringify({ id: next, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (probe, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await probe(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
try {
  await call('Runtime.enable');
  await call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
  await waitFor(() => evaluate("!!document.querySelector('.harness-avatar-library-actions input[type=file]')"), 'pack import control');
  await evaluate(`(async () => {
    const { exportAvatarPack } = await import('/src/harnessAvatarPackTransfer.ts');
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = '#52ab83'; context.fillRect(0, 0, 32, 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const asset = { id: 'fixture', title: 'Navigator', tags: ['Guide'], source: 'generated', prompt: 'Original navigator' };
    const json = await exportAvatarPack('Test crew', [asset], async () => blob);
    const file = new File([json], 'test.avatar-pack.json', { type: 'application/json' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('.harness-avatar-library-actions input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const imported = await waitFor(() => evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const assets = await store.avatarLibrary();
    const asset = assets.find(item => item.title === 'Navigator');
    return asset?.packName === 'Test crew' && !!(await store.avatarAsset(asset.id));
  })()`), 'imported pack image');
  if (!imported) throw new Error('The imported image was not stored.');
  await waitFor(() => evaluate("document.querySelector('.harness-avatar-library-actions select[aria-label=\"Avatar pack\"]')?.selectedOptions[0]?.textContent === 'Test crew' && !!document.querySelector('.harness-avatar-tile strong')"), 'selected pack filter');
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent === 'Export pack').click(); true");
  const filename = await waitFor(async () => (await readdir(downloadPath)).find(name => name.endsWith('.avatar-pack.json')), 'pack download');
  const exported = importAvatarPack(JSON.parse(await readFile(`${downloadPath}/${filename}`, 'utf8')));
  if (exported.name !== 'Test crew' || exported.avatars.length !== 1 || exported.avatars[0].input.title !== 'Navigator') throw new Error('Export lost pack metadata or image.');
  console.log('Avatar pack browser transfer passed: import, pack filter, stored PNG, and export.');
} finally { socket.close(); await rm(downloadPath, { recursive: true, force: true }); }
