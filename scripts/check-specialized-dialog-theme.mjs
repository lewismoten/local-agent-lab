/** Optional layout check. Requires Pocket TTS English, Depth Anything V2 Small, and TripoSR saved in disposable Chrome. Vite on 5198; CDP on 9239. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

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
  for (let attempt = 0; attempt < 160; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const cases = [
  { name: 'image', path: 'models/Tiny-SD-FP16-ONNX', type: 'image', selector: '.image-model-diagnostics' },
  { name: 'speech', path: 'models/Pocket-TTS-english_2026-04', type: 'speech', selector: '.speech-diagnostics-dialog:not(.transcription-dialog)' },
  { name: 'transcription', path: 'models/Whisper-Tiny-English-Q8', type: 'transcription', selector: '.transcription-dialog' },
  { name: 'motion', path: 'models/Depth-Anything-V2-Small-ONNX', type: 'video', selector: '.motion-diagnostics-dialog' },
  { name: 'tripo', path: 'models/TripoSR-Q8-ONNX', type: 'mesh', selector: '.motion-diagnostics-dialog' },
];
let snapshot;
const results = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type'), speech: sessionStorage.getItem('selected-speech-model') };
  })()`);
  const installed = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const speech = await import('/src/speechAssets.ts');
    const motion = await import('/src/motionAssets.ts');
    await Promise.all([speech.speechAssetsManager.discover(folder), motion.motionAssetsManager.discover(folder)]);
    return { speech: speech.getSpeechAssets().installed['english_2026-04'], depth: motion.getMotionAssets().installed.depth, tripo: motion.getMotionAssets().installed.tripo };
  })()`);
  assert.ok(installed.speech && installed.depth && installed.tripo, `Install the three optional audit models first: ${JSON.stringify(installed)}`);
  for (const item of cases) {
    const before = await evaluate('performance.timeOrigin');
    await evaluate(`(async () => {
      const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
      const settings = await store.settings();
      await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(item.path)} } : profile) });
      sessionStorage.setItem('browser-model-type', ${JSON.stringify(item.type)});
      ${item.name === 'speech' ? "sessionStorage.setItem('selected-speech-model', 'english_2026-04');" : ''}
      location.hash = '#/models';
      setTimeout(() => location.reload(), 50);
      return true;
    })()`);
    await waitFor(`performance.timeOrigin > ${before}`, `${item.name} reload`);
    try { await waitFor(`!!document.querySelector(${JSON.stringify(item.selector)})`, `${item.name} inspector`); }
    catch (error) {
      const detail = await evaluate(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const settings = await store.settings(); return { model: settings.profiles.find(item => item.id === 'browser')?.model, dialogs: [...document.querySelectorAll('dialog')].map(item => item.className), modelButtons: [...document.querySelectorAll('.model-buttons button')].map(item => item.textContent) }; })()`);
      console.warn(`${item.name} inspector state: ${JSON.stringify(detail)}`);
      throw error;
    }
    await evaluate(`(() => { const dialog = document.querySelector(${JSON.stringify(item.selector)}); dialog.showModal(); return true; })()`);
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const state = await evaluate(`(() => {
        const dialog = document.querySelector(${JSON.stringify(item.selector)});
        const rect = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return { name: ${JSON.stringify(item.name)}, title: dialog.querySelector('h2')?.textContent || dialog.getAttribute('aria-label'),
          width: innerWidth, colorScheme: style.colorScheme, background: style.backgroundColor, textColor: style.color,
          left: rect.left, right: rect.right, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
          controls: [...dialog.querySelectorAll('input,select,textarea')].map(control => ({ type: control.tagName, background: getComputedStyle(control).backgroundColor, color: getComputedStyle(control).color })) };
      })()`);
      results.push(state);
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(`/tmp/rivers-${item.name}-dialog-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      assert.equal(state.colorScheme, 'dark', `${item.name} dialog should use dark controls`);
      assert.ok(state.left >= -1 && state.right <= state.width + 1, `${item.name} dialog should fit the viewport`);
      assert.ok(state.scrollWidth <= state.clientWidth + 1, `${item.name} dialog should not overflow horizontally`);
    }
    await evaluate(`document.querySelector(${JSON.stringify(item.selector)}).close(); true`);
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        ${snapshot.speech == null ? "sessionStorage.removeItem('selected-speech-model');" : `sessionStorage.setItem('selected-speech-model', ${JSON.stringify(snapshot.speech)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not restore browser settings: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
