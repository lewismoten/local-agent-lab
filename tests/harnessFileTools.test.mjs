import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFileTools, deleteToolFile, listToolBackups, listToolFilesPage, moveToolFile, pageGitStatus, readToolFile, restoreToolBackup, searchToolFiles, unusedToolFilePath, writeToolFile } from '../src/harnessTools.ts';
import { indexLibraryFile, indexLibraryProject, libraryIndexCount, searchLibrary } from '../src/harnessLibrary.ts';
import { chunkSearchBits } from '../src/harnessData.ts';
import { readBlob, writeBlob } from '../src/storage.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); this.modified = Date.now(); this.writes = 0; }
  async getFile() { return new File([this.blob], this.name, { lastModified: this.modified }); }
  async createWritable() {
    return {
      write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); this.modified = Date.now(); this.writes++; },
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
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
    return entry;
  }
  async removeEntry(name) {
    if (!this.children.delete(name)) throw new DOMException('Missing entry', 'NotFoundError');
  }
  async *entries() { yield* this.children.entries(); }
}

const scope = { projects: [{ id: 'home', name: 'Home', filesPath: 'repositories/demo' }], workspaceAccess: false, defaultProjectId: 'home' };
const missing = error => error instanceof DOMException && error.name === 'NotFoundError';

test('Git tools are offered only when an allowed project maps to a code folder', () => {
  const folder = new MemoryDirectory();
  const withCodeFolder = browserFileTools(folder, scope).definitions.map(tool => tool.function.name);
  const withoutCodeFolder = browserFileTools(folder, { ...scope, projects: [{ id: 'home', name: 'Home' }] }).definitions.map(tool => tool.function.name);
  assert.ok(withCodeFolder.includes('git_init'));
  assert.ok(withoutCodeFolder.includes('read_file'));
  assert.ok(withoutCodeFolder.every(name => !name.startsWith('git_')));
});

test('read-only shell uses the active project file scope', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'repositories/demo/src/readme.md', new Blob(['hello from project']));
  await writeBlob(folder, 'harness/private.txt', new Blob(['secret']));
  const tools = browserFileTools(folder, scope);
  assert.equal(await tools.execute('shell_readonly', { command: 'pwd' }), '/workspace');
  assert.match(await tools.execute('shell_readonly', { command: 'ls -la /workspace/src' }), /src\/readme.md/);
  assert.match(await tools.execute('shell_readonly', { command: 'cat /workspace/src/readme.md' }), /hello from project/);
  assert.match(await tools.execute('shell_readonly', { command: 'rg "hello from" /workspace/src' }), /src\/readme\.md:1:1/);
  await assert.rejects(tools.execute('shell_readonly', { command: 'cat /workspace/../harness/private.txt' }), /paths must stay/);
  await assert.rejects(tools.execute('shell_readonly', { command: 'cat /harness/private.txt' }), /paths must stay/);
  const restricted = browserFileTools(folder, { ...scope, projects: [{ ...scope.projects[0], toolPermissions: { shell_cat: 'deny' } }] });
  assert.match(await restricted.execute('shell_readonly', { command: 'ls /workspace/src' }), /readme\.md/);
  await assert.rejects(restricted.execute('shell_readonly', { command: 'cat /workspace/src/readme.md' }), /shell_cat is blocked/);
});

test('a read-only project hides model writes and rejects direct or cross-scope write calls', async () => {
  const folder = new MemoryDirectory();
  const readOnly = { projects: [{ ...scope.projects[0], toolAccess: 'read-only' }], workspaceAccess: true, defaultProjectId: 'home' };
  const tools = browserFileTools(folder, readOnly);
  const names = tools.definitions.map(tool => tool.function.name);
  assert.ok(names.includes('read_file') && names.includes('shell_readonly') && names.includes('git_status'));
  assert.ok(!names.includes('write_file') && !names.includes('delete_file') && !names.includes('git_commit') && !names.includes('restore_backup'));
  await assert.rejects(tools.execute('write_file', { path: 'src/new.ts', content: 'bad' }), /read-only/);
  await assert.rejects(tools.execute('write_file', { project: 'fake', area: 'workspace', path: 'repositories/demo/src/new.ts', content: 'bad' }), /read-only/);
  await assert.rejects(readBlob(folder, 'repositories/demo/src/new.ts'), missing);
});

