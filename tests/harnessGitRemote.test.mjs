import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCloneTarget, runRemoteGit, validateRemoteGitOptions } from '../src/harnessGitRemote.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; }
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
  async *entries() { yield* this.children.entries(); }
}
const project = { id: 'demo', name: 'Demo', filesPath: 'repositories/demo' };

test('remote inputs reject embedded credentials and unsafe credential transport', () => {
  assert.equal(validateRemoteGitOptions({ url: ' https://github.com/user/repo.git ' }).url, 'https://github.com/user/repo.git');
  for (const url of ['file:///tmp/repo', 'https://secret@github.com/user/repo.git', 'https://github.com/', 'https://github.com/user/repo.git?token=x']) {
    assert.throws(() => validateRemoteGitOptions({ url }), undefined, url);
  }
  assert.throws(() => validateRemoteGitOptions({ url: 'http://example.com/repo.git', token: 'secret' }), /Credentials require HTTPS/);
  assert.throws(() => validateRemoteGitOptions({ url: 'https://example.com/repo.git', token: 'secret', corsProxy: 'http://proxy.example' }), /Credentials require HTTPS/);
  assert.equal(validateRemoteGitOptions({ url: 'http://localhost:8000/repo.git', token: 'secret' }).url, 'http://localhost:8000/repo.git');
});

test('clone checks the mapped folder and every ancestor before writing', async () => {
  const root = new MemoryDirectory();
  await assertCloneTarget(root, project);
  const repositories = await root.getDirectoryHandle('repositories', { create: true });
  const target = await repositories.getDirectoryHandle('demo', { create: true });
  await assertCloneTarget(root, project);
  await target.getFileHandle('README.md', { create: true });
  await assert.rejects(assertCloneTarget(root, project), /empty project code folder/);
  const wrapped = new MemoryDirectory();
  const parent = await wrapped.getDirectoryHandle('repositories', { create: true });
  await parent.getDirectoryHandle('.git', { create: true });
  await assert.rejects(assertCloneTarget(wrapped, project), /already inside a Git repository/);
});

test('a stopped remote action does not create the mapped folder', async () => {
  const root = new MemoryDirectory();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runRemoteGit(root, project, 'clone', { url: 'https://example.com/repo.git', signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(root.getDirectoryHandle('repositories'), { name: 'NotFoundError' });
});
