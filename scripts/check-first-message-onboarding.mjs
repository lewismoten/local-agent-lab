/** Optional UI check. Run Vite on 5198 and an empty Chrome profile on CDP port 9239. */
import { writeFile } from 'node:fs/promises';

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
  if (process.env.MOBILE === '1') await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  await waitFor("!!document.querySelector('.harness-starter-action button') && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'chat starter');
  await evaluate(`(() => {
    const box = document.querySelector('.harness-compose textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Help me build a small project.');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("(() => { const button = document.querySelector('.harness-compose-box button[title=\"Choose a model to send\"]'); return button && !button.disabled; })()", 'enabled Send button');
  await evaluate("document.querySelector('.harness-compose-box button[title=\"Choose a model to send\"]').click(); true");
  const state = await waitFor(`(async () => {
    const action = document.querySelector('.harness-starter-action button');
    const { getModelDownload } = await import('/src/modelDownloadSession.ts');
    return document.activeElement === action ? {
      route: location.hash, draft: document.querySelector('.harness-compose textarea').value,
      status: document.querySelector('.harness-compose small[role="status"]')?.textContent || '',
      messages: document.querySelectorAll('.harness-message').length,
      queued: getModelDownload().queue.length,
    } : false;
  })()`, 'inline setup focus');
  if ((state.route && !state.route.startsWith('#/chat')) || state.draft !== 'Help me build a small project.' || !state.status.includes('Choose a model') || state.messages !== 0 || state.queued !== 0) {
    throw new Error(`First-message setup changed the draft or started a download: ${JSON.stringify(state)}`);
  }
  if (process.env.SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  console.log(`First-message setup passed at ${process.env.MOBILE === '1' ? '414×896' : 'desktop'}: draft kept, starter focused, no automatic download.`);
} finally { socket.close(); }