test('workspace read-only mode rejects direct model writes even with full workspace access', async () => {
  const folder = new MemoryDirectory();
  const locked = browserFileTools(folder, { ...scope, workspaceAccess: true, workspaceReadOnly: true });
  await assert.rejects(locked.execute('write_file', { area: 'workspace', path: 'repositories/demo/new.ts', content: 'bad' }), /blocked/);
  await assert.rejects(locked.execute('git_init', {}), /blocked/);
  assert.equal(await locked.execute('shell_readonly', { command: 'pwd' }), '/workspace');
  await assert.rejects(readBlob(folder, 'repositories/demo/new.ts'), missing);
});

test('workspace-wide tools cannot bypass a different assigned read-only project', async () => {
  const folder = new MemoryDirectory();
  const mixed = { projects: [{ ...scope.projects[0], id: 'writable' }, { ...scope.projects[0], id: 'locked', filesPath: 'repositories/locked', toolAccess: 'read-only' }], workspaceAccess: true, defaultProjectId: 'writable' };
  const tools = browserFileTools(folder, mixed);
  assert.ok(tools.definitions.some(tool => tool.function.name === 'write_file'));
  await assert.rejects(tools.execute('write_file', { area: 'workspace', path: 'repositories/locked/src/app.ts', content: 'bad' }), /could affect a read-only project/);
  await assert.rejects(readBlob(folder, 'repositories/locked/src/app.ts'), missing);
  assert.match(await tools.execute('write_file', { project: 'writable', path: 'src/app.ts', content: 'good' }), /Wrote/);
  const workspaceWide = browserFileTools(folder, { ...mixed, projects: mixed.projects.slice(0, 1), workspaceProjects: mixed.projects });
  await assert.rejects(workspaceWide.execute('write_file', { area: 'workspace', path: 'repositories/locked/src/app.ts', content: 'bad' }), /could affect a read-only project/);
  assert.match(await workspaceWide.execute('write_file', { area: 'workspace', path: 'scratch/notes.md', content: 'okay' }), /Wrote/);
});

test('a blocked project tool remains visible for settings but cannot execute', async () => {
  const folder = new MemoryDirectory();
  const restricted = { ...scope, projects: [{ ...scope.projects[0], toolPermissions: { write_file: 'deny', read_file: 'deny' } }] };
  const tools = browserFileTools(folder, restricted);
  assert.ok(tools.definitions.some(tool => tool.function.name === 'write_file'));
  assert.ok(tools.definitions.some(tool => tool.function.name === 'read_file'));
  await assert.rejects(tools.execute('write_file', { path: 'src/new.ts', content: 'blocked' }), /blocked in Project settings/);
  await assert.rejects(tools.execute('read_file', { path: 'src/new.ts' }), /blocked in Project settings/);
  await assert.rejects(readBlob(folder, 'repositories/demo/src/new.ts'), missing);
});

test('file reads preserve UTF-8 characters at byte boundaries and give the next offset', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'repositories/demo/src/unicode.ts', new Blob(['aé💡b']));
  const first = await readToolFile(folder, scope, 'home', 'files', 'src/unicode.ts', 0, 2);
  assert.match(first, /bytes 0–3 of 8\naé\n\[More available; read with offset 3\.\]/);
  const second = await readToolFile(folder, scope, 'home', 'files', 'src/unicode.ts', 3, 2);
  assert.match(second, /bytes 3–7 of 8\n💡\n\[More available; read with offset 7\.\]/);
  const inside = await readToolFile(folder, scope, 'home', 'files', 'src/unicode.ts', 5, 1);
  assert.match(inside, /bytes 3–7 of 8\n💡/);
  await assert.rejects(readToolFile(folder, scope, 'home', 'files', 'src/unicode.ts', Number.NaN), /offset/);
  await assert.rejects(readToolFile(folder, scope, 'home', 'files', 'src/unicode.ts', 0, 0), /length/);
});

test('syntax tool checks saved code within the assigned project', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'repositories/demo/src/app.ts', new Blob(['export const answer: = 42;']));
  const tools = browserFileTools(folder, scope);
  const result = JSON.parse(await tools.execute('check_syntax', { path: 'src/app.ts' }));
  assert.equal(result.status, 'errors');
  assert.equal(result.diagnostics[0].line, 1);
  await assert.rejects(tools.execute('check_syntax', { project: 'other', path: 'src/app.ts' }), /outside the agent/);
  await assert.rejects(tools.execute('check_syntax', { area: 'workspace', path: 'src/app.ts' }), /does not have workspace access/);
});

