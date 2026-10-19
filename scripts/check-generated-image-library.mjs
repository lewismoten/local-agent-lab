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
  await evaluate(`(async () => {
    const { browserFiles, writeBlob } = await import('/src/storage.ts');
    const folder = await browserFiles(); if (!folder) throw new Error('Browser file storage is unavailable.');
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const savedAsset = (await store.avatarLibrary()).find(item => item.id === '${created.id}');
    const savedImage = await store.avatarAsset('${created.id}');
    if (!savedAsset || !savedImage) throw new Error('Shared generated image is missing.');
    await writeBlob(folder, 'outputs/images/recorder-copy.png', savedImage);
    await writeBlob(folder, 'outputs/images/recorder-copy.json', new Blob([JSON.stringify({ imagePath: 'outputs/images/recorder-copy.png', prompt: savedAsset.prompt, imageModel: 'Fixture image', generatedAt: savedAsset.createdAt })], { type: 'application/json' }));
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d'); context.fillStyle = '#15baac'; context.fillRect(0, 0, 96, 96);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await writeBlob(folder, 'harness/projects/older-book/library/generated/old-scene.png', blob);
    await writeBlob(folder, 'outputs/images/old-inspector.png', blob);
    await writeBlob(folder, 'outputs/images/old-inspector.json', new Blob([JSON.stringify({ imagePath: 'outputs/images/old-inspector.png', prompt: 'An archived teal image', imageModel: 'Fixture inspector', generatedAt: '2026-01-02T00:00:00.000Z' })], { type: 'application/json' }));
    return true;
  })()`);
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent.includes('Find older images')).click(); true");
  await waitFor("!![...document.querySelectorAll('.harness-avatar-tile strong')].find(node => node.textContent === 'old scene')", 'older image tile');
  await waitFor("!![...document.querySelectorAll('.harness-avatar-tile strong')].find(node => node.textContent === 'old inspector')", 'older inspector tile');
  const deduplicated = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const assets = await store.avatarLibrary();
    return { matching: assets.filter(item => item.prompt === 'A teal circuit garden').length,
      alias: assets.find(item => item.id === '${created.id}')?.relatedPaths?.includes('outputs/images/recorder-copy.png'),
      separate: assets.some(item => item.path === 'outputs/images/recorder-copy.png') };
  })()`);
  if (deduplicated.matching !== 1 || !deduplicated.alias || deduplicated.separate)
    throw new Error(`Inspector output made a duplicate image tile: ${JSON.stringify(deduplicated)}`);
  await evaluate('location.reload(); true');
  await waitFor("!![...document.querySelectorAll('.harness-avatar-tile strong')].find(node => node.textContent === 'old scene')", 'reopened older image');
  const linked = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const assets = await store.avatarLibrary();
    const item = assets.find(asset => asset.path?.endsWith('/old-scene.png'));
    const inspector = assets.find(asset => asset.path === 'outputs/images/old-inspector.png');
    const image = item ? await store.avatarAsset(item.id) : null;
    return { path: item?.path, bytes: image?.size, mimeType: image?.type, inspectorPrompt: inspector?.prompt };
  })()`);
  if (!linked.path || !linked.bytes || linked.mimeType !== 'image/png' || linked.inspectorPrompt !== 'An archived teal image') throw new Error(`Older image link did not survive reload: ${JSON.stringify(linked)}`);
  await evaluate("[...document.querySelectorAll('.harness-avatar-library-actions button')].find(button => button.textContent.includes('Find older images')).click(); true");
  await waitFor("document.querySelector('.harness-avatar-library [role=status]')?.textContent.includes('No older images found')", 'repeat image scan');
  const repeated = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const assets = await store.avatarLibrary();
    return { total: assets.length, matching: assets.filter(item => item.prompt === 'A teal circuit garden').length,
      alias: assets.find(item => item.id === '${created.id}')?.relatedPaths?.includes('outputs/images/recorder-copy.png') };
  })()`);
  if (repeated.matching !== 1 || !repeated.alias) throw new Error(`Repeat scan lost the image association: ${JSON.stringify(repeated)}`);
  const large = await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d'); context.fillStyle = '#bb75df'; context.fillRect(0, 0, 96, 96);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const original = new Blob([png, new Uint8Array(20_000_000)], { type: 'image/png' });
    await window.__localAgentLabImageRecorder(original, { model: 'Large fixture', provider: 'browser', prompt: 'A large violet image' });
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const asset = (await store.avatarLibrary()).find(item => item.prompt === 'A large violet image');
    const saved = asset ? await store.avatarAsset(asset.id) : null;
    return { id: asset?.id, path: asset?.path, bytes: saved?.size, originalBytes: original.size };
  })()`);
  if (!large.path?.startsWith('harness/images/originals/') || large.bytes !== large.originalBytes || large.bytes <= 20_000_000)
    throw new Error(`Oversized generated image was not preserved: ${JSON.stringify(large)}`);
  await evaluate('location.reload(); true');
  await waitFor("!![...document.querySelectorAll('.harness-avatar-tile strong')].find(node => node.textContent.includes('Large fixture'))", 'reopened oversized image');
  const largeTile = await evaluate(`(() => {
    const tile = [...document.querySelectorAll('.harness-avatar-tile')].find(item => item.textContent.includes('Large fixture'));
    return { placeholder: tile?.querySelector('.harness-avatar-preview-trigger')?.textContent, image: !!tile?.querySelector('.harness-avatar-preview-trigger img') };
  })()`);
  if (largeTile.placeholder !== 'Large image' || largeTile.image) throw new Error(`Oversized thumbnail should be deferred: ${JSON.stringify(largeTile)}`);
  const persistedLarge = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return (await store.avatarAsset('${large.id}'))?.size || 0;
  })()`);
  if (persistedLarge !== large.bytes) throw new Error(`Oversized original was not readable after reload: ${persistedLarge}`);
  await evaluate("[...document.querySelectorAll('.harness-avatar-tile')].find(item => item.textContent.includes('Large fixture')).querySelector('.harness-avatar-preview-trigger').click(); true");
  await waitFor("!!document.querySelector('.harness-avatar-preview-dialog[open] a[download$=\".png\"]')", 'oversized image download');
  console.log(`Generated image library passed: original PNG, preview, favorite, collection, older image link, and ${large.bytes} byte generated source after reload.`);
} finally { socket.close(); }
