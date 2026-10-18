/** Layout smoke test for vision diagnostics. Requires Vite on 5198 and disposable Chrome on CDP 9239. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const name = 'Ternary-Bonsai-2-2B-PQ2_0.gguf';
const modelPath = `models/${name}`;
const directoryName = name.replace(/\.gguf$/i, '');
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 45_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

let snapshot;
let placeholderCreated = false;
try {
  await call('Runtime.enable');
  await call('Page.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  await evaluate(`(async () => {
    const { browserFiles } = await import('/src/storage.ts');
    const folder = await browserFiles();
    const models = await folder.getDirectoryHandle('models', { create: true });
    try { await models.getDirectoryHandle(${JSON.stringify(directoryName)}); throw new Error('Vision model folder already exists; refusing to replace it.'); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    const directory = await models.getDirectoryHandle(${JSON.stringify(directoryName)}, { create: true });
    const file = await directory.getFileHandle(${JSON.stringify(name)}, { create: true });
    const writer = await file.createWritable();
    await writer.write(new Uint8Array([0])); await writer.close();
    return true;
  })()`);
  placeholderCreated = true;
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
      profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(modelPath)} } : profile) });
    sessionStorage.setItem('browser-model-type', 'text');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`document.querySelector('select[aria-label="Model file"]')?.value === ${JSON.stringify(modelPath)}`, 'placeholder model selection');
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Inspect features' && !item.disabled); if (!button) throw new Error('Inspect features unavailable.'); button.click(); return true; })()`);
  await waitFor(`document.querySelector('.model-diagnostics-dialog')?.open`, 'model diagnostics');
  await evaluate(`(() => { const button = document.querySelector('.model-diagnostics-dialog .vision-diagnostics-dialog').previousElementSibling; if (!button || button.disabled) throw new Error('Vision tests unavailable.'); button.click(); return true; })()`);
  await waitFor(`document.querySelector('.vision-diagnostics-dialog')?.open && document.querySelectorAll('.vision-result').length >= 8`, 'vision fixtures');
  const results = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 700));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.vision-diagnostics-dialog');
      const rect = dialog.getBoundingClientRect();
      const style = getComputedStyle(dialog);
      return { viewport: innerWidth, left: rect.left, right: rect.right, dialogScroll: dialog.scrollWidth,
        dialogClient: dialog.clientWidth, documentScroll: document.documentElement.scrollWidth,
        colorScheme: style.colorScheme, fixtureCount: dialog.querySelectorAll('.vision-result').length,
        imagesReady: [...dialog.querySelectorAll('.vision-result img')].every(image => image.complete && image.naturalWidth > 0) };
    })()`);
    assert.equal(state.viewport, width);
    assert.equal(state.colorScheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= width + 1, 'dialog fits viewport');
    assert.ok(state.dialogScroll <= state.dialogClient + 1, 'dialog has no horizontal overflow');
    assert.ok(state.documentScroll <= width + 1, 'page has no horizontal overflow');
    assert.ok(state.imagesReady, 'all fixture images decode');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-vision-dialog-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    results.push(state);
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        if (${placeholderCreated}) {
          const { browserFiles } = await import('/src/storage.ts');
          const folder = await browserFiles();
          const models = await folder.getDirectoryHandle('models');
          await models.removeEntry(${JSON.stringify(directoryName)}, { recursive: true });
        }
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not restore browser state: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
