import type { BrowserTools } from './browserModel.ts';
import { readBlob, writeBlob } from './storage.ts';
import { parseReadOnlyShell, shellCommandPermission } from './harnessShell.ts';
import { isMutatingToolName } from './harnessToolActions.ts';
import { assertToolAllowed } from './harnessToolPermissions.ts';
import type { HarnessProject, ToolPolicyProfile } from './harnessData.ts';
import type { GitState } from './harnessGit.ts';
import { applyUnifiedPatch } from './harnessPatch.ts';

export type ToolArea = 'files' | 'library' | 'workspace';
export type ToolScope = { projects: HarnessProject[]; workspaceAccess: boolean; workspaceReadOnly?: boolean; defaultProjectId: string; workspaceProjects?: HarnessProject[]; toolProfiles?: ToolPolicyProfile[]; agentId?: string; conversationId?: string; conversationProfileId?: string; conversationPermissions?: HarnessProject['toolPermissions']; conversationApprovedTools?: string[] };
export type ToolBackup = { version: 1; id: string; createdAt: string; projectId: string; area: ToolArea; path: string; fullPath: string; bytes: number; sha256: string };
export type ToolFileEntry = { path: string; kind: 'file' | 'directory'; bytes?: number };
export type ToolFilePage = { entries: ToolFileEntry[]; nextOffset: number | null; total: number };
export function pageGitStatus(state: GitState, offset = 0): GitState & { totalChanges: number; nextOffset: number | null; moreChanges: number } {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Git status offset must be a nonnegative integer.');
  const size = 100;
  const changes = state.changes.slice(offset, offset + size);
  const nextOffset = offset + changes.length < state.changes.length ? offset + changes.length : null;
  return { ...state, changes, recent: offset ? [] : state.recent, totalChanges: state.changes.length, nextOffset, moreChanges: Math.max(0, state.changes.length - offset - changes.length) };
}
const TEXT_EXTENSIONS = /(?:\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|txt|css|scss|sass|less|html|svg|vue|svelte|astro|py|rs|go|java|kt|kts|swift|dart|rb|php|c|cc|cpp|h|hpp|cs|fs|ex|exs|erl|lua|r|jl|sh|bash|zsh|fish|ps1|toml|yaml|yml|xml|csv|sql|graphql|gql|proto|ini|cfg|conf|gradle|gitignore|env\.example)|(?:^|\/)(?:Dockerfile|Makefile|Justfile|LICENSE|NOTICE|Gemfile|Procfile))$/i;
const RESERVED_PARTS = new Set(['.git', '.hg', '.svn', 'node_modules']);

