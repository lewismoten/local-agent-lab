/** Optional UI check. Run Vite on 5198 and an empty Chrome profile on CDP port 9239. */
import { createServer } from 'node:http';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`No Chrome page at ${base}.`);
let modelRequest;
let imageRequest;
let imageRequests = 0;
let iconBase64 = '';
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  if (request.url.endsWith('/images/generations')) {
    imageRequest = JSON.parse(raw);
    imageRequests++;
    response.end(JSON.stringify({ data: [{ b64_json: iconBase64 }] }));
    return;
  }
  modelRequest = JSON.parse(raw);
  response.end(JSON.stringify({ choices: [{ message: { content: '# Field notes\n\nThe parser work was reviewed.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 18 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const modelPort = server.address().port;
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || result.result?.description || 'Browser evaluation failed.');
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
  await waitFor("document.querySelectorAll('.harness-journal-style-card').length === 8", 'style cards');
  const fixture = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    await store.setJournalEnabled(true);
    const { createConversation } = await import('/src/harnessData.ts');
    const { journalDate } = await import('/src/harnessJournal.ts');
    const meta = createConversation('home'); meta.title = 'Parser work';
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    const at = new Date().toISOString();
    await store.recordJournalMessage(meta, { id: crypto.randomUUID(), seq: 0, role: 'user', content: 'Reviewed parser tests and found a bug.', createdAt: at });
    const settings = await store.settings();
    const profiles = settings.profiles.map(profile => profile.id === 'compatible' ? { ...profile, model: 'journal-mock', endpoint: 'http://127.0.0.1:${modelPort}/v1', maxOutputTokens: 600 } : profile);
    await store.saveSettings({ ...settings, profiles, selectedProfileId: 'compatible', imageConfig: {
      preset: 'tiny-sd', provider: 'compatible', endpoint: 'http://127.0.0.1:${modelPort}/v1', model: 'journal-icon-mock', apiKey: ''
    } });
    return { date: journalDate(at, (await store.journalIndex()).timeZone), sessionId: meta.id };
  })()`);
  await evaluate("location.reload(); true");
  await waitFor("!!document.querySelector('.harness-journal-article')", 'journal entry');
  await evaluate("document.querySelectorAll('.harness-journal-style-select')[1].click(); true");
  await waitFor("document.querySelectorAll('.harness-journal-style-select')[1].getAttribute('aria-pressed') === 'true'", 'field style');
  const fieldPrompt = await evaluate("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.journalStyleSettings()).selected; })()");
  if (fieldPrompt !== 'field') throw new Error('Selected style was not saved.');
  await evaluate("[...document.querySelectorAll('.harness-journal-style-actions button')].find(item => item.textContent.includes('Generate entry')).click(); true");
  await waitFor("document.querySelector('.harness-journal-rendering h1')?.textContent === 'Field notes'", 'generated journal');
  if (!modelRequest?.messages?.[0]?.content?.includes('field notes') || !modelRequest?.messages?.[1]?.content?.includes('Parser work')) throw new Error('The model did not receive the selected style and source facts.');
  const persisted = await evaluate(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.journalRenderings('${fixture.date}')).entries.field?.text; })()`);
  if (!persisted?.includes('The parser work was reviewed.')) throw new Error('Generated journal was not saved.');
  iconBase64 = await evaluate("(() => { const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64; const context=canvas.getContext('2d'); context.fillStyle='#64c9bd'; context.fillRect(0,0,64,64); return canvas.toDataURL('image/png').split(',')[1]; })()");
  await evaluate("(() => { const details=document.querySelectorAll('.harness-journal-style-card')[1].querySelector('details'); details.open=true; details.querySelector('button').click(); return true; })()");
  await waitFor("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const id=(await store.journalStyleSettings()).iconAssetIds.field; return id && !!(await store.avatarAsset(id)); })()", 'generated style icon');
  if (!imageRequest?.prompt?.includes('field notes')) throw new Error('The image model did not receive the field-notes icon prompt.');
  await evaluate("[...document.querySelectorAll('.harness-journal-styles-head button')].find(item => item.textContent.includes('Generate missing icons')).click(); true");
  await waitFor("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return Object.keys((await store.journalStyleSettings()).iconAssetIds).length === 8; })()", 'all missing icons');
  await waitFor("document.querySelector('.harness-journal-style-actions [role=status]')?.textContent === '7 icons ready'", 'missing icons finished');
  await evaluate("[...document.querySelectorAll('.harness-journal-styles-head button')].find(item => item.textContent.includes('Regenerate all icons')).click(); true");
  await waitFor("document.querySelector('.harness-journal-style-actions [role=status]')?.textContent === '8 icons ready'", 'all icons regenerated');
  if (imageRequests !== 16) throw new Error(`Expected 16 icon model requests, got ${imageRequests}.`);
  await evaluate("document.querySelector('.harness-journal-artwork > summary').click(); document.querySelector('.harness-journal-artwork button').click(); true");
  await waitFor(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const id=(await store.journalRenderings('${fixture.date}')).artworkAssetId; return id && !!(await store.avatarAsset(id)); })()`, 'generated day artwork');
  await waitFor("!!document.querySelector('.harness-journal-artwork-preview img')", 'day artwork preview');
  if (!imageRequest?.prompt?.includes('Abstract memory') || imageRequests !== 17) throw new Error('The day artwork was not generated with its prompt.');
  await evaluate("location.reload(); true");
  await waitFor("document.querySelector('.harness-journal-rendering h1')?.textContent === 'Field notes' && !!document.querySelectorAll('.harness-journal-style-card')[1].querySelector('img') && !!document.querySelector('.harness-journal-artwork-preview img')", 'journal, icon, and artwork after reload');
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  const mobile = await evaluate("({ viewport: innerWidth, document: document.documentElement.scrollWidth, cards: document.querySelectorAll('.harness-journal-style-card').length })");
  if (mobile.document > mobile.viewport + 2 || mobile.cards !== 8) throw new Error(`Mobile journal overflow: ${JSON.stringify(mobile)}`);
  console.log('Journal styles passed: selection, model entry, individual/missing/all style icons, day artwork, persistence, reload, and mobile fit.');
} finally { socket.close(); server.close(); }
