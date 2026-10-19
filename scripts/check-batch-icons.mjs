/** Run Vite on 5173 and a fresh Chrome profile on CDP port 9267 at /#/images. */
import { createServer } from 'node:http';

const base = process.env.APP_URL || 'http://127.0.0.1:5173/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9267);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  (item) => item.type === 'page' && item.url.startsWith(base),
);
if (!page) throw new Error(`No Chrome page at ${base}.`);
let iconBase64 = '';
let requests = 0;
const prompts = [];
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  prompts.push(JSON.parse(body).prompt);
  requests++;
  if (requests === 2) await new Promise((resolve) => setTimeout(resolve, 2500));
  if (!response.destroyed) response.end(JSON.stringify({ data: [{ b64_json: iconBase64 }] }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const imagePort = server.address().port;
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    message.error ? waiter.reject(message.error) : waiter.resolve(message.result);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out.`));
    }, 30_000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Browser evaluation failed.',
    );
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await call('Runtime.enable');
  await waitFor("!!document.querySelector('.harness-avatar-library')", 'Images page');
  await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const settings = await store.settings();
    await store.saveSettings({ ...settings, imageConfig: { preset: 'tiny-sd', provider: 'compatible', endpoint: 'http://127.0.0.1:${imagePort}/v1', model: 'batch-icon-mock', apiKey: '' } });
    return true;
  })()`);
  await evaluate('location.reload(); true');
  await waitFor(
    "!![...document.querySelectorAll('button')].find(button => button.textContent.includes('Batch icons'))",
    'batch icon button',
  );
  iconBase64 = await evaluate(
    "(() => { const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64; const context=canvas.getContext('2d'); context.fillStyle='#69d5c9'; context.fillRect(0,0,64,64); return canvas.toDataURL('image/png').split(',')[1]; })()",
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(button => button.textContent.includes('Batch icons')).click(); true",
  );
  await waitFor("!!document.querySelector('.harness-icon-studio')", 'icon studio');
  const count = await evaluate(
    "(() => { const boxes=[...document.querySelectorAll('.harness-icon-studio-kinds input')]; boxes[0].click(); boxes[2].click(); return document.querySelector('.harness-icon-studio [role=status]')?.textContent; })()",
  );
  if (!count?.includes('3 icons selected')) throw new Error(`Expected three default identities: ${count}`);
  await evaluate("document.querySelector('.harness-icon-studio-actions .harness-primary').click(); true");
  await waitFor(
    "document.querySelector('.harness-icon-studio-progress progress')?.value === 1",
    'first saved identity icon',
  );
  await evaluate("document.querySelector('.harness-icon-studio-actions .harness-danger').click(); true");
  await waitFor(
    "[...document.querySelectorAll('.harness-icon-studio [role=status]')].some(item => item.textContent.includes('Stopped after 1'))",
    'stopped batch',
  );
  const stopped = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    return (await store.manifest()).identities.filter(item => item.avatarAssetId).length;
  })()`);
  if (stopped !== 1) throw new Error(`Stop did not preserve exactly one completed icon: ${stopped}`);
  const remaining = await evaluate(
    "document.querySelector('.harness-icon-studio [role=status]')?.textContent",
  );
  if (!remaining.includes('2 icons selected'))
    throw new Error(`Missing-icon scope did not resume at the remaining identities: ${remaining}`);
  await evaluate("document.querySelector('.harness-icon-studio-actions .harness-primary').click(); true");
  await waitFor(
    "[...document.querySelectorAll('.harness-icon-studio [role=status]')].some(item => item.textContent.includes('Saved 2 icons'))",
    'remaining icons',
  );
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-avatar-library')", 'reopened Images page');
  const saved = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const identities = (await store.manifest()).identities;
    return Promise.all(identities.map(async item => ({ id: item.id, assetId: item.avatarAssetId, bytes: (await store.identityAvatar(item.id))?.size || 0 })));
  })()`);
  if (saved.length !== 3 || saved.some((item) => !item.assetId || !item.bytes))
    throw new Error(`Batch icons did not survive reload: ${JSON.stringify(saved)}`);
  await evaluate(
    "[...document.querySelectorAll('button')].find(button => button.textContent.includes('Batch icons')).click(); true",
  );
  await waitFor("!!document.querySelector('.harness-icon-studio')", 'reopened studio');
  const achievementCount = await evaluate(`(async () => {
    const boxes=[...document.querySelectorAll('.harness-icon-studio-kinds input')]; boxes[0].click(); boxes[1].click();
    const { ACHIEVEMENTS } = await import('/src/harnessAchievements.ts');
    const label=document.querySelector('.harness-icon-studio [role=status]')?.textContent || '';
    return { expected: ACHIEVEMENTS.length, selected: Number(/^\\d+/.exec(label)?.[0] || -1) };
  })()`);
  if (achievementCount.selected !== achievementCount.expected)
    throw new Error(`Hidden achievements were omitted: ${JSON.stringify(achievementCount)}`);
  await evaluate("document.querySelector('.harness-icon-studio-actions .harness-primary').click(); true");
  await waitFor(
    `[...document.querySelectorAll('.harness-icon-studio [role=status]')].some(item => item.textContent.includes('Saved ${achievementCount.expected} icons'))`,
    'achievement icons',
  );
  const modelCount = await evaluate(`(async () => {
    const boxes=[...document.querySelectorAll('.harness-icon-studio-kinds input')]; boxes[1].click(); boxes[0].click();
    const label=document.querySelector('.harness-icon-studio [role=status]')?.textContent || '';
    return Number(/^\\d+/.exec(label)?.[0] || -1);
  })()`);
  if (modelCount < 10) throw new Error(`Too few model families were selected: ${modelCount}`);
  await evaluate("document.querySelector('.harness-icon-studio-actions .harness-primary').click(); true");
  await waitFor(
    `[...document.querySelectorAll('.harness-icon-studio [role=status]')].some(item => item.textContent.includes('Saved ${modelCount} icons'))`,
    'model family icons',
  );
  await evaluate('location.reload(); true');
  await waitFor("!!document.querySelector('.harness-avatar-library')", 'final Images reload');
  const final = await evaluate(`(async () => {
    const { store } = await (await import('/src/harnessStore.ts')).openBrowserWorkspace();
    const { ACHIEVEMENTS } = await import('/src/harnessAchievements.ts');
    const keys=Object.keys((await store.surfaceArtwork()).items);
    return { achievements: ACHIEVEMENTS.filter(item => keys.includes('achievement:' + item.id)).length,
      models: keys.filter(key => key.startsWith('model-family:')).length };
  })()`);
  if (final.achievements !== achievementCount.expected || final.models !== modelCount)
    throw new Error(`Batch icon targets did not survive reload: ${JSON.stringify(final)}`);
  if (
    prompts.some(
      (prompt) =>
        !prompt.includes('No words, letters, numbers, or logos.') ||
        !prompt.includes('Style: Dark background'),
    )
  )
    throw new Error('A batch request omitted the editable global prompt or style.');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    screenWidth: 390,
    screenHeight: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate(
    "[...document.querySelectorAll('button')].find(button => button.textContent.includes('Batch icons')).click(); true",
  );
  await waitFor("!!document.querySelector('.harness-icon-studio')", 'mobile icon studio');
  const fit = await evaluate(
    "(() => { const box=document.querySelector('.harness-icon-studio').getBoundingClientRect(); return { viewport:innerWidth, page:document.documentElement.scrollWidth, left:box.left, right:box.right }; })()",
  );
  if (fit.page > fit.viewport + 2 || fit.left < -1 || fit.right > fit.viewport + 1)
    throw new Error(`Mobile icon studio overflow: ${JSON.stringify(fit)}`);
  console.log(
    `Batch icons passed: stop/resume, ${saved.length} identities, ${final.achievements} achievements including hidden, ${final.models} model families, reload, and 390px fit.`,
  );
} finally {
  socket.close();
  server.close();
}
