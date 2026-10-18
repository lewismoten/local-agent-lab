const site = new URL(process.argv[2] || 'https://lewismoten.github.io/local-agent-lab/');
if (!site.pathname.endsWith('/')) site.pathname += '/';
const root = site.href;

async function get(path, method = 'GET') {
  const response = await fetch(new URL(path, root), { method, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

const [html, worker, indexResponse, noticesResponse] = await Promise.all([
  get('index.html').then(response => response.text()),
  get('coi-serviceworker.js').then(response => response.text()),
  get('licenses/third-party-index.json'),
  get('licenses/third-party-notices.txt'),
]);
const base = site.pathname;
if (!html.includes(`href="${base}favicon.ico"`)) throw new Error(`Published index.html does not use ${base}.`);
const version = worker.match(/const BUILD_VERSION = \/\* BUILD_VERSION \*\/ '([a-f0-9]{16})';/)?.[1];
const list = worker.match(/const PRECACHE_FILES = \/\* PRECACHE_FILES \*\/ (\[[^\n]+\]);/)?.[1];
if (!version || !list) throw new Error('Published service worker has no production manifest.');
const paths = JSON.parse(list);
if (!Array.isArray(paths) || !paths.length || paths.length !== new Set(paths).size) throw new Error('Published precache is empty or duplicated.');
if (paths.some(path => /^(?:models|engines)\//i.test(path) || /\.(?:gguf|safetensors|cact|onnx|pt|pth)$/i.test(path))) throw new Error('Published precache includes optional model or engine weights.');
for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  if (!match[1].startsWith(base) || !paths.includes(match[1].slice(base.length))) throw new Error(`Published index.html references an uncached asset: ${match[1]}`);
}
const index = await indexResponse.json();
const notices = await noticesResponse.text();
if (index.version !== 1 || !Array.isArray(index.packages) || !index.packages.length) throw new Error('Published package notices are missing.');
for (const entry of index.packages) {
  if (!entry.name || !entry.version || !entry.license || !entry.notices?.length || entry.notices.some(notice => !notice.text?.trim()) || !notices.includes(`${entry.name}@${entry.version}`)) throw new Error(`Published notice is incomplete for ${entry.name || 'an unnamed package'}.`);
}
const failures = [];
let next = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (next < paths.length) {
    const path = paths[next++];
    try { await get(path, 'HEAD'); }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
}));
if (failures.length) throw new Error(`Published assets missing:\n${failures.join('\n')}`);
console.log(`Published Pages audit: ${root} build ${version}; ${paths.length} cached files reachable, ${index.packages.length} package notices complete, no optional weights bundled.`);
