/** Optional UI check. Run Vite on 5198 and an empty Chrome profile on CDP port 9239. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`No Chrome page at ${base}.`);
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
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
try {
  await call('Runtime.enable');
  await call('Page.navigate', { url: `${base}#/memory` });
  await waitFor("!!document.querySelector('.harness-memory-grid input[list=\"memory-categories\"]')", 'memory editor');
  await evaluate(`(() => {
    const form = document.querySelector('.harness-memory-grid > .harness-card');
    const fields = [...form.querySelectorAll('label')];
    const set = (label, value) => {
      const field = fields.find(item => item.textContent.startsWith(label)).querySelector('input,textarea');
      const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('Category', 'About Me'); set('Title', 'Home city'); set('What to remember', 'Lives in Boston.');
    form.querySelector('.harness-memory-actions .harness-primary').click();
    return true;
  })()`);
  const saved = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const record = (await store.memory()).find(item => item.title === 'Home city');
    return record ? { category: record.category, content: record.content } : false;
  })()`, 'saved categorized memory');
  if (saved.category !== 'About Me' || saved.content !== 'Lives in Boston.') throw new Error(`Wrong saved memory: ${JSON.stringify(saved)}`);
  await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Filter memories by category"]');
    select.value = 'About Me'; select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("document.querySelector('.harness-memory-list .harness-card h3')?.textContent === 'Home city'", 'category filter');
  console.log('Memory category UI passed: saved About Me note and found it through the category filter.');
} finally { socket.close(); }
