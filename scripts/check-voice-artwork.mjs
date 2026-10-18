/** Browser check. Run Vite on 5198 and a fresh Chrome profile on CDP port 9246. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9246);
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
  await waitFor("!!document.querySelector('.harness-models')", 'models page');
  const fixture = await evaluate(`(async () => {
    const { browserFiles } = await import('/src/storage.ts');
    const { saveVoiceSample, VOICE_PASSAGES } = await import('/src/voiceSamples.ts');
    const folder = await browserFiles();
    if (!folder) throw new Error('Browser file storage unavailable.');
    const sample = await saveVoiceSample(folder, {
      name: 'Artwork test voice', language: 'english_2026-04', text: VOICE_PASSAGES['english_2026-04'][0],
      version: '1.0', company: 'Test', license: 'Private fixture'
    }, new Blob([new Uint8Array([82,73,70,70,36,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,64,31,0,0,128,62,0,0,2,0,16,0,100,97,116,97,0,0,0,0])], { type: 'audio/wav' }), 1);
    return sample.id;
  })()`);
  await evaluate("[...document.querySelectorAll('.browser-model-tabs button')].find(button => button.textContent === 'Voices').click(); true");
  await waitFor("!![...document.querySelectorAll('.voice-table tbody tr')].find(row => row.textContent.includes('Artwork test voice'))", 'voice row');
  await evaluate("[...document.querySelectorAll('.voice-table tbody tr')].find(row => row.textContent.includes('Artwork test voice')).querySelector('.harness-surface-artwork-button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'voice icon editor');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#ad83f5'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'voice.png', { type: 'image/png' }));
    const input = document.querySelector('.harness-surface-artwork-dialog input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return !!(await store.surfaceArtwork()).items['voice:${fixture}']?.assetId;
  })()`, 'saved voice icon');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); location.reload(); true");
  await waitFor("!![...document.querySelectorAll('.voice-table tbody tr')].find(row => row.textContent.includes('Artwork test voice'))?.querySelector('.harness-surface-artwork-button img')", 'voice icon after reload');
  await evaluate("[...document.querySelectorAll('.voice-table tbody tr')].find(row => row.textContent.includes('Artwork test voice')).querySelector('.harness-surface-artwork-button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'reopened voice icon editor');
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  const fit = await evaluate("(() => { const dialog=document.querySelector('.harness-surface-artwork-dialog').getBoundingClientRect(); return {viewport:innerWidth,body:document.documentElement.scrollWidth,dialogLeft:dialog.left,dialogRight:dialog.right}; })()");
  if (fit.body > fit.viewport + 2 || fit.dialogLeft < -1 || fit.dialogRight > fit.viewport + 1) throw new Error(`Mobile voice icon editor overflow: ${JSON.stringify(fit)}`);
  console.log('Voice artwork passed: upload, saved icon, display after reload, and mobile editor fit.');
} finally { socket.close(); }
