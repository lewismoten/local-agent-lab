/** Optional live check. Requires Depth Anything, Supra2, and ONNX Image in disposable Chrome. */
import assert from 'node:assert/strict';

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
const waitFor = async (expression, label, attempts = 2400) => {
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
    const motion = await import('/src/motionAssets.ts');
    const image = await import('/src/browserImageAssets.ts');
    await Promise.all([motion.motionAssetsManager.discover(folder), image.browserImageAssetsManager.discover(folder)]);
    if (!motion.getMotionAssets().installed.depth || !image.getBrowserImageAssets().installed['supra-mobile'] || !image.getBrowserImageAssets().installed.engine)
      throw new Error('Depth Anything, Supra2, and ONNX Image must already be downloaded.');
    return { settings: await store.settings(), url: location.href, type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
      profile.id === 'browser' ? { ...profile, model: 'models/Depth-Anything-V2-Small-ONNX' } : profile) });
    sessionStorage.setItem('browser-model-type', 'video');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'model reload', 240);
  await waitFor(`!![...document.querySelectorAll('.browser-model-tabs button')].find(button => button.textContent.trim() === 'Local Models')`, 'Local Models tab', 240);
  await evaluate(`[...document.querySelectorAll('.browser-model-tabs button')].find(button => button.textContent.trim() === 'Local Models').click(); true`);
  await waitFor(`!!document.querySelector('.motion-diagnostics-dialog')`, 'motion inspector', 240);
  await evaluate(`(() => {
    const dialog = document.querySelector('.motion-diagnostics-dialog'); dialog.showModal();
    const select = [...dialog.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'supra-mobile'));
    select.value = 'supra-mobile'; select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelector('.motion-diagnostics-dialog select')?.value === 'supra-mobile'`, 'Supra2 selection', 240);
  await evaluate(`[...document.querySelectorAll('.motion-diagnostics-dialog button')].find(button => button.textContent.trim() === 'Run video test').click(); true`);
  let lastStage = '';
  let outcome;
  for (let attempt = 0; attempt < 2400; attempt++) {
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
      return { stage: dialog?.querySelector('[role="status"]')?.textContent || '',
        result: dialog?.querySelector('.image-model-results')?.textContent || '',
        error: dialog?.querySelector('.model-error[role="alert"]')?.textContent || '' };
    })()`);
    if (state.stage && state.stage !== lastStage) { console.error(`[motion] ${state.stage}`); lastStage = state.stage; }
    if (state.result) { outcome = state; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(outcome, 'Motion run did not finish within ten minutes.');
  assert.match(outcome.result, /✅/, `Motion run failed: ${outcome.error || outcome.result}`);
  const reportPath = /Report saved to (models\/[^\s]+\.json)/.exec(outcome.result)?.[1];
  assert.ok(reportPath, 'Motion diagnostic report path missing.');
  const saved = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const { readBlob } = await import('/src/storage.ts');
    const report = JSON.parse(await (await readBlob(folder, ${JSON.stringify(reportPath)})).text());
    const path = report.sourceImagePath;
    const image = await readBlob(folder, path);
    const metadata = JSON.parse(await (await readBlob(folder, path.replace(/\\.png$/, '.json'))).text());
    return { result: report.result, sourcePath: path, imageBytes: image.size,
      seedMatches: report.inputs.imageSeed === metadata.seed,
      promptMatches: report.inputs.prompt === metadata.prompt,
      modelPath: metadata.modelPackage?.path, hashes: metadata.modelPackage?.files?.length || 0,
      steps: metadata.settings?.steps, reportHasProvenance: !!report.inputImageProvenance };
  })()`);
  assert.ok(saved.result === 'passed' && saved.sourcePath.startsWith('sources/generated/') && saved.imageBytes > 1000
    && saved.seedMatches && saved.promptMatches && saved.modelPath === 'models/Supra2-IMG-Mobile-ONNX'
    && saved.hashes > 0 && saved.steps === 20 && saved.reportHasProvenance,
  `Prompt-generated motion provenance is incomplete: ${JSON.stringify(saved)}`);
  console.log(JSON.stringify(saved, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        document.querySelector('.motion-diagnostics-dialog[open]')?.close();
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
    } catch (error) { console.warn(`Could not fully restore disposable Chrome: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