test('coding edits report syntax feedback without undoing the saved file', async () => {
  const folder = new MemoryDirectory();
  const tools = browserFileTools(folder, scope);
  const invalid = await tools.execute('write_file', { path: 'src/check.ts', content: 'export const value: = 1;' });
  assert.match(invalid, /Syntax issues after save/);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/check.ts')).text(), 'export const value: = 1;');
  const fixed = await tools.execute('replace_in_file', { path: 'src/check.ts', search: 'value: =', replacement: 'value = ' });
  assert.match(fixed, /Syntax check: valid parse/);
  assert.equal((await listToolBackups(folder, scope, 'home', 'files')).length, 1);
});

test('move and delete tools preserve recoverable copies and refuse to overwrite', async () => {
  const folder = new MemoryDirectory();
  await writeToolFile(folder, scope, 'home', 'files', 'src/old.ts', 'export const answer = 42;');
  const moved = await moveToolFile(folder, scope, 'home', 'files', 'src/old.ts', 'src/new.ts');
  assert.match(moved, /Backup: harness\/history\/.+\.bak/);
  await assert.rejects(readBlob(folder, 'repositories/demo/src/old.ts'), missing);
  assert.match(await readToolFile(folder, scope, 'home', 'files', 'src/new.ts'), /answer = 42/);
  await assert.rejects(moveToolFile(folder, scope, 'home', 'files', 'src/new.ts', 'src/new.ts'), /different destination/);
  await writeToolFile(folder, scope, 'home', 'files', 'src/occupied.ts', 'existing');
  await assert.rejects(moveToolFile(folder, scope, 'home', 'files', 'src/new.ts', 'src/occupied.ts'), /already exists/);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/occupied.ts')).text(), 'existing');
  const removed = await deleteToolFile(folder, scope, 'home', 'files', 'src/new.ts');
  assert.match(removed, /Backup: harness\/history\/.+\.bak/);
  await assert.rejects(readBlob(folder, 'repositories/demo/src/new.ts'), missing);
  const backupPath = removed.match(/Backup: (.+)\.$/)[1];
  assert.equal(await (await readBlob(folder, backupPath)).text(), 'export const answer = 42;');
});

test('file operations enforce project and workspace boundaries', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/files/ok.ts', new Blob(['safe']));
  await writeBlob(folder, 'repositories/demo/large.bin', new Blob([new Uint8Array(2_000_001)]));
  const repo = await (await folder.getDirectoryHandle('repositories')).getDirectoryHandle('demo');
  await repo.getDirectoryHandle('src', { create: true });
  await assert.rejects(deleteToolFile(folder, scope, 'other', 'files', 'ok.ts'), /outside the agent/);
  await assert.rejects(moveToolFile(folder, scope, 'home', 'workspace', 'harness/secret.ts', 'safe.ts'), /managed separately/);
  await assert.rejects(deleteToolFile(folder, scope, 'home', 'files', '../secret.ts'), /relative path/);
  await assert.rejects(deleteToolFile(folder, scope, 'home', 'files', 'missing.ts'), missing);
  await assert.rejects(deleteToolFile(folder, scope, 'home', 'files', 'large.bin'), /Large files/);
  await assert.rejects(deleteToolFile(folder, scope, 'home', 'files', 'src'), missing);
  assert.equal((await readBlob(folder, 'repositories/demo/large.bin')).size, 2_000_001);
});

test('uploads receive a new name when a project file already exists', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/notes/outline.md', new Blob(['original']));
  assert.equal(await unusedToolFilePath(folder, scope, 'home', 'library', 'notes/outline.md'), 'notes/outline (2).md');
  await writeBlob(folder, 'harness/projects/home/library/notes/outline (2).md', new Blob(['second']));
  assert.equal(await unusedToolFilePath(folder, scope, 'home', 'library', 'notes/outline.md'), 'notes/outline (3).md');
  assert.equal(await (await readBlob(folder, 'harness/projects/home/library/notes/outline.md')).text(), 'original');
});

test('tool-driven library move and delete update its search index', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/notes/first.md', new Blob(['A silver comet crosses the sky.']));
  await indexLibraryFile(folder, 'home', 'notes/first.md');
  assert.equal(await libraryIndexCount(folder, 'home'), 1);
  const tools = browserFileTools(folder, scope);
  await tools.execute('move_file', { area: 'library', path: 'notes/first.md', destination: 'notes/renamed.md' });
  assert.equal(await libraryIndexCount(folder, 'home'), 1);
  assert.equal((await searchLibrary(folder, 'home', 'silver comet'))[0]?.path, 'notes/renamed.md');
  await tools.execute('delete_file', { area: 'library', path: 'notes/renamed.md' });
  assert.equal(await libraryIndexCount(folder, 'home'), 0);
  assert.deepEqual(await searchLibrary(folder, 'home', 'silver comet'), []);
});

