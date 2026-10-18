import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public', 'licenses', 'third-party-notices.txt');
const indexOutput = join(root, 'public', 'licenses', 'third-party-index.json');
const overrides = new Map([
  ['rehype-katex', ['remark-math.txt', 'https://github.com/remarkjs/remark-math/blob/main/license']],
  ['remark-math', ['remark-math.txt', 'https://github.com/remarkjs/remark-math/blob/main/license']],
  ['clean-git-ref', ['clean-git-ref.txt', 'SPDX Apache-2.0 text; package author from package.json']],
  ['diff3', ['diff3.txt', 'License notices embedded in the installed diff3.js and onp.js files']],
  ['minimisted', ['minimisted.txt', 'SPDX MIT text; package author from package.json']],
]);

const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dependencyTree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }));
const requiredBy = new Map();
function collectParents(dependencies, parent = 'App') {
  for (const [name, item] of Object.entries(dependencies || {})) {
    const identifier = `${name}@${item.version}`;
    if (!requiredBy.has(identifier)) requiredBy.set(identifier, new Set());
    requiredBy.get(identifier).add(parent);
    collectParents(item.dependencies, name);
  }
}
collectParents(dependencyTree.dependencies);
function authorDetails(author) {
  const value = typeof author === 'string' ? author : author?.name || '';
  const website = (typeof author === 'object' ? author?.url : '') || value.match(/https?:\/\/[^\s)<>]+/)?.[0] || '';
  return { name: value.replace(/<[^>]*>/g, '').replace(/\(https?:\/\/[^)]*\)/g, '').replace(/https?:\/\/\S+/g, '').trim(), website };
}
const lines = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const installed = new Map();
for (const directory of lines.slice(1)) {
  const details = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  installed.set(`${details.name}@${details.version}`, { directory, details });
}

const notices = [
  'Local Agent Lab — third-party notices',
  'Generated from installed production dependencies during the build.',
  'Optional model weights and browser engines are downloaded separately with their own license files.',
  '',
];
const index = [];
const missing = [];
for (const [identifier, { directory, details }] of [...installed].sort(([a], [b]) => a.localeCompare(b))) {
  const entries = await readdir(directory);
  const legalFiles = entries.filter(name => /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name)).sort();
  let source = legalFiles.length ? 'Installed npm package' : '';
  let texts = await Promise.all(legalFiles.map(async name => `--- ${name} ---\n${await readFile(join(directory, name), 'utf8')}`));
  if (!texts.length) {
    const fallback = details.name.startsWith('@napi-rs/canvas-')
      ? ['napi-canvas.txt', 'https://github.com/Brooooooklyn/canvas/blob/main/LICENSE']
      : overrides.get(details.name);
    if (fallback) {
      source = fallback[1];
      texts = [await readFile(join(root, 'scripts', 'license-overrides', fallback[0]), 'utf8')];
    } else missing.push(identifier);
  }
  const repository = typeof details.repository === 'string' ? details.repository : details.repository?.url || '';
  const author = authorDetails(details.author);
  const website = typeof details.homepage === 'string' ? details.homepage : '';
  const documentation = typeof details.documentation === 'string' ? details.documentation : '';
  const parents = [...(requiredBy.get(identifier) || [])].sort((a, b) => a.localeCompare(b));
  if (!parents.length) throw new Error(`No production dependency path was found for ${identifier}.`);
  index.push({
    name: details.name,
    version: details.version,
    author: author.name,
    authorWebsite: author.website,
    relationship: parents.includes('App') ? 'direct' : 'transitive',
    requiredBy: parents,
    license: typeof details.license === 'string' ? details.license : JSON.stringify(details.license || 'unspecified'),
    website,
    repository,
    documentation,
    notices: legalFiles.length
      ? legalFiles.map((name, position) => ({ name, text: texts[position].replace(`--- ${name} ---\n`, '') }))
      : [{ name: 'License', text: texts[0] || '', source }],
  });
  notices.push('='.repeat(80), identifier, `Included through: ${parents.join(', ')}`, `Declared license: ${typeof details.license === 'string' ? details.license : JSON.stringify(details.license || 'unspecified')}`);
  if (repository) notices.push(`Repository: ${repository}`);
  if (details.author) notices.push(`Package author: ${typeof details.author === 'string' ? details.author : details.author.name || JSON.stringify(details.author)}`);
  notices.push(`License text source: ${source || 'MISSING'}`, '', ...texts.map(text => text.trimEnd()), '');
}
if (missing.length) throw new Error(`License text is missing for: ${missing.join(', ')}. Add an audited local override before publishing.`);
await mkdir(join(root, 'public', 'licenses'), { recursive: true });
await writeFile(output, notices.join('\n') + '\n');
await writeFile(indexOutput, JSON.stringify({ version: 2, packages: index, development: Object.entries(project.devDependencies || {}).map(([name, range]) => ({ name, range })) }) + '\n');
console.log(`Third-party notices: ${installed.size} runtime packages included; ${Object.keys(project.devDependencies || {}).length} direct build tools excluded.`);
