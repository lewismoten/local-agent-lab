import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gitCommit, gitStage, gitState } from '../src/harnessGit.ts';
import { gitRemoteDetails, runRemoteGit } from '../src/harnessGitRemote.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); this.modified = Date.now(); }
  async getFile() { return new File([this.blob], this.name, { lastModified: this.modified }); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); this.modified = Date.now(); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing directory', entry ? 'TypeMismatchError' : 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing file', entry ? 'TypeMismatchError' : 'NotFoundError');
    return entry;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw new DOMException('Missing entry', 'NotFoundError'); }
  async *entries() { yield* this.children.entries(); }
}

const project = { id: 'demo', name: 'Demo', filesPath: 'repositories/demo' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function save(folder, text) {
  const root = await folder.getDirectoryHandle('repositories');
  const code = await root.getDirectoryHandle('demo');
  const writer = await (await code.getFileHandle('README.md', { create: true })).createWritable();
  await writer.write(text); await writer.close();
}

function gitHttpServer(root) {
  const server = createServer(async (request, response) => {
    if (server.requiredToken) {
      const expected = `Basic ${Buffer.from(`x-access-token:${server.requiredToken}`).toString('base64')}`;
      if (request.headers.authorization !== expected) { response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }); response.end('Authentication required'); return; }
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const [pathname, query = ''] = (request.url || '/').split('?');
    const child = spawn('git', ['http-backend'], { env: {
      ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REQUEST_METHOD: request.method || 'GET',
      PATH_INFO: pathname, QUERY_STRING: query, CONTENT_TYPE: request.headers['content-type'] || '',
      CONTENT_LENGTH: String(body.length), REMOTE_USER: 'test',
    } });
    const output = [], errors = [];
    child.stdout.on('data', value => output.push(value));
    child.stderr.on('data', value => errors.push(value));
    child.stdin.end(body);
    const code = await new Promise(resolve => child.on('close', resolve));
    if (code !== 0) { response.writeHead(500); response.end(Buffer.concat(errors)); return; }
    const raw = Buffer.concat(output);
    let end = raw.indexOf('\r\n\r\n'), separator = 4;
    if (end < 0) { end = raw.indexOf('\n\n'); separator = 2; }
    if (end < 0) { response.writeHead(500); response.end('Invalid Git CGI response'); return; }
    let status = 200;
    for (const line of raw.subarray(0, end).toString().split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon), value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') status = Number(value.slice(0, 3));
      else if (!['expires', 'pragma', 'cache-control'].includes(name.toLowerCase())) response.setHeader(name, value);
    }
    response.writeHead(status); response.end(raw.subarray(end + separator));
  });
  server.requiredToken = '';
  return server;
}

test('portable browser filesystem clones, fetches, pulls and pushes over Git HTTP', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-git-remote-'));
  const source = join(root, 'source');
  const bare = join(root, 'demo.git');
  const server = gitHttpServer(root);
  try {
    git(root, 'init', '--bare', '--initial-branch=main', bare);
    git(root, 'config', '--file', join(bare, 'config'), 'http.receivepack', 'true');
    git(root, 'init', '--initial-branch=main', source);
    git(source, 'config', 'user.name', 'Local Test'); git(source, 'config', 'user.email', 'local@example.com');
    await writeFile(join(source, 'README.md'), 'one\n');
    git(source, 'add', 'README.md'); git(source, 'commit', '-m', 'Initial');
    git(source, 'remote', 'add', 'origin', bare); git(source, 'push', '-u', 'origin', 'main');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/demo.git`;
    const folder = new MemoryDirectory();
    assert.match(await runRemoteGit(folder, project, 'clone', { url }), /cloned/);
    assert.equal((await gitState(folder, project)).recent[0].message, 'Initial');
    assert.equal((await gitRemoteDetails(folder, project)).url, url);
    await writeFile(join(source, 'README.md'), 'two\n');
    git(source, 'add', 'README.md'); git(source, 'commit', '-m', 'Upstream'); git(source, 'push');
    assert.match(await runRemoteGit(folder, project, 'fetch', { url }), /Fetched main/);
    assert.match(await runRemoteGit(folder, project, 'pull', { url }), /fast-forward/);
    assert.equal((await gitState(folder, project)).recent[0].message, 'Upstream');
    await save(folder, 'three\n');
    await gitStage(folder, project, (await gitState(folder, project)).changes[0]);
    await gitCommit(folder, project, 'Browser edit', 'Browser Test', 'browser@example.com');
    assert.match(await runRemoteGit(folder, project, 'push', { url }), /Pushed main/);
    assert.equal(git(root, '--git-dir', bare, 'log', '-1', '--format=%s'), 'Browser edit');
    server.requiredToken = 'memory-only-token';
    assert.match(await runRemoteGit(folder, project, 'fetch', { url, token: server.requiredToken }), /Fetched main/);
    const config = await (await (await (await folder.getDirectoryHandle('repositories')).getDirectoryHandle('demo')).getDirectoryHandle('.git')).getFileHandle('config').then(handle => handle.getFile()).then(file => file.text());
    assert(!config.includes(server.requiredToken), 'credentials must not be saved with the portable repository');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