test('backups can be listed and restored without replacing current work silently', async () => {
  const folder = new MemoryDirectory();
  await writeToolFile(folder, scope, 'home', 'files', 'src/app.ts', 'first version');
  await writeToolFile(folder, scope, 'home', 'files', 'src/app.ts', 'second version');
  const [saved] = await listToolBackups(folder, scope, 'home', 'files');
  assert.equal(saved.path, 'src/app.ts');
  assert.equal(saved.bytes, 'first version'.length);
  await assert.rejects(restoreToolBackup(folder, scope, 'home', 'files', saved.id), /Confirm replacement/);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/app.ts')).text(), 'second version');
  await assert.rejects(restoreToolBackup(folder, scope, 'other', 'files', saved.id, true), /does not belong/);
  await restoreToolBackup(folder, scope, 'home', 'files', saved.id, true);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/app.ts')).text(), 'first version');
  assert.equal((await listToolBackups(folder, scope, 'home', 'files')).length, 2);
  const second = (await listToolBackups(folder, scope, 'home', 'files')).find(item => item.id !== saved.id);
  assert.equal(second.path, 'src/app.ts');
  assert.equal(await (await readBlob(folder, `harness/history/${second.id}.bak`)).text(), 'second version');
});

test('a damaged backup cannot replace a current file', async () => {
  const folder = new MemoryDirectory();
  await writeToolFile(folder, scope, 'home', 'files', 'src/app.ts', 'first');
  await writeToolFile(folder, scope, 'home', 'files', 'src/app.ts', 'second');
  const [saved] = await listToolBackups(folder, scope, 'home', 'files');
  await writeBlob(folder, `harness/history/${saved.id}.bak`, new Blob(['bad']));
  await assert.rejects(restoreToolBackup(folder, scope, 'home', 'files', saved.id, true), /incomplete or damaged/);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/app.ts')).text(), 'second');
});

test('model tools inspect scoped backups and require a current file hash before replacing work', async () => {
  const folder = new MemoryDirectory();
  const tools = browserFileTools(folder, scope);
  await tools.execute('write_file', { path: 'src/app.ts', content: 'first version' });
  await tools.execute('write_file', { path: 'src/app.ts', content: 'second version' });
  const { backups } = JSON.parse(await tools.execute('list_backups', {}));
  assert.equal(backups.length, 1);
  const id = backups[0].id;
  const inspected = JSON.parse(await tools.execute('inspect_backup', { backup_id: id }));
  assert.equal(inspected.preview, 'first version');
  assert.equal(inspected.path, 'src/app.ts');
  await assert.rejects(tools.execute('restore_backup', { backup_id: id }), /Confirm replacement/);
  const current = JSON.parse(await tools.execute('file_info', { path: 'src/app.ts' }));
  await tools.execute('write_file', { path: 'src/app.ts', content: 'third version' });
  await assert.rejects(tools.execute('restore_backup', { backup_id: id, expected_current_sha256: current.sha256 }), /changed after it was inspected/);
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/app.ts')).text(), 'third version');
  const latest = JSON.parse(await tools.execute('file_info', { path: 'src/app.ts' }));
  await tools.execute('restore_backup', { backup_id: id, expected_current_sha256: latest.sha256 });
  assert.equal(await (await readBlob(folder, 'repositories/demo/src/app.ts')).text(), 'first version');
  await assert.rejects(tools.execute('inspect_backup', { project: 'other', backup_id: id }), /outside the agent|does not belong/);
});

test('model tools can restore a deleted library file and update search', async () => {
  const folder = new MemoryDirectory();
  const tools = browserFileTools(folder, scope);
  await tools.execute('write_file', { area: 'library', path: 'notes/comet.md', content: 'A silver comet crosses the sky.' });
  await tools.execute('delete_file', { area: 'library', path: 'notes/comet.md' });
  const { backups } = JSON.parse(await tools.execute('list_backups', { area: 'library' }));
  await tools.execute('restore_backup', { area: 'library', backup_id: backups[0].id });
  assert.equal((await searchLibrary(folder, 'home', 'silver comet'))[0]?.path, 'notes/comet.md');
});

