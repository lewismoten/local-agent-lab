/** Browser check: run Vite on 5198 and headless Chrome with CDP port 9249. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9249);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor("!!document.querySelector('.harness-theme-trigger')", 'appearance control');
  for (const [theme, expected] of [['plain', 'rgb(16, 20, 27)'], ['manuscript', 'rgb(33, 25, 19)'], ['cyberpunk', null]]) {
    await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
    await waitFor("document.querySelector('.harness-theme-dialog')?.open", 'appearance dialog');
    await evaluate(`document.querySelector('.theme-preview-${theme}').click(); true`);
    await waitFor(`document.documentElement.dataset.theme === '${theme}'`, `${theme} applied`);
    const state = await evaluate(`(() => ({ theme: document.documentElement.dataset.theme,
      background: getComputedStyle(document.querySelector('.harness-main')).backgroundColor,
      atmosphere: getComputedStyle(document.querySelector('.harness-atmosphere')).display,
      overflow: document.documentElement.scrollWidth - innerWidth,
      option: document.querySelector('.theme-preview-${theme}').getAttribute('aria-pressed') }))()`);
    assert.equal(state.theme, theme);
    assert.equal(state.option, 'true');
    assert.ok(state.overflow <= 1, `${theme} has horizontal overflow: ${state.overflow}px`);
    if (expected) { assert.equal(state.background, expected); assert.equal(state.atmosphere, 'none'); }
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-theme-${theme}.png`, Buffer.from(screenshot.data, 'base64'));
    await evaluate("location.hash = '/models'; true");
    await waitFor("!!document.querySelector('.browser-model-panel')", `${theme} model page`);
    const model = await evaluate("(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, surface: getComputedStyle(document.querySelector('.browser-model-panel')).backgroundColor }))()");
    assert.ok(model.overflow <= 1, `${theme} model page has horizontal overflow: ${model.overflow}px`);
    const modelScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-theme-${theme}-models.png`, Buffer.from(modelScreenshot.data, 'base64'));
    await evaluate("location.hash = '/chat'; true");
    await waitFor("!!document.querySelector('.harness-chat-header')", `${theme} chat page`);
  }
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.harness-theme-dialog')?.open", 'appearance dialog on mobile');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await evaluate("(() => { const dialog = document.querySelector('.harness-theme-dialog'); const rect = dialog.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: innerWidth, overflow: dialog.scrollWidth - dialog.clientWidth }; })()");
  assert.ok(mobile.left >= -1 && mobile.right <= mobile.width + 1 && mobile.overflow <= 1, `Appearance dialog overflows on mobile: ${JSON.stringify(mobile)}`);
  const mobileScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('/tmp/rivers-theme-mobile-dialog.png', Buffer.from(mobileScreenshot.data, 'base64'));
  await evaluate("document.querySelector('.theme-preview-manuscript').click(); true");
  await waitFor("document.documentElement.dataset.theme === 'manuscript'", 'selected theme before reload');
  await waitFor("(async () => (await (await (await import('/src/harnessStore.ts')).openBrowserWorkspace()).store.settings()).themeId === 'manuscript')()", 'theme saved to workspace');
  await evaluate('location.reload(); true');
  await waitFor("document.querySelector('.harness')?.dataset.theme === 'manuscript'", 'saved theme after reload');
  await waitFor("!!document.querySelector('.harness-theme-trigger')", 'appearance control after reload');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.harness-theme-dialog')?.open", 'theme picker for custom theme');
  await evaluate("[...document.querySelectorAll('.harness-theme-dialog footer button')].find(button => button.textContent.includes('New theme')).click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open", 'custom theme editor');
  await evaluate("document.querySelector('.harness-theme-editor .harness-primary').click(); true");
  await waitFor("document.documentElement.dataset.theme === 'custom'", 'custom theme applied');
  const custom = await evaluate("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const saved = await store.settings(); return { id: saved.themeId, count: saved.customThemes.length, name: saved.customThemes[0]?.name, background: getComputedStyle(document.querySelector('.harness-main')).backgroundColor }; })()");
  assert.ok(custom.id.startsWith('custom:') && custom.count === 1 && custom.name === 'New theme', `Custom theme was not saved: ${JSON.stringify(custom)}`);
  assert.equal(custom.background, 'rgb(16, 20, 27)');
  const customScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('/tmp/rivers-theme-custom.png', Buffer.from(customScreenshot.data, 'base64'));
  await evaluate('location.reload(); true');
  await waitFor("document.querySelector('.harness')?.dataset.theme === 'custom'", 'custom theme after reload');
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.theme-preview-custom')?.getAttribute('aria-pressed') === 'true'", 'selected custom theme');
  const exported = await evaluate(`(async () => {
    const original = HTMLAnchorElement.prototype.click;
    let link;
    HTMLAnchorElement.prototype.click = function () { link = { href: this.href, filename: this.download }; };
    try { document.querySelector('.harness-theme-custom-row button[aria-label^="Export"]').click();
      return { filename: link.filename, pack: JSON.parse(await (await fetch(link.href)).text()) }; }
    finally { HTMLAnchorElement.prototype.click = original; }
  })()`);
  assert.equal(exported.pack.format, 'local-agent-lab-theme');
  assert.equal(exported.pack.theme.name, 'New theme');
  assert.ok(exported.filename.endsWith('.theme.json'));
  await evaluate("document.querySelector('.harness-theme-custom-row button.harness-secondary').click(); true");
  await waitFor("document.querySelector('.harness-theme-editor')?.open", 'custom theme reopened');
  await evaluate(`(() => { const input = document.querySelectorAll('.harness-theme-colors input[type=color]')[5];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#ff6633'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await evaluate("document.querySelector('.harness-theme-editor .harness-primary').click(); true");
  await waitFor("document.documentElement.style.getPropertyValue('--theme-accent') === '#ff6633'", 'edited custom accent');
  await evaluate("document.querySelector('.harness-theme-trigger').click(); true");
  await waitFor("document.querySelector('.theme-preview-custom')?.getAttribute('aria-pressed') === 'true'", 'edited theme in picker');
  await evaluate("document.querySelector('.harness-theme-custom-row button.harness-danger').click(); true");
  await waitFor("!!document.querySelector('.harness-confirm-dialog[open]')", 'delete confirmation');
  await evaluate("document.querySelector('.harness-confirm-dialog .button.danger').click(); true");
  await waitFor("document.documentElement.dataset.theme === 'cyberpunk' && !document.querySelector('.theme-preview-custom')", 'custom theme removed');
  await evaluate(`(() => { const input = document.querySelector('.harness-theme-dialog input[type=file]'); const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(exported.pack))}], 'restored.theme.json', { type: 'application/json' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor("document.querySelector('.harness-theme-editor')?.open", 'imported theme editor');
  await evaluate("document.querySelector('.harness-theme-editor .harness-primary').click(); true");
  await waitFor("document.documentElement.dataset.theme === 'custom'", 'imported theme applied');
  const imported = await evaluate("(async () => (await (await (await import('/src/harnessStore.ts')).openBrowserWorkspace()).store.settings()).customThemes.length)()");
  assert.equal(imported, 1);
  console.log('Theme options passed: built-in palettes, mobile fit, custom edit/save/reload/delete, and pack export/import.');
} finally { socket.close(); }
