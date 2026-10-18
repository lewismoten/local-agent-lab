/** UI check with Vite on 5198 and an isolated Chrome profile on CDP port 9244. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9244);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page' && item.url.startsWith(base));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-project-select')", 'workspace');
  const sourceId = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { createConversation } = await import('/src/harnessData.ts');
    const meta = { ...createConversation('home'), title: 'Icon conversation', autoTitled: true };
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    return meta.id;
  })()`);
  await evaluate('location.reload(); true');
  await waitFor("document.querySelector('.harness-session-open')?.textContent.includes('Icon conversation')", 'conversation in sidebar');
  await evaluate("document.querySelector('.harness-session-more').click(); true");
  await waitFor("[...document.querySelectorAll('dialog')].some(item => item.open && item.querySelector('h2')?.textContent === 'Conversation')", 'conversation editor');
  await evaluate("document.querySelector('.harness-conversation-artwork-button').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'conversation icon editor');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#b983e9'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'conversation.png', { type: 'image/png' }));
    const input = document.querySelector('.harness-surface-artwork-dialog input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-session-open .harness-conversation-icon')", 'conversation sidebar icon');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Conversation'); [...dialog.querySelectorAll('button')].find(item => item.textContent.trim() === 'Close').click(); location.reload(); true");
  await waitFor("!!document.querySelector('.harness-session-open .harness-conversation-icon')", 'conversation icon after reload');
  await evaluate("document.querySelector('.harness-project-select button[aria-label=\"New project\"]').click(); true");
  await waitFor("[...document.querySelectorAll('dialog')].some(item => item.open && item.querySelector('h2')?.textContent === 'New project')", 'new project editor');
  await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'New project');
    const input = dialog.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Second project');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector('.harness-primary').click();
    return true;
  })()`);
  await waitFor("document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Second project'", 'second project');
  const secondId = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return (await store.manifest()).projects.find(item => item.name === 'Second project')?.id;
  })()`);
  if (!secondId) throw new Error('Second project was not saved.');
  await evaluate("(() => { const select = document.querySelector('#project-select'); select.value = 'home'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await waitFor("document.querySelector('.harness-session-open')?.textContent.includes('Icon conversation')", 'source project');
  await evaluate("document.querySelector('.harness-session-more').click(); true");
  await evaluate(`(() => { const select = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Conversation').querySelector('label select'); select.value = ${JSON.stringify(secondId)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await evaluate("[...[...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Conversation').querySelectorAll('button')].find(item => item.textContent.trim() === 'Copy').click(); true");
  // The destination now has an independently identified conversation with the same artwork.
  await waitFor(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.sessions(${JSON.stringify(secondId)})).length === 1; })()`, 'copied conversation');
  await evaluate(`(() => { const select = document.querySelector('#project-select'); select.value = ${JSON.stringify(secondId)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor("!!document.querySelector('.harness-session-open .harness-conversation-icon')", 'copied conversation icon');
  const copiedIcon = await evaluate(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const copy = (await store.sessions(${JSON.stringify(secondId)}))[0]; const artwork = (await store.surfaceArtwork()).items; return !!artwork['conversation:' + copy.id] && !!artwork['conversation:' + ${JSON.stringify(sourceId)}]; })()`);
  if (!copiedIcon) throw new Error('The copied conversation lost its icon or changed the source.');
  await evaluate("(() => { const select = document.querySelector('#project-select'); select.value = 'home'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await waitFor("document.querySelector('.harness-session-open')?.textContent.includes('Icon conversation')", 'source before move');
  await evaluate("document.querySelector('.harness-session-more').click(); true");
  await evaluate(`(() => { const dialog = [...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Conversation'); const select = dialog.querySelector('label select'); select.value = ${JSON.stringify(secondId)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await evaluate("[...[...document.querySelectorAll('dialog')].find(item => item.open && item.querySelector('h2')?.textContent === 'Conversation').querySelectorAll('button')].find(item => item.textContent.trim() === 'Move').click(); true");
  const moved = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const source = await store.sessions('home'); const destination = await store.sessions(${JSON.stringify(secondId)});
    const artwork = (await store.surfaceArtwork()).items;
    return source.length === 0 && destination.length === 2 && !artwork['conversation:' + ${JSON.stringify(sourceId)}]
      && destination.every(item => !!artwork['conversation:' + item.id]);
  })()`, 'moved conversation artwork');
  if (!moved) throw new Error('The move did not preserve destination icons and clear the source reference.');
  await evaluate(`(() => { const select = document.querySelector('#project-select'); select.value = ${JSON.stringify(secondId)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor("document.querySelectorAll('.harness-session-open .harness-conversation-icon').length === 2", 'both destination icons');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const fit = await evaluate("(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth, sidebar: document.querySelector('.harness-sidebar').getBoundingClientRect().right }))()");
  if (fit.body > fit.viewport + 2) throw new Error(`Conversation icon overflows mobile viewport: ${JSON.stringify(fit)}`);
  console.log('Conversation artwork passed: upload, reload, sidebar display, copy, move, and 390 px layout.');
} finally { socket.close(); }