test('Git status pages keep changed files beyond the first hundred reachable', () => {
  const state = { repository: true, branch: 'main', recent: [{ oid: 'abc', message: 'Start', author: 'Author', date: '2026-01-01T00:00:00Z' }],
    changes: Array.from({ length: 205 }, (_, index) => ({ path: `src/file-${index}.ts`, head: 1, workdir: 2, stage: 1, staged: false, unstaged: true, label: 'Modified' })) };
  const first = pageGitStatus(state);
  assert.equal(first.changes.length, 100);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.totalChanges, 205);
  const second = pageGitStatus(state, first.nextOffset);
  const third = pageGitStatus(state, second.nextOffset);
  assert.equal(second.changes[0].path, 'src/file-100.ts');
  assert.equal(third.changes.at(-1).path, 'src/file-204.ts');
  assert.equal(third.nextOffset, null);
  assert.deepEqual(second.recent, []);
  assert.throws(() => pageGitStatus(state, -1), /nonnegative integer/);
});

test('patch tool edits a project file once, saves a backup, and rejects stale or out-of-scope edits', async () => {
  const folder = new MemoryDirectory();
  const path = 'repositories/demo/src/app.ts';
  await writeBlob(folder, path, new Blob(['const a = 1;\nconst b = 2;\n']));
  const tools = browserFileTools(folder, scope);
  const patch = '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 3;\n const b = 2;\n';
  assert.match(await tools.execute('apply_patch', { path: 'src/app.ts', patch }), /Applied unified patch/);
  assert.equal(await (await readBlob(folder, path)).text(), 'const a = 3;\nconst b = 2;\n');
  const [saved] = await listToolBackups(folder, scope, 'home', 'files');
  assert.equal(await (await readBlob(folder, `harness/history/${saved.id}.bak`)).text(), 'const a = 1;\nconst b = 2;\n');
  await assert.rejects(tools.execute('apply_patch', { path: 'src/app.ts', patch }), /no longer matches/);
  await assert.rejects(tools.execute('apply_patch', { project: 'other', path: 'src/app.ts', patch }), /outside the agent/);
  assert.equal(await (await readBlob(folder, path)).text(), 'const a = 3;\nconst b = 2;\n');
});

test('a deleted library document can be restored and searched again', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/notes/comet.md', new Blob(['A silver comet crosses the sky.']));
  await indexLibraryFile(folder, 'home', 'notes/comet.md');
  const tools = browserFileTools(folder, scope);
  await tools.execute('delete_file', { area: 'library', path: 'notes/comet.md' });
  assert.equal(await libraryIndexCount(folder, 'home'), 0);
  const [record] = await listToolBackups(folder, scope, 'home', 'library');
  await restoreToolBackup(folder, scope, 'home', 'library', record.id);
  assert.equal(await libraryIndexCount(folder, 'home'), 1);
  assert.equal((await searchLibrary(folder, 'home', 'silver comet'))[0]?.path, 'notes/comet.md');
});

test('bulk library indexing batches manifest writes and keeps finished files on Stop', async () => {
  const folder = new MemoryDirectory();
  for (let index = 0; index < 40; index++) {
    await writeBlob(folder, `harness/projects/home/library/notes/${String(index).padStart(2, '0')}.md`, new Blob([`Indexed note ${index} about ${index === 39 ? 'a copper moon' : 'the sky'}.`]));
  }
  const result = await indexLibraryProject(folder, 'home');
  assert.equal(result.indexed, 40);
  assert.equal(await libraryIndexCount(folder, 'home'), 40);
  assert.equal((await searchLibrary(folder, 'home', 'copper moon'))[0]?.path, 'notes/39.md');
  let directory = folder;
  for (const part of ['harness', 'projects', 'home', 'library-index']) directory = await directory.getDirectoryHandle(part);
  assert.equal((await directory.getFileHandle('manifest.json')).writes, 4);

  const stopped = new MemoryDirectory();
  for (let index = 0; index < 5; index++) await writeBlob(stopped, `harness/projects/home/library/notes/${index}.md`, new Blob([`Unique note ${index}.`]));
  const controller = new AbortController();
  await assert.rejects(indexLibraryProject(stopped, 'home', progress => {
    if (progress.total === 5 && progress.completed === 3) controller.abort();
  }, controller.signal), error => error?.name === 'AbortError');
  assert.equal(await libraryIndexCount(stopped, 'home'), 3);
  assert.equal((await searchLibrary(stopped, 'home', 'Unique note 2'))[0]?.path, 'notes/2.md');
});

