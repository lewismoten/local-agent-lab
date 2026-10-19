/** Run Vite and a disposable Chrome page on CDP port 9276. */
import assert from 'node:assert/strict';

const port = Number(process.env.CHROME_DEBUG_PORT || 9276);
const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in Chrome first.`);
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
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
const waitFor = async (expression, label) => {
  for (let count = 0; count < 120; count++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const markdown = '## Saved response\n\n| Name | Count |\n| --- | ---: |\n| Mira | 3 |';
try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness')", 'workspace');
  await evaluate(`(async () => {
    const {store,manifest}=await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const {createConversation}=await import('/src/harnessData.ts');
    let session=createConversation(manifest.projects[0].id);
    session=await store.appendMessage(session,{id:crypto.randomUUID(),role:'user',content:'Make a table.',createdAt:new Date().toISOString()});
    session=await store.appendMessage(session,{id:crypto.randomUUID(),role:'assistant',content:${JSON.stringify(markdown)},createdAt:new Date().toISOString()});
    await store.updateSessions(session.projectId,current=>[...current,session]);
    location.hash='/chat/'+session.id;location.reload();return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-message.assistant .harness-message-copy')", 'assistant Copy button');
  const labels = await evaluate("[...document.querySelectorAll('.harness-message-copy')].map(item=>item.getAttribute('aria-label'))");
  assert.deepEqual(labels, ['Copy assistant response 2']);
  await evaluate("Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__responseCopied=text;}});document.querySelector('.harness-message-copy').click();true");
  await waitFor('!!window.__responseCopied', 'copied response');
  assert.equal(await evaluate('window.__responseCopied'), markdown);
  await waitFor("[...document.querySelectorAll('[role=status]')].some(item=>item.textContent.includes('Response copied'))", 'copy confirmation');
  await call('Browser.grantPermissions', { origin: base.replace(/\/$/, ''), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await evaluate("delete navigator.clipboard.writeText;document.querySelector('.harness-message-copy').click();true");
  await waitFor(`(async()=>await navigator.clipboard.readText()===${JSON.stringify(markdown)})()`, 'system clipboard text');
  console.log('Assistant response Copy preserves saved Markdown on the system clipboard.');
} finally { socket.close(); }
