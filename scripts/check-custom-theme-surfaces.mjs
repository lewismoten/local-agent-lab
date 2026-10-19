/** Browser check: Vite on 5198 and disposable Chrome CDP on 9249. Modifies only that disposable workspace. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9249);
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 25_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-theme-trigger')", 'workspace');
  await evaluate(`(async () => {
    const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const {workspaceSettings} = await import('/src/harnessSettings.ts');
    const {newCustomTheme} = await import('/src/customTheme.ts');
    const {DEFAULT_PROFILES} = await import('/src/ai.ts');
    const prior = await store.settings();
    const theme = {...newCustomTheme(), id:'theme-review', name:'Night garden', description:'A quiet neon reading room',
      colors:{background:'#0b1423',panel:'#122637',raised:'#1b3545',text:'#f3f8fa',muted:'#b9d0d0',accent:'#9df4e5',border:'#5b8593'}, font:'serif',radius:12,motion:'subtle',readingScale:125};
    await store.saveSettings(workspaceSettings(prior?.profiles || DEFAULT_PROFILES, prior?.selectedProfileId || 'browser', prior?.imageConfig || {preset:'none',provider:'compatible',endpoint:'',model:'',apiKey:''}, prior?.compactionAt, 'custom:theme-review', [theme]));
    location.reload(); return true;
  })()`);
  await waitFor("document.querySelector('.harness')?.dataset.theme === 'custom'", 'custom theme');
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    await waitFor(`innerWidth === ${width}`, `${width}px viewport`);
    await new Promise(resolve => setTimeout(resolve, 300));
    for (const view of ['chat', 'models', 'journal', 'tasks', 'identities', 'files', 'memory', 'achievements']) {
      await evaluate(`location.hash = '#/${view}'; true`);
      await waitFor(`document.querySelector('.harness')?.dataset.view === '${view}'`, `${view} page`);
      if (view === 'models') await waitFor("!!document.querySelector('.browser-model-panel')", 'model panel');
      if (width === 390) await evaluate("document.querySelector('.harness-sidebar-scrim')?.click(); true");
      await new Promise(resolve => setTimeout(resolve, 260));
      const state = await evaluate(`(() => { const main = document.querySelector('.harness-main'); const sidebar = document.querySelector('.harness-sidebar'); const reading = document.querySelector('.harness-compose textarea, .harness-heading p'); return { theme: document.documentElement.dataset.theme, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, main: getComputedStyle(main).backgroundColor, sidebar: getComputedStyle(sidebar).backgroundColor, color: getComputedStyle(main).color, readingSize: reading ? getComputedStyle(reading).fontSize : null }; })()`);
      assert.equal(state.theme, 'custom');
      assert.ok(state.overflow <= 1, `${width}px ${view} overflow: ${JSON.stringify(state)}`);
      assert.equal(state.main, 'rgb(11, 20, 35)');
      assert.equal(state.sidebar, 'rgb(18, 38, 55)');
      if (view === 'chat' || view === 'models') assert.equal(state.readingSize, '16.3px');
      if (view === 'chat' || view === 'models') {
        const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(`/tmp/rivers-custom-${view}-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      }
    }
  }
  console.log('Custom theme applied across eight workspace views at desktop and mobile widths; four screenshots saved in /tmp.');
} finally { socket.close(); }
