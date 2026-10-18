import { useEffect, useRef, useState } from 'react';
import { Download, History, RotateCcw, X } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog.tsx';
import { listToolBackups, readToolBackup, restoreToolBackup, type ToolArea, type ToolBackup, type ToolScope } from './harnessTools.ts';
import { showToast } from './toastStore.ts';

type Props = {
  folder: FileSystemDirectoryHandle;
  scope: ToolScope;
  projectId: string;
  area: ToolArea;
  onRestored: () => void;
  onActivityChange: (busy: boolean) => void;
};

export default function FileHistoryDialog({ folder, scope, projectId, area, onRestored, onActivityChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const confirmAction = useConfirmDialog();
  const [records, setRecords] = useState<ToolBackup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { epoch.current++; dialog.current?.close(); setRecords([]); setError(''); }, [folder, projectId, area]);

  async function refresh() {
    const currentEpoch = epoch.current;
    onActivityChange(true);
    setBusy(true); setError('');
    try { const next = await listToolBackups(folder, scope, projectId, area); if (epoch.current === currentEpoch) setRecords(next); }
    catch (cause) { if (epoch.current === currentEpoch) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { onActivityChange(false); if (epoch.current === currentEpoch) setBusy(false); }
  }
  function open() { dialog.current?.showModal(); void refresh(); }
  async function restore(record: ToolBackup) {
    if (busy) return;
    const currentEpoch = epoch.current;
    onActivityChange(true);
    setBusy(true); setError('');
    try {
      try { await restoreToolBackup(folder, scope, projectId, area, record.id); }
      catch (cause) {
        if (!(cause instanceof Error) || !cause.message.includes('Confirm replacement')) throw cause;
        const okay = await confirmAction(`Replace ${record.path} with its saved version? The current file will be backed up first.`, { title: 'Restore file', confirmLabel: 'Restore', destructive: true });
        if (!okay) return;
        await restoreToolBackup(folder, scope, projectId, area, record.id, true);
      }
      if (epoch.current === currentEpoch) onRestored();
      showToast(`${record.path} restored.`);
      const next = await listToolBackups(folder, scope, projectId, area);
      if (epoch.current === currentEpoch) setRecords(next);
    } catch (cause) { if (epoch.current === currentEpoch) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { onActivityChange(false); if (epoch.current === currentEpoch) setBusy(false); }
  }
  async function download(record: ToolBackup) {
    onActivityChange(true);
    setError('');
    try {
      const { copy } = await readToolBackup(folder, scope, projectId, area, record.id);
      const url = URL.createObjectURL(copy);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${record.path.split('/').at(-1) || 'file'}.backup`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { onActivityChange(false); }
  }

  return <>
    <button className="harness-secondary" onClick={open} title="Browse saved file versions"><History size={15}/> History</button>
    <dialog ref={dialog} className="harness-dialog harness-file-history" onClose={() => setError('')}>
      <div className="harness-file-history-head"><div><span className="harness-overline">RECOVERY</span><h2>File history</h2></div><button className="harness-icon" onClick={() => dialog.current?.close()} aria-label="Close file history"><X size={16}/></button></div>
      <p className="harness-muted">Recent saved versions in this {area === 'library' ? 'library' : 'project'} area.</p>
      {busy && <p className="harness-muted" role="status">Checking saved versions…</p>}
      {error && <p className="harness-file-history-error" role="alert">{error}</p>}
      {!busy && !records.length && <p className="harness-file-history-empty">No labeled backups yet. Existing files remain in your workspace.</p>}
      <div className="harness-file-history-list">{records.map(record => <article key={record.id}>
        <div><strong>{record.path}</strong><small>{new Date(record.createdAt).toLocaleString()} · {(record.bytes / 1024).toFixed(1)} KB</small></div>
        <button className="harness-secondary" onClick={() => void download(record)} disabled={busy} title="Download saved copy"><Download size={14}/> Download</button>
        <button className="harness-primary" onClick={() => void restore(record)} disabled={busy} title="Restore saved copy"><RotateCcw size={14}/> Restore</button>
      </article>)}</div>
      {records.length >= 50 && <p className="harness-muted">Showing the 50 most recent backups for this area.</p>}
    </dialog>
  </>;
}
