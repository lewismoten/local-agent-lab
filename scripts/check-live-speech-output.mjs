/** Optional live Pocket TTS check. Requires Pocket TTS English and its engine in disposable Chrome, Vite on 5198, CDP on 9239. */
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
    const speech = await import('/src/speechAssets.ts');
    await speech.speechAssetsManager.discover(folder);
    if (!speech.getSpeechAssets().installed.engine || !speech.getSpeechAssets().installed['english_2026-04']) throw new Error('Pocket TTS English and its browser engine must be installed first.');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type'), speech: sessionStorage.getItem('selected-speech-model') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(item => item.id === 'browser' ? { ...item, model: 'models/Pocket-TTS-english_2026-04' } : item) });
    sessionStorage.setItem('browser-model-type', 'speech');
    sessionStorage.setItem('selected-speech-model', 'english_2026-04');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'speech model view reload');
  await waitFor("!![...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled)", 'speech inspector button');
  await evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled).click(); true");
  await waitFor("!!document.querySelector('.speech-diagnostics-dialog[open]')", 'speech dialog');
  await evaluate(`(() => {
    const box = document.querySelector('.speech-diagnostics-dialog textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Hello, River.');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!![...document.querySelectorAll('.speech-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run speech test' && !item.disabled)", 'Run speech test button');
  await evaluate("[...document.querySelectorAll('.speech-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run speech test').click(); true");
  const result = await waitFor(`(() => {
    const dialog = document.querySelector('.speech-diagnostics-dialog[open]');
    const audio = dialog?.querySelector('audio[aria-label="Generated speech"]');
    const error = dialog?.querySelector('.model-error[role="alert"]')?.textContent;
    return audio ? { generated: true, source: audio.currentSrc || audio.src, report: dialog.querySelector('p[role="status"]')?.textContent || '' } : error ? { generated: false, error } : false;
  })()`, 'generated speech or visible error', 1600);
  assert.ok(result.generated, `Speech generation failed: ${result.error || 'no audio'}`);
  assert.ok(result.source?.startsWith('blob:'), 'the result should expose an audio preview');
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.speech-diagnostics-dialog[open]');
      const rect = dialog.getBoundingClientRect();
      return { width: innerWidth, scheme: getComputedStyle(dialog).colorScheme, left: rect.left, right: rect.right,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, audioWidth: dialog.querySelector('audio')?.getBoundingClientRect().width || 0 };
    })()`);
    layouts.push(state);
    assert.equal(state.scheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= state.width + 1, 'speech dialog should fit');
    assert.ok(state.scrollWidth <= state.clientWidth + 1, 'speech result should not overflow horizontally');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-speech-output-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify({ result, layouts }, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        document.querySelector('.speech-diagnostics-dialog[open]')?.close();
        const unload = [...document.querySelectorAll('.model-buttons button')].find(item => item.textContent?.trim() === 'Unload' && !item.disabled);
        unload?.click();
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        ${snapshot.speech == null ? "sessionStorage.removeItem('selected-speech-model');" : `sessionStorage.setItem('selected-speech-model', ${JSON.stringify(snapshot.speech)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not fully restore the disposable profile: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
