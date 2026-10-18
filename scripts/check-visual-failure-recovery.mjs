/**
 * Start Chrome on the Vite app with --remote-debugging-port=9332 and a
 * disposable profile containing the downloaded Supra2 model and ONNX engine.
 * The test injects two inference errors after loading; it does not damage files.
 */
const port = process.env.CDP_PORT || '9332';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.includes('127.0.0.1:5173'));
if (!page) throw new Error('Open the Vite app in the Chrome profile before running this check.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let requestId = 0;
const pending = new Map();
socket.onmessage = event => {
  const reply = JSON.parse(event.data);
  const entry = pending.get(reply.id);
  if (!entry) return;
  pending.delete(reply.id);
  reply.error ? entry.reject(new Error(reply.error.message)) : entry.resolve(reply.result);
};
function call(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 180000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
try {
  await call('Runtime.enable');
  const results = await evaluate(`(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-agent-lab');
    const image = await import('/src/browserImage.ts');
    image.setBrowserImageFolder(root);
    const cases = [
      ['GPU device lost while running graph', 'GPU device', 'gpu-lost'],
      ['GPUOutOfMemoryError: allocation failed', 'out of memory', 'out-of-memory'],
    ];
    const results = [];
    for (const [injected, expected, name] of cases) {
      await image.loadBrowserImageModel('supra-mobile');
      const before = image.getBrowserImageStatus().state;
      const runtime = globalThis.ort;
      const original = runtime.InferenceSession.prototype.run;
      runtime.InferenceSession.prototype.run = function () { throw new Error(injected); };
      let message = '';
      try { await image.generateBrowserImage('A green leaf', undefined, undefined, undefined, 'supra-mobile'); }
      catch (error) { message = error.message; }
      finally { runtime.InferenceSession.prototype.run = original; }
      results.push({ name, before, after: image.getBrowserImageStatus().state, message,
        passed: before === 'ready' && image.getBrowserImageStatus().state === 'idle' && message.includes(expected) && message.includes('unloaded') });
    }
    return results;
  })()`);
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.message}`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally { socket.close(); }
