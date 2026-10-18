/** Optional browser check. Requires a saved TripoSR PLY in disposable Chrome on CDP 9239. */
import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .find(item => item.type === 'page' && item.url.startsWith(base));
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 60_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 240; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

let snapshot;
try {
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return { url: location.href, width: innerWidth, height: innerHeight,
      settings: await store.settings(),
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
      profile.id === 'browser' ? { ...profile, model: 'models/TripoSR-Q8-ONNX' } : profile) });
    sessionStorage.setItem('browser-model-type', 'mesh');
    location.hash = '#/models'; setTimeout(() => location.reload(), 50); return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'model view reload');
  await waitFor("!!document.querySelector('.motion-diagnostics-dialog')", 'TripoSR inspector');
  await evaluate("document.querySelector('.motion-diagnostics-dialog').showModal(); true");
  const originalPly = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const report = await (await import('/src/diagnosticReports.ts')).loadLatestDiagnosticJson(folder, 'models/TripoSR-Q8-ONNX', 'mesh');
    if (!report?.plyPath) throw new Error('Save a TripoSR PLY before this check.');
    const blob = await (await import('/src/storage.ts')).readBlob(folder, report.plyPath);
    const file = new File([blob], 'imported-blue-vase.ply', { type: 'application/octet-stream' });
    const input = document.querySelector('.motion-diagnostics-dialog .tripo-ply-picker input[type=file]');
    const transfer = new DataTransfer(); transfer.items.add(file);
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return report.plyPath;
  })()`);
  await waitFor("!![...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Save GLB' && !item.disabled)", 'Save GLB action');
  await evaluate("[...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent.trim() === 'Save GLB').click(); true");
  const path = await waitFor("/GLB saved to (media\\/meshes\\/[^\\s]+\\.glb)/.exec(document.querySelector('.motion-diagnostics-dialog[open] .image-model-results')?.textContent || '')?.[1]", 'converted GLB');
  const sidecar = await evaluate(`(async () => {
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const file = await (await import('/src/storage.ts')).readBlob(folder, ${JSON.stringify(path + '.meta.json')});
    return JSON.parse(await file.text());
  })()`);
  assert.equal(sidecar.artifactPath, path);
  assert.equal(sidecar.kind, 'mesh-conversion');
  assert.equal(sidecar.modelRequired, false);
  assert.equal(sidecar.source.name, 'imported-blue-vase.ply');
  assert.equal(sidecar.source.origin, 'imported-ply');
  assert.equal(sidecar.modelPackage, undefined);
  console.log(JSON.stringify({ originalPly, convertedGlb: path, sidecar: path + '.meta.json' }));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        location.replace(${JSON.stringify(snapshot.url)}); setTimeout(() => location.reload(), 50); return true;
      })()`);
    } catch (error) { console.warn(`Could not restore browser settings: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
