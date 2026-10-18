import type { PromiseFsClient } from 'isomorphic-git';
import type { HarnessProject } from './harnessData.ts';

type FileLikeStats = {
  size: number; mode: number; mtimeMs: number; ctimeMs: number; mtime: Date; ctime: Date;
  isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean;
};
export type GitChange = { path: string; head: number; workdir: number; stage: number; staged: boolean; unstaged: boolean; label: string };
export type GitState = { repository: boolean; branch: string; branches: string[]; changes: GitChange[]; recent: { oid: string; message: string; author: string; date: string }[] };
export type GitDiff = { path: string; staged: string; unstaged: string };
export type GitHistoryPage = { commits: GitState['recent']; nextOffset: number | null };
const MAX_DIFF_FILE_BYTES = 200_000;
const MAX_DIFF_CHARS = 16_000;
async function loadGit() {
  const { Buffer } = await import('buffer');
  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ||= Buffer;
  return import('isomorphic-git');
}

function fsError(cause: unknown, path: string): Error & { code: string } {
  if (cause instanceof Error && typeof (cause as { code?: unknown }).code === 'string') return cause as Error & { code: string };
  const name = cause instanceof DOMException ? cause.name : '';
  const code = name === 'NotFoundError' ? 'ENOENT' : name === 'TypeMismatchError' ? 'ENOTDIR' : name === 'NoModificationAllowedError' ? 'EACCES' : 'EIO';
  return Object.assign(new Error(`${code}: ${path}`), { code, cause });
}
function nodeError(code: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}
function partsOf(path: string): string[] {
  if (!path.startsWith('/') || path.includes('\\')) throw nodeError('EINVAL', path);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw nodeError('EACCES', path); parts.pop(); }
    else if (/[\x00-\x1f]/.test(part)) throw nodeError('EINVAL', path);
    else parts.push(part);
  }
  return parts;
}
async function atDirectory(root: FileSystemDirectoryHandle, parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}
async function handleAt(root: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemHandle> {
  if (!parts.length) return root;
  const parent = await atDirectory(root, parts.slice(0, -1));
  try { return await parent.getFileHandle(parts.at(-1)!); }
  catch (error) { if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') {
    try { return await parent.getDirectoryHandle(parts.at(-1)!); }
    catch (other) { throw fsError(other, parts.join('/')); }
  } }
  return parent.getDirectoryHandle(parts.at(-1)!);
}
function stats(kind: 'file' | 'directory', size = 0, modified = 0): FileLikeStats {
  const date = new Date(modified);
  return { size, mode: kind === 'file' ? 0o100644 : 0o040755, mtimeMs: modified, ctimeMs: modified, mtime: date, ctime: date,
    isFile: () => kind === 'file', isDirectory: () => kind === 'directory', isSymbolicLink: () => false };
}

export function gitFileSystem(root: FileSystemDirectoryHandle, allowedDir = '/'): PromiseFsClient {
  const allowed = partsOf(allowedDir);
  const checkedParts = (path: string) => {
    const parts = partsOf(path);
    if (allowed.some((part, index) => parts[index] !== part)) throw nodeError('EACCES', path);
    return parts;
  };
  const file = async (path: string) => {
    const parts = checkedParts(path);
    try { return await (await atDirectory(root, parts.slice(0, -1))).getFileHandle(parts.at(-1)!); }
    catch (error) { throw fsError(error, path); }
  };
  return { promises: {
    async readFile(path: string, options?: string | { encoding?: string }) {
      const blob = await (await file(path)).getFile();
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? blob.text() : new Uint8Array(await blob.arrayBuffer());
    },
    async writeFile(path: string, data: string | Uint8Array) {
      const handle = await (async () => {
        const parts = checkedParts(path);
        try { return await (await atDirectory(root, parts.slice(0, -1))).getFileHandle(parts.at(-1)!, { create: true }); }
        catch (error) { throw fsError(error, path); }
      })();
      const writer = await handle.createWritable();
      try { const content = typeof data === 'string' ? data : new Uint8Array(data); await writer.write(content); } finally { await writer.close(); }
    },
    async unlink(path: string) {
      const parts = checkedParts(path);
      try { await (await atDirectory(root, parts.slice(0, -1))).removeEntry(parts.at(-1)!); }
      catch (error) { throw fsError(error, path); }
    },
    async readdir(path: string) {
      try {
        const dir = await atDirectory(root, checkedParts(path));
        const names: string[] = [];
        for await (const [name] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) names.push(name);
        return names;
      } catch (error) { throw fsError(error, path); }
    },
    async mkdir(path: string) {
      const parts = checkedParts(path);
      try {
        const parent = await atDirectory(root, parts.slice(0, -1));
        try { await parent.getDirectoryHandle(parts.at(-1)!); throw nodeError('EEXIST', path); }
        catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
        await parent.getDirectoryHandle(parts.at(-1)!, { create: true });
      } catch (error) { if (typeof (error as { code?: unknown }).code === 'string') throw error; throw fsError(error, path); }
    },
    async rmdir(path: string) {
      const parts = checkedParts(path);
      try { await (await atDirectory(root, parts.slice(0, -1))).removeEntry(parts.at(-1)!); }
      catch (error) { throw fsError(error, path); }
    },
    async readlink(path: string) { throw nodeError('ENOSYS', path); },
    async symlink(_target: string, path: string) { throw nodeError('ENOSYS', path); },
    async stat(path: string) {
      try { const handle = await handleAt(root, checkedParts(path)); const blob = handle.kind === 'file' ? await (handle as FileSystemFileHandle).getFile() : null; return stats(handle.kind, blob?.size, blob?.lastModified); }
      catch (error) { if (typeof (error as { code?: unknown }).code === 'string') throw error; throw fsError(error, path); }
    },
    async lstat(path: string) {
      try { const handle = await handleAt(root, checkedParts(path)); const blob = handle.kind === 'file' ? await (handle as FileSystemFileHandle).getFile() : null; return stats(handle.kind, blob?.size, blob?.lastModified); }
      catch (error) { if (typeof (error as { code?: unknown }).code === 'string') throw error; throw fsError(error, path); }
    },
  } };
}

