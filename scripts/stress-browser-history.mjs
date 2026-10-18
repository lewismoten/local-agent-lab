/** Run against a temporary Chrome profile opened on the Vite app with remote debugging.
 * Example: node scripts/stress-browser-history.mjs --port 9231 --mb 100
 */
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const port = argument('--port', 9231);
const megabytes = argument('--mb', 100);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(megabytes) || megabytes <= 0 || megabytes > 1024) {
  throw new Error('Use a valid --port and --mb between 0 and 1024.');
}

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && /^https?:\/\//.test(item.url));
if (!page) throw new Error('No app page is open in the debugging browser.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const progressToken = `HISTORY_STRESS_PROGRESS_${Date.now()}`;
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value === progressToken) {
    console.log('Progress:', ...message.params.args.slice(1).map(item => item.value ?? item.description));
  }
  const waiting = pending.get(message.id);
  if (waiting) { pending.delete(message.id); message.error ? waiting.reject(message.error) : waiting.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await call('Runtime.enable');
await call('Performance.enable');
const expression = `(async () => {
  const { HarnessStore } = await import('/src/harnessStore.ts');
  const { createConversation, MESSAGE_CHUNK_SIZE, chunkSearchBits } = await import('/src/harnessData.ts');
  const { compactConversation } = await import('/src/harnessContext.ts');
  const workspaceId = 'history-benchmark-' + Date.now();
  const store = new HarnessStore(workspaceId, null);
  const source = createConversation('home');
  const root = 'harness/projects/home/sessions/' + source.id;
  const target = ${Math.floor(megabytes * 1048576)};
  let bytes = 0, count = 0, group = [], newest = [];
  let maxGap = 0, lastTick = performance.now();
  const tick = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick - 50); lastTick = now; }, 50);
  const timings = {};
  const measure = async (label, action) => { const start = performance.now(); const value = await action(); timings[label] = Math.round(performance.now() - start); return value; };
  const makeContent = seq => {
    let state = Math.imul(seq + 1, 0x9e3779b1) | 1;
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
    const lines = [];
    for (let i = 0; i < 66; i++) {
      const symbol = next().toString(36), file = next().toString(36), revision = next().toString(36), value = next().toString(36);
      lines.push('const item_' + symbol + ' = await workspace.read("src/' + file + '.ts", { revision: "' + revision + '" }); // ' + value);
    }
    return (seq === 12 ? 'ancient_unique_marker\\n' : '') + lines.join('\\n') + '\\nMessage ' + seq + '.';
  };
  const storageBefore = await navigator.storage.estimate();
  try {
    await measure('createMs', async () => {
      while (bytes < target) {
        const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, offset) => {
          const seq = count + offset;
          return { id: 'm-' + seq, seq, role: seq % 2 ? 'assistant' : 'user', createdAt: new Date(Date.UTC(2025, 0, 1) + Math.floor(seq / 100) * 86400000).toISOString(), content: makeContent(seq) };
        });
        const number = count / MESSAGE_CHUNK_SIZE;
        await store.write(root + '/chunks/' + String(number).padStart(6, '0') + '.json', chunk);
        group.push(chunkSearchBits(chunk));
        if (group.length === 64) { await store.write(root + '/search/' + String(Math.floor(number / 64)).padStart(6, '0') + '.json', { version: 1, chunks: group }); group = []; }
        bytes += new Blob([JSON.stringify(chunk)]).size;
        count += chunk.length;
        newest = chunk;
        if (number % 100 === 0) console.log('${progressToken}', count, Math.round(bytes / 1048576) + ' MiB');
      }
      if (group.length) await store.write(root + '/search/' + String(Math.floor((count / MESSAGE_CHUNK_SIZE - 1) / 64)).padStart(6, '0') + '.json', { version: 1, chunks: group });
    });
    const meta = { ...source, messageCount: count, activeFrom: count - MESSAGE_CHUNK_SIZE };
    await store.updateSessions('home', current => [meta, ...current]);
    const hits = await measure('searchMs', () => store.searchMessages(meta, 'ancient_unique_marker', 8));
    const recent = await measure('recentMs', () => store.recentMessages(meta, 40));
    const oldest = await measure('oldestMs', () => store.messages(meta, 0, 40));
    const compacted = await measure('compactMs', () => compactConversation(meta, newest, null));
    const copy = await measure('copyMs', () => store.copyConversation(meta, 'home'));
    const copiedHit = await measure('copiedSearchMs', () => store.searchMessages(copy, 'ancient_unique_marker', 1));
    const copiedLast = await store.recentMessages(copy, 1);
    const storageAfter = await navigator.storage.estimate();
    if (hits.length !== 1 || hits[0].seq !== 12 || copiedHit.length !== 1 || copiedHit[0].seq !== 12 || recent.length !== 40 || oldest.length !== 40 || compacted.segments.length !== 1 || copy.messageCount !== count || copiedLast[0].content !== newest.at(-1).content) throw new Error('History verification failed.');
    return { timings, logicalBytes: bytes, messages: count, chunks: Math.ceil(count / MESSAGE_CHUNK_SIZE), maxMainThreadGapMs: Math.round(maxGap), browserStorageDeltaBytes: (storageAfter.usage || 0) - (storageBefore.usage || 0), quotaBytes: storageAfter.quota };
  } finally { clearInterval(tick); }
})()`;

try {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value, null, 2));
} finally { socket.close(); }
