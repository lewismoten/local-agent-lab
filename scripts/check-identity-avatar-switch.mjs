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
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-nav')", 'workspace');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = '#48d9b3'; context.fillRect(0, 0, 32, 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const path = await store.saveIdentityAvatar('ada', blob);
    await store.updateManifest(current => ({ ...current, identities: current.identities.map(identity => identity.id === 'ada' ? { ...identity, avatarPath: path } : identity) }));
    location.href = ${JSON.stringify(base + '#/identities')}; location.reload();
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-identity-card')", 'identity cards');
  await evaluate("document.querySelector('.harness-identity-card button').click(); true");
  await waitFor("!!document.querySelector('.harness-identity-dialog[open] button[aria-label=\"Image avatar\"]')", 'saved avatar choice');
  await evaluate(`(() => {
    const dialog = document.querySelector('.harness-identity-dialog');
    const prompt = dialog.querySelector('.harness-identity-avatar-prompt textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(prompt, 'Custom picture idea.');
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector('button[aria-label="Shield icon"]').click();
    return true;
  })()`);
  const switched = await waitFor(`(() => {
    const dialog = document.querySelector('.harness-identity-dialog');
    const shield = dialog.querySelector('button[aria-label="Shield icon"]');
    return shield?.getAttribute('aria-pressed') === 'true' ? {
      customPrompt: dialog.querySelector('.harness-identity-avatar-prompt textarea').value,
      imageAvailable: !!dialog.querySelector('button[aria-label="Image avatar"]'),
    } : false;
  })()`, 'icon choice');
  if (switched.customPrompt !== 'Custom picture idea.' || !switched.imageAvailable) throw new Error(`Switching icons lost the custom prompt or image: ${JSON.stringify(switched)}`);
  await evaluate("document.querySelector('.harness-identity-dialog .harness-identity-avatar-prompt button').click(); true");
  const suggested = await evaluate("document.querySelector('.harness-identity-dialog .harness-identity-avatar-prompt textarea').value");
  if (!suggested.includes('protective shield emblem')) throw new Error(`Suggested prompt did not follow the icon: ${suggested}`);
  await evaluate("document.querySelector('.harness-identity-dialog .harness-dialog-actions .harness-primary').click(); true");
  await waitFor("!document.querySelector('.harness-identity-dialog[open]')", 'identity save');
  const saved = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const identity = (await store.manifest()).identities.find(item => item.id === 'ada');
    return { icon: identity.icon, avatarPath: identity.avatarPath, imagePresent: !!(await store.identityAvatar('ada')) };
  })()`);
  if (saved.icon !== 'shield' || saved.avatarPath || !saved.imagePresent) throw new Error(`Icon save lost image or selected wrong choice: ${JSON.stringify(saved)}`);
  await evaluate("document.querySelector('.harness-identity-card button').click(); true");
  await waitFor("!!document.querySelector('.harness-identity-dialog[open] button[aria-label=\"Image avatar\"]')", 'retained image choice');
  await evaluate("document.querySelector('.harness-identity-dialog button[aria-label=\"Image avatar\"]').click(); true");
  const restored = await evaluate("document.querySelector('.harness-identity-dialog button[aria-label=\"Image avatar\"]').getAttribute('aria-pressed')");
  if (restored !== 'true') throw new Error('The saved image could not be selected again.');
  console.log('Identity avatar switch passed: image retained after icon save, restored on edit, and icon-aware prompt respected custom text.');
} finally { socket.close(); }
