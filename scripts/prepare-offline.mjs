import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const workerPath = join(root, 'coi-serviceworker.js');
async function filesUnder(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile() && path !== workerPath) files.push(path);
  }
  return files;
}

const files = (await filesUnder(root)).sort();
if (!files.some(path => path.endsWith(`${sep}index.html`))) throw new Error('Built index.html is missing.');
const hash = createHash('sha256');
for (const path of files) {
  hash.update(relative(root, path));
  hash.update(await readFile(path));
}
const version = hash.digest('hex').slice(0, 16);
const assets = files.map(path => relative(root, path).split(sep).join('/'));
let worker = await readFile(workerPath, 'utf8');
const versionSlot = "/* BUILD_VERSION */ 'dev'";
const assetSlot = '/* PRECACHE_FILES */ []';
if (!worker.includes(versionSlot) || !worker.includes(assetSlot)) throw new Error('Service worker build slots are missing.');
worker = worker.replace(versionSlot, `/* BUILD_VERSION */ '${version}'`)
  .replace(assetSlot, `/* PRECACHE_FILES */ ${JSON.stringify(assets)}`);
await writeFile(workerPath, worker);
console.log(`Offline app shell: ${assets.length} files prepared (${version}).`);
