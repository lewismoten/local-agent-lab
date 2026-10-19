/** Optional UI check. Run Vite on 5198 and an empty Chrome profile on CDP port 9239. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`No Chrome page at ${base}.`);
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
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || result.result?.description || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-identity-card')", 'identities page');
  await evaluate("document.querySelector('.harness-identity-card button').click(); true");
  await waitFor("!!document.querySelector('.harness-identity-dialog[open] input[type=file]')", 'identity editor');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#54dab5'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('.harness-identity-dialog input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-identity-dialog button[aria-label=\"Image avatar\"]')", 'uploaded image');
  await evaluate("document.querySelector('.harness-identity-dialog .harness-dialog-actions .harness-primary').click(); true");
  const initial = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const assets = await store.avatarLibrary();
    const active = (await store.manifest()).identities.find(item => item.id === 'ada')?.avatarPath;
    return assets.length && active ? { assets, active } : false;
  })()`, 'saved avatar asset');
  if (initial.assets.length !== 1 || initial.assets[0].source !== 'uploaded' || !initial.active) throw new Error(`Upload did not create a reusable asset: ${JSON.stringify(initial)}`);
  await evaluate("location.hash = '/images'; true");
  await waitFor("!!document.querySelector('.harness-avatar-library .harness-avatar-tile button')", 'gallery tile');
  await waitFor("[...document.querySelectorAll('select[aria-label=\"Image use\"] option')].some(option => option.value === 'Avatars')", 'avatar use category');
  await evaluate("document.querySelector('.harness-avatar-library .harness-avatar-tile button:nth-child(2)').click(); true");
  await waitFor("!!document.querySelector('.harness-avatar-asset-dialog[open]')", 'asset editor');
  await evaluate(`(() => {
    const dialog = document.querySelector('.harness-avatar-asset-dialog');
    const inputs = dialog.querySelectorAll('input');
    for (const [index, value] of ['Neon Ada', 'Teal, Robot'].entries()) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    }
    dialog.querySelector('.harness-primary').click(); return true;
  })()`);
  await waitFor("!document.querySelector('.harness-avatar-asset-dialog[open]')", 'saved labels');
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search saved images"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'robot');
    input.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await waitFor("document.querySelector('.harness-avatar-library .harness-avatar-tile strong')?.textContent === 'Neon Ada'", 'tag search');
  await evaluate("document.querySelector('.harness-avatar-library .harness-avatar-tile button').click(); true");
  await waitFor("!!document.querySelector('.harness-identity-dialog[open]')", 'new identity from gallery');
  await evaluate(`(() => {
    const dialog = document.querySelector('.harness-identity-dialog');
    const labels = [...dialog.querySelectorAll('label')];
    const set = (label, value) => {
      const field = labels.find(item => item.textContent.startsWith(label)).querySelector('input,textarea');
      const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('Name', 'Nova'); set('Instructions', 'Help with coding tasks.');
    dialog.querySelector('.harness-dialog-actions .harness-primary').click(); return true;
  })()`);
  const reused = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const nova = (await store.manifest()).identities.find(item => item.name === 'Nova');
    if (!nova?.avatarPath) return false;
    const first = await store.identityAvatar('ada'), second = await store.identityAvatar(nova.id);
    const original = first ? new Uint8Array(await first.arrayBuffer()) : null;
    const copy = second ? new Uint8Array(await second.arrayBuffer()) : null;
    const assets = await store.avatarLibrary();
    return { same: !!original && !!copy && original.length === copy.length && original.every((byte, index) => byte === copy[index]),
      assetCount: assets.length, linked: nova.avatarAssetId === assets[0]?.id };
  })()`, 'reused image');
  if (!reused.same || reused.assetCount !== 1 || !reused.linked) throw new Error(`Avatar reuse failed: ${JSON.stringify(reused)}`);
  console.log('Avatar gallery passed: upload, catalog, labels, tag search, and reuse in another identity without duplicate assets.');
} finally { socket.close(); }
