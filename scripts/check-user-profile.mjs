/** Optional UI check. Run Vite on 5198 and an empty temporary Chrome profile on CDP port 9239. */
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
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-user-profile-button')", 'profile button');
  await evaluate("document.querySelector('.harness-user-profile-button').click(); true");
  await waitFor("document.querySelector('.harness-user-profile-dialog')?.open", 'profile dialog');
  await evaluate(`(async () => {
    const dialog = document.querySelector('.harness-user-profile-dialog');
    const name = dialog.querySelector('input[aria-label="Your name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Riley');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#bd81e5'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'me.png', { type: 'image/png' }));
    const input = dialog.querySelector('input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-user-profile-preview img')", 'uploaded avatar preview');
  await evaluate("document.querySelector('.harness-user-profile-dialog .harness-dialog-actions .harness-primary').click(); true");
  const saved = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const profile = (await store.manifest()).userProfile;
    if (profile?.name !== 'Riley' || !profile.avatarAssetId) return false;
    const image = await store.avatarAsset(profile.avatarAssetId);
    return image ? { name: profile.name, size: image.size, libraryCount: (await store.avatarLibrary()).length } : false;
  })()`, 'saved profile');
  if (saved.libraryCount !== 1 || saved.size < 20) throw new Error(`User avatar not saved in the library: ${JSON.stringify(saved)}`);
  const fixture = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { createConversation } = await import('/src/harnessData.ts');
    const meta = createConversation('home');
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    await store.appendConversationMessage(meta, { id: crypto.randomUUID(), role: 'user', content: 'Hello from my profile.', createdAt: new Date().toISOString() });
    return meta.id;
  })()`);
  await evaluate(`location.hash = '/chat/${fixture}'; location.reload(); true`);
  await waitFor("document.querySelector('.harness-message.user .harness-message-meta strong')?.textContent === 'Riley' && !!document.querySelector('.harness-message.user .harness-user-chat-avatar img')", 'saved chat name and image after reload');
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('.harness-user-profile-button').click(); true");
  const mobile = await waitFor("(() => { const dialog = document.querySelector('.harness-user-profile-dialog'); return dialog?.open ? { width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, viewport: innerWidth } : false; })()", 'mobile profile dialog');
  if (mobile.scrollWidth > mobile.width + 2 || mobile.width > mobile.viewport) throw new Error(`Mobile profile dialog overflows: ${JSON.stringify(mobile)}`);
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const meta = (await store.sessions('home')).find(item => item.id === ${JSON.stringify(fixture)});
    if (meta) await store.deleteConversation(meta);
    return true;
  })()`);
  console.log('User profile passed: name, uploaded avatar, workspace persistence, chat display after reload, and mobile dialog fit.');
} finally { socket.close(); }
