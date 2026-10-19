/** Browser smoke check: run Vite on 5198 and Chrome CDP on 9249. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9249);
const wallpaperBase64 = (await readFile(new URL('../docs/logo-256.png', import.meta.url))).toString('base64');
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async expression => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
};

try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: base });
  await waitFor("!!document.querySelector('.harness-theme-trigger')");
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.harness-theme-dialog')?.open");
  await evaluate("[...document.querySelectorAll('.harness-theme-dialog footer button')].find(button => button.textContent.includes('New theme')).click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open");
  const before = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); return { id: settings.themeId, count: settings.customThemes.length }; })()");
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
    await waitFor(`innerWidth === ${width}`);
    const view = await evaluate(`(() => { const dialog = document.querySelector('.harness-theme-editor'); const rect = dialog.getBoundingClientRect(); return { width: innerWidth, left: rect.left, right: rect.right, pageOverflow: document.documentElement.scrollWidth - innerWidth, dialogOverflow: dialog.scrollWidth - dialog.clientWidth, verticalOverflow: dialog.scrollHeight - dialog.clientHeight, preview: !!dialog.querySelector('.harness-theme-live-preview'), setup: dialog.textContent.includes('Set up a model'), stages: [...dialog.querySelectorAll('.harness-theme-generation-actions button')].length }; })()`);
    assert.ok(view.left >= -1 && view.right <= width + 1 && view.pageOverflow <= 1 && view.dialogOverflow <= 1, `${width}px appearance editor overflow: ${JSON.stringify(view)}`);
    if (width === 1440) assert.ok(view.verticalOverflow <= 2, `Desktop theme editor needs unnecessary scrolling: ${JSON.stringify(view)}`);
    assert.ok(view.preview && (view.setup || view.stages === 3), `Theme generator controls missing: ${JSON.stringify(view)}`);
  }
  await evaluate("[...document.querySelectorAll('.harness-theme-editor .harness-dialog-actions button')].find(item => item.textContent === 'Preview workspace').click(); true");
  await waitFor("!!document.querySelector('.harness-theme-preview-bar') && !document.querySelector('.harness-theme-editor').open");
  await evaluate("document.querySelector('.harness-sidebar-scrim')?.click(); true");
  await new Promise(resolve => setTimeout(resolve, 300));
  const previewBar = await evaluate("(() => { const bar = document.querySelector('.harness-theme-preview-bar'); const rect = bar.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, composeBottom: document.querySelector('.harness-compose')?.getBoundingClientRect().bottom, overflow: bar.scrollWidth - bar.clientWidth }; })()");
  assert.ok(previewBar.left >= 0 && previewBar.right <= previewBar.width && previewBar.overflow <= 1 && previewBar.top > previewBar.height * .7 && previewBar.bottom <= previewBar.height && previewBar.composeBottom <= previewBar.top, `Mobile preview bar is misplaced: ${JSON.stringify(previewBar)}`);
  const previewScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('/tmp/rivers-theme-preview-mobile.png', Buffer.from(previewScreenshot.data, 'base64'));
  await evaluate("location.hash = '#/models'; true");
  await waitFor("document.querySelector('.harness')?.dataset.view === 'models' && !!document.querySelector('.harness-theme-preview-bar')");
  const during = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); return { id: settings.themeId, count: settings.customThemes.length, preview: document.documentElement.style.getPropertyValue('--theme-background') }; })()");
  assert.equal(during.id, before.id);
  assert.equal(during.count, before.count);
  assert.equal(during.preview, '#10141b');
  await evaluate("document.querySelector('.harness-theme-preview-bar button').click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open");
  await evaluate("[...document.querySelectorAll('.harness-theme-editor .harness-dialog-actions button')].find(item => item.textContent === 'Preview workspace').click(); true");
  await waitFor("!!document.querySelector('.harness-theme-preview-bar')");
  await evaluate("[...document.querySelectorAll('.harness-theme-preview-bar button')].find(item => item.textContent === 'Discard').click(); true");
  await waitFor("!document.querySelector('.harness-theme-preview-bar')");
  const after = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); return { id: settings.themeId, count: settings.customThemes.length }; })()");
  assert.deepEqual(after, before);
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.harness-theme-dialog')?.open");
  await evaluate("[...document.querySelectorAll('.harness-theme-dialog footer button')].find(item => item.textContent.includes('New theme')).click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open");
  await evaluate(`(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(wallpaperBase64)}), char => char.charCodeAt(0)); const file = new File([bytes], 'theme.png', {type:'image/png'}); const transfer = new DataTransfer(); transfer.items.add(file); const input = document.querySelector('.harness-theme-wallpaper input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
  await waitFor("!!document.querySelector('.harness-theme-wallpaper img')");
  await evaluate("[...document.querySelectorAll('.harness-theme-editor .harness-dialog-actions button')].find(item => item.textContent === 'Preview workspace').click(); true");
  await waitFor("!!document.querySelector('.harness-theme-preview-bar')");
  const imagePreview = await evaluate("(() => ({ attached: document.documentElement.dataset.themeWallpaper, pseudo: getComputedStyle(document.querySelector('.harness-main'), '::after').backgroundImage }))()");
  assert.equal(imagePreview.attached, 'true');
  assert.ok(imagePreview.pseudo.includes('data:image/png;base64,'), 'Theme PNG was not rendered in workspace preview');
  await evaluate("[...document.querySelectorAll('.harness-theme-preview-bar button')].find(item => item.textContent === 'Save theme').click(); true");
  await waitFor("document.querySelector('.harness')?.dataset.theme === 'custom' && !document.querySelector('.harness-theme-preview-bar')");
  await waitFor(`(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.settings())?.customThemes.length === ${before.count + 1}; })()`);
  await evaluate("location.reload(); true");
  await waitFor("document.querySelector('.harness')?.dataset.theme === 'custom'");
  const saved = await evaluate("(async () => { const {store} = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); return { id: settings.themeId, count: settings.customThemes.length, wallpaper: !!settings.customThemes.find(item => `custom:${item.id}` === settings.themeId)?.wallpaper, rendered: document.documentElement.dataset.themeWallpaper }; })()");
  assert.ok(saved.id.startsWith('custom:') && saved.count === before.count + 1);
  assert.ok(saved.wallpaper && saved.rendered === 'true', 'PNG background did not persist after reload');
  console.log('Theme editor fits desktop and mobile; preview, discard, and embedded PNG save/reload work.');
} finally { socket.close(); }
