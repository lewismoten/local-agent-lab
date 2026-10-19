/** Optional browser check. Run Vite on 5198 and disposable Chrome on CDP port 9257. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9257);
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
  const next = ++id; pending.set(next, { resolve, reject });
  socket.send(JSON.stringify({ id: next, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await evaluate(expression); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-identity-card')", 'identities');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { identityAvatarPath } = await import('/src/harnessData.ts');
    const image = async color => {
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 24, 24);
      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    };
    const green = await image('#00ad7a'), blue = await image('#2864bf');
    const one = await store.saveAvatarAsset(green, { title: 'Ada original', tags: [], source: 'uploaded' });
    await store.saveAvatarAsset(blue, { title: 'Lumen A', tags: [], source: 'uploaded' });
    const last = await store.saveAvatarAsset(blue, { title: 'Lumen B', tags: [], source: 'uploaded' });
    await store.saveIdentityAvatar('ada', green); await store.saveIdentityAvatar('lumen', blue);
    await store.updateManifest(current => ({ ...current, identities: current.identities.map(identity =>
      identity.id === 'ada' || identity.id === 'lumen' ? { ...identity, avatarPath: identityAvatarPath(identity.id), avatarAssetId: undefined } : identity) }));
    sessionStorage.setItem('legacyExpected', JSON.stringify({ ada: one.id, lumen: last.id }));
    location.hash = '/images'; location.reload(); return true;
  })()`);
  const linked = await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const identities = (await store.manifest()).identities;
    return identities.find(item => item.id === 'ada')?.avatarAssetId === JSON.parse(sessionStorage.getItem('legacyExpected')).ada
      && !identities.find(item => item.id === 'lumen')?.avatarAssetId;
  })()`, 'unique avatar link');
  if (!linked) throw new Error('Unique legacy image was not linked.');
  await waitFor("document.querySelector('.harness-image-legacy summary')?.textContent.includes('1 linked') && document.querySelector('.harness-image-legacy summary')?.textContent.includes('1 to review')", 'ambiguous review');
  await evaluate("[...document.querySelectorAll('.harness-image-legacy button')].find(button => button.textContent.startsWith('Lumen B')).click(); true");
  await waitFor(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return (await store.manifest()).identities.find(item => item.id === 'lumen')?.avatarAssetId === JSON.parse(sessionStorage.getItem('legacyExpected')).lumen;
  })()`, 'reviewed avatar link');
  await waitFor("[...document.querySelectorAll('select[aria-label=\"Image use\"] option')].some(option => option.value === 'Avatars')", 'avatar use filter');
  await evaluate(`(async () => {
    const { openFolderWorkspace } = await import('/src/harnessStore.ts');
    const { identityAvatarPath } = await import('/src/harnessData.ts');
    const root = await navigator.storage.getDirectory();
    const name = 'legacy-avatar-folder-' + crypto.randomUUID();
    const folder = await root.getDirectoryHandle(name, { create: true });
    const { store, manifest } = await openFolderWorkspace(folder);
    await store.saveManifest(manifest);
    const canvas = document.createElement('canvas'); canvas.width = 18; canvas.height = 18;
    const context = canvas.getContext('2d'); context.fillStyle = '#9276c6'; context.fillRect(0, 0, 18, 18);
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const asset = await store.saveAvatarAsset(image, { title: 'Folder original', tags: [], source: 'uploaded' });
    await store.saveIdentityAvatar('ada', image);
    await store.updateManifest(current => ({ ...current, identities: current.identities.map(identity => identity.id === 'ada'
      ? { ...identity, avatarPath: identityAvatarPath('ada'), avatarAssetId: undefined } : identity) }));
    sessionStorage.setItem('legacyFolder', JSON.stringify({ name, assetId: asset.id }));
    location.reload(); return true;
  })()`);
  await waitFor("!!document.querySelector('.harness-avatar-library')", 'workspace after reload');
  const folderResult = await evaluate(`(async () => {
    const { name, assetId } = JSON.parse(sessionStorage.getItem('legacyFolder'));
    const { openFolderWorkspace } = await import('/src/harnessStore.ts');
    const { scanLegacyAvatarLinks } = await import('/src/harnessLegacyAvatarLinks.ts');
    const { imageUseIndex } = await import('/src/harnessImageUse.ts');
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(name);
    const first = await openFolderWorkspace(folder);
    const scan = await scanLegacyAvatarLinks(first.store, await first.store.avatarLibrary(), first.manifest.identities);
    if (scan.unique.length !== 1 || scan.unique[0].assetIds[0] !== assetId) return false;
    await first.store.updateManifest(current => ({ ...current, identities: current.identities.map(identity => identity.id === 'ada'
      ? { ...identity, avatarAssetId: assetId } : identity) }));
    const reopened = await openFolderWorkspace(folder);
    const uses = await imageUseIndex(reopened.store, await reopened.store.avatarLibrary());
    const linked = reopened.manifest.identities.find(identity => identity.id === 'ada')?.avatarAssetId === assetId;
    await root.removeEntry(name, { recursive: true });
    return linked && uses.get(assetId)?.has('Avatars');
  })()`);
  if (!folderResult) throw new Error('Folder-backed avatar link did not survive reopening.');
  console.log('Legacy avatar links passed: unique match, duplicate review, and folder-backed reopen.');
} finally { socket.close(); }