export function projectGitDir(project: HarnessProject): string {
  const path = project.filesPath || '';
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part) || /^(\.git|\.hg|\.svn|node_modules)$/i.test(part)) || /^(harness|models|engines)$/i.test(parts[0])) throw new Error('Map this project to a relative code folder before using Git.');
  return `/${parts.join('/')}`;
}
export async function gitState(folder: FileSystemDirectoryHandle, project: HarnessProject): Promise<GitState> {
  const dir = projectGitDir(project);
  const fs = gitFileSystem(folder, dir);
  try { await fs.promises.stat(`${dir}/.git`); }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') return { repository: false, branch: '', branches: [], changes: [], recent: [] }; throw error; }
  const git = await loadGit();
  const [branch, branches, matrix, history] = await Promise.all([
    git.currentBranch({ fs, dir }), git.listBranches({ fs, dir }), git.statusMatrix({ fs, dir, refresh: false }),
    git.log({ fs, dir, depth: 5 }).catch(error => { if ((error as { code?: string }).code === 'NotFoundError') return []; throw error; }),
  ]);
  const changes = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1)).map(([path, head, workdir, stage]) => ({
    path, head, workdir, stage, staged: head !== stage, unstaged: workdir !== stage,
    label: head === 0 ? 'New' : workdir === 0 ? 'Deleted' : 'Modified',
  }));
  return { repository: true, branch: branch || (history.length ? 'Detached HEAD' : 'main'), branches, changes, recent: history.map(item => ({ oid: item.oid, message: item.commit.message.trim(), author: item.commit.author.name, date: new Date(item.commit.author.timestamp * 1000).toISOString() })) };
}

function branchName(value: string): string {
  const name = value.trim();
  if (name.length > 120 || !name || name.includes('..') || name.includes('@{') || name.split('/').some(part => !/^[a-z0-9][a-z0-9._-]*$/i.test(part) || part.endsWith('.') || part.endsWith('.lock'))) {
    throw new Error('Use a branch name made of letters, numbers, dots, dashes, underscores, and slashes.');
  }
  return name;
}

/** Branch checkout changes project files, so refuse it while anything is uncommitted. */
export async function gitCheckoutBranch(folder: FileSystemDirectoryHandle, project: HarnessProject, branch: string): Promise<void> {
  const ref = branchName(branch);
  const state = await gitState(folder, project);
  if (!state.repository) throw new Error('This project does not have a Git repository.');
  if (!state.branches.includes(ref)) throw new Error(`Branch ${ref} does not exist in this repository.`);
  if (state.branch === ref) return;
  if (state.changes.length) throw new Error('Commit, stash externally, or remove local changes before switching branches.');
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir), git = await loadGit();
  await git.checkout({ fs, dir, ref, force: false, nonBlocking: true });
}

