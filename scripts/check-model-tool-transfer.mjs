/** Optional browser check. Run Vite on 5198 and a disposable Chrome profile on CDP 9239. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:5198/';
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9239);
const runId = crypto.randomUUID().slice(0, 8);
const requests = [];
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
  const lastUser = [...(body.messages || [])].reverse().find(message => message.role === 'user')?.content || '';
  const action = /resume/i.test(lastUser) ? 'resume_model_queue' : /pause/i.test(lastUser) ? 'pause_model_queue' : 'queue_model_download';
  const status = action === 'queue_model_download' ? 'queued' : action === 'pause_model_queue' ? 'paused' : 'resuming';
  const wantsTool = body.tools?.some(tool => tool.function?.name === action) && !body.messages?.some(message => message.role === 'tool' && String(message.content).includes(`"status":"${status}"`));
  response.end(JSON.stringify({ choices: [{ message: wantsTool
    ? { role: 'assistant', content: '', tool_calls: [{ id: `${action}-1`, type: 'function', function: { name: action, arguments: action === 'queue_model_download' ? '{"id":"minicpm5-1b"}' : '{}' } }] }
    : { role: 'assistant', content: 'The model download request has been reviewed.' }, finish_reason: wantsTool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const mockPort = server.address().port;
let socket;
let cleanupNeeded = false;
let cleanupBrowser = null;
let previousSpeed = null;
try {
  const pages = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json();
  const page = pages.find(item => item.type === 'page' && item.url.startsWith(appUrl));
  if (!page) throw new Error(`Open ${appUrl} in the disposable Chrome profile first.`);
  socket = new WebSocket(page.webSocketDebuggerUrl);
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
  cleanupBrowser = async () => evaluate(`(async () => {
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    await modelDownloadManager.pause();
    const item = modelDownloadManager.getSnapshot().queue.find(entry => entry.name.includes('MiniCPM5-1B'));
    if (item) {
      const folder = modelDownloadManager.getAttachedFolder();
      if (folder) await modelDownloadManager.discard(folder, item.name);
      modelDownloadManager.removeQueued(item.url);
    }
    if (${previousSpeed ?? 'null'} !== null) modelDownloadManager.setSpeedLimit(${previousSpeed ?? 'null'});
    return modelDownloadManager.getSnapshot().queue.length;
  })()`);
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const found = await evaluate(expression);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  await call('Runtime.enable');
  const previousTimeOrigin = await evaluate('performance.timeOrigin');
  previousSpeed = await evaluate(`(async () => {
    const { store } = await import('/src/harnessStore.ts').then(module => module.openBrowserWorkspace());
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'compatible', profiles: settings.profiles.map(profile => profile.id === 'compatible' ? { ...profile, model: 'mock-tool-model', endpoint: 'http://127.0.0.1:${mockPort}/v1' } : profile) });
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    const previous = modelDownloadManager.getSnapshot().speedLimit;
    modelDownloadManager.setSpeedLimit(0.25);
    location.hash = '#/chat'; setTimeout(() => location.reload(), 50); return previous;
  })()`);
  await waitFor(`performance.timeOrigin > ${previousTimeOrigin}`, 'reloaded chat page');
  await waitFor("document.querySelector('.harness-control select[aria-label=\"AI profile\"]')?.value === 'compatible' && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'configured chat');
  await evaluate(`(() => { const box = document.querySelector('.harness-compose textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Queue the MiniCPM5 1B browser model for download. Test ${runId}.'); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || ''))", 'Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || '')).click(); true");
  const review = await waitFor("(() => { const dialog = document.querySelector('.harness-confirm-dialog[open]'); return dialog?.textContent?.includes('queue_model_download') ? dialog.textContent : false; })()", 'queue approval dialog');
  assert.match(review, /MiniCPM5 1B/);
  assert.match(review, /Apache 2\.0/);
  assert.match(review, /models\//);
  assert.equal(requests.filter(body => body.tools?.length).length, 1, 'model should request a tool before approval');
  await evaluate("document.querySelector('.harness-confirm-dialog[open] .button.primary').click(); true");
  cleanupNeeded = true;
  const result = await waitFor(`(async () => {
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    const snapshot = modelDownloadManager.getSnapshot();
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const manifest = await store.manifest();
    const sessions = await store.sessions(manifest.projects[0].id);
    let messages = null;
    for (const session of sessions.filter(item => item.messageCount >= 2)) {
      const candidate = await store.messages(session, 0);
      const index = candidate.findIndex(message => message.role === 'user' && message.content.includes('${runId}'));
      if (index >= 0) { messages = candidate.slice(index); break; }
    }
    if (!messages) return false;
    return messages.some(message => message.role === 'assistant' && message.toolEvents?.some(event => event.includes('queue_model_download'))) ?
      { status: snapshot.status, queue: snapshot.queue.map(item => item.name), error: snapshot.error, messages } : false;
  })()`, 'model queue tool event and saved chat');
  assert(result.messages.some(message => message.content.includes('reviewed')));
  assert(result.messages.some(message => message.toolEvents?.some(event => event.includes('"status":"queued"'))));
  assert(requests.some(body => body.messages?.some(message => message.role === 'tool')));
  console.log(`Browser model tool queue check: ${JSON.stringify({ status: result.status, queue: result.queue, error: result.error })}`);
  assert(result.queue.some(name => name.includes('MiniCPM5-1B')), 'approved model was not in the live queue');
  await evaluate(`(() => { const box = document.querySelector('.harness-compose textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Pause the model download. Test ${runId}.'); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || ''))", 'Pause Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || '')).click(); true");
  const pauseReview = await waitFor("(() => { const dialog = document.querySelector('.harness-confirm-dialog[open]'); return dialog?.textContent?.includes('pause_model_queue') ? dialog.textContent : false; })()", 'pause approval dialog');
  assert.match(pauseReview, /MiniCPM5-1B/);
  await evaluate("document.querySelector('.harness-confirm-dialog[open] .button.primary').click(); true");
  await waitFor(`(async () => {
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    const snapshot = modelDownloadManager.getSnapshot();
    return snapshot.queuePaused && snapshot.queue.some(item => item.name.includes('MiniCPM5-1B'));
  })()`, 'paused model queue');
  await evaluate(`(() => { const box = document.querySelector('.harness-compose textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Resume the queued model download. Test ${runId}.'); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || ''))", 'Resume Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || button.textContent || '')).click(); true");
  const resumeReview = await waitFor("(() => { const dialog = document.querySelector('.harness-confirm-dialog[open]'); return dialog?.textContent?.includes('resume_model_queue') ? dialog.textContent : false; })()", 'resume approval dialog');
  assert.match(resumeReview, /MiniCPM5-1B/);
  await evaluate("document.querySelector('.harness-confirm-dialog[open] .button.primary').click(); true");
  const resumed = await waitFor(`(async () => {
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    const snapshot = modelDownloadManager.getSnapshot();
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const manifest = await store.manifest();
    const sessions = await store.sessions(manifest.projects[0].id);
    for (const session of sessions.filter(item => item.messageCount >= 2)) {
      const messages = await store.messages(session, 0);
      const index = messages.findIndex(message => message.role === 'user' && message.content.includes('Resume the queued model download. Test ${runId}'));
      if (index >= 0 && messages.slice(index + 1).some(message => message.toolEvents?.some(event => event.includes('"status":"resuming"'))))
        return { status: snapshot.status, paused: snapshot.queuePaused, error: snapshot.error, bytes: snapshot.progress?.bytes || 0 };
    }
    return false;
  })()`, 'resumed model queue tool event');
  console.log(`Browser model tool transfer state: ${JSON.stringify(resumed)}`);
  assert.equal(resumed.paused, false, `queue paused after resume: ${resumed.error}`);
  const transferred = await waitFor(`(async () => {
    const { modelDownloadManager } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/modelDownloadSession.ts?t='))?.name || '/src/modelDownloadSession.ts');
    const snapshot = modelDownloadManager.getSnapshot();
    if (snapshot.error) throw new Error(snapshot.error);
    return snapshot.progress?.bytes > 0 ? snapshot.progress.bytes : false;
  })()`, 'model transfer bytes');
  console.log(`Browser model tool check passed: reviewed queue, pause, resume, and ${transferred} downloaded bytes.`);
} finally {
  if (socket?.readyState === WebSocket.OPEN && cleanupNeeded && cleanupBrowser) {
    try { await cleanupBrowser(); } catch (error) { console.warn(`Disposable browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket?.close();
  server.close();
}
