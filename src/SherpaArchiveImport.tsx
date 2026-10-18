import { useRef, useState } from 'react';
import { ensureWritableFolder } from './storage.ts';
import { transcriptionAssetsManager } from './transcriptionAssets.ts';
import { SHERPA_ARCHIVE_NAME } from './transcriptionManifest.ts';

const source = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.32/${SHERPA_ARCHIVE_NAME}`;

export default function SherpaArchiveImport({ folder, compact = false }: { folder: FileSystemDirectoryHandle | null; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function importFile(file: File | null) {
    if (!folder || !file) return;
    setBusy(true); setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the Sherpa archive.');
      await transcriptionAssetsManager.importSherpaArchive(folder, file);
      dialog.current?.close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <>
    <button className={compact ? 'button secondary catalog-action-button' : 'button secondary compact'} type="button" title="Import Sherpa archive" aria-label="Import Sherpa archive" disabled={!folder || busy} onClick={() => dialog.current?.showModal()}>{compact ? '📂' : 'Import Sherpa'}</button>
    <dialog ref={dialog} className="model-limit-dialog" aria-label="Import Sherpa Zipformer">
      <div className="provider-heading"><h2>Import Sherpa Zipformer</h2><form method="dialog"><button className="button secondary compact" type="submit" disabled={busy}>Close</button></form></div>
      <p>Download the official archive, then choose it here. The app will verify and unpack the model and engine into your project folder.</p>
      <p><a href={source} target="_blank" rel="noreferrer">Download {SHERPA_ARCHIVE_NAME}</a></p>
      <label className="field"><span>Choose the downloaded archive</span><input type="file" accept=".bz2,.tar.bz2" disabled={busy} onChange={event => void importFile(event.target.files?.[0] || null)}/></label>
      {busy && <div className="model-test-progress" role="status"><span>Verifying and copying archive…</span><progress aria-label="Importing Sherpa archive"/></div>}
      {error && <p className="model-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
