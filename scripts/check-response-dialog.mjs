/** Optional UI check. Run Vite on 5198 and an empty temporary Chrome profile on CDP port 9239. */
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:5198/';
const port = Number(process.env.CHROME_DEBUG_PORT || 9239);
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
await waitFor("document.querySelector('.harness-chat-header') !== null", 'chat');
let fixture;
try {
  fixture = await evaluate(`(async () => {
    const { HarnessStore } = await import('/src/harnessStore.ts');
    const { createConversation } = await import('/src/harnessData.ts');
    const store = new HarnessStore('browser-home', null);
    if ((await store.sessions('home')).length) throw new Error('Use an empty temporary Chrome profile for this smoke check.');
    const meta = createConversation('home');
    meta.title = 'Response Inspector smoke';
    await store.updateSessions('home', sessions => [meta, ...sessions]);
    const messageId = crypto.randomUUID();
    const model = { profileId: 'browser', provider: 'browser', model: 'test-small.gguf', thinking: 'light', contextWindow: 4096, maxOutputTokens: 512 };
    const report = {
      version: 2, createdAt: new Date().toISOString(), model,
      input: { system: 'Inspect project files before changing them. '.repeat(35), turns: [{ role: 'user', content: 'Find the parser issue and explain the fix.' }], note: 'Initial submitted prompt.' },
      output: { text: '**Fixed** the parser condition.\\n\\n\u0060\u0060\u0060ts\\nif (escaped) return token;\\n\u0060\u0060\u0060', thinking: 'I checked the escaped quote branch.', toolEvents: ['read_file: src/parser.ts returned 120 lines'] },
      rounds: [{ request: { model: 'test-small.gguf', messages: [{ role: 'user', content: 'Find the parser issue.' }], max_tokens: 512, temperature: 0.4, seed: 42 }, response: { text: 'Fixed the parser condition.', thinking: 'I checked the escaped quote branch.', finishReason: 'stop', inputTokens: 300, cachedInputTokens: 180, outputTokens: 70 }, toolResults: [{ name: 'read_file', content: 'src/parser.ts: escaped quote branch' }] }],
      usage: { inputTokens: 300, cachedInputTokens: 180, outputTokens: 70, elapsedMs: 4000, observedTokensPerSecond: 17.5 }, sampling: { seed: 42, temperature: 0.4, note: 'Submitted in every model round.' },
    };
    await store.saveResponseDiagnostic('home', meta.id, messageId, report);
    await store.appendConversationMessage(meta, { id: messageId, role: 'assistant', content: 'Fixed the parser condition.', createdAt: new Date().toISOString(), model, hasDiagnostics: true });
    return { sessionId: meta.id, messageId };
  })()`);
  await evaluate(`location.hash = '/chat/${fixture.sessionId}'; location.reload(); true`);
  await waitFor("document.querySelector('.harness-message-inspect') !== null", 'Inspect button');
  await evaluate("document.querySelector('.harness-message-inspect').click(); true");
  const visible = await waitFor(`(() => {
    const dialog = document.querySelector('dialog.harness-response-dialog');
    return dialog?.open && dialog.querySelector('.harness-response-report-stats') && dialog.querySelector('.harness-response-round') ? {
      width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, stats: dialog.querySelector('.harness-response-report-stats').textContent,
      rounds: dialog.querySelectorAll('.harness-response-round').length,
      ordered: (() => { const report = dialog.querySelector('.harness-response-report'); const head = report.querySelector('.harness-response-report-head').getBoundingClientRect(); const stats = report.querySelector('.harness-response-report-stats').getBoundingClientRect(); const model = report.querySelector('section').getBoundingClientRect(); return head.bottom <= stats.top + 2 && stats.bottom <= model.top + 40; })(),
      downloadEnabled: ![...dialog.querySelectorAll('button')].find(item => item.textContent.includes('Download JSON')).disabled,
    } : false;
  })()`, 'saved diagnostic');
  if (visible.scrollWidth > visible.width + 2) throw new Error(`Diagnostic dialog overflows horizontally: ${visible.scrollWidth} > ${visible.width}.`);
  if (!visible.ordered) throw new Error('Diagnostic header, metrics, and sections are out of order.');
  if (!visible.stats.includes('17.5 tok/s') || !visible.stats.includes('0.4') || !visible.stats.includes('Cached 180') || visible.rounds !== 1 || !visible.downloadEnabled) throw new Error(`Diagnostic is incomplete: ${JSON.stringify(visible)}`);
  if (process.env.SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 350));
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  const downloadDir = await mkdtemp(join(tmpdir(), 'agent-response-'));
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await evaluate("[...document.querySelector('dialog.harness-response-dialog').querySelectorAll('button')].find(item => item.textContent.includes('Download JSON')).click(); true");
  let downloaded = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const names = await readdir(downloadDir);
    if (names.includes(`response-${fixture.messageId}.json`)) {
      const saved = JSON.parse(await readFile(join(downloadDir, `response-${fixture.messageId}.json`), 'utf8'));
      if (saved.sampling.temperature !== 0.4 || saved.rounds[0].request.seed !== 42 || saved.usage.cachedInputTokens !== 180) throw new Error('The downloaded trace lost sampling or prompt cache settings.');
      downloaded = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!downloaded) throw new Error('Download JSON did not save the response trace.');
  console.log(`Response dialog passed at ${process.env.MOBILE === '1' ? '414×896' : 'desktop'}: visible trace, no horizontal overflow, JSON download.`);
} finally {
  if (fixture) await evaluate(`(async () => {
    const { HarnessStore } = await import('/src/harnessStore.ts');
    const store = new HarnessStore('browser-home', null);
    const session = (await store.sessions('home')).find(item => item.id === ${JSON.stringify(fixture.sessionId)});
    if (session) await store.deleteConversation(session);
    return true;
  })()`);
  socket.close();
}
