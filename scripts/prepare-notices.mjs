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
const directPurposes = new Map([
  ['@babel/parser', 'Parses JavaScript and TypeScript source code.'],
  ['@noble/hashes', 'Provides cryptographic hashes for file checks.'],
  ['buffer', 'Provides Node-style binary buffers in browsers.'],
  ['fflate', 'Compresses and extracts ZIP data in the browser.'],
  ['isomorphic-git', 'Reads and writes Git repositories in the browser.'],
  ['katex', 'Renders mathematical formulas in HTML.'],
  ['lucide-react', 'Provides the interface’s SVG icon set.'],
  ['pdfjs-dist', 'Reads and renders imported PDF documents.'],
  ['react', 'Builds interactive interface components.'],
  ['react-dom', 'Renders React components into the web page.'],
  ['react-markdown', 'Displays Markdown from chat and documents.'],
  ['rehype-katex', 'Turns parsed math into rendered KaTeX HTML.'],
  ['remark-math', 'Recognizes math syntax inside Markdown.'],
  ['streaming-bz2-decompress', 'Decompresses large bzip2 archives in chunks.'],
  ['three', 'Renders and navigates interactive 3D scenes.'],
]);
const shortDescriptionOverrides = new Map([
  ['@types/ms', 'Adds TypeScript types for the ms duration helper.'],
  ['@ungap/structured-clone', 'Polyfills structured cloning of JavaScript values.'],
  ['async-lock', 'Serializes asynchronous work by named lock.'],
  ['bail', 'Throws errors from unified processing pipelines.'],
  ['crc-32', 'Computes CRC-32 checksums for binary data.'],
  ['diff3', 'Merges three versions of text with conflicts.'],
  ['for-each', 'Runs a callback for each collection item.'],
  ['hastscript', 'Builds HTML syntax trees from JavaScript.'],
  ['html-url-attributes', 'Lists HTML attributes that hold URL values.'],
  ['inline-style-parser', 'Parses CSS declarations from style attributes.'],
  ['minimist', 'Parses command-line flags and arguments.'],
  ['minimisted', 'Wraps minimist argument parsing helpers.'],
  ['parse5', 'Parses and serializes HTML documents.'],
  ['safe-buffer', 'Provides a safer Node.js Buffer implementation.'],
  ['trough', 'Runs middleware stages in unified pipelines.'],
  ['unist-util-visit', 'Walks nodes in a unified syntax tree.'],
  ['web-namespaces', 'Maps XML namespaces used by web documents.'],
  ['wrappy', 'Wraps callbacks while preserving properties.'],
]);
const buildPurposes = new Map([
  ['@eslint/js', 'Provides ESLint’s core JavaScript rule presets.'],
  ['@types/react', 'Adds TypeScript definitions for React components.'],
  ['@types/react-dom', 'Adds TypeScript definitions for React DOM APIs.'],
  ['@types/three', 'Adds TypeScript definitions for Three.js scenes.'],
  ['@vitejs/plugin-react', 'Enables React compilation and fast refresh in Vite.'],
  ['eslint', 'Checks code for bugs and consistency problems.'],
  ['prettier', 'Formats source files with shared style rules.'],
  ['typescript', 'Type-checks and compiles TypeScript source files.'],
  ['typescript-eslint', 'Adds TypeScript parsing and rules to ESLint.'],
  ['vite', 'Runs the local server and builds production assets.'],
]);
function shortPurpose(description) {
  const text = description.replace(/\s+/g, ' ').trim();
  if (text.length <= 60) return text;
  return `${text.slice(0, 59).replace(/\s+\S*$/, '')}…`;
}

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
  const purpose = parents.includes('App') ? directPurposes.get(details.name) : shortDescriptionOverrides.get(details.name) || shortPurpose(details.description || '');
  if (!purpose || purpose.length < 30 || purpose.length > 60) throw new Error(`A 30–60 character purpose is missing for ${identifier}.`);
  index.push({
    name: details.name,
    purpose,
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
const development = Object.entries(project.devDependencies || {}).map(([name, range]) => {
  const purpose = buildPurposes.get(name);
  if (!purpose || purpose.length < 30 || purpose.length > 60) throw new Error(`A 30–60 character build-tool purpose is missing for ${name}.`);
  return { name, range, purpose };
});
await writeFile(indexOutput, JSON.stringify({ version: 3, packages: index, development }) + '\n');
console.log(`Third-party notices: ${installed.size} runtime packages included; ${Object.keys(project.devDependencies || {}).length} direct build tools excluded.`);