function safeParts(path: string): string[] {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part) || RESERVED_PARTS.has(part.toLowerCase()))) throw new Error('Use a relative path outside repository internals and dependencies.');
  return parts;
}
function withinReadOnlyCodeFolder(scope: ToolScope, path: string): boolean {
  const lower = path.toLowerCase();
  return (scope.workspaceProjects || scope.projects).some(project => {
    if (project.toolAccess !== 'read-only' || !project.filesPath) return false;
    const root = project.filesPath.toLowerCase().replace(/\/$/, '');
    return lower === root || lower.startsWith(`${root}/`);
  });
}
function rootFor(scope: ToolScope, projectId: string, area: ToolArea): string {
  if (area === 'workspace') {
    if (!scope.workspaceAccess) throw new Error('This agent does not have workspace access.');
    return '';
  }
  const project = scope.projects.find(item => item.id === projectId);
  if (!project) throw new Error('This project is outside the agent’s scope.');
  if (area === 'files' && project.filesPath) {
    const parts = safeParts(project.filesPath);
    if (/^(harness|models|engines|\.git|node_modules)$/i.test(parts[0])) throw new Error('Choose a code folder outside the app, model, and Git internals.');
    return parts.join('/');
  }
  return `harness/projects/${projectId}/${area}`;
}
function pathFor(scope: ToolScope, projectId: string, area: ToolArea, path: string): string {
  safeParts(path);
  return [rootFor(scope, projectId, area), path].filter(Boolean).join('/');
}
export function toolFilePath(scope: ToolScope, projectId: string, area: ToolArea, path: string): string {
  return pathFor(scope, projectId, area, path);
}
/** Choose a new file name for uploads so adding a file never replaces an existing project file. */
export async function unusedToolFilePath(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string): Promise<string> {
  safeParts(path);
  const slash = path.lastIndexOf('/');
  const directory = path.slice(0, slash + 1);
  const filename = path.slice(slash + 1);
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let index = 0; index < 100; index++) {
    const candidate = index ? `${directory}${stem} (${index + 1})${extension}` : path;
    try { await readBlob(folder, pathFor(scope, projectId, area, candidate)); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return candidate; throw error; }
  }
  throw new Error(`Too many files named ${filename}. Rename the upload and try again.`);
}
async function directory(folder: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let current = folder;
  if (!path) return current;
  for (const part of safeParts(path)) current = await current.getDirectoryHandle(part, { create });
  return current;
}
export async function listToolFilesPage(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea = 'files', subpath = '', offset = 0, limit = 200): Promise<ToolFilePage> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('File list offset must be a nonnegative integer.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('File list page size must be between 1 and 200.');
  const root = rootFor(scope, projectId, area);
  let target: FileSystemDirectoryHandle;
  try { target = await directory(folder, [root, subpath].filter(Boolean).join('/')); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return { entries: [], nextOffset: null, total: 0 }; throw error; }
  const visible: { name: string; handle: FileSystemHandle }[] = [];
  for await (const [name, handle] of (target as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (RESERVED_PARTS.has(name.toLowerCase())) continue;
    visible.push({ name, handle });
  }
  visible.sort((a, b) => a.handle.kind.localeCompare(b.handle.kind) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));
  const entries: ToolFileEntry[] = [];
  for (const { name, handle } of visible.slice(offset, offset + limit)) {
    const path = [subpath, name].filter(Boolean).join('/');
    entries.push(handle.kind === 'file' ? { path, kind: 'file', bytes: (await (handle as FileSystemFileHandle).getFile()).size } : { path, kind: 'directory' });
  }
  return { entries, nextOffset: offset + entries.length < visible.length ? offset + entries.length : null, total: visible.length };
}
export async function listToolFiles(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea = 'files', subpath = ''): Promise<ToolFileEntry[]> {
  return (await listToolFilesPage(folder, scope, projectId, area, subpath)).entries;
}
export async function readToolFile(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, offset = 0, length = 12000): Promise<string> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('File read offset must be a nonnegative integer.');
  if (!Number.isSafeInteger(length) || length < 1 || length > 16000) throw new Error('File read length must be between 1 and 16000 bytes.');
  const full = pathFor(scope, projectId, area, path);
  if (!TEXT_EXTENSIONS.test(path) && !path.split('/').at(-1)?.startsWith('.')) throw new Error('This tool reads text files. Download binary files from the project library.');
  const file = await readBlob(folder, full);
  const from = Math.min(file.size, offset);
  // A requested byte may fall inside a multibyte character. Read three extra
  // bytes on either side so the model receives complete UTF-8 characters.
  const probeFrom = Math.max(0, from - 3);
  const requestedEnd = Math.min(file.size, from + length);
  const bytes = new Uint8Array(await file.slice(probeFrom, Math.min(file.size, requestedEnd + 3)).arrayBuffer());
  let start = from - probeFrom;
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
  let end = requestedEnd - probeFrom;
  while (probeFrom + end < file.size && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++;
  const actualFrom = probeFrom + start;
  const actualEnd = probeFrom + end;
  const content = new TextDecoder().decode(bytes.subarray(start, end));
  return `${area}/${path} · bytes ${actualFrom}–${actualEnd} of ${file.size}\n${content}${actualEnd < file.size ? `\n[More available; read with offset ${actualEnd}.]` : ''}`;
}
async function digest(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const backupRoot = 'harness/history';
const validBackupId = (id: string) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(id);
async function backup(folder: FileSystemDirectoryHandle, full: string, source: { projectId: string; area: ToolArea; path: string }, expectedOriginal?: string, expectedHash?: string): Promise<string | null> {
  try {
    const original = await readBlob(folder, full);
    if (original.size > 2_000_000) throw new Error('Large files must be edited outside the browser tool.');
    if (expectedOriginal !== undefined && await original.text() !== expectedOriginal) throw new Error('The file changed after it was read. Read it again before editing.');
    if (expectedHash !== undefined && await digest(original) !== expectedHash) throw new Error('The file changed after it was inspected. Inspect it again before restoring.');
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
    const savedPath = `${backupRoot}/${id}.bak`;
    const meta: ToolBackup = { version: 1, id, createdAt, ...source, fullPath: full, bytes: original.size, sha256: await digest(original) };
    await writeBlob(folder, savedPath, original);
    await writeBlob(folder, `${backupRoot}/${id}.json`, new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    return savedPath;
  } catch (error) { if (expectedOriginal !== undefined || expectedHash !== undefined || !(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  return null;
}
function validateBackup(scope: ToolScope, projectId: string, area: ToolArea, value: unknown): ToolBackup {
  const record = value as Partial<ToolBackup> | null;
  if (!record || record.version !== 1 || typeof record.id !== 'string' || !validBackupId(record.id) ||
      record.projectId !== projectId || record.area !== area || typeof record.path !== 'string' ||
      typeof record.fullPath !== 'string' || typeof record.createdAt !== 'string' ||
      !Number.isInteger(record.bytes) || (record.bytes ?? -1) < 0 ||
      typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('This backup does not belong to the selected project and area.');
  if (mutablePath(scope, projectId, area, record.path) !== record.fullPath) throw new Error('The project file mapping changed since this backup was saved.');
  return record as ToolBackup;
}
export async function listToolBackups(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, limit = 50): Promise<ToolBackup[]> {
  let history: FileSystemDirectoryHandle;
  try { history = await directory(folder, backupRoot); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return []; throw error; }
  const names: string[] = [];
  for await (const [name, handle] of (history as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file' && validBackupId(name.slice(0, -5)) && name.endsWith('.json')) names.push(name);
  }
  names.sort((a, b) => b.localeCompare(a));
  const results: ToolBackup[] = [];
  for (const name of names) {
    try {
      const file = await (await history.getFileHandle(name)).getFile();
      const record = validateBackup(scope, projectId, area, JSON.parse(await file.text()));
      if (`${record.id}.json` === name) results.push(record);
    } catch { /* Ignore unrelated, older, or damaged entries. */ }
    if (results.length >= Math.max(1, Math.min(100, limit))) break;
  }
  return results;
}
export async function readToolBackup(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, id: string): Promise<{ record: ToolBackup; copy: File }> {
  if (!validBackupId(id)) throw new Error('Invalid backup ID.');
  const record = validateBackup(scope, projectId, area, JSON.parse(await (await readBlob(folder, `${backupRoot}/${id}.json`)).text()));
  if (record.id !== id) throw new Error('Backup metadata does not match its file.');
  const copy = await readBlob(folder, `${backupRoot}/${id}.bak`);
  if (copy.size !== record.bytes || await digest(copy) !== record.sha256) throw new Error('The backup copy is incomplete or damaged.');
  return { record, copy };
}
export async function restoreToolBackup(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, id: string, overwrite = false, expectedCurrentSha256?: string): Promise<string> {
  const { record, copy } = await readToolBackup(folder, scope, projectId, area, id);
  let existing: File | null = null;
  try { existing = await readBlob(folder, record.fullPath); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  if (expectedCurrentSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(expectedCurrentSha256)) throw new Error('Expected current SHA-256 must be a 64-character lowercase hex value.');
    if (!existing || await digest(existing) !== expectedCurrentSha256) throw new Error('The file changed after it was inspected. Inspect it again before restoring.');
  }
  if (existing && !overwrite) throw new Error('The file still exists. Confirm replacement before restoring.');
  if (existing) await backup(folder, record.fullPath, { projectId, area, path: record.path }, undefined, expectedCurrentSha256);
  await writeBlob(folder, record.fullPath, copy);
  if (area === 'library') {
    const { indexLibraryFile, indexableLibraryPath } = await import('./harnessLibrary.ts');
    if (indexableLibraryPath(record.path)) await indexLibraryFile(folder, projectId, record.path);
  }
  return `Restored ${record.fullPath} from ${backupRoot}/${id}.bak.`;
}
function mutablePath(scope: ToolScope, projectId: string, area: ToolArea, path: string): string {
  if (area === 'workspace' && /^(models|engines|harness|\.git|node_modules)(\/|$)/i.test(path)) throw new Error('App, model, engine, and Git internals are managed separately.');
  return pathFor(scope, projectId, area, path);
}
async function removeFile(folder: FileSystemDirectoryHandle, full: string): Promise<void> {
  const parts = full.split('/');
  const name = parts.pop()!;
  const parent = await directory(folder, parts.join('/'));
  await parent.getFileHandle(name);
  await parent.removeEntry(name);
}
export async function writeToolFile(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, content: string, expectedOriginal?: string): Promise<string> {
  if (!TEXT_EXTENSIONS.test(path) && !path.split('/').at(-1)?.startsWith('.')) throw new Error('Choose a text or code file extension.');
  if (new Blob([content]).size > 200_000) throw new Error('Tool writes are limited to 200 KB at a time.');
  const full = mutablePath(scope, projectId, area, path);
  const savedPath = await backup(folder, full, { projectId, area, path }, expectedOriginal);
  await writeBlob(folder, full, new Blob([content], { type: 'text/plain' }));
  return `Wrote ${full} (${new Blob([content]).size} bytes).${savedPath ? ` Previous version: ${savedPath}.` : ''}`;
}
export async function deleteToolFile(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string): Promise<string> {
  const full = mutablePath(scope, projectId, area, path);
  await readBlob(folder, full);
  const savedPath = await backup(folder, full, { projectId, area, path });
  if (!savedPath) throw new Error('The file changed before it could be backed up.');
  await removeFile(folder, full);
  return `Removed ${full}. Backup: ${savedPath}.`;
}
export async function moveToolFile(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, destination: string): Promise<string> {
  const from = mutablePath(scope, projectId, area, path);
  const to = mutablePath(scope, projectId, area, destination);
  if (from === to) throw new Error('Choose a different destination path.');
  const file = await readBlob(folder, from);
  if (file.size > 2_000_000) throw new Error('Large files must be moved outside the browser tool.');
  try { await readBlob(folder, to); throw new Error('The destination already exists. Choose another path.'); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  const savedPath = await backup(folder, from, { projectId, area, path });
  if (!savedPath) throw new Error('The source changed before it could be backed up.');
  await writeBlob(folder, to, file);
  await removeFile(folder, from);
  return `Moved ${from} to ${to}. Backup: ${savedPath}.`;
}
export async function replaceToolText(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, search: string, replacement: string): Promise<string> {
  if (!search || search.length > 30000 || replacement.length > 30000) throw new Error('Give a nonempty search string and bounded replacement.');
  const full = pathFor(scope, projectId, area, path);
  const file = await readBlob(folder, full);
  if (file.size > 2_000_000) throw new Error('Large files must be edited outside the browser tool.');
  const text = await file.text();
  const at = text.indexOf(search);
  if (at < 0) throw new Error('Exact text was not found. Read the current file first.');
  if (text.indexOf(search, at + search.length) >= 0) throw new Error('The search text appears more than once. Supply a more specific span.');
  return writeToolFile(folder, scope, projectId, area, path, text.slice(0, at) + replacement + text.slice(at + search.length), text);
}
export async function replaceManyToolText(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, edits: { search: string; replacement: string }[]): Promise<string> {
  if (!Array.isArray(edits) || !edits.length || edits.length > 16) throw new Error('Give between 1 and 16 exact replacements.');
  const full = pathFor(scope, projectId, area, path);
  const file = await readBlob(folder, full);
  if (file.size > 2_000_000) throw new Error('Large files must be edited outside the browser tool.');
  const text = await file.text();
  const spans = edits.map((edit, index) => {
    if (typeof edit?.search !== 'string' || !edit.search || edit.search.length > 30000 || typeof edit.replacement !== 'string' || edit.replacement.length > 30000) throw new Error(`Edit ${index + 1} needs bounded search and replacement text.`);
    const start = text.indexOf(edit.search);
    if (start < 0) throw new Error(`Edit ${index + 1}: exact text was not found. Read the current file first.`);
    if (text.indexOf(edit.search, start + edit.search.length) >= 0) throw new Error(`Edit ${index + 1}: the search text appears more than once. Supply a more specific span.`);
    return { start, end: start + edit.search.length, replacement: edit.replacement };
  }).sort((a, b) => a.start - b.start);
  if (spans.some((span, index) => index > 0 && span.start < spans[index - 1].end)) throw new Error('Edits overlap. Supply separate, non-overlapping spans.');
  let result = '', cursor = 0;
  for (const span of spans) { result += text.slice(cursor, span.start) + span.replacement; cursor = span.end; }
  result += text.slice(cursor);
  const written = await writeToolFile(folder, scope, projectId, area, path, result, text);
  return `${written} Applied ${spans.length} exact replacements.`;
}
export async function applyToolPatch(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, path: string, patch: string): Promise<string> {
  const full = mutablePath(scope, projectId, area, path);
  if (!TEXT_EXTENSIONS.test(path) && !path.split('/').at(-1)?.startsWith('.')) throw new Error('Choose a text or code file extension.');
  const file = await readBlob(folder, full);
  if (file.size > 2_000_000) throw new Error('Large files must be edited outside the browser tool.');
  const original = await file.text();
  const updated = applyUnifiedPatch(original, patch);
  return `${await writeToolFile(folder, scope, projectId, area, path, updated, original)} Applied unified patch.`;
}
export async function searchToolFiles(folder: FileSystemDirectoryHandle, scope: ToolScope, projectId: string, area: ToolArea, query: string, path = '', signal?: AbortSignal, offset = 0): Promise<string> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2 || needle.length > 200) throw new Error('Use a search phrase between 2 and 200 characters.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('File search offset must be a nonnegative integer.');
  if (path) safeParts(path);
  const checkCancelled = () => { if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError'); };
  const pending: { path: string; offset: number }[] = [{ path, offset: 0 }];
  const matches: string[] = [];
  let inspected = 0, bytesRead = 0, limited = false, moreInFile = false, filePosition = 0;
  while (pending.length && inspected < 1000 && bytesRead < 10_000_000 && matches.length < 20) {
    checkCancelled();
    const task = pending.shift()!;
    const page = await listToolFilesPage(folder, scope, projectId, area, task.path, task.offset, 100);
    checkCancelled();
    if (page.nextOffset !== null) pending.unshift({ path: task.path, offset: page.nextOffset });
    const entries = page.entries;
    for (const entry of entries) {
      checkCancelled();
      if (entry.kind === 'directory') { if (pending.length < 1000) pending.push({ path: entry.path, offset: 0 }); else limited = true; continue; }
      if ((!TEXT_EXTENSIONS.test(entry.path) && !entry.path.split('/').at(-1)?.startsWith('.')) || (entry.bytes || 0) > 1_000_000) continue;
      if (filePosition < offset) { filePosition++; continue; }
      if (inspected >= 1000 || bytesRead + (entry.bytes || 0) > 10_000_000 || matches.length >= 20) { limited = true; break; }
      inspected++; filePosition++;
      const file = await readBlob(folder, pathFor(scope, projectId, area, entry.path));
      checkCancelled();
      bytesRead += file.size;
      const text = await file.text();
      checkCancelled();
      const lower = text.toLowerCase();
      let from = 0;
      for (let found = 0; found < 3 && matches.length < 20; found++) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        const lineStart = text.lastIndexOf('\n', at - 1) + 1;
        const lineEnd = text.indexOf('\n', at);
        const line = text.slice(0, lineStart).split('\n').length;
        const column = at - lineStart + 1;
        const excerptStart = Math.max(lineStart, at - 100);
        const excerptEnd = Math.min(lineEnd < 0 ? text.length : lineEnd, at + needle.length + 180);
        matches.push(`${entry.path}:${line}:${column} · character ${at}\n${excerptStart > lineStart ? '…' : ''}${text.slice(excerptStart, excerptEnd)}${excerptEnd < (lineEnd < 0 ? text.length : lineEnd) ? '…' : ''}`);
        from = at + Math.max(1, needle.length);
      }
      if (lower.indexOf(needle, from) >= 0) moreInFile = true;
    }
  }
  limited ||= pending.length > 0 || matches.length >= 20;
  const continuation = limited ? `[Search limit: ${inspected} text files, ${(bytesRead / 1_000_000).toFixed(1)} MB. Continue with offset ${filePosition} or narrow the path.]\n` : '';
  const more = moreInFile ? '\n[Some files have more matches. Search a longer phrase or read the file.]' : '';
  return continuation + (matches.length ? matches.join('\n\n') : `No match in ${inspected} text files.`) + more;
}

export function browserFileTools(folder: FileSystemDirectoryHandle | null, scope: ToolScope, signal?: AbortSignal): BrowserTools | undefined {
  if (!folder) return undefined;
  async function indexLibraryEdit(projectId: string, area: ToolArea, path: string): Promise<string> {
    if (area !== 'library') return '';
    try {
      const { indexLibraryFile, indexableLibraryPath } = await import('./harnessLibrary.ts');
      if (!indexableLibraryPath(path)) return '';
      await indexLibraryFile(folder!, projectId, path);
      return '\nThe project library search index was updated.';
    } catch (error) {
      return `\nThe file was saved, but its library search index could not be updated: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async function syntaxFeedback(projectId: string, area: ToolArea, path: string): Promise<string> {
    if (!/\.(?:js|jsx|mjs|cjs|ts|tsx|json)$/i.test(path)) return '';
    try {
      const file = await readBlob(folder!, pathFor(scope, projectId, area, path));
      const { MAX_SYNTAX_BYTES, syntaxDiagnostics } = await import('./harnessSyntax.ts');
      if (file.size > MAX_SYNTAX_BYTES) return '\nSyntax check skipped: file exceeds 200 KB.';
      const result = await syntaxDiagnostics(path, await file.text());
      if (result.status === 'ok') return '\nSyntax check: valid parse. Types, imports, and tests were not checked.';
      const lines = result.diagnostics.slice(0, 4).map(item => `${item.line === null ? '?' : item.line}:${item.column === null ? '?' : item.column} ${item.message}`);
      return `\nSyntax issues after save: ${lines.join(' | ')}${result.diagnostics.length > 4 || result.moreErrors ? ' | More issues: call check_syntax.' : ''}`;
    } catch (error) {
      return `\nSyntax check unavailable after save: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const parameters = (extra: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties: {
    project: { type: 'string', description: 'Project ID; omit for the current project.' },
    area: { type: 'string', enum: ['files', 'library', 'workspace'], description: 'Project files, library, or granted workspace root.' },
    ...extra,
  }, required });
  const string = (description: string) => ({ type: 'string', description });
  return {
    definitions: ([
      { type: 'function', function: { name: 'shell_readonly', description: 'Read-only project shell: pwd, ls [-al] [folder], cat one text file, or rg "literal phrase" [folder]. /workspace is this project’s Files area. No execution, scripts, pipes, or writes.', parameters: { type: 'object', properties: { command: string('One read-only command, for example rg "function name" /workspace/src') }, required: ['command'] } } },
      { type: 'function', function: { name: 'list_files', description: 'List one page of a folder inside the allowed project or workspace. Use nextOffset to read later pages.', parameters: parameters({ path: string('Relative subfolder; omit for the root.'), offset: { type: 'number', description: 'Zero-based entry offset; omit for the first page.' } }) } },
      { type: 'function', function: { name: 'read_file', description: 'Read a bounded byte range of a text or code file.', parameters: parameters({ path: string('Relative file path.'), offset: { type: 'number', description: 'Starting byte offset.' }, length: { type: 'number', description: 'Maximum bytes, up to 16000.' } }, ['path']) } },
      { type: 'function', function: { name: 'check_syntax', description: 'Check a saved JavaScript, TypeScript, JSX, TSX, or JSON file for parse errors. Does not run code, check types, or resolve imports.', parameters: parameters({ path: string('Relative code or JSON file path, up to 200 KB.') }, ['path']) } },
      { type: 'function', function: { name: 'search_files', description: 'Search text files in the allowed area; returns bounded matches with line and column. Use offset to continue a limited search or narrow path.', parameters: parameters({ query: string('Text to search for.'), path: string('Relative subfolder to narrow the search; omit for the area root.'), offset: { type: 'number', description: 'Eligible text files to skip; use the offset returned by a limited search.' } }, ['query']) } },
      { type: 'function', function: { name: 'search_library', description: 'Search the project library index and return relevant, source-labeled document excerpts, including indexed PDFs.', parameters: parameters({ query: string('Topic or phrase to find.') }, ['query']) } },
      { type: 'function', function: { name: 'write_file', description: 'Create or replace a text file. The previous version is backed up.', parameters: parameters({ path: string('Relative file path.'), content: string('Complete new text content, up to 200 KB.') }, ['path', 'content']) } },
      { type: 'function', function: { name: 'replace_in_file', description: 'Replace one exact occurrence in a file after reading it. The previous version is backed up.', parameters: parameters({ path: string('Relative file path.'), search: string('Exact old text.'), replacement: string('Replacement text.') }, ['path', 'search', 'replacement']) } },
      { type: 'function', function: { name: 'replace_many_in_file', description: 'Apply up to 16 non-overlapping exact replacements to one file in one write. All old spans must be unique and present; the previous file is backed up.', parameters: parameters({ path: string('Relative file path.'), edits: { type: 'array', items: { type: 'object', properties: { search: string('Exact old text.'), replacement: string('Replacement text.') }, required: ['search', 'replacement'] } } }, ['path', 'edits']) } },
      { type: 'function', function: { name: 'apply_patch', description: 'Apply up to 16 unified diff hunks to one existing text file. Include context lines and @@ line headers; the previous version is backed up.', parameters: parameters({ path: string('Relative file path.'), patch: string('Single-file unified diff, with optional --- and +++ headers. Do not include other files.') }, ['path', 'patch']) } },
      { type: 'function', function: { name: 'move_file', description: 'Move or rename one file within the allowed area. Refuses to replace an existing destination and backs up the source.', parameters: parameters({ path: string('Existing relative file path.'), destination: string('New relative file path in the same area.') }, ['path', 'destination']) } },
      { type: 'function', function: { name: 'delete_file', description: 'Remove one file after saving a recoverable copy in workspace history. Directories cannot be removed.', parameters: parameters({ path: string('Relative file path to remove.') }, ['path']) } },
      { type: 'function', function: { name: 'file_info', description: 'Read the size and SHA-256 of a file before restoring a backup over it. Limited to files of 2 MB or less.', parameters: parameters({ path: string('Relative file path.') }, ['path']) } },
      { type: 'function', function: { name: 'list_backups', description: 'List recent recoverable file versions in the allowed project or workspace area.', parameters: parameters({}) } },
      { type: 'function', function: { name: 'inspect_backup', description: 'Check a backup and read a bounded text preview before restoring it.', parameters: parameters({ backup_id: string('Backup ID returned by list_backups.') }, ['backup_id']) } },
      { type: 'function', function: { name: 'restore_backup', description: 'Restore a verified backup. A missing file can be recreated directly. To replace an existing file, first call file_info and pass its current SHA-256; the replaced version is also backed up.', parameters: parameters({ backup_id: string('Backup ID returned by list_backups.'), expected_current_sha256: string('SHA-256 from file_info, required when replacing an existing file.') }, ['backup_id']) } },
      { type: 'function', function: { name: 'git_init', description: 'Initialize Git with a main branch in an allowed project code folder. Refuses existing repositories. The project must be mapped to a relative code folder.', parameters: parameters({}) } },
      { type: 'function', function: { name: 'git_status', description: 'Read a page of Git changes, branch, staged state, and recent commits for an allowed code project. Use nextOffset for more changes.', parameters: parameters({ offset: { type: 'number', description: 'Zero-based changed-file offset; omit for the first 100.' } }) } },
      { type: 'function', function: { name: 'git_history', description: 'Read ten recent local commits in an allowed code project. Use nextOffset for older commits.', parameters: parameters({ offset: { type: 'number', description: 'Zero-based commit offset; omit for the first ten.' } }) } },
      { type: 'function', function: { name: 'git_diff', description: 'Read a bounded text diff for one changed file in an allowed code project, including staged and unstaged edits.', parameters: parameters({ path: string('Relative path of a changed file from git_status.') }, ['path']) } },
      { type: 'function', function: { name: 'git_stage', description: 'Stage one changed file in an allowed code project. Review git_diff first; this stages its current working copy.', parameters: parameters({ path: string('Relative changed-file path from git_status.') }, ['path']) } },
      { type: 'function', function: { name: 'git_unstage', description: 'Unstage one changed file in an allowed code project without discarding its working copy.', parameters: parameters({ path: string('Relative staged-file path from git_status.') }, ['path']) } },
      { type: 'function', function: { name: 'git_commit', description: 'Commit currently staged changes in an allowed code project. Requires an explicit message and author identity.', parameters: parameters({ message: string('Commit message.'), author_name: string('Author name.'), author_email: string('Author email.') }, ['message', 'author_name', 'author_email']) } },
      { type: 'function', function: { name: 'git_create_branch', description: 'Create a local branch from the current commit in an allowed code project. Does not switch branches or change open files; the user can switch in Files & tools.', parameters: parameters({ branch: string('New local branch name, such as feature/search.') }, ['branch']) } },
    ] as BrowserTools['definitions']).filter(tool =>
      (!tool.function.name.startsWith('git_') || scope.projects.some(project => !!project.filesPath)) &&
      (scope.projects.find(project => project.id === scope.defaultProjectId)?.toolAccess !== 'read-only' || !isMutatingToolName(tool.function.name))),
    execute: async (name, args) => {
      if (signal?.aborted) throw signal.reason || new DOMException('Tool call stopped.', 'AbortError');
      const project = String(args.project || scope.defaultProjectId);
      const area = (args.area === 'library' || args.area === 'workspace' ? args.area : 'files') as ToolArea;
      const path = String(args.path || '');
      assertToolAllowed(scope, name, area === 'workspace' && !name.startsWith('git_') ? scope.defaultProjectId : project);
      if (isMutatingToolName(name) && (area !== 'workspace' || name.startsWith('git_')) && scope.projects.find(item => item.id === project)?.toolAccess === 'read-only') {
        throw new Error(`Model tools are read-only for this project. Change its tool access in Project settings to allow ${name}.`);
      }
      if (isMutatingToolName(name) && area === 'workspace' && (
        withinReadOnlyCodeFolder(scope, path) || withinReadOnlyCodeFolder(scope, String(args.destination || '')) ||
        name === 'restore_backup' && (scope.workspaceProjects || scope.projects).some(item => item.toolAccess === 'read-only')
      )) {
        throw new Error('This workspace write could affect a read-only project. Use a writable project Files area.');
      }
      if (name === 'shell_readonly') {
        const command = parseReadOnlyShell(String(args.command || ''));
        assertToolAllowed(scope, shellCommandPermission(command.name), scope.defaultProjectId);
        if (command.name === 'pwd') return '/workspace';
        if (command.name === 'cat') return readToolFile(folder, scope, scope.defaultProjectId, 'files', command.path);
        if (command.name === 'rg') return searchToolFiles(folder, scope, scope.defaultProjectId, 'files', command.query, command.path, signal);
        const page = await listToolFilesPage(folder, scope, scope.defaultProjectId, 'files', command.path);
        return `${page.entries.map(entry => `${entry.kind === 'directory' ? 'd' : '-'} ${entry.bytes ?? '-'} ${entry.path}`).join('\n') || '(empty folder)'}${page.nextOffset !== null ? `\n[More entries: use list_files at offset ${page.nextOffset}.]` : ''}`;
      }
      if (name === 'list_files') return JSON.stringify(await listToolFilesPage(folder, scope, project, area, path, Number(args.offset || 0)));
      if (name === 'read_file') return readToolFile(folder, scope, project, area, path, Number(args.offset ?? 0), Number(args.length ?? 12000));
      if (name === 'check_syntax') {
        const file = await readBlob(folder, pathFor(scope, project, area, path));
        const { MAX_SYNTAX_BYTES, syntaxDiagnostics } = await import('./harnessSyntax.ts');
        if (file.size > MAX_SYNTAX_BYTES) throw new Error('Syntax checking is limited to files of 200 KB or less.');
        if (signal?.aborted) throw signal.reason || new DOMException('Tool call stopped.', 'AbortError');
        const result = await syntaxDiagnostics(path, await file.text());
        if (signal?.aborted) throw signal.reason || new DOMException('Tool call stopped.', 'AbortError');
        return JSON.stringify(result);
      }
      if (name === 'search_files') return searchToolFiles(folder, scope, project, area, String(args.query || ''), path, signal, Number(args.offset ?? 0));
      if (name === 'search_library') {
        if (!scope.projects.some(item => item.id === project)) throw new Error('This project is outside the agent’s scope.');
        const { searchLibrary, formatLibraryHits } = await import('./harnessLibrary.ts');
        return formatLibraryHits(await searchLibrary(folder, project, String(args.query || ''), 3000, signal)) || 'No indexed library excerpt matched. Open the Library area to update its index.';
      }
      if (name === 'write_file') {
        const result = await writeToolFile(folder, scope, project, area, path, String(args.content || ''));
        return result + await indexLibraryEdit(project, area, path) + await syntaxFeedback(project, area, path);
      }
      if (name === 'replace_in_file') {
        const result = await replaceToolText(folder, scope, project, area, path, String(args.search || ''), String(args.replacement || ''));
        return result + await indexLibraryEdit(project, area, path) + await syntaxFeedback(project, area, path);
      }
      if (name === 'replace_many_in_file') {
        const result = await replaceManyToolText(folder, scope, project, area, path, args.edits as { search: string; replacement: string }[]);
        return result + await indexLibraryEdit(project, area, path) + await syntaxFeedback(project, area, path);
      }
      if (name === 'apply_patch') {
        const result = await applyToolPatch(folder, scope, project, area, path, String(args.patch || ''));
        return result + await indexLibraryEdit(project, area, path) + await syntaxFeedback(project, area, path);
      }
      if (name === 'move_file') {
        const destination = String(args.destination || '');
        const result = await moveToolFile(folder, scope, project, area, path, destination);
        if (area === 'library') {
          const { removeIndexedLibraryFile } = await import('./harnessLibrary.ts');
          await removeIndexedLibraryFile(folder, project, path);
          return result + await indexLibraryEdit(project, area, destination);
        }
        return result;
      }
      if (name === 'delete_file') {
        const result = await deleteToolFile(folder, scope, project, area, path);
        if (area === 'library') {
          const { removeIndexedLibraryFile } = await import('./harnessLibrary.ts');
          await removeIndexedLibraryFile(folder, project, path);
        }
        return result;
      }
      if (name === 'file_info') {
        const file = await readBlob(folder, pathFor(scope, project, area, path));
        if (file.size > 2_000_000) throw new Error('Files above 2 MB cannot be restored with the browser file tool.');
        return JSON.stringify({ area, path, bytes: file.size, sha256: await digest(file) });
      }
      if (name === 'list_backups') {
        const records = await listToolBackups(folder, scope, project, area, 20);
        return JSON.stringify({ backups: records.map(({ id, createdAt, path, bytes, sha256 }) => ({ id, createdAt, path, bytes, sha256 })), moreMayExist: records.length === 20 });
      }
      if (name === 'inspect_backup') {
        const { record, copy } = await readToolBackup(folder, scope, project, area, String(args.backup_id || ''));
        const textFile = TEXT_EXTENSIONS.test(record.path) || record.path.split('/').at(-1)?.startsWith('.');
        return JSON.stringify({ id: record.id, path: record.path, createdAt: record.createdAt, bytes: record.bytes, sha256: record.sha256,
          preview: textFile ? await copy.slice(0, 8000).text() : null, previewTruncated: textFile && copy.size > 8000 });
      }
      if (name === 'restore_backup') {
        const expected = args.expected_current_sha256;
        if (expected !== undefined && typeof expected !== 'string') throw new Error('Expected current SHA-256 must be text from file_info.');
        return restoreToolBackup(folder, scope, project, area, String(args.backup_id || ''), expected !== undefined, expected);
      }
      if (name === 'git_init') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitInit } = await import('./harnessGit.ts');
        await gitInit(folder, allowed);
        return `Initialized Git in ${allowed.name}. Main branch is ready; no files were staged or committed.`;
      }
      if (name === 'git_status') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitState } = await import('./harnessGit.ts');
        const state = await gitState(folder, allowed);
        return JSON.stringify(pageGitStatus(state, Number(args.offset ?? 0)));
      }
      if (name === 'git_history') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitHistory } = await import('./harnessGit.ts');
        return JSON.stringify(await gitHistory(folder, allowed, Number(args.offset ?? 0)));
      }
      if (name === 'git_diff') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitDiff } = await import('./harnessGit.ts');
        const diff = await gitDiff(folder, allowed, path);
        return [`${diff.path} · Git diff`, diff.staged && `STAGED\n${diff.staged}`, diff.unstaged && `UNSTAGED\n${diff.unstaged}`].filter(Boolean).join('\n\n');
      }
      if (name === 'git_create_branch') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitPrepareBranch } = await import('./harnessGit.ts');
        const branch = String(args.branch || '');
        await gitPrepareBranch(folder, allowed, branch);
        return `Created local branch ${branch.trim()} in ${allowed.name}. The current branch and files were not changed.`;
      }
      if (name === 'git_stage' || name === 'git_unstage' || name === 'git_commit') {
        const allowed = scope.projects.find(item => item.id === project);
        if (!allowed) throw new Error('This project is outside the agent’s scope.');
        const { gitState, gitStage, gitUnstage, gitCommit } = await import('./harnessGit.ts');
        const state = await gitState(folder, allowed);
        if (!state.repository) throw new Error('This project does not have a Git repository.');
        if (name === 'git_commit') {
          if (!state.changes.some(change => change.staged)) throw new Error('Stage at least one change before committing.');
          const oid = await gitCommit(folder, allowed, String(args.message || ''), String(args.author_name || ''), String(args.author_email || ''));
          return `Committed ${oid.slice(0, 12)}. ${state.changes.filter(change => change.staged).length} staged file(s) included.`;
        }
        const change = state.changes.find(item => item.path === path);
        if (!change) throw new Error('This file has no Git changes.');
        if (name === 'git_stage') {
          if (!change.unstaged) throw new Error('This file has no unstaged changes.');
          await gitStage(folder, allowed, change);
          return `Staged ${path}.`;
        }
        if (!change.staged) throw new Error('This file is not staged.');
        await gitUnstage(folder, allowed, change);
        return `Unstaged ${path}; its working copy remains in place.`;
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };
}
