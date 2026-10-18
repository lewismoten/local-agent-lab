/** Real vision UI check. Requires Bonsai 2 PTQ1, its projector, and PrismML in disposable browser storage. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const model = 'models/Ternary-Bonsai-2-2B-PTQ1_0.gguf';
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 600_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 120) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

let snapshot;
try {
  await call('Runtime.enable');
  await call('Page.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { browserFiles } = await import('/src/storage.ts');
    const folder = await browserFiles();
    const prism = await import('/src/prismEngine.ts');
    await prism.prismEngineManager.discover(folder);
    if (!prism.getPrismEngineDownload().installed) throw new Error('PrismML engine missing.');
    const licenses = await import('/src/modelLicenses.ts');
    const catalog = licenses.catalogModelForPath(${JSON.stringify(model)});
    await licenses.assertModelLicenseFiles(folder, ${JSON.stringify(model)});
    await licenses.assertVisionProjectorLicenseFiles(folder, catalog);
    const modelFile = await (await (await folder.getDirectoryHandle('models')).getDirectoryHandle('Ternary-Bonsai-2-2B-PTQ1_0')).getFileHandle('Ternary-Bonsai-2-2B-PTQ1_0.gguf');
    assertSize((await modelFile.getFile()).size, catalog.bytes);
    function assertSize(actual, expected) { if (actual !== expected) throw new Error('Model size mismatch: ' + actual + ' vs ' + expected); }
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
      profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(model)}, contextWindow: 4096, maxOutputTokens: 256, browserThinkingMode: 'none' } : profile) });
    sessionStorage.setItem('browser-model-type', 'text');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`document.querySelector('select[aria-label="Model file"]')?.value === ${JSON.stringify(model)}`, 'Bonsai selection');
  await waitFor(`[...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Inspect features' && !item.disabled)`, 'feature inspector');
  await evaluate(`(() => { [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Inspect features' && !item.disabled).click(); return true; })()`);
  await waitFor(`document.querySelector('.model-diagnostics-dialog')?.open`, 'model diagnostics');
  await evaluate(`(() => { const button = document.querySelector('.model-diagnostics-dialog .vision-diagnostics-dialog').previousElementSibling; if (button.disabled) throw new Error('Vision tests unavailable.'); button.click(); return true; })()`);
  await waitFor(`document.querySelector('.vision-diagnostics-dialog')?.open && document.querySelectorAll('.vision-result').length === 10`, 'vision fixtures');
  await waitFor(`[...document.querySelectorAll('.vision-diagnostics-dialog button')].some(item => item.textContent.trim() === 'Run vision tests' && !item.disabled)`, 'projector readiness');
  await evaluate(`(() => { [...document.querySelectorAll('.vision-diagnostics-dialog button')].find(item => item.textContent.trim() === 'Run vision tests').click(); return true; })()`);

  const started = Date.now();
  let lastCount = -1;
  let state;
  while (Date.now() - started < 480_000) {
    state = await evaluate(`(() => {
      const dialog = document.querySelector('.vision-diagnostics-dialog');
      const items = [...dialog.querySelectorAll('.vision-result')];
      return { running: [...dialog.querySelectorAll('button')].some(item => item.textContent.trim() === 'Working…'),
        completed: items.filter(item => /^[✅❌❔]/u.test(item.querySelector('h3')?.textContent || '')).length,
        status: dialog.querySelector('.vision-status')?.textContent || '',
        first: items[0]?.querySelector('.diagnostic-rendered')?.textContent || '' };
    })()`);
    if (state.completed !== lastCount) { console.log(`[vision] ${state.completed}/10 ${state.status}`); lastCount = state.completed; }
    if (!state.running && state.completed > 0) break;
    if (!state.running && /error|failed|unavailable|could not/i.test(state.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  if (state?.running) {
    await evaluate(`(() => { [...document.querySelectorAll('.vision-diagnostics-dialog button')].find(item => item.textContent.trim() === 'Stop')?.click(); return true; })()`);
    await waitFor(`![...document.querySelectorAll('.vision-diagnostics-dialog button')].some(item => item.textContent.trim() === 'Working…')`, 'vision stop', 80);
  }
  assert.ok(state?.completed > 0, `No vision result: ${state?.status || 'unknown state'}`);
  assert.ok(state.first.trim() && state.first.trim() !== '—', 'First vision answer is visible');
  await evaluate(`(() => { const button = [...document.querySelectorAll('.vision-diagnostics-dialog button')].find(item => item.textContent.trim() === 'Save JSON'); if (!button || button.disabled) throw new Error('Vision report cannot be saved.'); button.click(); return true; })()`);
  await waitFor(`document.querySelector('.vision-diagnostics-dialog .vision-status')?.textContent?.startsWith('Saved to models/')`, 'saved vision report');
  const savedReport = await evaluate(`(async () => {
    const { browserFiles, readBlob } = await import('/src/storage.ts');
    const path = document.querySelector('.vision-diagnostics-dialog .vision-status').textContent.slice('Saved to '.length);
    const report = JSON.parse(await (await readBlob(await browserFiles(), path)).text());
    return { path, tests: report.tests?.length, file: report.file, checkedAt: report.checkedAt };
  })()`);
  assert.equal(savedReport.tests, state.completed);
  assert.equal(savedReport.file, model);
  const details = await evaluate(`(() => [...document.querySelectorAll('.vision-result')].filter(item => /^[✅❌❔]/u.test(item.querySelector('h3')?.textContent || '')).map(item => ({ title: item.querySelector('h3')?.textContent, output: item.querySelector('.diagnostic-rendered')?.textContent?.slice(0, 500) })))()`);
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 800));
    const layout = await evaluate(`(() => { const dialog = document.querySelector('.vision-diagnostics-dialog'); const rect = dialog.getBoundingClientRect(); return { viewport: innerWidth, left: rect.left, right: rect.right, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, dark: getComputedStyle(dialog).colorScheme === 'dark' }; })()`);
    assert.equal(layout.viewport, width);
    assert.ok(layout.dark && layout.left >= -1 && layout.right <= width + 1 && layout.scrollWidth <= layout.clientWidth + 1);
    layouts.push(layout);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-live-vision-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify({ savedReport, results: details, layouts }, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { unloadBrowserModel } = await import('/src/browserModel.ts');
        await unloadBrowserModel();
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not restore browser state: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
