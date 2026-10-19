/** Optional UI check. Run Vite on 5173 and a fresh Chrome profile on CDP port 9266. */
const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9266);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-topbar')", 'workspace');
  const created = await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
    const context = canvas.getContext('2d'); const pixels = context.createImageData(640, 640);
    let seed = 42;
    for (let index = 0; index < pixels.data.length; index += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[index] = seed & 255; pixels.data[index + 1] = seed >>> 8 & 255;
      pixels.data[index + 2] = seed >>> 16 & 255; pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    const originalFetch = window.fetch;
    window.fetch = (input, init) => String(input) === 'https://fixture.invalid/v1/images/generations'
      ? Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: encoded }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, init);
    try {
      const { generateImage, IMAGE_PRESETS } = await import('/src/imageGeneration.ts');
      const image = await generateImage({ ...IMAGE_PRESETS['small-sd'], endpoint: 'https://fixture.invalid/v1', model: 'Fixture image' }, 'A teal circuit garden');
      const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
      const assets = await store.avatarLibrary(); const asset = assets.find(item => item.prompt === 'A teal circuit garden');
      if (!asset) throw new Error('Generated image was not saved to Images.');
      const saved = await store.avatarAsset(asset.id);
      const bitmap = await createImageBitmap(saved);
      const result = { id: asset.id, source: asset.source, size: saved.size, generatedSize: image.size, width: bitmap.width, height: bitmap.height };
      bitmap.close(); return result;
    } finally { window.fetch = originalFetch; }
  })()`);
  if (created.source !== 'generated' || created.size !== created.generatedSize || created.size <= 512_000 || created.width !== 640 || created.height !== 640)
    throw new Error(`Generated PNG was not preserved at full size: ${JSON.stringify(created)}`);
  await evaluate("location.hash = '/images'; true");
  await waitFor("!!document.querySelector('.harness-avatar-tile strong')?.textContent.includes('Fixture image')", 'generated image tile');
  await evaluate("document.querySelector('.harness-avatar-preview-trigger').click(); true");
  const preview = await waitFor(`(() => {
    const dialog = document.querySelector('.harness-avatar-preview-dialog[open]');
    const image = dialog?.querySelector('img');
    return image?.naturalWidth ? { width: image.naturalWidth, height: image.naturalHeight, prompt: dialog.textContent.includes('A teal circuit garden'), download: !!dialog.querySelector('a[download]') } : false;
  })()`, 'full-size image preview');
  if (preview.width !== 640 || preview.height !== 640 || !preview.prompt || !preview.download)
    throw new Error(`Image preview is incomplete: ${JSON.stringify(preview)}`);
  await evaluate("document.querySelector('.harness-avatar-preview-dialog header button').click(); true");
  await waitFor("!document.querySelector('.harness-avatar-preview-dialog[open]')", 'closed preview');
  await evaluate("document.querySelector('.harness-avatar-tile .harness-avatar-favorite').click(); true");
  await waitFor("document.querySelector('.harness-avatar-tile .harness-avatar-favorite')?.getAttribute('aria-pressed') === 'true'", 'favorite');
  await evaluate("document.querySelector('.harness-avatar-tile button:nth-child(2)').click(); true");
  await waitFor("!!document.querySelector('.harness-avatar-asset-dialog[open]')", 'image editor');
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('.harness-avatar-asset-dialog label')].find(label => label.textContent.startsWith('Collections'))?.querySelector('input');
    if (!field) throw new Error('Collections field is missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Story covers');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.harness-avatar-asset-dialog .harness-primary').click(); return true;
  })()`);
  await waitFor("!document.querySelector('.harness-avatar-asset-dialog[open]')", 'saved collection');
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-avatar-tile strong')?.textContent.includes('Fixture image')", 'reopened image');
  const reopened = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const asset = (await store.avatarLibrary()).find(item => item.id === '${created.id}');
    return { favorite: asset?.favorite, collections: asset?.collections, filter: [...document.querySelectorAll('select[aria-label="Image collection"] option')].map(item => item.textContent) };
  })()`);
  if (!reopened.favorite || !reopened.collections?.includes('Story covers') || !reopened.filter.includes('Story covers'))
    throw new Error(`Favorite or collection was not restored: ${JSON.stringify(reopened)}`);
  console.log(`Generated image library passed: ${created.size} byte original PNG, full-size preview, favorite, named collection, and reload.`);
} finally { socket.close(); }
