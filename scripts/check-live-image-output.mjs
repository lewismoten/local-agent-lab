/** Optional live image check. Requires Supra2-IMG Mobile and the ONNX image engine in disposable Chrome, Vite on 5198, CDP on 9239. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9239);
const page = (await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 180_000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 240) => {
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
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const image = await import('/src/browserImageAssets.ts');
    await image.browserImageAssetsManager.discover(folder);
    if (!image.getBrowserImageAssets().installed['supra-mobile'] || !image.getBrowserImageAssets().installed.engine) throw new Error('Supra2-IMG Mobile and the ONNX image engine must be installed first.');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: 'models/Supra2-IMG-Mobile-ONNX' } : profile) });
    sessionStorage.setItem('browser-model-type', 'image');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'image model view reload');
  await waitFor("!![...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models')", 'Local Models tab');
  await evaluate("[...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models').click(); true");
  await waitFor("!!document.querySelector('.image-model-diagnostics')", 'image inspector');
  await evaluate("document.querySelector('.image-model-diagnostics').showModal(); true");
  await waitFor("!![...document.querySelectorAll('.image-model-diagnostics[open] button')].find(item => item.textContent?.trim() === 'Run image test' && !item.disabled)", 'Run image test button');
  await evaluate("[...document.querySelectorAll('.image-model-diagnostics[open] button')].find(item => item.textContent?.trim() === 'Run image test').click(); true");
  let lastPhase = '';
  let result;
  for (let attempt = 0; attempt < 2400; attempt++) {
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.image-model-diagnostics[open]');
      const progress = dialog?.querySelector('.image-step-progress');
      const report = dialog?.querySelector('.image-model-results');
      return { phase: progress?.textContent || '', report: report?.textContent || '',
        preview: !!dialog?.querySelector('.image-preview-sequence .image-generator-preview'),
        previewCount: dialog?.querySelectorAll('.image-preview-strip figure').length || 0,
        download: !!dialog?.querySelector('a[download="supra-mobile-image.png"]'),
        error: dialog?.querySelector('.model-error[role=alert]')?.textContent || '' };
    })()`);
    if (state.phase && state.phase !== lastPhase && attempt % 20 === 0) { console.error(`[Supra2] ${state.phase}`); lastPhase = state.phase; }
    if (state.report && !state.phase && (state.preview || state.error)) { result = state; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(result, 'Supra2 did not finish within ten minutes');
  assert.ok(result.preview && result.download, `Supra2 did not produce a downloadable preview: ${result.error || result.report}`);
  assert.ok(result.previewCount >= 3, 'the result should show intermediate generation previews');
  assert.match(result.report, /✅ Image generation:/, 'the reference image check should pass');
  const image = await evaluate(`(async () => {
    const link = document.querySelector('.image-model-diagnostics[open] a[download="supra-mobile-image.png"]');
    const blob = await (await fetch(link.href)).blob(); const bitmap = await createImageBitmap(blob);
    const result = { bytes: blob.size, width: bitmap.width, height: bitmap.height, type: blob.type };
    bitmap.close(); return result;
  })()`);
  assert.ok(image.bytes > 1000 && image.width > 0 && image.height > 0, 'the result should decode as an image');
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate("(() => { const dialog = document.querySelector('.image-model-diagnostics[open]'); dialog.scrollTop = dialog.scrollHeight; return true; })()");
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.image-model-diagnostics[open]'); const rect = dialog.getBoundingClientRect();
      return { width: innerWidth, scheme: getComputedStyle(dialog).colorScheme, left: rect.left, right: rect.right,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        previewWidth: dialog.querySelector('.image-generator-preview')?.getBoundingClientRect().width || 0 };
    })()`);
    layouts.push(state);
    assert.equal(state.scheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= state.width + 1, 'image dialog should fit');
    assert.ok(state.scrollWidth <= state.clientWidth + 1, 'generated image result should not overflow horizontally');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-image-output-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify({ result, image, layouts }, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        document.querySelector('.image-model-diagnostics[open]')?.close();
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not fully restore the disposable profile: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