test('bulk indexing preserves a library entry added while its batch is pending', async () => {
  const folder = new MemoryDirectory();
  for (let index = 0; index < 20; index++) await writeBlob(folder, `harness/projects/home/library/notes/${index}.md`, new Blob([`Background note ${index}.`]));
  let injected = false;
  await indexLibraryProject(folder, 'home', progress => {
    if (injected || progress.total !== 20 || progress.completed !== 8) return;
    injected = true;
    const project = folder.children.get('harness').children.get('projects').children.get('home');
    const source = new MemoryFile('external.md');
    source.blob = new Blob(['A turquoise compass points north.']);
    project.children.get('library').children.set('external.md', source);
    const id = 'e'.repeat(32);
    const body = new MemoryFile(`${id}.json`);
    body.blob = new Blob([JSON.stringify({ version: 1, path: 'external.md', chunks: [{ offset: 0, text: 'A turquoise compass points north.' }] })]);
    const indexDirectory = project.children.get('library-index');
    indexDirectory.children.set(`${id}.json`, body);
    const manifest = indexDirectory.children.get('manifest.json');
    manifest.blob = new Blob([JSON.stringify({ version: 1, documents: [{ path: 'external.md', id, bytes: source.blob.size, modified: source.modified, chunks: [chunkSearchBits([{ content: 'A turquoise compass points north.' }])], indexedAt: new Date().toISOString() }] })]);
  });
  assert.equal(injected, true);
  assert.equal(await libraryIndexCount(folder, 'home'), 21);
  assert.equal((await searchLibrary(folder, 'home', 'turquoise compass'))[0]?.path, 'external.md');
});

test('updating the library index removes entries whose source was deleted outside the app', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/obsolete.md', new Blob(['Old research note.']));
  await indexLibraryFile(folder, 'home', 'obsolete.md');
  let directory = folder;
  for (const part of ['harness', 'projects', 'home', 'library']) directory = await directory.getDirectoryHandle(part);
  await directory.removeEntry('obsolete.md');
  await indexLibraryProject(folder, 'home');
  assert.equal(await libraryIndexCount(folder, 'home'), 0);
});

test('updating the library index clears entries when the entire library folder was removed', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/research.md', new Blob(['An old research note.']));
  await indexLibraryFile(folder, 'home', 'research.md');
  let project = folder;
  for (const part of ['harness', 'projects', 'home']) project = await project.getDirectoryHandle(part);
  await project.removeEntry('library');
  const stopped = new AbortController();
  stopped.abort(new DOMException('Stopped.', 'AbortError'));
  await assert.rejects(indexLibraryProject(folder, 'home', undefined, stopped.signal), error => error?.name === 'AbortError');
  assert.equal(await libraryIndexCount(folder, 'home'), 1);
  await indexLibraryProject(folder, 'home');
  assert.equal(await libraryIndexCount(folder, 'home'), 0);
  assert.deepEqual(await searchLibrary(folder, 'home', 'research'), []);
});

