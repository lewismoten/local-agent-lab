/** Real RIFE frame-interpolation UI check. Requires RIFE and ONNX engine in disposable Chrome OPFS. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const model = 'models/RIFE-4.9-ONNX';
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 120_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, attempts = 180) => {
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
    await motion.motionAssetsManager.discover(folder);
    if (!motion.getMotionAssets().installed.rife) throw new Error('RIFE files missing.');
    await motion.assertMotionFiles(folder, 'rife');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const previousLoad = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile =>
      profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(model)} } : profile) });
    sessionStorage.setItem('browser-model-type', 'video');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${previousLoad}`, 'Models reload');
  await waitFor(`document.querySelector('select[aria-label="Model file"]')?.value === ${JSON.stringify(model)}`, 'RIFE selection');
  await waitFor(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Inspect features' && !button.disabled)`, 'inspector');
  await evaluate(`(() => { [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Inspect features' && !button.disabled).click(); return true; })()`);
  await waitFor(`document.querySelector('.motion-diagnostics-dialog')?.open && document.querySelector('#motion-diagnostics-title')?.textContent?.includes('RIFE')`, 'RIFE dialog');
  await evaluate(`(async () => {
    const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
    for (const [selector, center] of [['#motion-first-frame', 100], ['#motion-last-frame', 132]]) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 256, 256);
      context.fillStyle = '#d82948'; context.beginPath(); context.arc(center, 128, 42, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#2269d7'; context.fillRect(20, 20, 34, 34);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], selector.includes('first') ? 'first.png' : 'last.png', { type: 'image/png' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = dialog.querySelector(selector); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await waitFor(`[...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].some(button => button.textContent.trim() === 'Run interpolation test' && !button.disabled)`, 'RIFE action');
  await evaluate(`(() => { [...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(button => button.textContent.trim() === 'Run interpolation test').click(); return true; })()`);
  const output = await waitFor(`(() => { const dialog=document.querySelector('.motion-diagnostics-dialog[open]'); const video=dialog?.querySelector('.motion-result video'); if (video) return { source:video.src, saved:dialog.querySelector('.motion-result small')?.textContent }; const result=dialog?.querySelector('.image-model-results')?.textContent; return result ? { error:result } : false; })()`, 'RIFE video or error', 360);
  assert.ok(output.source?.startsWith('blob:'), `RIFE generation failed: ${output.error || 'no video'}`);
  const artifact = await evaluate(`(async () => {
    const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
    const video = dialog.querySelector('.motion-result video');
    if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    const { browserFiles, readBlob } = await import('/src/storage.ts');
    const folder = await browserFiles();
    const report = await (await import('/src/diagnosticReports.ts')).loadLatestDiagnosticJson(folder, ${JSON.stringify(model)}, 'video');
    const saved = await readBlob(folder, report.videoPath);
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    const frames = [];
    for (const time of [0.05, 0.55, 1.05]) {
      await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Video seek timed out.')), 8000); video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true }); video.currentTime = time; });
      context.drawImage(video, 0, 0, 64, 64);
      frames.push(context.getImageData(0, 0, 64, 64).data.slice());
    }
    const difference = (left, right) => { let sum=0; for (let i=0;i<left.length;i+=4) sum+=Math.abs(left[i]-right[i])+Math.abs(left[i+1]-right[i+1])+Math.abs(left[i+2]-right[i+2]); return +(sum/(64*64*3)).toFixed(2); };
    const red = frame => { let count=0, weightedX=0; for (let y=0;y<64;y++) for (let x=0;x<64;x++) { const i=(y*64+x)*4; if (frame[i]>100 && frame[i]>frame[i+1]*1.5 && frame[i]>frame[i+2]*1.5) { count++; weightedX+=x; } } return { count, centerX: count ? +(weightedX/count).toFixed(1) : null }; };
    return { report: { result: report.result, detail: report.detail, videoPath: report.videoPath }, bytes: saved.size,
      width: video.videoWidth, height: video.videoHeight, duration: video.duration,
      firstToMiddle: difference(frames[0], frames[1]), middleToLast: difference(frames[1], frames[2]), red: frames.map(red) };
  })()`);
  assert.equal(artifact.report.result, 'passed');
  assert.ok(artifact.bytes > 1000 && artifact.width === 512 && artifact.height === 512 && artifact.duration >= 1.4);
  assert.ok(artifact.firstToMiddle > 0.5 && artifact.middleToLast > 0.5, 'middle frame should differ from both endpoints');
  assert.ok(artifact.red.every(frame => frame.count > 100), 'all three encoded frames should retain the moving red circle');
  assert.ok(artifact.red[0].centerX < artifact.red[1].centerX && artifact.red[1].centerX < artifact.red[2].centerX, 'circle should move through the interpolated frame');
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await new Promise(resolve => setTimeout(resolve, 650));
    const layout = await evaluate(`(() => { const dialog=document.querySelector('.motion-diagnostics-dialog[open]'); const rect=dialog.getBoundingClientRect(); return { viewport:innerWidth,left:rect.left,right:rect.right,scrollWidth:dialog.scrollWidth,clientWidth:dialog.clientWidth,dark:getComputedStyle(dialog).colorScheme==='dark' }; })()`);
    assert.equal(layout.viewport, width);
    assert.ok(layout.dark && layout.left >= -1 && layout.right <= width + 1 && layout.scrollWidth <= layout.clientWidth + 1);
    layouts.push(layout);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-live-rife-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    const downloadReachable = await evaluate(`(() => { const dialog=document.querySelector('.motion-diagnostics-dialog[open]'); dialog.scrollTop=dialog.scrollHeight; const link=dialog.querySelector('.motion-result a[download]'); return !!link && link.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1; })()`);
    assert.ok(downloadReachable, `RIFE download link is reachable at ${width}`);
  }
  console.log(JSON.stringify({ artifact, layouts }, null, 2));
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
