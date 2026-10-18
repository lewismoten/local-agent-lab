/** Optional live output check. Requires Depth Anything V2 Small and the ONNX image engine in disposable Chrome, Vite on 5198, CDP on 9239. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
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
const waitFor = async (expression, label, attempts = 480) => {
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
  await call('DOM.enable');
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const folder = await (await import('/src/storage.ts')).browserFiles();
    const motion = await import('/src/motionAssets.ts');
    const image = await import('/src/browserImageAssets.ts');
    await Promise.all([motion.motionAssetsManager.discover(folder), image.browserImageAssetsManager.discover(folder)]);
    if (!motion.getMotionAssets().installed.depth || !image.getBrowserImageAssets().installed.engine) throw new Error('Depth Anything V2 Small and the ONNX image engine must be installed first.');
    return { settings: await store.settings(), url: location.href, width: innerWidth, height: innerHeight,
      type: sessionStorage.getItem('browser-model-type') };
  })()`);
  const before = await evaluate('performance.timeOrigin');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, selectedProfileId: 'browser', profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: 'models/Depth-Anything-V2-Small-ONNX' } : profile) });
    sessionStorage.setItem('browser-model-type', 'video');
    location.hash = '#/models';
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  await waitFor(`performance.timeOrigin > ${before}`, 'depth model view reload');
  await waitFor("!![...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models')", 'Local Models tab');
  await evaluate("[...document.querySelectorAll('.browser-model-tabs button')].find(item => item.textContent?.trim() === 'Local Models').click(); true");
  await waitFor("!!document.querySelector('.motion-diagnostics-dialog')", 'depth inspector');
  await evaluate("document.querySelector('.motion-diagnostics-dialog').showModal(); true");
  const root = await call('DOM.getDocument');
  const input = await call('DOM.querySelector', { nodeId: root.root.nodeId, selector: '.motion-diagnostics-dialog input[type=file]' });
  assert.ok(input.nodeId, 'depth inspector should accept a first frame');
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resolve('public/Lewis-Moten-and-Teddy-at-B-n-L-custard.jpg')] });
  await waitFor("!![...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run video test' && !item.disabled)", 'Run video test button');
  await evaluate("[...document.querySelectorAll('.motion-diagnostics-dialog[open] button')].find(item => item.textContent?.trim() === 'Run video test').click(); true");
  const output = await waitFor(`(() => {
    const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
    const video = dialog?.querySelector('.motion-result video');
    const error = dialog?.querySelector('.model-error[role="alert"]')?.textContent;
    const finished = !!dialog?.querySelector('.image-model-results');
    return video ? { generated: true, source: video.src, depthPreview: !!dialog.querySelector('.motion-depth-preview'), saved: dialog.querySelector('.motion-result small')?.textContent } : finished ? { generated: false, error: error || dialog.querySelector('.image-model-results')?.textContent } : false;
  })()`, 'generated depth video or visible error', 1200);
  assert.ok(output.generated, `Depth video generation failed: ${output.error || 'no video'}`);
  assert.ok(output.source?.startsWith('blob:'), 'the result should expose a video preview');
  assert.ok(output.depthPreview, 'the result should show the estimated depth map');
  const videoBytes = await evaluate("(async () => (await (await fetch(document.querySelector('.motion-result video').src)).blob()).size)()");
  assert.ok(videoBytes > 1000, 'the encoded video should contain media bytes');
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate("(() => { const dialog = document.querySelector('.motion-diagnostics-dialog[open]'); dialog.scrollTop = dialog.scrollHeight; return true; })()");
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('.motion-diagnostics-dialog[open]');
      const rect = dialog.getBoundingClientRect();
      return { width: innerWidth, scheme: getComputedStyle(dialog).colorScheme, left: rect.left, right: rect.right,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        previewWidth: dialog.querySelector('.motion-depth-preview')?.getBoundingClientRect().width || 0,
        videoWidth: dialog.querySelector('video')?.getBoundingClientRect().width || 0 };
    })()`);
    layouts.push(state);
    assert.equal(state.scheme, 'dark');
    assert.ok(state.left >= -1 && state.right <= state.width + 1, 'depth dialog should fit');
    assert.ok(state.scrollWidth <= state.clientWidth + 1, 'depth result should not overflow horizontally');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`/tmp/rivers-depth-output-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  const motion = await evaluate(`(async () => {
    const video = document.querySelector('.motion-result video');
    if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const frame = async time => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video seek timed out.')), 5000);
        video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0, 64, 64);
      return context.getImageData(0, 0, 64, 64).data;
    };
    const first = await frame(0.25), second = await frame(1.25);
    let difference = 0;
    for (let index = 0; index < first.length; index += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(first[index + channel] - second[index + channel]);
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, meanRgbDifference: Math.round(difference / (64 * 64 * 3) * 100) / 100 };
  })()`);
  assert.ok(motion.duration > 1.5 && motion.width === 512 && motion.height === 512, 'the encoded clip should be a two-second 512px video');
  assert.ok(motion.meanRgbDifference > 0.5, 'frames should visibly change over time');
  console.log(JSON.stringify({ output, videoBytes, motion, layouts }, null, 2));
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
