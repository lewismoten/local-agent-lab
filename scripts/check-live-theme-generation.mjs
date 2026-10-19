/** Optional live check: Vite on 5198, disposable Chrome CDP on 9249, local Ollama with llama3.2:3b. */
import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9249);
const model = process.env.THEME_TEST_MODEL || 'llama3.2:3b';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in a disposable Chrome profile first.`);
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 90_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 300) => {
  for (let i = 0; i < attempts; i++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-theme-trigger')", 'workspace');
  const originalCount = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.settings())?.customThemes?.length || 0; })()");
  await evaluate(`(async () => {
    const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const {workspaceSettings} = await import('/src/harnessSettings.ts');
    const {DEFAULT_PROFILES} = await import('/src/ai.ts');
    const prior = await store.settings();
    const profiles = (prior?.profiles || DEFAULT_PROFILES).map(profile => profile.id === 'ollama' ? {...profile, model: ${JSON.stringify(model)}} : profile);
    await store.saveSettings(workspaceSettings(profiles, 'ollama', prior?.imageConfig || {preset:'none',provider:'compatible',endpoint:'',model:'',apiKey:''}, prior?.compactionAt, prior?.themeId, prior?.customThemes));
    location.reload(); return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-model-controls select[aria-label=\"AI profile\"]')", 'chat profile');
  await evaluate("(() => { const select = document.querySelector('.harness-model-controls select[aria-label=\"AI profile\"]'); select.value = 'ollama'; select.dispatchEvent(new Event('change', {bubbles:true})); return true; })()");
  await waitFor("document.querySelector('.harness-model-controls select[aria-label=\"AI profile\"]')?.value === 'ollama'", 'Ollama profile selected');
  await evaluate("location.hash = '#/models'; true");
  await waitFor("!![...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Test selected model')", 'model test control');
  await evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Test selected model').click(); true");
  await waitFor("[...document.querySelectorAll('[role=status]')].some(item => item.textContent?.includes('responded in this browser session'))", 'model confirmation', 900);
  await evaluate("location.hash = '#/chat'; true");
  await waitFor("document.querySelector('.harness-model-state')?.textContent?.includes('READY')", 'confirmed model');
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.harness-theme-dialog')?.open", 'appearance dialog');
  await evaluate("[...document.querySelectorAll('.harness-theme-dialog footer button')].find(item => item.textContent.includes('New theme')).click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open", 'editor');
  await evaluate("(() => { const textarea = document.querySelector('.harness-theme-editor textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, 'Calm nocturnal botanical lights with readable text.'); textarea.dispatchEvent(new Event('input', {bubbles:true})); return true; })()");
  for (const stage of ['Name & style', 'Palette', 'Details']) {
    await evaluate(`(() => { const button = [...document.querySelectorAll('.harness-theme-generation-actions button')].find(item => item.textContent.includes(${JSON.stringify(stage)})); button.click(); return true; })()`);
    await waitFor("document.querySelector('.harness-theme-generation-actions button')?.disabled", `${stage} started`);
    await waitFor("!document.querySelector('.harness-theme-generation-actions button')?.disabled", `${stage} complete`, 900);
    const error = await evaluate("document.querySelector('.harness-theme-editor .model-error')?.textContent || ''");
    assert.equal(error, '', `${stage}: ${error}`);
  }
  const result = await evaluate("(() => ({ name: document.querySelector('.harness-theme-editor-grid input')?.value, preview: document.querySelector('.harness-theme-live-preview strong')?.textContent, contrast: document.querySelector('.harness-theme-contrast')?.textContent, saved: document.querySelector('.harness-theme-editor')?.open }))()");
  assert.ok(result.name && result.name !== 'New theme' && result.preview && result.contrast && result.saved, JSON.stringify(result));
  const afterCount = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.settings())?.customThemes?.length || 0; })()");
  assert.equal(afterCount, originalCount, 'AI draft was saved before review');
  console.log(`Live ${model} theme draft: ${result.name}; ${result.contrast}. No theme saved.`);
} finally { socket.close(); }
