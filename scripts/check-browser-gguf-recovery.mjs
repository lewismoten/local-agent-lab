/** Optional UI check. Requires MiniCPM5 1B and Wllama in a disposable Chrome profile on CDP 9239, with Vite on 5198. */
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 60_000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 240; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const prompt = async value => {
  await evaluate(`(() => { const box = document.querySelector('.harness-compose textarea'); if (!box) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(value)}); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || ''))", 'Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || '')).click(); true");
};
const sidecar = 'models/MiniCPM5-1B-Q4_K_M/LICENSE.txt';
let licenseChanged = false;
const restoreLicense = async () => evaluate(`(async () => {
  const { browserFiles } = await import('/src/storage.ts');
  const { ensureModelLicenseFiles, assertModelLicenseFiles } = await import('/src/modelLicenses.ts');
  const { MODEL_CATALOG } = await import('/src/catalogModels.ts');
  const folder = await browserFiles();
  const model = MODEL_CATALOG.find(item => item.id === 'minicpm5-1b');
  await ensureModelLicenseFiles(folder, model.url);
  await assertModelLicenseFiles(folder, 'models/' + model.name);
  return true;
})()`);
try {
  await call('Runtime.enable');
  const previousTimeOrigin = await evaluate('performance.timeOrigin');
  const ready = await evaluate(`(async () => {
    const { browserFiles } = await import('/src/storage.ts');
    const { maybeModelFile } = await import('/src/modelFolders.ts');
    const { assertModelLicenseFiles } = await import('/src/modelLicenses.ts');
    const { assertWllamaEngineFiles } = await import('/src/wllamaEngine.ts');
    const folder = await browserFiles();
    if (!folder) return false;
    const file = await maybeModelFile(folder, 'MiniCPM5-1B-Q4_K_M.gguf');
    if (file?.size !== 688065920) return false;
    await assertModelLicenseFiles(folder, 'models/MiniCPM5-1B-Q4_K_M.gguf');
    await assertWllamaEngineFiles(folder);
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: 'models/MiniCPM5-1B-Q4_K_M.gguf', contextWindow: 2048, maxOutputTokens: 96, thinkingTokens: 0, browserThinkingMode: 'none' } : profile) });
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  if (!ready) throw new Error('Download MiniCPM5 1B and Wllama into this disposable browser workspace first.');
  await waitFor(`performance.timeOrigin > ${previousTimeOrigin}`, 'configured page reload');
  await waitFor("!!document.querySelector('.harness-compose textarea:not([disabled])')", 'chat composer');
  await evaluate("document.querySelector('button[aria-label=\"New conversation\"]')?.click(); true");
  await waitFor("document.querySelectorAll('.harness-message').length === 0 && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'new conversation');
  await prompt('Reply with only the word ready.');
  await waitFor("(() => { const items = [...document.querySelectorAll('.harness-message')]; return items.length === 2 && items.at(-1).querySelector('.harness-message-content')?.textContent?.trim().toLowerCase() === 'ready'; })()", 'first model answer');
  const reloadTimeOrigin = await evaluate('performance.timeOrigin');
  await call('Page.reload');
  await waitFor(`performance.timeOrigin > ${reloadTimeOrigin}`, 'full page reload');
  await waitFor("document.querySelectorAll('.harness-message').length === 2 && !!document.querySelector('.harness-compose textarea:not([disabled])')", 'reopened conversation');
  await prompt('Reply with only the word recovered.');
  await waitFor("(() => { const items = [...document.querySelectorAll('.harness-message')]; return items.length === 4 && items.at(-1).querySelector('.harness-message-content')?.textContent?.trim().toLowerCase() === 'recovered'; })()", 'answer after full reload');
  await evaluate(`(async () => { const { browserFiles, writeBlob } = await import('/src/storage.ts'); await writeBlob(await browserFiles(), ${JSON.stringify(sidecar)}, new Blob(['deliberately invalid test sidecar'])); return true; })()`);
  licenseChanged = true;
  const retryPrompt = 'Reply with only the word retried. License recovery test.';
  await prompt(retryPrompt);
  const failure = await waitFor(`(() => {
    const error = document.querySelector('.harness-error')?.textContent || '';
    return error.includes('Required model license file') ? { draft: document.querySelector('.harness-compose textarea')?.value, messages: document.querySelectorAll('.harness-message').length, error } : false;
  })()`, 'license failure');
  assert.equal(failure.draft, retryPrompt, 'failed setup must keep the draft');
  assert.equal(failure.messages, 4, 'failed setup must not save the user message');
  await restoreLicense();
  licenseChanged = false;
  await waitFor("!!Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || ''))", 'retry Send button');
  await evaluate("Array.from(document.querySelectorAll('.harness-compose-box button')).find(button => !button.disabled && /send/i.test(button.title || '')).click(); true");
  const retryAnswer = await waitFor("(() => { const items = [...document.querySelectorAll('.harness-message')]; return items.length === 6 ? items.at(-1).querySelector('.harness-message-content')?.textContent?.trim() || false : false; })()", 'successful retry');
  console.log(`Real GGUF recovery check passed: initial reply, full reload, failed license check with preserved draft, and successful retry (${JSON.stringify(retryAnswer)}).`);
} finally {
  if (licenseChanged && socket.readyState === WebSocket.OPEN) {
    try { await restoreLicense(); }
    catch (error) { console.warn(`Could not restore ${sidecar}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
