import { useRef, useState, useSyncExternalStore } from 'react';
import type { AIConfig } from './ai';
import { getBatchDiagnostics, startBatchDiagnostics, stopBatchDiagnostics, subscribeBatchDiagnostics } from './diagnosticBatchRunner';
import { rescoreSavedNeedleReports } from './needleReportRescore';
import { rescoreSavedGgufReports } from './ggufReportRescore';
import { showToast } from './toastStore';

export default function BatchDiagnostics({ folder, models, config, disabled }: { folder: FileSystemDirectoryHandle | null; models: string[]; config: AIConfig; disabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMessage, setRescoreMessage] = useState('');
  const batch = useSyncExternalStore(subscribeBatchDiagnostics, getBatchDiagnostics);
  async function rescore() {
    if (!folder) return;
    setRescoring(true); setRescoreMessage('Reading saved reports…');
    try {
      const count = await rescoreSavedNeedleReports(folder, true) + await rescoreSavedGgufReports(folder, models, true);
      const message = count ? `${count} saved report${count === 1 ? '' : 's'} rescored without running models.` : 'Saved reports are already current.';
      setRescoreMessage(message);
      showToast(message);
    } catch (error) { setRescoreMessage(error instanceof Error ? error.message : String(error)); }
    finally { setRescoring(false); }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || !models.length || disabled} onClick={() => dialog.current?.showModal()}>Run all diagnostics</button>
    <dialog ref={dialog} className="model-diagnostics-dialog batch-diagnostics-dialog" aria-label="Run all model diagnostics">
      <h2>Run all diagnostics</h2>
      <p>Runs available tests for each installed GGUF and Needle model. Vision runs when its projector is available. JSON reports are saved to <code>models/diagnostics/</code>.</p>
      <div className="model-diagnostics-actions">
        <button className="button primary compact" type="button" disabled={!folder || !models.length || batch.running} onClick={() => { if (folder) void startBatchDiagnostics(folder, models, config); }}>Run {models.length} models</button>
        <button className="button secondary compact" type="button" disabled={!folder || rescoring || batch.running} onClick={() => void rescore()}>{rescoring ? 'Rescoring…' : 'Rescore saved reports'}</button>
        {batch.running && <button className="button danger compact" type="button" onClick={stopBatchDiagnostics}>Stop</button>}
        <button className="button secondary compact" type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      {rescoreMessage && <p className="muted" role="status">{rescoreMessage}</p>}
      {!!batch.items.length && <>
        <div className="diagnostic-progress-row" role="status"><strong>Models</strong><progress aria-label="Models finished" value={batch.completed} max={batch.items.length}/><span>{batch.completed}/{batch.items.length}</span></div>
        <p className="muted">{batch.error || batch.step}</p>
        <div className="batch-diagnostics-list">{batch.items.map(item => <div key={item.path}>
          <strong>{item.state === 'done' ? '✅' : item.state === 'failed' ? '❌' : item.state === 'stopped' ? '⏹️' : item.state === 'running' ? '⏳' : '○'} {item.path.split('/').pop()}</strong>
          <span>{item.error || item.step}{item.visionSkipped && ` · ${item.visionSkipped}`}</span>
          {item.textReport && <small>{item.textReport}</small>}{item.visionReport && <small>{item.visionReport}</small>}
        </div>)}</div>
      </>}
    </dialog>
  </>;
}
