import test from 'node:test';
import assert from 'node:assert/strict';
import { gitCheckoutBranch, gitCommit, gitCreateBranch, gitDiff, gitHistory, gitInit, gitStage, gitState, gitUnstage, projectGitDir } from '../src/harnessGit.ts';
import { readGitAuthor, saveGitAuthor } from '../src/harnessGitAuthor.ts';
import { browserFileTools } from '../src/harnessTools.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); this.modified = Date.now(); }
  async getFile() { return new File([this.blob], this.name, { lastModified: this.modified }); }
  async createWritable() {
    return {
      write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); this.modified = Date.now(); },
      close: async () => {},
    };
  }
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

test('Git mappings reject nested repository internals and dependency folders', () => {
  assert.equal(projectGitDir(project), '/repositories/demo');
  for (const filesPath of ['repositories/.git/work', 'repositories/demo/node_modules/app', 'repositories/demo/.svn/work']) {
    assert.throws(() => projectGitDir({ ...project, filesPath }), /relative code folder/);
  }
});
test('Git author defaults travel with their workspace folder', async () => {
  const first = new MemoryDirectory(), second = new MemoryDirectory();
  assert.equal(await readGitAuthor(first), null);
  await assert.rejects(saveGitAuthor(first, { name: 'Ada', email: 'invalid' }), /author name and email/);
  await saveGitAuthor(first, { name: '  Ada  ', email: ' ada@example.com ' });
  assert.deepEqual(await readGitAuthor(first), { name: 'Ada', email: 'ada@example.com' });
  assert.equal(await readGitAuthor(second), null);
});
async function write(root, path, content) {
  const parts = path.split('/');
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  const writer = await (await directory.getFileHandle(parts.at(-1), { create: true })).createWritable();
  await writer.write(content);
  await writer.close();
}

test('coding agent initializes only its mapped project repository once', async () => {
  const folder = new MemoryDirectory();
  const tools = browserFileTools(folder, { projects: [project], defaultProjectId: project.id, workspaceAccess: false });
  await assert.rejects(tools.execute('git_init', { project: 'other' }), /outside the agent/);
  const unmapped = browserFileTools(folder, { projects: [{ ...project, filesPath: '' }], defaultProjectId: project.id, workspaceAccess: false });
  await assert.rejects(unmapped.execute('git_init', {}), /relative code folder/);
  assert.match(await tools.execute('git_init', {}), /Initialized Git/);
  assert.equal((await gitState(folder, project)).repository, true);
  await assert.rejects(tools.execute('git_init', {}), /already has a Git repository/);
});

test('Git initialization refuses a repository already wrapping the project folder', async () => {
  const parentRepository = new MemoryDirectory();
  const repositories = await parentRepository.getDirectoryHandle('repositories', { create: true });
  await repositories.getDirectoryHandle('.git', { create: true });
  await assert.rejects(gitInit(parentRepository, project), /inside a Git repository at repositories/);
  await assert.rejects(parentRepository.getDirectoryHandle('repositories').then(dir => dir.getDirectoryHandle('demo')), { name: 'NotFoundError' });

  const rootWorktree = new MemoryDirectory();
  await rootWorktree.getFileHandle('.git', { create: true });
  await assert.rejects(gitInit(rootWorktree, project), /workspace root is already a Git repository/);
});

test('browser folder Git can initialize, stage, commit, diff, and unstage', async () => {
  const folder = new MemoryDirectory();
  assert.equal((await gitState(folder, project)).repository, false);
  await gitInit(folder, project);
  await write(folder, 'repositories/demo/src/app.ts', 'export const answer = 1;\n');
  let state = await gitState(folder, project);
  assert.equal(state.repository, true);
  assert.equal(state.changes[0]?.label, 'New');
  await gitStage(folder, project, state.changes[0]);
  state = await gitState(folder, project);
  assert.equal(state.changes[0]?.staged, true);
  assert.match((await gitDiff(folder, project, 'src/app.ts')).staged, /\+export const answer = 1;/);
  await gitCommit(folder, project, 'Initial commit', 'Test Author', 'test@example.com');
  state = await gitState(folder, project);
  assert.equal(state.changes.length, 0);
  assert.equal(state.recent[0]?.message, 'Initial commit');
  assert.deepEqual((await gitHistory(folder, project)).commits.map(item => item.message), ['Initial commit']);
  await write(folder, 'repositories/demo/src/app.ts', 'export const answer = 2;\n');
  state = await gitState(folder, project);
  assert.match((await gitDiff(folder, project, 'src/app.ts')).unstaged, /\+export const answer = 2;/);
  await gitStage(folder, project, state.changes[0]);
  state = await gitState(folder, project);
  await gitUnstage(folder, project, state.changes[0]);
  state = await gitState(folder, project);
  assert.equal(state.changes[0]?.staged, false);
  assert.equal(state.changes[0]?.unstaged, true);
});

