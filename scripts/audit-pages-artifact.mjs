import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const fail = message => { throw new Error(`Pages artifact audit: ${message}`); };

async function filesUnder(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join('/'));
  }
  return found;
}

const files = (await filesUnder(root)).sort();
const fileSet = new Set(files);
for (const required of ['index.html', 'favicon.ico', 'coi-serviceworker.js', 'licenses/third-party-index.json', 'licenses/third-party-notices.txt']) {
  if (!fileSet.has(required)) fail(`${required} is missing.`);
}
const prohibited = files.filter(path => /^(?:models|engines)\//i.test(path) || /\.(?:gguf|safetensors|cact|onnx|pt|pth)$/i.test(path));
if (prohibited.length) fail(`optional models or engines were bundled: ${prohibited.slice(0, 10).join(', ')}`);

const html = await readFile(join(root, 'index.html'), 'utf8');
const base = process.env.GITHUB_PAGES === 'true' ? '/local-agent-lab/' : '/';
if (!html.includes(`href="${base}favicon.ico"`)) fail(`index.html does not use the expected ${base} base path.`);
const linked = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)].map(match => match[1]);
for (const url of linked) {
  if (!url.startsWith(base)) fail(`index.html has a URL outside the ${base} base path: ${url}`);
  const path = url.slice(base.length);
  if (!fileSet.has(path)) fail(`index.html references a missing asset: ${path}`);
}

const worker = await readFile(join(root, 'coi-serviceworker.js'), 'utf8');
if (!/const BUILD_VERSION = \/\* BUILD_VERSION \*\/ '[a-f0-9]{16}';/.test(worker)) fail('the offline worker has no production build version.');
const manifest = worker.match(/const PRECACHE_FILES = \/\* PRECACHE_FILES \*\/ (\[[^\n]+\]);/);
if (!manifest) fail('the offline worker has no precache list.');
const precache = JSON.parse(manifest[1]);
if (!Array.isArray(precache) || precache.length !== new Set(precache).size) fail('the precache list is missing or duplicated.');
const expected = files.filter(path => path !== 'coi-serviceworker.js');
if (precache.length !== expected.length || precache.some((path, index) => path !== expected[index])) fail('the precache list does not match the artifact files.');

const index = JSON.parse(await readFile(join(root, 'licenses/third-party-index.json'), 'utf8'));
if (index.version !== 3 || !Array.isArray(index.packages) || !index.packages.length || !Array.isArray(index.development)) fail('the third-party notice index is empty or invalid.');
if (index.development.some(entry => !entry.purpose || entry.purpose.length < 30 || entry.purpose.length > 60)) fail('a build-tool purpose is missing.');
const noticeText = await readFile(join(root, 'licenses/third-party-notices.txt'), 'utf8');
for (const entry of index.packages) {
  if (!entry.name || !entry.version || !entry.license || !entry.purpose || entry.purpose.length < 30 || entry.purpose.length > 60 || !entry.notices?.length || entry.notices.some(notice => !notice.text?.trim())) fail(`license text or purpose is missing for ${entry.name || 'an unnamed package'}.`);
  if (!['direct', 'transitive'].includes(entry.relationship) || !entry.requiredBy?.length) fail(`dependency path is missing for ${entry.name || 'an unnamed package'}.`);
  if (!noticeText.includes(`${entry.name}@${entry.version}`)) fail(`the raw notice file omits ${entry.name}@${entry.version}.`);
}

console.log(`Pages artifact audit: ${files.length} files, ${precache.length} precached, ${index.packages.length} package notices; no optional model weights or engines bundled.`);
