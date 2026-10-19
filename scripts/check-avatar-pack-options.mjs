/** Optional browser check. Run Vite on 5198 and a disposable Chrome profile on CDP port 9251. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9251);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error('No workspace page found.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id;
  pending.set(next, { resolve, reject });
  socket.send(JSON.stringify({ id: next, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
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
  await waitFor("!!document.querySelector('.harness-avatar-library-actions button')", 'avatar library');
  await evaluate("if (document.querySelector('.harness-avatar-pack-dialog[open]')) document.querySelector('.harness-avatar-pack-dialog .harness-dialog-actions button').click(); true");
  await waitFor("!document.querySelector('.harness-avatar-pack-dialog[open]')", 'closed prior pack dialog');
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent.includes('Generate pack')).click(); true");
  await waitFor("!!document.querySelector('.harness-avatar-pack-dialog[open]')", 'pack dialog');
  await evaluate(`(() => {
    const dialog = document.querySelector('.harness-avatar-pack-dialog');
    const kind = dialog.querySelector('.harness-avatar-pack-fields select');
    kind.value = 'animals'; kind.dispatchEvent(new Event('change', { bubbles: true }));
    const style = [...dialog.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'other'));
    style.value = 'other'; style.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-avatar-pack-dialog input[placeholder=\"Describe a visual style\"]')", 'custom style');
  await evaluate(`(() => {
    const dialog = document.querySelector('.harness-avatar-pack-dialog');
    const style = dialog.querySelector('input[placeholder="Describe a visual style"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(style, 'Paper mosaic');
    style.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector('.harness-avatar-direction-chips button').click();
    const custom = dialog.querySelector('input[aria-label="Custom subject direction"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(custom, 'Glowing antennae');
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("document.querySelector('.harness-avatar-pack-dialog .harness-avatar-direction-add button:not(:disabled)') !== null", 'direction Add');
  await evaluate("document.querySelector('.harness-avatar-pack-dialog .harness-avatar-direction-add button').click(); true");
  const planned = await waitFor("[...document.querySelectorAll('.harness-avatar-pack-dialog .harness-avatar-direction-chips button, .harness-avatar-pack-dialog .harness-avatar-custom-chip')].some(button => button.textContent.includes('Glowing antennae') && (button.getAttribute('aria-pressed') === 'true' || button.classList.contains('harness-avatar-custom-chip'))) && document.querySelector('.harness-avatar-pack-dialog .harness-avatar-pack-plan p')?.textContent.includes('Corgi')", 'animal pack plan').catch(async error => {
    const state = await evaluate("({ kind: document.querySelector('.harness-avatar-pack-fields select')?.value, plan: document.querySelector('.harness-avatar-pack-plan p')?.textContent, custom: document.querySelector('.harness-avatar-custom-chip')?.textContent })");
    throw new Error(`${error.message} ${JSON.stringify(state)}`);
  });
  if (!planned) throw new Error('Animal plan or custom direction was missing.');
  await evaluate("document.querySelector('.harness-avatar-pack-dialog .harness-dialog-actions button').click(); true");
  const saved = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const preferences = await store.avatarPackPreferences();
    return preferences.styles.includes('Paper mosaic') && preferences.directions.includes('Glowing antennae');
  })()`, 'saved workspace choices');
  if (!saved) throw new Error('Custom choices were not saved.');
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent.includes('Generate pack')).click(); true");
  await waitFor("[...document.querySelectorAll('.harness-avatar-pack-dialog option')].some(option => option.textContent === 'Paper mosaic')", 'reused custom style');
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-avatar-library-actions button')", 'reloaded avatar library');
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent.includes('Generate pack')).click(); true");
  await waitFor("[...document.querySelectorAll('.harness-avatar-pack-dialog option')].some(option => option.textContent === 'Paper mosaic') && [...document.querySelectorAll('.harness-avatar-direction-chips button')].some(button => button.textContent === 'Glowing antennae')", 'custom choices after reload');
  await evaluate(`(() => {
    const count = document.querySelectorAll('.harness-avatar-pack-fields select')[1];
    count.value = '24'; count.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const titles = await waitFor("(() => { const text = document.querySelector('.harness-avatar-pack-plan p')?.textContent || ''; return text.split(' · ').length === 24 ? text.split(' · ') : false; })()", '24 avatar plan');
  if (new Set(titles).size !== 24) throw new Error('The 24 avatar plan contains repeated titles.');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { default: Preview } = await import('/src/HarnessAvatarPackPreview.tsx');
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default || ReactModule;
    const ReactDom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDom.createRoot || ReactDom.default?.createRoot;
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const asset = await store.saveAvatarAsset(blob, { title: 'Preview test', tags: [], source: 'generated' });
    const host = document.createElement('div'); host.id = 'avatar-preview-test'; document.body.append(host);
    window.__avatarPreviewRoot = createRoot(host);
    window.__avatarPreviewRoot.render(React.createElement(Preview, { asset, store }));
    return true;
  })()`);
  await waitFor("document.querySelector('#avatar-preview-test img')?.src.startsWith('blob:')", 'saved avatar thumbnail');
  await evaluate("window.__avatarPreviewRoot.unmount(); document.querySelector('#avatar-preview-test').remove(); true");
  console.log('Avatar pack options passed: 24 unique subjects, workspace reuse, and saved-image preview.');
} finally { socket.close(); }