test('explicit library reindex notices a same-size edit with an unchanged timestamp', async () => {
  const folder = new MemoryDirectory();
  const path = 'harness/projects/home/library/research.md';
  await writeBlob(folder, path, new Blob(['orbit amber']));
  await indexLibraryFile(folder, 'home', 'research.md');
  let directory = folder;
  for (const part of path.split('/').slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const file = await directory.getFileHandle('research.md');
  const timestamp = file.modified;
  file.blob = new Blob(['orbit azure']);
  file.modified = timestamp;
  assert.equal(await indexLibraryFile(folder, 'home', 'research.md'), true);
  assert.equal((await searchLibrary(folder, 'home', 'azure'))[0]?.path, 'research.md');
  assert.deepEqual(await searchLibrary(folder, 'home', 'amber'), []);
});

test('library search rejects stale excerpts and index update catches an external same-timestamp edit', async () => {
  const folder = new MemoryDirectory();
  const path = 'harness/projects/home/library/notes.md';
  await writeBlob(folder, path, new Blob(['orbit amber']));
  await indexLibraryFile(folder, 'home', 'notes.md');
  let directory = folder;
  for (const part of path.split('/').slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const file = await directory.getFileHandle('notes.md');
  const timestamp = file.modified;
  file.blob = new Blob(['orbit azure']);
  file.modified = timestamp;

  assert.deepEqual(await searchLibrary(folder, 'home', 'amber'), []);
  assert.equal((await indexLibraryProject(folder, 'home')).indexed, 1);
  assert.equal((await searchLibrary(folder, 'home', 'orbit azure'))[0]?.path, 'notes.md');
  assert.deepEqual(await searchLibrary(folder, 'home', 'amber'), []);
});

test('simultaneous library edits keep both search entries', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/one.md', new Blob(['The indigo lantern is lit.']));
  await writeBlob(folder, 'harness/projects/home/library/two.md', new Blob(['The copper orchard is quiet.']));
  await Promise.all([
    indexLibraryFile(folder, 'home', 'one.md'),
    indexLibraryFile(folder, 'home', 'two.md'),
  ]);
  assert.equal(await libraryIndexCount(folder, 'home'), 2);
  assert.equal((await searchLibrary(folder, 'home', 'indigo lantern'))[0]?.path, 'one.md');
  assert.equal((await searchLibrary(folder, 'home', 'copper orchard'))[0]?.path, 'two.md');
});

test('library search finds an exact phrase beyond sixty weaker indexed candidates', async () => {
  const folder = new MemoryDirectory();
  for (let index = 0; index < 60; index++) {
    const path = `notes/a-${String(index).padStart(2, '0')}.md`;
    await writeBlob(folder, `harness/projects/home/library/${path}`, new Blob(['A silver trail crosses the sky. Much later, a comet appears.']));
    await indexLibraryFile(folder, 'home', path);
  }
  await writeBlob(folder, 'harness/projects/home/library/notes/z-match.md', new Blob(['A silver comet crosses the sky.']));
  await indexLibraryFile(folder, 'home', 'notes/z-match.md');
  const progress = [];
  const hits = await searchLibrary(folder, 'home', 'silver comet', 2400, undefined, (checked, total, phase) => progress.push({ checked, total, phase }));
  assert.equal(hits[0]?.path, 'notes/z-match.md');
  assert.deepEqual(progress[0], { checked: 0, total: 61, phase: 'index' });
  assert.deepEqual(progress.at(-1), { checked: 61, total: 61, phase: 'verify' });
  const indexController = new AbortController();
  await assert.rejects(searchLibrary(folder, 'home', 'silver comet', 2400, indexController.signal, (checked, total, phase) => {
    if (phase === 'index' && checked === total) indexController.abort();
  }), error => error?.name === 'AbortError');
  const controller = new AbortController();
  await assert.rejects(searchLibrary(folder, 'home', 'silver comet', 2400, controller.signal, checked => {
    if (checked >= 20) controller.abort();
  }), error => error?.name === 'AbortError');
  const toolController = new AbortController();
  const toolSearch = browserFileTools(folder, scope, toolController.signal).execute('search_library', { query: 'silver comet' });
  toolController.abort();
  await assert.rejects(toolSearch, error => error?.name === 'AbortError');
});

test('library search can open an uploaded file by its path even when its body has no query words', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'harness/projects/home/library/docs/unique-outline.md', new Blob(['A copper moon rises above the harbor.']));
  await indexLibraryFile(folder, 'home', 'docs/unique-outline.md');
  const hits = await searchLibrary(folder, 'home', 'Please use library/docs/unique-outline.md');
  assert.equal(hits[0]?.path, 'docs/unique-outline.md');
  assert.match(hits[0]?.text || '', /copper moon/);
  const longPrompt = 'Explain several implementation details about project planning, hardware limits, context windows, model behavior, privacy guarantees, and offline storage. Please use library/docs/unique-outline.md';
  const longHits = await searchLibrary(folder, 'home', longPrompt);
  assert.equal(longHits[0]?.path, 'docs/unique-outline.md');
  await writeBlob(folder, 'harness/projects/home/library/docs/second note.md', new Blob(['Silver towers overlook a quiet sea.']));
  await indexLibraryFile(folder, 'home', 'docs/second note.md');
  const attached = await searchLibrary(folder, 'home', `${longPrompt}, library/docs/second note.md`);
  assert.deepEqual(new Set(attached.map(hit => hit.path)), new Set(['docs/unique-outline.md', 'docs/second note.md']));
});

