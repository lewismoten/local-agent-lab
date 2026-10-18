/** Optional UI check. Run Vite on 5198 and an empty Chrome profile on CDP port 9239. */
import { createServer } from 'node:http';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9239);
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') { response.writeHead(404); response.end('{}'); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push(body);
  if (body.model === 'failing-model') { response.writeHead(503); response.end('{"error":"Mock model unavailable"}'); return; }
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'I can help plan that project.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7 } }));
});
const requests = [];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const mockPort = server.address().port;
const pages = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json();
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
  await waitFor("!!document.querySelector('.harness-compose textarea:not([disabled])')", 'chat composer');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'compatible', profiles: settings.profiles.map(profile => profile.id === 'compatible' ? { ...profile, model: 'mock-model', endpoint: 'http://127.0.0.1:${mockPort}/v1' } : profile) });
    location.reload();
    return true;
  })()`);
  await waitFor("document.querySelector('.harness-control select[aria-label=\"AI profile\"]')?.value === 'compatible' && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'configured compatible model');
  await evaluate(`(() => {
    const box = document.querySelector('.harness-compose textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Help me build a small project.');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("(() => { const button = document.querySelector('.harness-compose-box button[title=\"Load model and send\"]'); return button && !button.disabled; })()", 'ready Send button');
  await evaluate("document.querySelector('.harness-compose-box button[title=\"Load model and send\"]').click(); true");
  const state = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const manifest = await store.manifest();
    const sessions = await store.sessions(manifest.projects[0].id);
    const session = sessions.find(item => item.messageCount >= 2);
    if (!session) return false;
    return { draft: document.querySelector('.harness-compose textarea').value,
      messages: (await store.messages(session, 0)).map(message => ({ role: message.role, content: message.content })),
      selectedProfile: document.querySelector('.harness-control select[aria-label="AI profile"]')?.value };
  })()`, 'saved first exchange');
  if (state.draft || state.selectedProfile !== 'compatible' || state.messages[0]?.content !== 'Help me build a small project.' || state.messages[1]?.content !== 'I can help plan that project.' || requests.length < 2) {
    throw new Error(`First-message model setup did not complete correctly: ${JSON.stringify({ state, requestCount: requests.length })}`);
  }
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, profiles: settings.profiles.map(profile => profile.id === 'compatible' ? { ...profile, model: 'failing-model' } : profile) });
    location.reload();
    return true;
  })()`);
  await waitFor("document.querySelector('.harness-control select[aria-label=\"AI profile\"]')?.value === 'compatible' && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'failing compatible model');
  await evaluate(`(() => {
    const box = document.querySelector('.harness-compose textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Keep this draft after a failure.');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("(() => { const button = document.querySelector('.harness-compose-box button[title=\"Load model and send\"]'); return button && !button.disabled; })()", 'failed model Send button');
  await evaluate("document.querySelector('.harness-compose-box button[title=\"Load model and send\"]').click(); true");
  const failure = await waitFor(`(() => {
    const message = document.querySelector('.harness-error')?.textContent || '';
    return message.includes('Mock model unavailable') ? { message, draft: document.querySelector('.harness-compose textarea').value,
      messageCount: document.querySelectorAll('.harness-message').length } : false;
  })()`, 'model failure');
  if (failure.draft !== 'Keep this draft after a failure.' || failure.messageCount !== 2) throw new Error(`Model failure lost the draft or added messages: ${JSON.stringify(failure)}`);
  console.log(`First-message compatible model check passed: saved exchange, then failed preflight preserved the unsent draft.`);
} finally { socket.close(); server.close(); }
