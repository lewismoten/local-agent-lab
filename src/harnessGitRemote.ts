import type { HttpClient } from 'isomorphic-git';
import type { HarnessProject } from './harnessData.ts';
import { gitFileSystem, gitState, projectGitDir } from './harnessGit.ts';

export type RemoteGitOperation = 'clone' | 'fetch' | 'pull' | 'push';
export type RemoteGitOptions = { url: string; corsProxy?: string; username?: string; token?: string; signal?: AbortSignal; onProgress?: (message: string) => void };
export type RemoteGitDetails = { url: string; corsProxy: string };

function checkedUrl(raw: string, label: string, allowRoot: boolean, hasToken: boolean): string {
  const value = raw.trim();
  if (!value || value.length > 2048) throw new Error(`Enter a ${label} URL under 2048 characters.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Enter a valid ${label} URL.`); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash
    || !allowRoot && (!url.pathname || url.pathname === '/')) throw new Error(`Use a plain HTTP(S) ${label} URL without embedded credentials, query, or fragment.`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && hasToken && !local) throw new Error('Credentials require HTTPS unless the endpoint is on this computer.');
  return url.toString().replace(/\/$/, '');
}

export function validateRemoteGitOptions(options: RemoteGitOptions): RemoteGitOptions {
  const token = options.token?.trim() || '';
  const username = options.username?.trim() || '';
  if (username.length > 100 || token.length > 2000) throw new Error('Git credentials are too long.');
  return {
    ...options,
    url: checkedUrl(options.url, 'repository', false, !!token),
    corsProxy: options.corsProxy?.trim() ? checkedUrl(options.corsProxy, 'CORS proxy', true, !!token) : '',
    username,
    token,
  };
}

async function gitModules() {
  const { Buffer } = await import('buffer');
  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ||= Buffer;
  const [git, transport] = await Promise.all([import('isomorphic-git'), import('isomorphic-git/http/web')]);
  return { git, http: transport.default };
}

/** Clone only into a new or empty mapped directory, outside another repository. */
export async function assertCloneTarget(folder: FileSystemDirectoryHandle, project: HarnessProject): Promise<void> {
  const parts = projectGitDir(project).slice(1).split('/');
  let current = folder;
  for (let depth = 0; depth <= parts.length; depth++) {
    try { await current.getDirectoryHandle('.git'); throw new Error('This folder is already inside a Git repository.'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
    if (depth === parts.length) {
      for await (const _ of (current as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
        throw new Error('Clone needs an empty project code folder. Choose or clear a separate mapped folder first.');
      }
      return;
    }
    try { current = await current.getDirectoryHandle(parts[depth]); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return; throw error; }
  }
}

async function createMappedDirectory(folder: FileSystemDirectoryHandle, project: HarnessProject): Promise<void> {
  let current = folder;
  for (const part of projectGitDir(project).slice(1).split('/')) current = await current.getDirectoryHandle(part, { create: true });
}

export async function gitRemoteDetails(folder: FileSystemDirectoryHandle, project: HarnessProject): Promise<RemoteGitDetails> {
  if (!(await gitState(folder, project)).repository) return { url: '', corsProxy: '' };
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const { git } = await gitModules();
  return { url: await git.getConfig({ fs, dir, path: 'remote.origin.url' }) || '', corsProxy: await git.getConfig({ fs, dir, path: 'http.corsProxy' }) || '' };
}

export async function runRemoteGit(folder: FileSystemDirectoryHandle, project: HarnessProject, operation: RemoteGitOperation, input: RemoteGitOptions): Promise<string> {
  const options = validateRemoteGitOptions(input);
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Remote Git stopped.', 'AbortError');
  const { git, http } = await gitModules();
  const transport: HttpClient = options.signal ? { request: request => http.request({ ...request, signal: options.signal }) } : http;
  const dir = projectGitDir(project), fs = gitFileSystem(folder, dir);
  const progress = (event: { phase: string; loaded: number; total: number }) => {
    options.onProgress?.(`${event.phase}: ${event.total ? `${event.loaded.toLocaleString()} / ${event.total.toLocaleString()}` : event.loaded.toLocaleString()}`);
  };
  const credentials = options.token ? { onAuth: () => ({ username: options.username || 'x-access-token', password: options.token! }) } : {};
  const common = { fs, http: transport, dir, url: options.url, corsProxy: options.corsProxy || undefined, onProgress: progress, ...credentials };
  const state = await gitState(folder, project);
  if (operation === 'clone') {
    if (state.repository) throw new Error('This project already has a Git repository.');
    await assertCloneTarget(folder, project);
    await createMappedDirectory(folder, project);
    options.onProgress?.('Contacting repository…');
    await git.clone({ ...common, singleBranch: true, noTags: true, nonBlocking: true });
    return 'Repository cloned into the project code folder.';
  }
  if (!state.repository) throw new Error('Initialize or clone a repository before using a remote.');
  if (!state.branch || state.branch === '(detached)') throw new Error('Choose a local branch before using this remote operation.');
  if (operation !== 'fetch' && !state.recent.length) throw new Error('Make a local commit on a branch before pulling or pushing.');
  if (operation === 'pull' && state.changes.length) throw new Error('Commit or clear local changes before pulling.');
  // The approved dialog can establish or update origin; neither URL nor proxy contains credentials.
  await git.setConfig({ fs, dir, path: 'remote.origin.url', value: options.url });
  await git.setConfig({ fs, dir, path: 'http.corsProxy', value: options.corsProxy || '' });
  options.onProgress?.(`Contacting ${new URL(options.url).hostname}…`);
  if (operation === 'fetch') {
    const result = await git.fetch({ ...common, remote: 'origin', ref: state.branch, singleBranch: true });
    return `Fetched ${state.branch}${result.fetchHead ? ` at ${result.fetchHead.slice(0, 8)}` : ''}.`;
  }
  if (operation === 'pull') {
    await git.fastForward({ ...common, remote: 'origin', ref: state.branch, remoteRef: state.branch, singleBranch: true });
    return `Pulled ${state.branch} with a fast-forward update.`;
  }
  const result = await git.push({ ...common, remote: 'origin', ref: state.branch, remoteRef: state.branch, force: false, delete: false });
  const rejected = Object.entries(result.refs).filter(([, status]) => !status.ok).map(([ref, status]) => `${ref}: ${status.error}`);
  if (!result.ok || rejected.length) throw new Error(`Push rejected: ${[result.error, ...rejected].filter(Boolean).join('; ') || 'remote refused the update'}`);
  return `Pushed ${state.branch} to origin.`;
}