test('large folders have stable pages and text search reaches files after the old 200-entry cap', async () => {
  const folder = new MemoryDirectory();
  for (let index = 249; index >= 0; index--) {
    const name = `file-${String(index).padStart(3, '0')}.ts`;
    await writeBlob(folder, `repositories/demo/${name}`, new Blob([index === 249 ? 'export const farawayMarker = true;' : `export const item = ${index};`]));
  }
  await writeBlob(folder, 'repositories/demo/node_modules/hidden.ts', new Blob(['farawayMarker']));
  const first = await listToolFilesPage(folder, scope, 'home', 'files');
  assert.equal(first.total, 250);
  assert.equal(first.entries.length, 200);
  assert.equal(first.entries[0].path, 'file-000.ts');
  assert.equal(first.nextOffset, 200);
  const second = await listToolFilesPage(folder, scope, 'home', 'files', '', first.nextOffset);
  assert.equal(second.entries.length, 50);
  assert.equal(second.entries.at(-1).path, 'file-249.ts');
  assert.equal(second.nextOffset, null);
  const tools = browserFileTools(folder, scope);
  const listed = JSON.parse(await tools.execute('list_files', { offset: 200 }));
  assert.equal(listed.entries[0].path, 'file-200.ts');
  assert.match(await searchToolFiles(folder, scope, 'home', 'files', 'farawayMarker'), /file-249\.ts/);
  await assert.rejects(listToolFilesPage(folder, scope, 'home', 'files', '', -1), /nonnegative integer/);
});

test('code search reports several bounded locations from one file', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'repositories/demo/src/app.ts', new Blob(['const marker = 1;\n// marker again\nconst marker = 3;\nconst marker = 4;\n']));
  const result = await searchToolFiles(folder, scope, 'home', 'files', 'marker', 'src');
  assert.match(result, /src\/app\.ts:1:7/);
  assert.match(result, /src\/app\.ts:2:4/);
  assert.match(result, /src\/app\.ts:3:7/);
  assert.doesNotMatch(result, /src\/app\.ts:4:7/);
  assert.equal(result.match(/src\/app\.ts:/g)?.length, 3);
  assert.match(result, /Some files have more matches/);
});

test('file search continues beyond one thousand files and includes text dotfiles', async () => {
  const folder = new MemoryDirectory();
  for (let index = 0; index < 1001; index++) {
    await writeBlob(folder, `repositories/demo/src/file-${String(index).padStart(4, '0')}.ts`, new Blob([index === 1000 ? 'const markerBeyondLimit = true;' : 'const unrelated = true;']));
  }
  await writeBlob(folder, 'repositories/demo/src/.prettierrc', new Blob(['dotfileMarker']));
  const first = await searchToolFiles(folder, scope, 'home', 'files', 'markerBeyondLimit', 'src');
  assert.match(first, /Continue with offset 1000/);
  assert.doesNotMatch(first, /file-1000\.ts/);
  const second = await searchToolFiles(folder, scope, 'home', 'files', 'markerBeyondLimit', 'src', undefined, 1000);
  assert.match(second, /file-1000\.ts/);
  const tools = browserFileTools(folder, scope);
  assert.match(await tools.execute('search_files', { query: 'markerBeyondLimit', path: 'src', offset: 0 }), /Continue with offset 1000/);
  assert.match(await tools.execute('search_files', { query: 'markerBeyondLimit', path: 'src', offset: 1000 }), /file-1000\.ts/);
  assert.match(await searchToolFiles(folder, scope, 'home', 'files', 'dotfileMarker', 'src'), /\.prettierrc/);
  await assert.rejects(searchToolFiles(folder, scope, 'home', 'files', 'markerBeyondLimit', 'src', undefined, -1), /offset/);
});

test('stopping a tool file search interrupts a repository scan', async () => {
  const folder = new MemoryDirectory();
  await writeBlob(folder, 'repositories/demo/src/first.ts', new Blob(['const needle = true;']));
  await writeBlob(folder, 'repositories/demo/src/second.ts', new Blob(['const needle = true;']));
  const controller = new AbortController();
  const directory = await folder.getDirectoryHandle('repositories').then(handle => handle.getDirectoryHandle('demo')).then(handle => handle.getDirectoryHandle('src'));
  const first = await directory.getFileHandle('first.ts');
  const getFile = first.getFile.bind(first);
  first.getFile = async () => { const file = await getFile(); controller.abort(new DOMException('Stopped.', 'AbortError')); return file; };
  const tools = browserFileTools(folder, scope, controller.signal);
  await assert.rejects(tools.execute('search_files', { query: 'needle', path: 'src' }), error => error?.name === 'AbortError');
});
