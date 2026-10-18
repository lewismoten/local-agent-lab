/** Disposable Chrome check for a selected model missing after a workspace reload. */
import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

let snapshot;
try {
  snapshot = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return { settings: await store.settings(), url: location.href,
      type: sessionStorage.getItem('browser-model-type'), tab: sessionStorage.getItem('browser-model-tab') };
  })()`);
  for (const [path, expected] of [
    ['models/definitely-missing-check.gguf', 'definitely-missing-check.gguf'],
    ['models/SD-1.5-ONNX', 'Stable Diffusion 1.5'],
  ]) {
    const oldOrigin = await evaluate('performance.timeOrigin');
    await evaluate(`(async () => {
      const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
      const settings = await store.settings();
      await store.saveSettings({ ...settings, selectedProfileId: 'browser',
        profiles: settings.profiles.map(profile => profile.id === 'browser' ? { ...profile, model: ${JSON.stringify(path)} } : profile) });
      sessionStorage.setItem('browser-model-type', 'all');
      sessionStorage.setItem('browser-model-tab', 'loaded');
      location.hash = '#/models';
      setTimeout(() => location.reload(), 50);
      return true;
    })()`);
    await waitFor(`performance.timeOrigin > ${oldOrigin}`, 'page reload');
    const state = await waitFor(`(() => {
      const picker = document.querySelector('select[aria-label="Model file"]');
      const message = [...document.querySelectorAll('.browser-model-choice [role="status"]')]
        .find(item => item.textContent?.includes('missing from this workspace'));
      return picker?.value === ${JSON.stringify(path)} && message?.textContent?.includes('missing from this workspace')
        ? { selected: picker.selectedOptions[0]?.textContent, message: message.textContent,
          loadDisabled: [...document.querySelectorAll('.model-buttons button')].find(button => button.textContent.trim() === 'Load')?.disabled }
        : false;
    })()`, `missing-file status for ${path}`);
    assert.match(state.selected, /missing from this workspace/);
    assert.ok(state.message.includes(expected));
    assert.equal(state.loadDisabled, true);
    console.log(`${path}: ${state.message.trim()}`);
  }
} finally {
  if (snapshot && socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
        await store.saveSettings(${JSON.stringify(snapshot.settings)});
        if (${JSON.stringify(snapshot.type)} === null) sessionStorage.removeItem('browser-model-type');
        else sessionStorage.setItem('browser-model-type', ${JSON.stringify(snapshot.type)});
        if (${JSON.stringify(snapshot.tab)} === null) sessionStorage.removeItem('browser-model-tab');
        else sessionStorage.setItem('browser-model-tab', ${JSON.stringify(snapshot.tab)});
        location.replace(${JSON.stringify(snapshot.url)});
        setTimeout(() => location.reload(), 50);
        return true;
      })()`);
    } catch (error) { console.warn(`Could not restore disposable browser settings: ${error instanceof Error ? error.message : String(error)}`); }
  }
  socket.close();
}
