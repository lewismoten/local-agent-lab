import { useEffect, useRef, useState } from 'react';
import { GitBranch, RefreshCw } from 'lucide-react';
import type { HarnessProject } from './harnessData.ts';
import { gitCheckoutBranch, gitCommit, gitCreateBranch, gitDiff, gitInit, gitStage, gitState, gitUnstage, type GitDiff, type GitState } from './harnessGit.ts';
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
  const stagedCount = state?.changes.filter(change => change.staged).length || 0;
  const visibleChanges = state?.changes.slice(0, visibleChangeCount) || [];
  return <section className="harness-git-panel harness-card" aria-label="Git repository">
    <div className="harness-git-heading"><div><span className="harness-overline">VERSION CONTROL</span><h2><GitBranch size={19}/> Git {state?.repository ? <small>{state.branch}</small> : null}</h2></div><span className="harness-git-heading-state">{busy ? 'Checking…' : state?.repository ? `${state.changes.length} changed · ${stagedCount} staged` : project.filesPath ? 'No repository' : 'Map a folder'}</span><div className="harness-git-heading-actions"><button className="harness-secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide' : 'Open Git'}</button>{expanded && project.filesPath && <button className="harness-icon" title="Refresh Git status" aria-label="Refresh Git status" disabled={busy} onClick={() => void run('Git status refreshed.', async () => {})}><RefreshCw size={15}/></button>}</div></div>
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    {expanded && (!project.filesPath ? <div className="harness-git-empty">Map a code folder to use Git. <button className="harness-secondary" onClick={onEditProject}>Project settings</button></div> : <>
      <p className="harness-git-path">{project.filesPath}{busy ? ' · Checking…' : ''}</p>
      {state && !state.repository && <div className="harness-git-empty">No repository in this folder. <button className="harness-primary" disabled={busy} onClick={() => void run('Git repository created.', () => gitInit(folder, project))}>Initialize Git</button></div>}
      {state?.repository && <>
        <div className="harness-git-branches">
          <label>Branch<select aria-label="Git branch" value={selectedBranch} disabled={busy || !state.branches.length} onChange={event => setSelectedBranch(event.target.value)}>{!state.branches.includes(state.branch) && <option value="">Choose branch</option>}{state.branches.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <button className="harness-secondary" disabled={busy || editorDirty || !!state.changes.length || !selectedBranch || selectedBranch === state.branch} onClick={() => void run(`Switched to ${selectedBranch}.`, async () => { await withModelLease('git:checkout', () => gitCheckoutBranch(folder, project, selectedBranch)); await onWorkingTreeChange(); })}>Switch</button>
          <label>New branch<input aria-label="New Git branch" value={newBranch} disabled={busy} onChange={event => setNewBranch(event.target.value)} placeholder="feature/name"/></label>
          <button className="harness-secondary" disabled={busy || editorDirty || !!state.changes.length || !state.recent.length || !newBranch.trim()} onClick={() => void run(`Created branch ${newBranch.trim()}.`, async () => { await withModelLease('git:checkout', () => gitCreateBranch(folder, project, newBranch)); setNewBranch(''); await onWorkingTreeChange(); })}>Create</button>
        </div>
        {editorDirty && <p className="harness-muted">Save or clear the file editor before changing branches.</p>}
        {!state.changes.length && <div className="harness-git-summary">Working tree clean</div>}
        {!!state.changes.length && <div className="harness-git-changes">{visibleChanges.map(change => <div className="harness-git-entry" key={change.path}><div className="harness-git-row"><span className="harness-git-kind">{change.label}</span><strong title={change.path}>{change.path}</strong><span className="harness-git-flags">{change.staged ? 'Staged' : 'Unstaged'}{change.staged && change.unstaged ? ' · newer edits' : ''}</span><button className="harness-secondary" disabled={busy || !!diffBusy} aria-expanded={selectedDiff?.path === change.path} onClick={() => void viewDiff(change.path)}>{diffBusy === change.path ? 'Loading…' : selectedDiff?.path === change.path ? 'Hide diff' : 'Diff'}</button>{change.unstaged && <button className="harness-secondary" disabled={busy} onClick={() => void run(`${change.path} staged.`, () => gitStage(folder, project, change))}>Stage</button>}{change.staged && <button className="harness-secondary" disabled={busy} onClick={() => void run(`${change.path} unstaged.`, () => gitUnstage(folder, project, change))}>Unstage</button>}</div>{selectedDiff?.path === change.path && <div className="harness-git-diff">{selectedDiff.staged && <><strong>Staged</strong><pre>{selectedDiff.staged}</pre></>}{selectedDiff.unstaged && <><strong>Unstaged</strong><pre>{selectedDiff.unstaged}</pre></>}</div>}</div>)}{state.changes.length > visibleChangeCount && <button className="harness-show-more" onClick={() => setVisibleChangeCount(count => count + CHANGE_PAGE_SIZE)}>Show more changes · {visibleChanges.length} of {state.changes.length}</button>}</div>}
        {stagedCount > 0 && <div className="harness-git-commit"><input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)}/><input aria-label="Author name" placeholder="Author name" value={authorName} disabled={authorLoading} onChange={event => setAuthorName(event.target.value)}/><input aria-label="Author email" type="email" placeholder="Author email" value={authorEmail} disabled={authorLoading} onChange={event => setAuthorEmail(event.target.value)}/><button className="harness-primary" disabled={busy || authorLoading || !message.trim() || !authorName.trim() || !authorEmail.trim()} onClick={() => void run('Commit saved on this drive.', async () => { await saveGitAuthor(folder, { name: authorName, email: authorEmail }); await gitCommit(folder, project, message, authorName, authorEmail); setMessage(''); })}>Commit staged</button></div>}
        {!!state.recent.length && <details className="harness-git-history"><summary>Recent commits</summary>{state.recent.map(item => <div key={item.oid}><code>{item.oid.slice(0, 8)}</code> {item.message} <small>{item.author} · {new Date(item.date).toLocaleDateString()}</small></div>)}</details>}
      </>}
    </>)}
  </section>;
}