export async function gitCreateBranch(folder: FileSystemDirectoryHandle, project: HarnessProject, branch: string): Promise<void> {
  const ref = branchName(branch);
  const state = await gitState(folder, project);
  if (!state.repository) throw new Error('This project does not have a Git repository.');
  if (!state.recent.length) throw new Error('Create the first commit before making a branch.');
  if (state.changes.length) throw new Error('Commit, stash externally, or remove local changes before creating and switching branches.');
  if (state.branches.includes(ref)) throw new Error(`Branch ${ref} already exists.`);
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir), git = await loadGit();
  await git.branch({ fs, dir, ref });
  await git.checkout({ fs, dir, ref, force: false, nonBlocking: true });
}

/** Let an agent prepare a branch without changing the user's open files. */
export async function gitPrepareBranch(folder: FileSystemDirectoryHandle, project: HarnessProject, branch: string): Promise<void> {
  const ref = branchName(branch);
  const state = await gitState(folder, project);
  if (!state.repository) throw new Error('This project does not have a Git repository.');
  if (!state.recent.length) throw new Error('Create the first commit before making a branch.');
  if (state.branches.includes(ref)) throw new Error(`Branch ${ref} already exists.`);
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir), git = await loadGit();
  await git.branch({ fs, dir, ref });
}
/** Read bounded commit metadata without scanning the working tree. */
export async function gitHistory(folder: FileSystemDirectoryHandle, project: HarnessProject, offset = 0): Promise<GitHistoryPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 200) throw new Error('Git history offset must be an integer from 0 to 200.');
  const dir = projectGitDir(project);
  const fs = gitFileSystem(folder, dir);
  try { await fs.promises.stat(`${dir}/.git`); }
  catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw new Error('This project does not have a Git repository.');
    throw error;
  }
  const git = await loadGit();
  const pageSize = 10;
  const history = await git.log({ fs, dir, depth: offset + pageSize + 1 })
    .catch(error => { if ((error as { code?: string }).code === 'NotFoundError') return []; throw error; });
  const commits = history.slice(offset, offset + pageSize).map(item => ({
    oid: item.oid,
    message: item.commit.message.trim().slice(0, 500),
    author: item.commit.author.name.slice(0, 120),
    date: new Date(item.commit.author.timestamp * 1000).toISOString(),
  }));
  return { commits, nextOffset: history.length > offset + pageSize ? offset + pageSize : null };
}
function diffLines(before: string, after: string, oldLabel: string, newLabel: string): string {
  if (before === after) return 'No changes.';
  const oldLines = before ? before.split('\n') : [], newLines = after ? after.split('\n') : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  if (oldMiddle.length * newMiddle.length > 120_000) {
    const preview = (lines: string[], marker: string) => lines.slice(0, 35).map(line => `${marker}${line.slice(0, 400)}`).join('\n') + (lines.length > 35 ? `\n[${lines.length - 35} ${marker === '-' ? 'old' : 'new'} lines omitted]` : '');
    return `--- ${oldLabel}\n+++ ${newLabel}\n@@ around line ${prefix + 1} · large change preview @@\n${preview(oldMiddle, '-')}\n${preview(newMiddle, '+')}\n[Large change; open the file for more context.]`;
  }
  const cols = newMiddle.length + 1;
  const counts = new Uint16Array((oldMiddle.length + 1) * cols);
  for (let i = oldMiddle.length - 1; i >= 0; i--) for (let j = newMiddle.length - 1; j >= 0; j--) counts[i * cols + j] = oldMiddle[i] === newMiddle[j] ? counts[(i + 1) * cols + j + 1] + 1 : Math.max(counts[(i + 1) * cols + j], counts[i * cols + j + 1]);
  const lines: string[] = [];
  let outputChars = 0;
  const push = (line: string) => { const bounded = line.length > 2000 ? `${line.slice(0, 2000)} [line truncated]` : line; lines.push(bounded); outputChars += bounded.length + 1; };
  const start = Math.max(0, prefix - 3);
  for (const line of oldLines.slice(start, prefix)) push(` ${line}`);
  let i = 0, j = 0;
  while (i < oldMiddle.length || j < newMiddle.length) {
    if (i < oldMiddle.length && j < newMiddle.length && oldMiddle[i] === newMiddle[j]) { push(` ${oldMiddle[i]}`); i++; j++; }
    else if (j < newMiddle.length && (i === oldMiddle.length || counts[i * cols + j + 1] > counts[(i + 1) * cols + j])) push(`+${newMiddle[j++]}`);
    else push(`-${oldMiddle[i++]}`);
    if (outputChars > MAX_DIFF_CHARS) { push('[Diff truncated; open the file for more context.]'); break; }
  }
  if (outputChars <= MAX_DIFF_CHARS) {
    for (const line of oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 3)) push(` ${line}`);
  }
  return `--- ${oldLabel}\n+++ ${newLabel}\n@@ -${start + 1},${oldLines.length - start - Math.max(0, suffix - 3)} +${start + 1},${newLines.length - start - Math.max(0, suffix - 3)} @@\n${lines.join('\n')}`;
}
export async function gitDiff(folder: FileSystemDirectoryHandle, project: HarnessProject, path: string): Promise<GitDiff> {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part) || /^(\.git|\.hg|\.svn|node_modules)$/i.test(part))) throw new Error('Choose a relative file outside repository internals.');
  const dir = projectGitDir(project), state = await gitState(folder, project);
  if (!state.repository) throw new Error('This project does not have a Git repository.');
  const change = state.changes.find(item => item.path === path);
  if (!change) throw new Error('This file has no Git changes.');
  const fs = gitFileSystem(folder, dir), git = await loadGit();
  const readObject = async (oid: string | undefined): Promise<string> => {
    if (!oid) return '';
    const { blob } = await git.readBlob({ fs, dir, oid });
    if (blob.byteLength > MAX_DIFF_FILE_BYTES) throw new Error('Diff is limited to text files up to 200 KB.');
    if (blob.includes(0)) throw new Error('This file appears to be binary.');
    return new TextDecoder('utf-8', { fatal: true }).decode(blob);
  };
  let head = '';
  if (change.head) {
    const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const { blob } = await git.readBlob({ fs, dir, oid, filepath: path });
    if (blob.byteLength > MAX_DIFF_FILE_BYTES) throw new Error('Diff is limited to text files up to 200 KB.');
    if (blob.includes(0)) throw new Error('This file appears to be binary.');
    head = new TextDecoder('utf-8', { fatal: true }).decode(blob);
  }
  const stageOids = await git.walk({ fs, dir, trees: [git.STAGE()], map: async (filepath, [entry]) => {
    if (filepath !== path && !path.startsWith(`${filepath}/`) && filepath !== '.') return null;
    return filepath === path && entry && await entry.type() === 'blob' ? await entry.oid() : undefined;
  } }) as string[];
  const staged = await readObject(stageOids.find(Boolean));
  let workdir = '';
  if (change.workdir) {
    const handle = await (await atDirectory(folder, [...partsOf(dir), ...parts.slice(0, -1)])).getFileHandle(parts.at(-1)!);
    const file = await handle.getFile();
    if (file.size > MAX_DIFF_FILE_BYTES) throw new Error('Diff is limited to text files up to 200 KB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) throw new Error('This file appears to be binary.');
    workdir = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return { path, staged: change.staged ? diffLines(head, staged, `HEAD/${path}`, `index/${path}`) : '', unstaged: change.unstaged ? diffLines(staged, workdir, `index/${path}`, `worktree/${path}`) : '' };
}
export async function gitInit(folder: FileSystemDirectoryHandle, project: HarnessProject): Promise<void> {
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const parts = partsOf(dir);
  let current = folder;
  for (let depth = 0; depth <= parts.length; depth++) {
    const existingRepoError = () => depth === parts.length
      ? new Error('This project already has a Git repository.')
      : depth === 0
        ? new Error('The workspace root is already a Git repository. Choose a workspace outside it for separate project repositories.')
        : new Error(`This folder is inside a Git repository at ${parts.slice(0, depth).join('/')}. Map the project to that repository root.`);
    try {
      await current.getDirectoryHandle('.git');
      throw existingRepoError();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TypeMismatchError') throw existingRepoError();
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    if (depth === parts.length) break;
    try { current = await current.getDirectoryHandle(parts[depth]); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      break;
    }
  }
  await atDirectory(folder, parts, true);
  const git = await loadGit();
  await git.init({ fs, dir, defaultBranch: 'main' });
}
export async function gitStage(folder: FileSystemDirectoryHandle, project: HarnessProject, change: GitChange): Promise<void> {
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const git = await loadGit();
  if (change.workdir === 0) await git.remove({ fs, dir, filepath: change.path });
  else await git.add({ fs, dir, filepath: change.path });
}
export async function gitUnstage(folder: FileSystemDirectoryHandle, project: HarnessProject, change: GitChange): Promise<void> {
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const git = await loadGit();
  if (change.head === 0) await git.remove({ fs, dir, filepath: change.path });
  else await git.resetIndex({ fs, dir, filepath: change.path });
}
export async function gitCommit(folder: FileSystemDirectoryHandle, project: HarnessProject, message: string, name: string, email: string): Promise<string> {
  if (!message.trim() || !name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter a commit message, author name, and email.');
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const git = await loadGit();
  return git.commit({ fs, dir, message: message.trim(), author: { name: name.trim(), email: email.trim() } });
}
