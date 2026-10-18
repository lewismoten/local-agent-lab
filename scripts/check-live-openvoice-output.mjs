/** Live OpenVoice UI check. Requires its model/engine and Pocket TTS English in disposable Chrome on CDP 9239, Vite on 5198. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in disposable Chrome first.`);
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
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 600) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
let snapshot;
try {
  await call('Runtime.enable'); await call('Page.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const { assertSpeechFiles } = await import('/src/speechAssets.ts');
    await assertSpeechFiles(folder, 'openvoice_v2_q8');
    await assertSpeechFiles(folder, 'english_2026-04');
    const samples = window.__openvoiceSamples;
    if (!samples?.source || !samples?.reference) {
      const { generateBrowserSpeech } = await import('/src/browserSpeech.ts');
      const source = await generateBrowserSpeech(folder, 'english_2026-04', 'Mira walked slowly beside the river.', 'alba');
      const reference = await generateBrowserSpeech(folder, 'english_2026-04', 'A quiet morning begins with a story.', 'marius');
      window.__openvoiceSamples = { source: new File([source], 'synthetic-source.wav', {type:'audio/wav'}), reference: new File([reference], 'synthetic-reference.wav', {type:'audio/wav'}) };
    }
    const fixtures = await folder.getDirectoryHandle('test-fixtures', { create: true });
    const dir = await fixtures.getDirectoryHandle('openvoice', { create: true });
    for (const [name, file] of Object.entries(window.__openvoiceSamples)) {
      const handle = await dir.getFileHandle(name + '.wav', { create: true });
      const writer = await handle.createWritable(); await writer.write(file); await writer.close();
    }
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type'), speech: sessionStorage.getItem('selected-speech-model') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(item =>
      item.id === 'browser' ? { ...item, model: 'models/OpenVoice-V2-Q8' } : item) });
    sessionStorage.setItem('browser-model-type', 'speech');
    sessionStorage.setItem('selected-speech-model', 'openvoice_v2_q8');
    location.hash = '#/models'; setTimeout(() => location.reload(), 50); return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'model selection reload');
  await waitFor("!![...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled)", 'OpenVoice inspector');
  await evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Inspect features' && !item.disabled).click(); true");
  await waitFor("!!document.querySelector('.speech-diagnostics-dialog[open] .openvoice-inputs')", 'OpenVoice dialog');
  await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const dir = await (await folder.getDirectoryHandle('test-fixtures')).getDirectoryHandle('openvoice');
    const dialog = document.querySelector('.speech-diagnostics-dialog[open]');
    const files = dialog.querySelectorAll('.openvoice-inputs input[type="file"]');
    for (const [index, name] of ['source', 'reference'].entries()) {
      const file = await (await dir.getFileHandle(name + '.wav')).getFile();
      const transfer = new DataTransfer(); transfer.items.add(new File([file], 'synthetic-' + name + '.wav', { type: 'audio/wav' }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(files[index], transfer.files);
      files[index].dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await waitFor("!![...document.querySelectorAll('.speech-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run conversion test' && !item.disabled)", 'conversion button');
  await evaluate("[...document.querySelectorAll('.speech-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run conversion test').click(); true");
  const result = await waitFor(`(() => {
    const dialog = document.querySelector('.speech-diagnostics-dialog[open]');
    const audio = dialog?.querySelector('audio[aria-label="Generated speech"]');
    const error = dialog?.querySelector('.model-error[role="alert"]')?.textContent;
    return audio ? { generated: true, source: audio.currentSrc || audio.src } : error ? { generated: false, error } : false;
  })()`, 'converted audio or visible error', 1200);
  assert.ok(result.generated, `OpenVoice conversion failed: ${result.error || 'no audio'}`);
  assert.ok(result.source.startsWith('blob:'), 'converted audio player should have a Blob URL');
  const report = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const { loadLatestDiagnosticJson } = await import('/src/diagnosticReports.ts');
    return await loadLatestDiagnosticJson(folder, 'models/OpenVoice-V2-Q8', 'speech');
  })()`);
  assert.equal(report?.tests?.speech?.result, 'passed');
  assert.equal(report.tests.speech.source, 'synthetic-source.wav');
  assert.equal(report.tests.speech.sample, 'synthetic-reference.wav');
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 150));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.speech-diagnostics-dialog[open]');
      const rect = dialog.getBoundingClientRect();
      const download = [...dialog.querySelectorAll('a')].find(item => item.textContent?.trim() === 'Download WAV');
      const save = [...dialog.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Save to workspace');
      return { width: innerWidth, scheme: getComputedStyle(dialog).colorScheme, left: rect.left, right: rect.right,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, download: !!download?.href, save: !!save && !save.disabled };
    })()`);
    assert.equal(state.scheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= width + 1, 'OpenVoice result dialog should fit the viewport');
    assert.ok(state.scrollWidth <= state.clientWidth + 1, 'OpenVoice result dialog should not overflow horizontally');
    assert.ok(state.download && state.save, 'download and save actions should be available');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-openvoice-output-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    layouts.push(state);
  }
  console.log(JSON.stringify({ report: { result: report.tests.speech.result, detail: report.tests.speech.detail }, layouts }, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        document.querySelector('.speech-diagnostics-dialog[open]')?.close();
        const folder = await (await import('/src/storage.ts')).browserFiles();
        const fixtures = await folder.getDirectoryHandle('test-fixtures');
        await fixtures.removeEntry('openvoice', { recursive: true });
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        ${snapshot.speech == null ? "sessionStorage.removeItem('selected-speech-model');" : `sessionStorage.setItem('selected-speech-model', ${JSON.stringify(snapshot.speech)});`}
        location.replace(${JSON.stringify(snapshot.url)}); setTimeout(() => location.reload(), 50); return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Disposable browser cleanup incomplete: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
