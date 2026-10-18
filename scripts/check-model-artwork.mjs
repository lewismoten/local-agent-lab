/** Browser check. Run Vite on 5198 and a fresh Chrome profile on CDP port 9244. */
import { createServer } from 'node:http';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9244);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`No Chrome page at ${base}.`);
let imageRequest;
let iconBase64 = '';
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  imageRequest = JSON.parse(raw);
  response.end(JSON.stringify({ data: [{ b64_json: iconBase64 }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const imagePort = server.address().port;
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
  await waitFor("!!document.querySelector('.harness-models')", 'models page');
  await evaluate(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); await store.saveSettings({ ...settings, imageConfig: { preset: 'tiny-sd', provider: 'compatible', endpoint: 'http://127.0.0.1:${imagePort}/v1', model: 'artwork-mock', apiKey: '' } }); return true; })()`);
  await evaluate('location.reload(); true');
  await waitFor("[...document.querySelectorAll('.browser-model-tabs button')].some(button => button.textContent === 'Catalog')", 'catalog tab');
  await evaluate("[...document.querySelectorAll('.browser-model-tabs button')].find(button => button.textContent === 'Catalog').click(); true");
  await waitFor("!!document.querySelector('.model-catalog-name .harness-surface-artwork-button')", 'catalog artwork controls');
  const selected = await evaluate("(() => { const button=document.querySelector('.model-catalog-name .harness-surface-artwork-button'); const title=button.getAttribute('aria-label').replace('Edit icon for ', ''); button.click(); return title; })()");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'artwork editor');
  iconBase64 = await evaluate("(() => { const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64; const context=canvas.getContext('2d'); context.fillStyle='#69d5c9'; context.fillRect(0,0,64,64); return canvas.toDataURL('image/png').split(',')[1]; })()");
  await evaluate("[...document.querySelectorAll('.harness-surface-artwork-actions button')].find(button => button.textContent.includes('Generate')).click(); true");
  await waitFor("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return Object.keys((await store.surfaceArtwork()).items).length === 1; })()", 'saved model artwork');
  if (!imageRequest?.prompt?.includes(selected)) throw new Error('The selected model name was missing from the image request.');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); true");
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.model-catalog-name .harness-surface-artwork-button img')", 'model icon after reload');
  await evaluate("document.querySelector('.model-catalog-name .harness-surface-artwork-button img').closest('button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'reopened artwork editor');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); [...document.querySelectorAll('.browser-model-tabs button')].find(button => button.textContent === 'Engines').click(); true");
  await waitFor("!!document.querySelector('.engine-table .harness-surface-artwork-button')", 'engine artwork controls');
  const engine = await evaluate("(() => { const button=document.querySelector('.engine-table .harness-surface-artwork-button'); const title=button.getAttribute('aria-label').replace('Edit icon for ', ''); button.click(); return title; })()");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'engine artwork editor');
  await evaluate("[...document.querySelectorAll('.harness-surface-artwork-actions button')].find(button => button.textContent.includes('Generate')).click(); true");
  await waitFor("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return Object.keys((await store.surfaceArtwork()).items).length === 2; })()", 'saved engine artwork');
  if (!imageRequest?.prompt?.includes(engine)) throw new Error('The selected engine name was missing from the image request.');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); location.reload(); true");
  await waitFor("!!document.querySelector('.engine-table .harness-surface-artwork-button img')", 'engine icon after reload');
  await evaluate("document.querySelector('.engine-table .harness-surface-artwork-button img').closest('button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'reopened engine artwork editor');
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  const fit = await evaluate("(() => { const dialog=document.querySelector('.harness-surface-artwork-dialog').getBoundingClientRect(); return {viewport:innerWidth,body:document.documentElement.scrollWidth,dialogLeft:dialog.left,dialogRight:dialog.right}; })()");
  if (fit.body > fit.viewport + 2 || fit.dialogLeft < -1 || fit.dialogRight > fit.viewport + 1) throw new Error(`Mobile artwork dialog overflow: ${JSON.stringify(fit)}`);
  console.log(`Surface artwork passed: ${selected} model and ${engine} engine icons generated, saved, reloaded, and mobile dialog fit.`);
} finally { socket.close(); server.close(); }
