import { useEffect, useRef, useState } from 'react';
import { GitBranch, Globe2, RefreshCw } from 'lucide-react';
import type { HarnessProject } from './harnessData.ts';
import { gitCheckoutBranch, gitCommit, gitCreateBranch, gitDiff, gitInit, gitStage, gitState, gitUnstage, type GitDiff, type GitState } from './harnessGit.ts';
import { gitRemoteDetails, runRemoteGit, type RemoteGitOperation } from './harnessGitRemote.ts';
import { readGitAuthor, saveGitAuthor } from './harnessGitAuthor.ts';
import { withModelLease } from './harnessLease.ts';
import { showToast } from './toastStore.ts';

const stored = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const CHANGE_PAGE_SIZE = 100;

export default function GitPanel({ folder, workspaceId, project, revision, editorDirty, onEditProject, onActivityChange, onWorkingTreeChange }: { folder: FileSystemDirectoryHandle; workspaceId: string; project: HarnessProject; revision: number; editorDirty: boolean; onEditProject: () => void; onActivityChange: (busy: boolean) => void; onWorkingTreeChange: () => void | Promise<void> }) {
  const [state, setState] = useState<GitState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedDiff, setSelectedDiff] = useState<GitDiff | null>(null);
  const [diffBusy, setDiffBusy] = useState('');
  const [visibleChangeCount, setVisibleChangeCount] = useState(CHANGE_PAGE_SIZE);
  const [message, setMessage] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [authorLoading, setAuthorLoading] = useState(true);
  const writePending = useRef(false);
  const activeOperations = useRef(0);
  const remoteDialog = useRef<HTMLDialogElement>(null);
  const remoteAbort = useRef<AbortController | null>(null);
  const [remoteOperation, setRemoteOperation] = useState<RemoteGitOperation>('fetch');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteProxy, setRemoteProxy] = useState('');
  const [remoteUsername, setRemoteUsername] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [remoteProgress, setRemoteProgress] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  function beginActivity() { if (++activeOperations.current === 1) onActivityChange(true); }
  function endActivity() { activeOperations.current = Math.max(0, activeOperations.current - 1); if (!activeOperations.current) onActivityChange(false); }
  useEffect(() => {
    let active = true;
    setAuthorLoading(true); setAuthorName(''); setAuthorEmail('');
    void readGitAuthor(folder).then(author => {
      if (!active) return;
      setAuthorName(author?.name || (workspaceId === 'browser-home' ? stored('harness-git-author-name') : ''));
      setAuthorEmail(author?.email || (workspaceId === 'browser-home' ? stored('harness-git-author-email') : ''));
    }).catch(cause => { if (active) setError(`Could not read Git author defaults: ${cause instanceof Error ? cause.message : String(cause)}`); })
      .finally(() => { if (active) setAuthorLoading(false); });
    return () => { active = false; };
  }, [folder, workspaceId]);
  useEffect(() => {
    if (!project.filesPath) { setState(null); return; }
    let active = true;
    beginActivity();
    setState(null); setSelectedDiff(null); setVisibleChangeCount(CHANGE_PAGE_SIZE); setBusy(true); setError('');
    void gitState(folder, project).then(next => { if (active) setState(next); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { endActivity(); if (active) setBusy(false); });
    return () => { active = false; };
  }, [folder, project.id, project.filesPath, revision]);
  useEffect(() => { setSelectedBranch(state?.branches.includes(state.branch) ? state.branch : ''); }, [state?.branch, state?.branches]);
  async function run(label: string, action: () => Promise<unknown>) {
    if (writePending.current) return;
    writePending.current = true;
    beginActivity();
    setBusy(true); setError('');
    try { await action(); setState(await gitState(folder, project)); setSelectedDiff(null); showToast(label); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { writePending.current = false; endActivity(); setBusy(false); }
  }
  async function viewDiff(path: string) {
    if (selectedDiff?.path === path) { setSelectedDiff(null); return; }
    beginActivity();
    setDiffBusy(path); setError('');
    try { setSelectedDiff(await gitDiff(folder, project, path)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { endActivity(); setDiffBusy(''); }
  }
  async function openRemote(operation: RemoteGitOperation) {
    setRemoteOperation(operation); setRemoteToken(''); setRemoteError(''); setRemoteProgress(''); setRemoteLoading(!!state?.repository);
    setRemoteUrl(''); setRemoteProxy('');
    remoteDialog.current?.showModal();
    if (!state?.repository) return;
    try {
      const details = await gitRemoteDetails(folder, project);
      if (remoteDialog.current?.open) { setRemoteUrl(details.url); setRemoteProxy(details.corsProxy); }
    } catch (cause) { if (remoteDialog.current?.open) setRemoteError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRemoteLoading(false); }
  }
  async function submitRemote() {
    if (writePending.current || !remoteUrl.trim()) return;
    const controller = new AbortController();
    remoteAbort.current = controller;
    writePending.current = true; beginActivity(); setBusy(true); setRemoteError(''); setRemoteProgress('Preparing remote operation…');
    try {
      const completed = await withModelLease('git:remote', () => runRemoteGit(folder, project, remoteOperation, {
        url: remoteUrl, corsProxy: remoteProxy, username: remoteUsername, token: remoteToken, signal: controller.signal, onProgress: setRemoteProgress,
      }), controller.signal);
      if (remoteOperation === 'clone' || remoteOperation === 'pull') await onWorkingTreeChange();
      setState(await gitState(folder, project)); setSelectedDiff(null);
      remoteDialog.current?.close(); setRemoteToken(''); setRemoteProgress(''); showToast(completed);
    } catch (cause) { setRemoteError(controller.signal.aborted ? 'Stopped. A clone may have left partial files in the mapped folder.' : cause instanceof Error ? cause.message : String(cause)); }
    finally { if (remoteAbort.current === controller) remoteAbort.current = null; writePending.current = false; endActivity(); setBusy(false); }
  }
  const stagedCount = state?.changes.filter(change => change.staged).length || 0;
  const visibleChanges = state?.changes.slice(0, visibleChangeCount) || [];
  return <section className="harness-git-panel harness-card" aria-label="Git repository">
    <div className="harness-git-heading"><div><span className="harness-overline">VERSION CONTROL</span><h2><GitBranch size={19}/> Git {state?.repository ? <small>{state.branch}</small> : null}</h2></div><span className="harness-git-heading-state">{busy ? 'Checking…' : state?.repository ? `${state.changes.length} changed · ${stagedCount} staged` : project.filesPath ? 'No repository' : 'Map a folder'}</span><div className="harness-git-heading-actions"><button className="harness-secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide' : 'Open Git'}</button>{expanded && project.filesPath && <button className="harness-icon" title="Refresh Git status" aria-label="Refresh Git status" disabled={busy} onClick={() => void run('Git status refreshed.', async () => {})}><RefreshCw size={15}/></button>}</div></div>
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    {expanded && (!project.filesPath ? <div className="harness-git-empty">Map a code folder to use Git. <button className="harness-secondary" onClick={onEditProject}>Project settings</button></div> : <>
      <p className="harness-git-path">{project.filesPath}{busy ? ' · Checking…' : ''}</p>
      {state && !state.repository && <div className="harness-git-empty">No repository in this folder. <button className="harness-primary" disabled={busy} onClick={() => void run('Git repository created.', () => gitInit(folder, project))}>Initialize Git</button> <button className="harness-secondary" disabled={busy || editorDirty} onClick={() => void openRemote('clone')}><Globe2 size={15}/> Clone from remote</button></div>}
      {state?.repository && <>
        <div className="harness-git-branches">
          <label>Branch<select aria-label="Git branch" value={selectedBranch} disabled={busy || !state.branches.length} onChange={event => setSelectedBranch(event.target.value)}>{!state.branches.includes(state.branch) && <option value="">Choose branch</option>}{state.branches.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <button className="harness-secondary" disabled={busy || editorDirty || !!state.changes.length || !selectedBranch || selectedBranch === state.branch} onClick={() => void run(`Switched to ${selectedBranch}.`, async () => { await withModelLease('git:checkout', () => gitCheckoutBranch(folder, project, selectedBranch)); await onWorkingTreeChange(); })}>Switch</button>
          <label>New branch<input aria-label="New Git branch" value={newBranch} disabled={busy} onChange={event => setNewBranch(event.target.value)} placeholder="feature/name"/></label>
          <button className="harness-secondary" disabled={busy || editorDirty || !!state.changes.length || !state.recent.length || !newBranch.trim()} onClick={() => void run(`Created branch ${newBranch.trim()}.`, async () => { await withModelLease('git:checkout', () => gitCreateBranch(folder, project, newBranch)); setNewBranch(''); await onWorkingTreeChange(); })}>Create</button>
        </div>
        <div className="harness-git-remote-actions"><span>Origin</span><button className="harness-secondary" disabled={busy} onClick={() => void openRemote('fetch')}>Fetch</button><button className="harness-secondary" disabled={busy || editorDirty || !!state.changes.length} onClick={() => void openRemote('pull')}>Pull</button><button className="harness-secondary" disabled={busy || !state.recent.length} onClick={() => void openRemote('push')}>Push</button></div>
        {editorDirty && <p className="harness-muted">Save or clear the file editor before changing branches or pulling.</p>}
        {!state.changes.length && <div className="harness-git-summary">Working tree clean</div>}
        {!!state.changes.length && <div className="harness-git-changes">{visibleChanges.map(change => <div className="harness-git-entry" key={change.path}><div className="harness-git-row"><span className="harness-git-kind">{change.label}</span><strong title={change.path}>{change.path}</strong><span className="harness-git-flags">{change.staged ? 'Staged' : 'Unstaged'}{change.staged && change.unstaged ? ' · newer edits' : ''}</span><button className="harness-secondary" disabled={busy || !!diffBusy} aria-expanded={selectedDiff?.path === change.path} onClick={() => void viewDiff(change.path)}>{diffBusy === change.path ? 'Loading…' : selectedDiff?.path === change.path ? 'Hide diff' : 'Diff'}</button>{change.unstaged && <button className="harness-secondary" disabled={busy} onClick={() => void run(`${change.path} staged.`, () => gitStage(folder, project, change))}>Stage</button>}{change.staged && <button className="harness-secondary" disabled={busy} onClick={() => void run(`${change.path} unstaged.`, () => gitUnstage(folder, project, change))}>Unstage</button>}</div>{selectedDiff?.path === change.path && <div className="harness-git-diff">{selectedDiff.staged && <><strong>Staged</strong><pre>{selectedDiff.staged}</pre></>}{selectedDiff.unstaged && <><strong>Unstaged</strong><pre>{selectedDiff.unstaged}</pre></>}</div>}</div>)}{state.changes.length > visibleChangeCount && <button className="harness-show-more" onClick={() => setVisibleChangeCount(count => count + CHANGE_PAGE_SIZE)}>Show more changes · {visibleChanges.length} of {state.changes.length}</button>}</div>}
        {stagedCount > 0 && <div className="harness-git-commit"><input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)}/><input aria-label="Author name" placeholder="Author name" value={authorName} disabled={authorLoading} onChange={event => setAuthorName(event.target.value)}/><input aria-label="Author email" type="email" placeholder="Author email" value={authorEmail} disabled={authorLoading} onChange={event => setAuthorEmail(event.target.value)}/><button className="harness-primary" disabled={busy || authorLoading || !message.trim() || !authorName.trim() || !authorEmail.trim()} onClick={() => void run('Commit saved on this drive.', async () => { await saveGitAuthor(folder, { name: authorName, email: authorEmail }); await gitCommit(folder, project, message, authorName, authorEmail); setMessage(''); })}>Commit staged</button></div>}
        {!!state.recent.length && <details className="harness-git-history"><summary>Recent commits</summary>{state.recent.map(item => <div key={item.oid}><code>{item.oid.slice(0, 8)}</code> {item.message} <small>{item.author} · {new Date(item.date).toLocaleDateString()}</small></div>)}</details>}
      </>}
    </>)}
    <dialog ref={remoteDialog} className="harness-dialog harness-git-remote-dialog" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setRemoteToken('')}>
      <div className="harness-git-remote-heading"><Globe2 size={21}/><div><span className="harness-overline">REMOTE REPOSITORY</span><h2>{remoteOperation === 'clone' ? 'Clone into this project' : `${remoteOperation[0].toUpperCase()}${remoteOperation.slice(1)} ${state?.branch || 'branch'}`}</h2></div></div>
      <p>Project code folder: <strong>{project.filesPath}</strong></p>
      <form onSubmit={event => { event.preventDefault(); void submitRemote(); }}>
        <label>Repository HTTPS URL<input type="url" value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" autoComplete="off" required disabled={busy || remoteLoading}/></label>
        <label>CORS proxy URL <small>(optional)</small><input type="url" value={remoteProxy} onChange={event => setRemoteProxy(event.target.value)} placeholder="https://your-trusted-proxy.example" autoComplete="off" disabled={busy || remoteLoading}/></label>
        <div className="harness-git-remote-credentials"><label>Username <small>(optional)</small><input value={remoteUsername} onChange={event => setRemoteUsername(event.target.value)} placeholder="x-access-token" autoComplete="off" disabled={busy}/></label><label>Access token <small>(optional)</small><input type="password" value={remoteToken} onChange={event => setRemoteToken(event.target.value)} autoComplete="off" disabled={busy}/></label></div>
        <p className="harness-muted">The token stays in memory for this action. A CORS proxy can see repository traffic and credentials; use one you trust.</p>
        {remoteOperation === 'clone' && <p className="harness-muted">Clone requires an empty mapped code folder. A failed transfer may leave partial files to remove before retrying.</p>}
        {remoteOperation === 'pull' && <p className="harness-muted">Pull updates files only when the branch can fast-forward and the working tree is clean.</p>}
        {remoteOperation === 'push' && <p className="harness-muted">Push sends committed content on {state?.branch || 'this branch'} to the remote. It never force-pushes.</p>}
        {remoteLoading && <p role="status">Reading remote settings…</p>}
        {remoteProgress && <p role="status" className="harness-git-remote-progress">{remoteProgress}</p>}
        {remoteError && <p role="alert" className="harness-git-error">{remoteError}</p>}
        <div className="harness-dialog-actions">{busy ? <button type="button" className="harness-danger" disabled={!!remoteAbort.current?.signal.aborted} onClick={() => { remoteAbort.current?.abort(); setRemoteProgress('Stopping…'); }}>Stop</button> : <button type="button" className="harness-secondary" onClick={() => remoteDialog.current?.close()}>Cancel</button>}<button className="harness-primary" disabled={busy || remoteLoading || !remoteUrl.trim()}>{busy ? 'Working…' : remoteOperation[0].toUpperCase() + remoteOperation.slice(1)}</button></div>
      </form>
    </dialog>
  </section>;
}