test('project branches switch committed files and refuse uncommitted changes', async () => {
  const folder = new MemoryDirectory();
  await gitInit(folder, project);
  await assert.rejects(gitCreateBranch(folder, project, 'feature/demo'), /first commit/);
  await write(folder, 'repositories/demo/app.ts', 'export const value = 1;\n');
  await gitStage(folder, project, (await gitState(folder, project)).changes[0]);
  await gitCommit(folder, project, 'Start', 'Test Author', 'test@example.com');
  await assert.rejects(gitCreateBranch(folder, project, '../escape'), /branch name/);
  await gitCreateBranch(folder, project, 'feature/demo');
  let state = await gitState(folder, project);
  assert.equal(state.branch, 'feature/demo');
  assert.deepEqual(state.branches.sort(), ['feature/demo', 'main']);
  await write(folder, 'repositories/demo/app.ts', 'export const value = 2;\n');
  await assert.rejects(gitCheckoutBranch(folder, project, 'main'), /local changes/);
  await gitStage(folder, project, (await gitState(folder, project)).changes[0]);
  await gitCommit(folder, project, 'Change value', 'Test Author', 'test@example.com');
  await gitCheckoutBranch(folder, project, 'main');
  assert.equal(await (await (await (await folder.getDirectoryHandle('repositories')).getDirectoryHandle('demo')).getFileHandle('app.ts')).getFile().then(file => file.text()), 'export const value = 1;\n');
  await gitCheckoutBranch(folder, project, 'feature/demo');
  assert.equal(await (await (await (await folder.getDirectoryHandle('repositories')).getDirectoryHandle('demo')).getFileHandle('app.ts')).getFile().then(file => file.text()), 'export const value = 2;\n');
});

test('coding tools can stage and commit only inside their assigned repository', async () => {
  const folder = new MemoryDirectory();
  await gitInit(folder, project);
  await write(folder, 'repositories/demo/README.md', 'Demo\n');
  const tools = browserFileTools(folder, { projects: [project], defaultProjectId: project.id, workspaceAccess: false });
  await assert.rejects(tools.execute('git_stage', { project: 'other', path: 'README.md' }), /outside the agent/);
  await assert.rejects(tools.execute('git_commit', { message: 'Empty', author_name: 'Test', author_email: 'test@example.com' }), /Stage at least one/);
  assert.match(await tools.execute('git_stage', { path: 'README.md' }), /Staged README.md/);
  assert.match(await tools.execute('git_unstage', { path: 'README.md' }), /working copy remains/);
  assert.match(await tools.execute('git_stage', { path: 'README.md' }), /Staged README.md/);
  assert.match(await tools.execute('git_commit', { message: 'Add readme', author_name: 'Test', author_email: 'test@example.com' }), /Committed/);
  assert.equal((await gitState(folder, project)).recent[0]?.message, 'Add readme');
  assert.deepEqual(JSON.parse(await tools.execute('git_history', {})).commits.map(item => item.message), ['Add readme']);
  await assert.rejects(tools.execute('git_history', { project: 'other' }), /outside the agent/);
  await assert.rejects(tools.execute('git_create_branch', { project: 'other', branch: 'feature/new' }), /outside the agent/);
  assert.match(await tools.execute('git_create_branch', { branch: 'feature/new' }), /current branch and files were not changed/);
  const afterBranch = await gitState(folder, project);
  assert.equal(afterBranch.branch, 'main');
  assert.ok(afterBranch.branches.includes('feature/new'));
  await assert.rejects(tools.execute('git_create_branch', { branch: 'feature/new' }), /already exists/);
});

test('Git history pages older commits and rejects invalid offsets', async () => {
  const folder = new MemoryDirectory();
  await gitInit(folder, project);
  for (let index = 0; index < 12; index++) {
    await write(folder, 'repositories/demo/notes.txt', `Revision ${index}\n`);
    const changed = (await gitState(folder, project)).changes[0];
    await gitStage(folder, project, changed);
    await gitCommit(folder, project, `Revision ${index}`, 'Test Author', 'test@example.com');
  }
  const first = await gitHistory(folder, project);
  const second = await gitHistory(folder, project, first.nextOffset);
  assert.equal(first.commits.length, 10);
  assert.equal(first.nextOffset, 10);
  assert.deepEqual(second.commits.map(item => item.message), ['Revision 1', 'Revision 0']);
  assert.equal(second.nextOffset, null);
  await assert.rejects(gitHistory(folder, project, -1), /offset/);
});
