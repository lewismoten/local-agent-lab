import { useEffect, useRef, useState } from 'react';
import { MOTION_MODELS } from './motionAssets.ts';
import { saveDiagnosticJson } from './diagnosticReports.ts';
import { ensureWritableFolder } from './storage.ts';
import { saveVisualArtifact } from './visualArtifactProvenance.ts';
import { showToast } from './toastStore.ts';
import { vectorizeImage } from './vectorRuntime.ts';
import { captureVisualTestEnvironment, type VisualTestEnvironment } from './visualTestEnvironment.ts';
import { motionPackageProvenance, type VisualModelPackage } from './visualModelProvenance.ts';

type Props = { folder: FileSystemDirectoryHandle | null; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
type Report = { file: string; checkedAt: string; runtime: string; result: 'passed' | 'failed'; detail: string; environment: VisualTestEnvironment; modelPackage?: VisualModelPackage; runtimePackage?: VisualModelPackage; inferenceBackend?: 'WASM'; input?: { name: string; preset: string; maxColors: number }; size?: { width: number; height: number; svgBytes: number }; svgPath?: string; savedPath?: string };
const path = MOTION_MODELS.vector.path;

export default function VectorModelDiagnostics({ folder, disabled, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [preset, setPreset] = useState<'bw' | 'poster' | 'photo'>('poster');
  const [maxColors, setMaxColors] = useState(16);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.path !== path || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function run() {
    if (!folder || !source || busy) return;
    const checkedAt = new Date().toISOString();
    const next: Report = { file: path, checkedAt, runtime: 'VTracer WebAssembly 1.0.0-alpha.4', result: 'failed', detail: '', environment: captureVisualTestEnvironment(), input: { name: source.name, preset, maxColors } };
    setBusy(true); setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save vectors in this workspace.');
      const { svg, width, height } = await vectorizeImage(folder, source, preset, maxColors);
      next.modelPackage = motionPackageProvenance('vector');
      next.runtimePackage = motionPackageProvenance('vector_engine');
      next.inferenceBackend = 'WASM';
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      next.size = { width, height, svgBytes: blob.size };
      next.svgPath = `media/vectors/vector-${checkedAt.replace(/[:.]/g, '-')}.svg`;
      await saveVisualArtifact(folder, next.svgPath, blob,
        { kind: 'vector', generatedAt: checkedAt, modelPackage: next.modelPackage, runtimePackage: next.runtimePackage, modelRequired: true,
          inferenceBackend: next.inferenceBackend, source: { name: source.name, origin: 'uploaded' }, settings: next.input });
      setPreview(URL.createObjectURL(blob));
      next.result = 'passed'; next.detail = `Created a ${width} × ${height} SVG. Review the paths and colors in the preview.`;
      showToast('Vector SVG saved.');
    } catch (cause) { next.detail = cause instanceof Error ? cause.message : String(cause); setError(next.detail); }
    finally {
      try { next.savedPath = await saveDiagnosticJson(folder, path, checkedAt, 'vector', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setReport({ ...next }); setBusy(false);
    }
  }
  async function copyReport() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); showToast('Vector report copied.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog motion-diagnostics-dialog" aria-labelledby="vector-diagnostics-title">
      <div className="provider-heading"><h2 id="vector-diagnostics-title">VTracer</h2><button className="button secondary compact" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      <p className="muted">Convert a raster image into editable SVG paths.</p>
      <div className="motion-controls"><label className="field"><span>Image</span><input type="file" accept="image/*" onChange={event => setSource(event.target.files?.[0] || null)}/></label><label className="field"><span>Style</span><select value={preset} onChange={event => setPreset(event.target.value as typeof preset)}><option value="poster">Poster</option><option value="photo">Photo</option><option value="bw">Black and white</option></select></label><label className="field"><span>Maximum colors · {maxColors}</span><input type="range" min={2} max={64} step={1} value={maxColors} disabled={preset === 'bw'} onChange={event => setMaxColors(Number(event.target.value))}/></label></div>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={!source || busy} onClick={() => void run()}>{busy ? 'Tracing…' : 'Create SVG'}</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copyReport()}>Copy JSON</button></div>
      {error && <p role="alert" className="model-error">{error}</p>}
      {preview && <figure><img className="motion-depth-preview" src={preview} alt="Vectorized SVG preview"/><figcaption>SVG preview</figcaption></figure>}
      {report && <div className="image-model-results"><p>{report.result === 'passed' ? '✅' : '❌'} {report.detail}</p>{report.svgPath && preview && <a className="button secondary compact" href={preview} download={report.svgPath.split('/').at(-1)}>Download SVG</a>}{report.svgPath && <small>Saved to {report.svgPath}</small>}{report.savedPath && <small>Report saved to {report.savedPath}</small>}</div>}
    </dialog>
  </>;
}
