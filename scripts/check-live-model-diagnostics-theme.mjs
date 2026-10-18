/** Optional live layout check. Requires a licensed chat GGUF in disposable Chrome on CDP 9239 and Vite on 5198. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9239);
const pages = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in the disposable Chrome profile first.`);
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 120_000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 320; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const snapshot = await evaluate('({ url: location.href, width: innerWidth, height: innerHeight })');
const details = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await evaluate(`location.hash = '#/models'; true`);
  await waitFor("!![...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled)", 'Inspect features button');
  await evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled).click(); true");
  await waitFor("!!document.querySelector('.model-diagnostics-dialog[open]')", 'model diagnostics dialog');
  await evaluate("document.querySelector('.model-diagnostics-dialog[open] .model-diagnostics-actions button')?.click(); true");
  await waitFor("!!document.querySelector('.model-diagnostics-dialog[open] .diagnostic-tabs button[role=tab]:nth-child(2)')", 'first live test tab');
  await waitFor("(() => { const dialog = document.querySelector('.model-diagnostics-dialog[open]'); return dialog && ![...dialog.querySelectorAll('.model-diagnostics-actions button')].some(item => item.textContent?.trim() === 'Testing…'); })()", 'finished diagnostics');
  await evaluate("document.querySelector('#diagnostic-tab-main')?.click(); true");
  const tested = await waitFor("(() => { const items = [...document.querySelectorAll('.model-diagnostics-dialog[open] .diagnostic-overview-tests strong')].map(item => item.textContent); return items.length ? items : false; })()", 'diagnostic overview');
  assert.ok(tested.some(item => item.includes('Passed')), 'at least one real diagnostic should pass');
  await evaluate("document.querySelector('#diagnostic-tab-1')?.click(); true");
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 150));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.model-diagnostics-dialog[open]');
      const panel = dialog.querySelector('.diagnostic-tab-panel');
      const rect = dialog.getBoundingClientRect();
      const style = getComputedStyle(dialog);
      return { width: innerWidth, height: innerHeight, colorScheme: style.colorScheme, background: style.backgroundColor, textColor: style.color,
        dialog: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth },
        panel: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }, tabs: dialog.querySelectorAll('.diagnostic-tabs button').length };
    })()`);
    details.push(state);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-live-diagnostics-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    assert.equal(state.colorScheme, 'dark', 'diagnostics should use the dark color scheme');
    assert.ok(state.dialog.left >= -1 && state.dialog.right <= width + 1, 'dialog should fit horizontally');
    assert.ok(state.dialog.scrollWidth <= state.dialog.clientWidth + 1, 'dialog content should not overflow horizontally');
    assert.ok(state.panel.scrollWidth <= state.panel.clientWidth + 1, 'diagnostic panel should not overflow horizontally');
  }
  console.log(JSON.stringify({ tested, details }, null, 2));
} finally {
  try {
    await evaluate(`document.querySelector('.model-diagnostics-dialog[open]')?.close(); location.href = ${JSON.stringify(snapshot.url)}; true`);
    await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
  } finally { socket.close(); }
}
