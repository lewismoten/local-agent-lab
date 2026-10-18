// The production build fills these two values with the published app files.
// The development copy still provides isolation for optional memory64 engines.
const BUILD_VERSION = /* BUILD_VERSION */ 'dev';
const PRECACHE_FILES = /* PRECACHE_FILES */ [];
const CACHE_PREFIX = 'local-agent-lab-shell-';
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const scope = self.registration.scope;
const shellUrl = new URL('index.html', scope).href;
const assetUrls = new Set(PRECACHE_FILES.map(path => new URL(path, scope).href));

function withIsolation(response) {
  if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.status === 304) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', event => event.waitUntil((async () => {
  if (PRECACHE_FILES.length) {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...assetUrls]);
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  if (PRECACHE_FILES.length) {
    const names = await caches.keys();
    // A tab running the previous build may still lazy-load one of its chunks.
    // Keep that shell until the next deployment instead of breaking the tab.
    const older = names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    const previous = older.at(-1);
    await Promise.all(older.filter(name => name !== previous).map(name => caches.delete(name)));
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  event.respondWith((async () => {
    if (request.mode === 'navigate') {
      try { return withIsolation(await fetch(request)); }
      catch (error) {
        if (assetUrls.has(url.href)) {
          const requested = await (await caches.open(CACHE_NAME)).match(url.href);
          if (requested) return withIsolation(requested);
        }
        const cached = await (await caches.open(CACHE_NAME)).match(shellUrl);
        if (cached) return withIsolation(cached);
        throw error;
      }
    }
    if (assetUrls.has(url.href)) {
      const cached = await (await caches.open(CACHE_NAME)).match(url.href);
      if (cached) return withIsolation(cached);
    }
    // The current shell lists only current build assets. An open older tab can
    // request its hashed chunks after activation, including while offline.
    const names = await caches.keys();
    for (const name of names.reverse()) {
      if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue;
      const cached = await (await caches.open(name)).match(url.href);
      if (cached) return withIsolation(cached);
    }
    return withIsolation(await fetch(request));
  })());
});
