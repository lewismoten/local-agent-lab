import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('an updated offline shell keeps the previous build available to open tabs', async () => {
  const scope = 'https://example.test/lab/';
  const stored = new Map();
  const cache = name => {
    if (!stored.has(name)) stored.set(name, new Map());
    return stored.get(name);
  };
  const put = (name, path, body) => cache(name).set(new URL(path, scope).href, new Response(body));
  put('local-agent-lab-shell-older', 'assets/oldest.js', 'oldest chunk');
  put('local-agent-lab-shell-previous', 'assets/previous.js', 'previous chunk');
  put('local-agent-lab-shell-current', 'index.html', 'current shell');
  put('local-agent-lab-shell-current', 'assets/current.js', 'current chunk');
  const caches = {
    keys: async () => [...stored.keys()],
    delete: async name => stored.delete(name),
    open: async name => ({
      match: async url => cache(name).get(url)?.clone(),
      addAll: async () => {},
    }),
  };
  const listeners = new Map();
  const self = {
    registration: { scope }, location: { origin: new URL(scope).origin },
    clients: { claim: async () => {} }, skipWaiting: async () => {},
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const source = (await readFile(new URL('../public/coi-serviceworker.js', import.meta.url), 'utf8'))
    .replace("/* BUILD_VERSION */ 'dev'", "/* BUILD_VERSION */ 'current'")
    .replace('/* PRECACHE_FILES */ []', '/* PRECACHE_FILES */ ["index.html","assets/current.js"]');
  runInNewContext(source, { self, caches, URL, Headers, Response, fetch: async () => { throw new Error('offline'); } });

  let activation;
  listeners.get('activate')({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(await caches.keys(), ['local-agent-lab-shell-previous', 'local-agent-lab-shell-current']);

  const request = async (path, mode = 'same-origin') => {
    let response;
    listeners.get('fetch')({ request: { method: 'GET', mode, url: new URL(path, scope).href }, respondWith: promise => { response = promise; } });
    return response;
  };
  assert.equal(await (await request('assets/previous.js')).text(), 'previous chunk');
  assert.equal(await (await request('index.html', 'navigate')).text(), 'current shell');
  assert.equal((await request('assets/previous.js')).headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});
