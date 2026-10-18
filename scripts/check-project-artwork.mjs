/** UI check with Vite on 5198 and an isolated Chrome profile on CDP port 9244. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9244);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-project-select .harness-surface-artwork-button')", 'project icon control');
  await evaluate("document.querySelector('.harness-project-select .harness-surface-artwork-button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'project icon editor');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#3ac7bc'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'project.png', { type: 'image/png' }));
    const input = document.querySelector('.harness-surface-artwork-dialog input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-project-select .harness-surface-artwork-button img')", 'uploaded project icon');
  const saved = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const entry = (await store.surfaceArtwork()).items['project:home'];
    return entry && !!await store.avatarAsset(entry.assetId);
  })()`);
  if (!saved) throw new Error('Home project icon was not saved in the workspace.');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); location.reload(); true");
  await waitFor("!!document.querySelector('.harness-project-select .harness-surface-artwork-button img')", 'project icon after reload');
  await evaluate("document.querySelector('.harness-project-select button[aria-label=\"New project\"]').click(); true");
  await waitFor("document.querySelector('dialog h2')?.textContent === 'New project' || [...document.querySelectorAll('dialog')].some(dialog => dialog.open && dialog.querySelector('h2')?.textContent === 'New project')", 'new project dialog');
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'New project');
    const input = dialog.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Second project');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate("[...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'New project').querySelector('.harness-primary').click(); true");
  await waitFor("document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Second project'", 'second project selected');
  if (await evaluate("!!document.querySelector('.harness-project-select .harness-surface-artwork-button img')")) throw new Error('The new project inherited the Home icon.');
  await evaluate("(() => { const select = document.querySelector('#project-select'); select.value = 'home'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await waitFor("!!document.querySelector('.harness-project-select .harness-surface-artwork-button img')", 'Home icon after project switch');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const fit = await evaluate("(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth, control: document.querySelector('.harness-project-select').getBoundingClientRect().right }))()");
  if (fit.body > fit.viewport + 2 || fit.control > fit.viewport + 1) throw new Error(`Project switcher overflows mobile viewport: ${JSON.stringify(fit)}`);
  console.log('Project artwork passed: upload, workspace persistence, reload, project isolation, switch back, and 390 px layout.');
} finally { socket.close(); }
