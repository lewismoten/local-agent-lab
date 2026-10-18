/** Optional browser check. Requires one licensed GGUF and its engine in disposable Chrome on CDP 9239, with Vite on 5198. */
import assert from 'node:assert/strict';

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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 90_000);
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

let snapshot;
let testSession;
try {
  await call('Runtime.enable');
  snapshot = await evaluate(`(async () => {
    const { openBrowserWorkspace } = await import('/src/harnessStore.ts');
    const { browserFiles } = await import('/src/storage.ts');
    const { readySoleInstalledChatModel } = await import('/src/harnessStarterModel.ts');
    const { store, manifest } = await openBrowserWorkspace();
    const settings = await store.settings();
    const model = await readySoleInstalledChatModel(await browserFiles());
    if (!model) throw new Error('Exactly one complete, licensed browser chat GGUF and its engine are required.');
    if (!settings.profiles.some(item => item.id === 'browser')) throw new Error('The browser profile is missing.');
    const preferredProject = localStorage.getItem('harness-project-id');
    const projectId = manifest.projects.some(item => item.id === preferredProject) ? preferredProject : manifest.projects[0].id;
    return { settings, model, url: location.href, projectId, sessionIds: (await store.sessions(projectId)).map(item => item.id) };
  })()`);
  const oldTimeOrigin = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(item => item.id === 'browser' ? { ...item, model: '', contextWindow: 2048, maxOutputTokens: 96, browserThinkingMode: 'none' } : item) });
    location.hash = '#/chat';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${oldTimeOrigin}`, 'unconfigured page reload');
  await waitFor(`document.querySelector('.harness-compose textarea:not([disabled])') && document.querySelector('.harness-model-state')?.textContent?.includes('MODEL READY')`, 'automatic model selection and quick check');
  const adopted = await evaluate(`(async () => (await (await import('/src/harnessStore.ts')).openBrowserWorkspace()).store.settings())()`);
  assert.equal(adopted.profiles.find(item => item.id === 'browser')?.model, snapshot.model);
  await evaluate(`document.querySelector('button[aria-label="New conversation"]')?.click(); true`);
  await waitFor("document.querySelectorAll('.harness-message').length === 0 && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'fresh conversation');
  const prompt = 'Reply with only the word ready.';
  await evaluate(`(() => {
    const box = document.querySelector('.harness-compose textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(prompt)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || ''))", 'Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || '')).click(); true");
  const answer = await waitFor("(() => { const items = [...document.querySelectorAll('.harness-message')]; return items.length === 2 ? items.at(-1).querySelector('.harness-message-content')?.textContent?.trim() || false : false; })()", 'first GGUF answer');
  testSession = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const sessions = await store.sessions(${JSON.stringify(snapshot.projectId)});
    return sessions.find(item => location.hash.endsWith('/' + item.id)) || null;
  })()`);
  assert.ok(testSession?.id, 'the first chat must be saved in a conversation');
  console.log(`Installed-model onboarding passed: adopted ${snapshot.model}, loaded automatically, and answered ${JSON.stringify(answer)} in saved conversation.`);
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        const prior = new Set(${JSON.stringify(snapshot.sessionIds)});
        for (const item of await store.sessions(${JSON.stringify(snapshot.projectId)})) {
          if (!prior.has(item.id)) await store.deleteConversation(item);
        }
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
    } catch (error) { console.warn(`Could not fully restore disposable browser settings: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
