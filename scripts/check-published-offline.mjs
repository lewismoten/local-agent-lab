/** Read-only smoke check. Start a fresh Chrome profile on --remote-debugging-port=9240 at the published site first. */
const port = Number(process.env.CHROME_DEBUG_PORT || 9240);
const origin = process.env.PAGES_URL || 'https://lewismoten.github.io/local-agent-lab/';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(origin));
if (!page) throw new Error(`Open ${origin} in a fresh Chrome profile with remote debugging on port ${port}.`);
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
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || 'Browser evaluation failed.');
  return value.result.value;
};
const waitFor = async (expression, label) => {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

await call('Page.enable');
await call('Network.enable');
try {
  const online = await waitFor(`(async()=>{
    if (!navigator.serviceWorker?.controller || !document.querySelector('.harness')) return null;
    const names = await caches.keys();
    const shell = names.find(name => name.startsWith('local-agent-lab-shell-'));
    return shell ? { worker: navigator.serviceWorker.controller.scriptURL, shell, count: (await (await caches.open(shell)).keys()).length } : null;
  })()`, 'service-worker control and shell cache');
  if (online.count < 50) throw new Error(`Shell cache contains only ${online.count} entries.`);
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call('Page.reload');
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('.harness') && !!navigator.serviceWorker.controller`, 'offline reload');
  const routes = [['models', 'Models & engines'], ['files', 'Files & tools'], ['journal', 'Journal'], ['identities', 'Identities']];
  for (const [route, heading] of routes) {
    await evaluate(`location.hash = ${JSON.stringify(`/${route}`)}; true`);
    await waitFor(`document.querySelector('h1')?.textContent?.includes(${JSON.stringify(heading)})`, `offline ${heading}`);
  }
  const result = await evaluate(`({ offline: !navigator.onLine, controller: navigator.serviceWorker.controller?.scriptURL, heading: document.querySelector('h1')?.textContent })`);
  if (!result.offline || result.controller !== online.worker) throw new Error(`Offline state or service-worker control was lost: ${JSON.stringify(result)}`);
  console.log(`Published offline smoke passed: ${online.count} cached files, controlled reload, ${routes.length} lazy screens opened without network.`);
} finally {
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  socket.close();
}
