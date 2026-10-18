/** Optional live 3D check. Requires TripoSR Q8, ONNX image engine, and WebGPU in disposable Chrome on CDP 9239; Vite on 5198. */
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
    if (!motion.getMotionAssets().installed.tripo || !image.getBrowserImageAssets().installed.engine) throw new Error('TripoSR Q8 and the ONNX image engine must be installed first.');
    if (!await navigator.gpu?.requestAdapter()) throw new Error('This browser has no WebGPU adapter for TripoSR.');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: 'models/TripoSR-Q8-ONNX' } : profile) });
    sessionStorage.setItem('browser-model-type', 'mesh');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'TripoSR model view reload', 240);
  await waitFor("!![...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models')", 'Local Models tab', 240);
  await evaluate("[...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models').click(); true");
  await waitFor("!!document.querySelector('.motion-diagnostics-dialog')", 'TripoSR inspector', 240);
  await evaluate("document.querySelector('.motion-diagnostics-dialog').showModal(); true");
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ece9e3'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#c4c0ba'; ctx.beginPath(); ctx.ellipse(128, 219, 70, 14, 0, 0, Math.PI * 2); ctx.fill();
    const blue = ctx.createLinearGradient(62, 0, 196, 0);
    blue.addColorStop(0, '#164358'); blue.addColorStop(.25, '#2787a4'); blue.addColorStop(.7, '#4aa4b9'); blue.addColorStop(1, '#123c50');
    ctx.fillStyle = blue; ctx.beginPath(); ctx.moveTo(111, 45); ctx.lineTo(145, 45); ctx.lineTo(149, 89);
    ctx.bezierCurveTo(188, 105, 196, 153, 177, 197); ctx.quadraticCurveTo(173, 216, 128, 218);
    ctx.quadraticCurveTo(83, 216, 79, 197); ctx.bezierCurveTo(60, 153, 68, 105, 107, 89); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#10394a'; ctx.beginPath(); ctx.ellipse(128, 44, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a8dce6'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(91, 122); ctx.quadraticCurveTo(76, 158, 94, 190); ctx.stroke();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('.motion-diagnostics-dialog input[type=file]');
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'blue-vase.png', { type: 'image/png' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.motion-diagnostics-dialog .tripo-input-preview img')", 'TripoSR input preview', 240);
  await evaluate(`(() => {
    const slider = [...document.querySelectorAll('.motion-diagnostics-dialog input[type=range]')].find(item => item.parentElement?.textContent?.includes('Mesh detail'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '32');
    slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!![...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Create mesh' && !item.disabled)", 'Create mesh button', 240);
  await evaluate("[...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Create mesh').click(); true");
  let lastStage = '';
  let result;
  for (let attempt = 0; attempt < 2400; attempt++) {
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
      const result = dialog?.querySelector('.image-model-results');
      return { stage: dialog?.querySelector('[role=status]')?.textContent || '', result: result?.textContent || '', report: result?.querySelector('p')?.textContent || '',
        error: dialog?.querySelector('.model-error[role=alert]')?.textContent || '', viewer: !!dialog?.querySelector('.tripo-mesh-viewer') };
    })()`);
    if (state.stage && state.stage !== lastStage && (!state.stage.startsWith('Sampling') || attempt % 40 === 0)) { console.error(`[TripoSR] ${state.stage}`); lastStage = state.stage; }
    if (state.report) { result = state; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(result, 'TripoSR did not finish within ten minutes');
  assert.ok(result.viewer, `TripoSR did not produce a mesh: ${result.error || result.result}`);
  assert.match(result.report, /Saved a colored mesh with [\d,]+ triangles/);
  await waitFor("!!document.querySelector('.tripo-mesh-viewer canvas')", 'interactive Three.js canvas', 240);
  const assets = await evaluate(`(async () => {
    const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
    const links = [...dialog.querySelectorAll('.image-model-results a')];
    return Promise.all(links.map(async link => ({ label: link.textContent.trim(), bytes: (await (await fetch(link.href)).blob()).size })));
  })()`);
  assert.ok(assets.some(item => item.label === 'Download PLY' && item.bytes > 1000), 'PLY download should be available');
  assert.ok(assets.some(item => item.label === 'Download GLB' && item.bytes > 1000), 'GLB download should be available');
  const provenance = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const { loadLatestDiagnosticJson } = await import('/src/diagnosticReports.ts');
    const { readBlob } = await import('/src/storage.ts');
    const report = await loadLatestDiagnosticJson(folder, 'models/TripoSR-Q8-ONNX', 'mesh');
    const sidecars = await Promise.all([report.plyPath, report.glbPath].map(async path => {
      const value = JSON.parse(await (await readBlob(folder, path + '.meta.json')).text());
      return { artifactPath: value.artifactPath, modelPath: value.modelPackage?.path, runtimePath: value.runtimePackage?.path };
    }));
    return { result: report?.result, modelPath: report?.modelPackage?.path,
      modelHashes: report?.modelPackage?.files?.map(file => file.sha256),
      runtimePath: report?.runtimePackage?.path,
      runtimeHashes: report?.runtimePackage?.files?.map(file => file.sha256),
      paths: [report.plyPath, report.glbPath], sidecars };
  })()`);
  assert.ok(provenance.result === 'passed' && provenance.modelPath === 'models/TripoSR-Q8-ONNX'
    && provenance.runtimePath === 'engines/ONNX-Image'
    && provenance.modelHashes?.length >= 3 && provenance.runtimeHashes?.length >= 3
    && [...provenance.modelHashes, ...provenance.runtimeHashes].every(hash => /^[a-f0-9]{64}$/.test(hash)),
  `TripoSR package provenance is incomplete: ${JSON.stringify(provenance)}`);
  assert.deepEqual(provenance.sidecars.map(item => item.artifactPath), provenance.paths);
  assert.ok(provenance.sidecars.every(item => item.modelPath === provenance.modelPath && item.runtimePath === provenance.runtimePath));
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate("(() => { document.querySelector('.motion-diagnostics-dialog[open] .tripo-mesh-viewer').scrollIntoView(); return true; })()");
    await new Promise(resolve => setTimeout(resolve, 200));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.motion-diagnostics-dialog[open]'); const rect = dialog.getBoundingClientRect();
      const viewer = dialog.querySelector('.tripo-viewer-viewport').getBoundingClientRect();
      return { width: innerWidth, scheme: getComputedStyle(dialog).colorScheme, left: rect.left, right: rect.right,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, viewerWidth: viewer.width,
        canvasWidth: dialog.querySelector('.tripo-viewer-viewport canvas')?.width || 0,
        detailRows: [...dialog.querySelectorAll('.image-model-results > small')].map(item => getComputedStyle(item).display) };
    })()`);
    layouts.push(state);
    assert.equal(state.scheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= state.width + 1, 'mesh dialog should fit');
    assert.ok(state.scrollWidth <= state.clientWidth + 1, 'mesh result should not overflow horizontally');
    assert.ok(state.viewerWidth > 200 && state.canvasWidth > 200, 'interactive viewer should have a usable canvas');
    assert.ok(state.detailRows.length >= 3 && state.detailRows.every(display => display === 'block'), 'saved paths and notes should have separate readable rows');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-tripo-output-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify({ result, assets, provenance, layouts }, null, 2));
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
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not fully restore the disposable profile: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
