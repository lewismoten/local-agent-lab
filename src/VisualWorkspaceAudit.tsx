import { useEffect, useState } from 'react';
import { showCompletionToast, showToast } from './toastStore.ts';
import { auditVisualWorkspace, type VisualWorkspaceAudit as AuditResult } from './visualWorkspaceAudit.ts';
import { backfillVisualArtifactSidecars, planVisualArtifactBackfill } from './visualArtifactBackfill.ts';
import './visualWorkspaceAudit.css';

export default function VisualWorkspaceAudit({ folder }: { folder: FileSystemDirectoryHandle }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [backfillCount, setBackfillCount] = useState(0);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const started = performance.now();
    setBusy(true); setError(''); setResult(null); setBackfillCount(0);
    void Promise.all([auditVisualWorkspace(folder, controller.signal), planVisualArtifactBackfill(folder, controller.signal)]).then(([next, candidates]) => {
      if (controller.signal.aborted) return;
      setResult(next); setBackfillCount(candidates.length); setBusy(false);
      if (performance.now() - started > 5000) showCompletionToast('Saved visual check complete.', started);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false);
    });
    return () => controller.abort();
  }, [folder, revision]);

  async function restoreDetails() {
    if (restoring || busy) return;
    setRestoring(true); setError('');
    try {
      const count = await backfillVisualArtifactSidecars(folder);
      showToast(`${count} visual ${count === 1 ? 'record' : 'records'} restored.`);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRestoring(false); }
  }

  return <details className="visual-workspace-audit">
    <summary><span>Saved visuals</span><small role="status">{busy ? 'Checking…' : error ? 'Could not check' : result?.issues.length ? `⚠️ ${result.issues.length} affected files` : result?.checkedRecords ? 'Files checked' : 'No saved visuals'}</small></summary>
    <div className="visual-workspace-audit-body">
      <div className="visual-workspace-audit-toolbar"><span>{result ? `${result.checkedRecords} records checked` : busy ? 'Checking saved reports and image details…' : ''}</span>{backfillCount > 0 && <button className="harness-secondary" type="button" disabled={busy || restoring} onClick={() => void restoreDetails()}>{restoring ? 'Restoring…' : `Restore details · ${backfillCount}`}</button>}<button className="harness-secondary" type="button" disabled={busy || restoring} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
      {error && <p role="alert">Could not check saved visuals: {error}</p>}
      {result?.withoutProvenance ? <p>{result.withoutProvenance} records have no verifiable model file details.</p> : null}
      {result?.unverifiedArtifacts.length ? <details><summary>{result.unverifiedArtifacts.length} media files have no verifiable source details</summary><ul>{result.unverifiedArtifacts.map(path => <li key={path}><code>{path}</code></li>)}</ul></details> : null}
      {result && !result.issues.length && <p>{result.checkedRecords ? 'No referenced model or engine files are missing.' : 'No visual output details were found.'}</p>}
      {result?.issues.map(issue => <div className="visual-workspace-audit-issue" key={issue.artifactPath}>
        <strong>{issue.artifactPath}</strong><span>Missing {issue.missingPaths.length} {issue.missingPaths.length === 1 ? 'dependency' : 'dependencies'}</span>
        <ul>{issue.missingPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      </div>)}
    </div>
  </details>;
}
