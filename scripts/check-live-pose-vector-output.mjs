/** Real pose and vector UI checks. Requires optional MediaPipe and VTracer files in disposable Chrome OPFS. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const cases = [
  { id: 'vector', path: 'models/VTracer-Vector', title: 'vector-diagnostics-title', action: 'Create SVG' },
  { id: 'pose', path: 'models/Pose-Landmarker-Full', title: 'pose-diagnostics-title', action: 'Detect poses' },
];
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 120_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 160) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

let snapshot;
const results = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const motion = await import('/src/motionAssets.ts');
    await motion.motionAssetsManager.discover(folder);
    const installed = motion.getMotionAssets().installed;
    if (!installed.vector || !installed.vector_engine || !installed.pose || !installed.pose_engine) throw new Error('Pose or vector files are missing.');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);

  for (const item of cases) {
    const startedAt = await evaluate('performance.timeOrigin');
    await evaluate(`(async () => {
      const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
      const settings = await store.settings();
      await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
        profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(item.path)} } : profile) });
      sessionStorage.setItem('browser-model-type', ${JSON.stringify(item.id)});
      location.hash = '#/models';
      setTimeout(() => location.reload(), 50);
      return true;
    })()`);
    await waitFor(`performance.timeOrigin > ${startedAt}`, `${item.id} reload`);
    await waitFor(`document.querySelector('select[aria-label="Model file"]')?.value === ${JSON.stringify(item.path)}`, `${item.id} selection`);
    await waitFor(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Inspect features' && !button.disabled)`, `${item.id} inspector`);
    await evaluate(`(() => { [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Inspect features' && !button.disabled).click(); return true; })()`);
    await waitFor(`document.querySelector('#${item.title}')?.closest('dialog')?.open`, `${item.id} dialog`);
    const selected = await evaluate(`(async () => {
      const dialog = document.querySelector('#${item.title}').closest('dialog');
      let file;
      if (${JSON.stringify(item.id)} === 'vector') {
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = '#df3149'; ctx.beginPath(); ctx.arc(74, 78, 42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2465cc'; ctx.fillRect(132, 42, 72, 72);
        ctx.fillStyle = '#2b9856'; ctx.beginPath(); ctx.moveTo(132, 209); ctx.lineTo(209, 209); ctx.lineTo(170, 140); ctx.fill();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        file = new File([blob], 'three-shapes.png', { type: 'image/png' });
      } else {
        const { PUBLIC_REFERENCE_PHOTO_NAME } = await import('/src/visionFixtures.ts');
        const response = await fetch('/' + PUBLIC_REFERENCE_PHOTO_NAME);
        if (!response.ok) throw new Error('Reference photo unavailable.');
        file = new File([await response.blob()], 'reference-photo.jpg', { type: 'image/jpeg' });
      }
      const input = dialog.querySelector('input[type=file]');
      const transfer = new DataTransfer(); transfer.items.add(file);
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      return { name: file.name, bytes: file.size };
    })()`);
    await waitFor(`[...document.querySelector('#${item.title}').closest('dialog').querySelectorAll('button')].some(button => button.textContent.trim() === ${JSON.stringify(item.action)} && !button.disabled)`, `${item.id} action`);
    await evaluate(`(() => { const dialog = document.querySelector('#${item.title}').closest('dialog'); [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(item.action)}).click(); return true; })()`);
    await waitFor(`!!document.querySelector('#${item.title}').closest('dialog').querySelector('.image-model-results')`, `${item.id} result`, 240);
    const result = await evaluate(`(async () => {
      const dialog = document.querySelector('#${item.title}').closest('dialog');
      const text = dialog.querySelector('.image-model-results')?.textContent || '';
      const preview = dialog.querySelector('figure img');
      const report = await (await import('/src/diagnosticReports.ts')).loadLatestDiagnosticJson(
        await (await import('/src/storage.ts')).browserFiles(), ${JSON.stringify(item.path)}, ${JSON.stringify(item.id)});
      let artifact;
      if (report?.svgPath) {
        const svg = await (await (await import('/src/storage.ts')).readBlob(await (await import('/src/storage.ts')).browserFiles(), report.svgPath)).text();
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        artifact = { type: 'svg', paths: root.querySelectorAll('path').length, width: root.getAttribute('width'), height: root.getAttribute('height') };
      }
      if (report?.posePath) {
        const saved = JSON.parse(await (await (await import('/src/storage.ts')).readBlob(await (await import('/src/storage.ts')).browserFiles(), report.posePath)).text());
        artifact = { type: 'pose', frames: saved.frames?.length, people: saved.frames?.[0]?.landmarks?.length, landmarks: saved.frames?.[0]?.landmarks?.[0]?.length,
          modelHashCount: saved.modelPackage?.files?.length || 0, runtimeHashCount: saved.runtimePackage?.files?.length || 0 };
      }
      const artifactPath = report?.svgPath || report?.posePath;
      const sidecar = artifactPath ? JSON.parse(await (await (await import('/src/storage.ts')).readBlob(
        await (await import('/src/storage.ts')).browserFiles(), artifactPath + '.meta.json')).text()) : null;
      return { text, preview: !!preview && preview.complete && preview.naturalWidth > 0, artifact,
        sidecar: sidecar && { artifactPath: sidecar.artifactPath, modelPackage: sidecar.modelPackage, runtimePackage: sidecar.runtimePackage },
        report: report && { result: report.result, detail: report.detail, frames: report.frames, people: report.people,
          svgPath: report.svgPath, posePath: report.posePath, savedPath: report.savedPath,
          modelPackage: report.modelPackage, runtimePackage: report.runtimePackage } };
    })()`);
    assert.equal(result.report?.result, 'passed', `${item.id} should save a passed report: ${result.text}`);
    assert.ok(result.preview, `${item.id} preview should decode`);
    assert.ok(result.text.includes('✅'));
    assert.equal(result.report.modelPackage?.path, item.path, `${item.id} should save its model ID`);
    assert.ok(result.report.modelPackage?.files?.every(file => /^[a-f0-9]{64}$/.test(file.sha256)), `${item.id} should save pinned model hashes`);
    assert.ok(result.report.runtimePackage?.files?.length > 0 && result.report.runtimePackage.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)), `${item.id} should save runtime hashes`);
    assert.equal(result.sidecar?.artifactPath, result.report.svgPath || result.report.posePath, `${item.id} output should have a sidecar`);
    assert.equal(result.sidecar?.modelPackage?.path, item.path, `${item.id} sidecar should retain the model path`);
    assert.ok(result.sidecar?.runtimePackage?.files?.length > 0, `${item.id} sidecar should retain engine files`);
    if (item.id === 'vector') assert.ok(result.artifact?.paths >= 4 && result.artifact.width === '256' && result.artifact.height === '256', 'SVG contains editable shapes');
    if (item.id === 'pose') assert.ok(result.artifact?.frames === 1 && result.artifact.people >= 1 && result.artifact.landmarks === 33 && result.artifact.modelHashCount > 0 && result.artifact.runtimeHashCount > 0, 'Pose file contains landmarks and package hashes');
    const layouts = [];
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      await new Promise(resolve => setTimeout(resolve, 600));
      const layout = await evaluate(`(() => { const dialog = document.querySelector('#${item.title}').closest('dialog'); const rect = dialog.getBoundingClientRect(); return { viewport: innerWidth, left: rect.left, right: rect.right, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, dark: getComputedStyle(dialog).colorScheme === 'dark', scrollable: dialog.scrollHeight > dialog.clientHeight }; })()`);
      assert.equal(layout.viewport, width);
      assert.ok(layout.dark && layout.left >= -1 && layout.right <= width + 1 && layout.scrollWidth <= layout.clientWidth + 1, `${item.id} dialog fits ${width}`);
      layouts.push(layout);
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(`/tmp/rivers-live-${item.id}-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      const lastVisible = await evaluate(`(() => { const dialog = document.querySelector('#${item.title}').closest('dialog'); dialog.scrollTop = dialog.scrollHeight; const last = dialog.querySelector('.image-model-results small:last-child'); return !last || last.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1; })()`);
      assert.ok(lastVisible, `${item.id} saved path is reachable at ${width}`);
    }
    results.push({ id: item.id, source: selected, result, layouts });
    console.log(`${item.id}: ${result.report.detail}`);
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        ${snapshot.type == null ? "sessionStorage.removeItem('browser-model-type');" : `sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});`}
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
      await call('Emulation.setDeviceMetricsOverride', { width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1, mobile: snapshot.width < 500 });
    } catch (error) { console.warn(`Could not restore browser settings: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
