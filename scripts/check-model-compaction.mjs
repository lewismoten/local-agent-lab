/** Optional live check: run Vite, a temporary Chrome CDP profile, and local Ollama first. */
const port = Number(process.env.CHROME_DEBUG_PORT || 9234);
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5198/';
const endpoint = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const model = process.env.OLLAMA_MODEL || 'llama3.2:1b';
const captureModelOutput = process.env.CAPTURE_MODEL_OUTPUT === '1';

const exchanges = [
  ['Create project Meridian. Private documents must stay on the removable drive; never upload them to a service.', 'Recorded the privacy rule for Meridian. I have not uploaded or modified any files.'],
  ['Use TypeScript and Vite for the interface. Keep model weights optional and separate from the published site.', 'The plan uses TypeScript and Vite. Model weights remain an optional workspace download, not part of the site bundle.'],
  ['Inspect src/parser.ts. Preserve escaped quotes and add Unicode escape tests.', 'I inspected src/parser.ts and fixed escaped quote handling with a small state machine. Unicode escape tests remain unfinished.'],
  ['Add PDF outline import, but ask before changing the importer.', 'PDF import is only a request so far. No importer code has changed.'],
  ['Prefer a compact chat layout on mobile; I use an iPhone XS Max.', 'I recorded the mobile width as a design constraint. Physical phone testing is still pending.'],
  ['Check the existing parser tests before changing more code.', 'I ran parser tests and all 12 existing cases passed. This does not cover Unicode escapes.'],
  ['Record the model and version used for every assistant reply.', 'The proposed response record includes provider, model name, version, and generation settings. Implementation is still pending.'],
  ['Keep an archive of original chat messages after compaction.', 'I saved all original messages in numbered chunks. Summary metadata does not replace the original archive.'],
  ['Can the workspace move between public library computers on a USB drive?', 'The design uses a selected folder. A second-computer USB test has not been performed yet.'],
  ['Use a model only after its license text is saved beside its weights.', 'The download workflow now saves license sidecars first. A complete upstream-license audit remains open.'],
  ['Search older conversation text without loading every message into the chat view.', 'I added per-chunk search bits and kept the rendered message window bounded.'],
  ['Do not make a Git commit automatically when a model edits a file.', 'Git commits require an explicit reviewed action. No commit was made in this exchange.'],
  ['Let an agent wait when I am chatting with a model.', 'A model lease now serializes chat and agent inference. Browser GGUF load contention still needs a live test.'],
  ['Add a human-readable journal, but leave it off by default.', 'The journal is implemented as opt-in and stores local facts with conversation references.'],
  ['I want a memory for project-specific choices.', 'Project memory records are available, but this request did not create a new memory entry.'],
  ['The dashboard should use a dark cyan and violet palette.', 'The visual theme uses dark panels with cyan and violet accents. Specialized dialogs still need inspection.'],
  ['Please evaluate encryption for the whole workspace.', 'Encryption is a requested future feature. There is no workspace encryption implementation yet.'],
  ['Check that a failed model summary cannot claim an unfinished test was completed.', 'The compaction guard checks some unsupported completed-work claims. It cannot prove every summary is correct.'],
  ['Plan a physical removable-drive test before changing the storage format.', 'A physical USB measurement remains pending; no SQLite migration has been chosen.'],
  ['Keep the privacy rule and unfinished Unicode tests visible in future context.', 'The next action is to verify both against original messages after compaction. Unicode escape tests remain pending.'],
];

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(appUrl));
if (!page) throw new Error(`No Chrome page at ${appUrl}; start Vite and Chrome with remote debugging first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
let showProgress = false;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (showProgress && message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value === 'COMPACT_PROGRESS') {
    console.log(message.params.args[1]?.value);
  }
  const resolve = pending.get(message.id);
  if (resolve) { pending.delete(message.id); resolve(message); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 300_000);
  pending.set(id, result => { clearTimeout(timer); if (result.error) reject(new Error(result.error.message)); else resolve(result.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
await call('Runtime.enable');
await call('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 900));
const expression = `(async () => {
  const { HarnessStore } = await import('/src/harnessStore.ts');
  const { createConversation } = await import('/src/harnessData.ts');
  const { compactConversation } = await import('/src/harnessContext.ts');
  const exchanges = ${JSON.stringify(exchanges)};
  const rawModelOutputs = [];
  const captures = [];
  const originalFetch = window.fetch.bind(window);
  if (${JSON.stringify(captureModelOutput)}) window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]).includes('/api/chat')) {
      captures.push(response.clone().text().then(raw => {
        const chunks = raw.trim().split('\\n').map(line => JSON.parse(line));
        rawModelOutputs.push({ text: chunks.map(chunk => chunk.message?.content || '').join('').slice(0, 1000), reason: chunks.at(-1)?.done_reason || '' });
      }).catch(() => { /* Preserve the original response for the app. */ }));
    }
    return response;
  };
  const workspaceId = 'check-' + crypto.randomUUID();
  const store = new HarnessStore(workspaceId, null);
  await store.manifest();
  let meta = createConversation('home');
  const original = [];
  const config = { id: 'ollama', label: 'Local Ollama', provider: 'ollama', model: ${JSON.stringify(model)}, endpoint: ${JSON.stringify(endpoint)}, apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 256, contextWindow: 1536 };
  const timings = [];
  for (const [phase, group] of [exchanges.slice(0, 12), exchanges.slice(12)].entries()) {
    const active = [];
    for (const [index, pair] of group.entries()) {
      for (const [turn, content] of pair.entries()) {
        const seq = original.length;
        const message = { id: crypto.randomUUID(), role: turn ? 'assistant' : 'user', createdAt: new Date(Date.UTC(2026, 0, 1) + seq * 86_400_000).toISOString(), content };
        meta = await store.appendMessage(meta, message);
        const stored = { ...message, seq };
        original.push(stored); active.push(stored);
      }
    }
    await store.updateSessions('home', current => [meta, ...current.filter(item => item.id !== meta.id)]);
    const started = performance.now();
    meta = await compactConversation(meta, active, config, undefined, message => console.log('COMPACT_PROGRESS', 'phase ' + (phase + 1) + ': ' + message));
    timings.push(Math.round(performance.now() - started));
    await store.updateSessions('home', current => [meta, ...current.filter(item => item.id !== meta.id)]);
  }
  const saved = await store.messages(meta, 0, meta.messageCount);
  await Promise.all(captures);
  window.fetch = originalFetch;
  const report = { timings, count: saved.length, originalsPreserved: saved.every((item, index) => item.content === original[index].content), activeFrom: meta.activeFrom, segments: meta.segments.map(item => ({ startSeq: item.startSeq, endSeq: item.endSeq, startAt: item.startAt, endAt: item.endAt, title: item.title, summary: item.summary })), contextSummary: meta.contextSummary, privacyRetained: meta.contextSummary.includes('never upload them to a service'), ...(rawModelOutputs.length ? { rawModelOutputs } : {}) };
  const database = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('local-agent-lab');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readwrite');
    const cursor = transaction.objectStore('records').openKeyCursor(IDBKeyRange.bound(workspaceId + ':', workspaceId + ':' + String.fromCharCode(65535)));
    cursor.onsuccess = () => { if (cursor.result) { transaction.objectStore('records').delete(cursor.result.primaryKey); cursor.result.continue(); } };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return report;
})()`;
try {
  showProgress = true;
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 300_000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  const report = result.result.value;
  console.log(JSON.stringify(report, null, 2));
  if (!report || report.count !== 40 || !report.originalsPreserved || report.activeFrom !== 40 || report.segments.length !== 2 || report.segments[0].startSeq !== 0 || report.segments[0].endSeq !== 23 || report.segments[1].startSeq !== 24 || report.segments[1].endSeq !== 39 || !report.privacyRetained || report.segments[0].summary.replace(/\W/g, '').toLowerCase() === report.segments[1].summary.replace(/\W/g, '').toLowerCase()) {
    throw new Error('Compaction lost original messages, boundaries, a durable privacy rule, or a distinct part summary.');
  }
} finally { socket.close(); }
