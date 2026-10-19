/** Browser check. Run Vite on 5198 and a fresh Chrome profile on CDP port 9246. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9246);
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
  await evaluate("location.hash = '/achievements'; location.reload(); true");
  await waitFor("!!document.querySelector('.harness-achievements-page h1')", 'achievements page');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { createConversation } = await import('/src/harnessData.ts');
    const meta = createConversation('home');
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    const first = await store.appendConversationMessage(meta, { id: crypto.randomUUID(), role: 'user', content: 'Test achievements.', createdAt: new Date().toISOString() });
    await store.appendConversationMessage(first.meta, { id: crypto.randomUUID(), role: 'assistant', content: 'Ready.', createdAt: new Date().toISOString(), model: { profileId: 'test', provider: 'browser', model: 'test-model', thinking: 'none', contextWindow: 4096, maxOutputTokens: 128 }, inputTokens: 1100, outputTokens: 80 });
    return true;
  })()`);
  await evaluate('location.reload(); true');
  await waitFor(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const record = await store.achievementLedger(); return !!record.unlockedAt['first-conversation'] && !!record.unlockedAt['first-message'] && !!record.unlockedAt['first-answer'] && !!record.unlockedAt['input-1k'] && record.counts.models >= 1 && record.modelsSeen?.includes('browser:test-model'); })()`, 'earned milestones');
  await waitFor("typeof globalThis.__localAgentLabImageRecorder === 'function'", 'active workspace image recorder');
  const imagesBefore = await evaluate("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return (await store.achievementLedger()).counts.generatedArtwork; })()");
  await evaluate(`(async () => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => String(args[0]).includes('achievement-image.invalid')
      ? new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : originalFetch(...args);
    try {
      const { generateImage } = await import('/src/imageGeneration.ts');
      await generateImage({ preset: 'tiny-sd', provider: 'compatible', endpoint: 'https://achievement-image.invalid/v1', model: 'test-image', apiKey: '' }, 'A leaf');
    } finally { window.fetch = originalFetch; }
    return true;
  })()`);
  await waitFor(`(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); const record = await store.achievementLedger(); return !!record.unlockedAt['first-image'] && record.counts.generatedArtwork > ${imagesBefore}; })()`, 'generated image milestone');
  await waitFor("document.querySelector('.harness-achievements-summary strong')?.textContent?.includes('/ 23')", 'achievement cards');
  await evaluate("[...document.querySelectorAll('.harness-achievement-card')].find(card => card.textContent.includes('First contact')).querySelector('button.harness-achievement-symbol').click(); true");
  await waitFor("document.querySelector('.harness-surface-artwork-dialog')?.open", 'achievement icon editor');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#f8bf81'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'achievement.png', { type: 'image/png' }));
    const input = document.querySelector('.harness-surface-artwork-dialog input[type=file]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("(async () => { const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace(); return !!(await store.surfaceArtwork()).items['achievement:first-conversation']?.assetId; })()", 'saved achievement icon');
  await evaluate("document.querySelector('.harness-surface-artwork-dialog .harness-dialog-actions button').click(); location.reload(); true");
  await waitFor("!![...document.querySelectorAll('.harness-achievement-card')].find(card => card.textContent.includes('First contact'))?.querySelector('.harness-achievement-symbol img')", 'card image after reload');
  const badge = await evaluate("(() => { const card = [...document.querySelectorAll('.harness-achievement-card')].find(item => item.textContent.includes('First contact')); return { image: !!card.querySelector('.harness-achievement-symbol img'), emoji: card.querySelector('.harness-achievement-symbol')?.textContent?.trim() || '', duplicate: !!card.querySelector('.harness-surface-artwork-button') }; })()");
  if (!badge.image || badge.emoji || badge.duplicate) throw new Error(`Achievement image did not replace its emoji: ${JSON.stringify(badge)}`);
  await call('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 1, mobile: true });
  const fit = await evaluate("({ body: document.documentElement.scrollWidth, viewport: innerWidth, cards: document.querySelectorAll('.harness-achievement-card').length })");
  if (fit.body > fit.viewport + 2 || fit.cards !== 23) throw new Error(`Mobile achievements layout failed: ${JSON.stringify(fit)}`);
  console.log('Achievements passed: automatic chat and image milestones, persisted ledger, icon upload, reload, and mobile layout.');
} finally { socket.close(); }
