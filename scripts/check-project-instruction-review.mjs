/** Optional UI smoke check. Start Vite on 5198 and a temporary Chrome profile on CDP port 9238. */
import { writeFile } from 'node:fs/promises';
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9238);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(appUrl));
if (!page) throw new Error(`No Chrome page at ${appUrl}.`);
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30_000);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || result.result?.description || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
await call('Runtime.enable');
if (process.env.MOBILE === '1') await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
else await call('Emulation.clearDeviceMetricsOverride');
await waitFor("document.querySelector('.harness-chat-header') !== null", 'the chat view');
let fixture;
try {
  fixture = await evaluate(`(async () => {
    const { HarnessStore } = await import('/src/harnessStore.ts');
    const { createConversation } = await import('/src/harnessData.ts');
    const store = new HarnessStore('browser-home', null);
    if ((await store.sessions('home')).length) throw new Error('Use an empty temporary Chrome profile for this smoke check.');
    const home = (await store.manifest()).projects.find(item => item.id === 'home');
    const meta = createConversation('home');
    meta.title = 'Project guidance review smoke';
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    const event = 'project_instruction_draft: ' + JSON.stringify({ draft: { projectId: 'home', instructions: 'Check files before editing and run focused tests.', expectedUpdatedAt: home.updatedAt }, reviewRequired: true, saved: false });
    let next = meta;
    for (let i = 0; i < 2; i++) {
      next = (await store.appendConversationMessage(next, { id: crypto.randomUUID(), role: 'assistant', content: 'Review the proposed project guidance.', createdAt: new Date().toISOString(), toolEvents: [event] })).meta;
    }
    return { sessionId: meta.id, home };
  })()`);
  await evaluate(`location.hash = '/chat/${fixture.sessionId}'; location.reload(); true`);
  await waitFor("document.querySelectorAll('.harness-message button').length > 0 && [...document.querySelectorAll('.harness-message button')].filter(button => button.textContent.includes('Review project instructions')).length === 2", 'two review buttons');
  const first = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.harness-message button')].filter(button => button.textContent.includes('Review project instructions'));
    buttons[0].click(); return true;
  })()`);
  if (!first) throw new Error('Could not open the first proposal.');
  const proposed = await waitFor(`(() => {
    const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Project settings');
    return dialog?.querySelector('textarea[rows="6"]')?.value || false;
  })()`, 'the proposed instructions in Project settings');
  if (proposed !== 'Check files before editing and run focused tests.') throw new Error(`Unexpected proposal: ${proposed}`);
  if (process.env.SCREENSHOT) {
    const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.SCREENSHOT, Buffer.from(image.data, 'base64'));
  }
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Project settings');
    [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save').click();
    return true;
  })()`);
  await waitFor("![...document.querySelectorAll('dialog')].some(item => item.open && item.querySelector('h2')?.textContent === 'Project settings')", 'Project settings to save');
  const saved = await evaluate(`(async () => {
    const { HarnessStore } = await import('/src/harnessStore.ts');
    const store = new HarnessStore('browser-home', null);
    return { manifest: (await store.manifest()).projects.find(item => item.id === 'home').instructions, project: (await store.project('home')).instructions };
  })()`);
  if (saved.manifest !== proposed || saved.project !== proposed) throw new Error('The saved instructions did not reach both project records.');
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.harness-message button')].filter(button => button.textContent.includes('Review project instructions'));
    buttons[1].click(); return true;
  })()`);
  const staleError = await waitFor("document.querySelector('.harness-error')?.textContent?.includes('Project settings changed since this draft') || false", 'stale proposal rejection');
  if (!staleError) throw new Error('The stale proposal was accepted.');
  console.log('Project instruction UI smoke passed: review, save to both project records, stale draft rejected.');
} finally {
  if (fixture) await evaluate(`(async () => {
    const { HarnessStore } = await import('/src/harnessStore.ts');
    const store = new HarnessStore('browser-home', null);
    const original = ${JSON.stringify(fixture.home)};
    await store.saveProject(original);
    await store.updateManifest(manifest => ({ ...manifest, projects: manifest.projects.map(item => item.id === original.id ? original : item) }));
    const session = (await store.sessions('home')).find(item => item.id === ${JSON.stringify(fixture.sessionId)});
    if (session) await store.deleteConversation(session);
    return true;
  })()`);
  socket.close();
}
