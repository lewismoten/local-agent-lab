/** Browser check. Run Vite on 5198 and fresh Chrome on CDP port 9247. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9247);
const appModule = await (await fetch(new URL('src/HarnessApp.tsx', base))).text();
const storeUrl = appModule.match(/from "(\/src\/toastStore\.ts\?t=\d+)"/)?.[1];
if (!storeUrl) throw new Error('Could not identify the toast store used by the mounted app.');
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`No Chrome page at ${base}.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 15_000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 70; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-sidebar')", 'app');
  await evaluate(`(async () => { const { showToast } = await import(${JSON.stringify(storeUrl)}); showToast('Achievement unlocked.', 'success', { label: 'View achievements', onClick: () => { location.hash = '/achievements'; } }); return true; })()`);
  await waitFor("!!document.querySelector('.toast-action')", 'toast action');
  await evaluate("document.querySelector('.toast-action').click(); true");
  await waitFor("location.hash === '#/achievements' && !document.querySelector('.toast-action')", 'action navigation');
  await evaluate(`(async () => {
    const { showToast } = await import(${JSON.stringify(storeUrl)});
    const { openToastImagePreview } = await import('/src/toastImagePreview.ts');
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    showToast('Image ready.', 'success', { label: 'View image', onClick: () => openToastImagePreview(image, 'Toast image') });
    return true;
  })()`);
  await waitFor("!!document.querySelector('.toast-action')", 'image action');
  await evaluate("document.querySelector('.toast-action').click(); true");
  await waitFor("document.querySelector('.toast-image-preview')?.open && document.querySelector('.toast-image-preview img')?.complete", 'image preview');
  const details = await evaluate("({ title: document.querySelector('.toast-image-preview h2')?.textContent, naturalWidth: document.querySelector('.toast-image-preview img')?.naturalWidth })");
  if (details.title !== 'Toast image' || details.naturalWidth !== 8) throw new Error(`Image action opened the wrong result: ${JSON.stringify(details)}`);
  await evaluate("document.querySelector('.toast-image-preview button').click(); true");
  await waitFor("!document.querySelector('.toast-image-preview')", 'preview cleanup');
  console.log('Toast actions passed: navigate to achievements, open the generated image, and clean up the dialog.');
} finally { socket.close(); }
