import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { MOTION_MODELS } from './motionAssets.ts';
import { saveDiagnosticJson } from './diagnosticReports.ts';
import { captureVisualTestEnvironment, type VisualTestEnvironment } from './visualTestEnvironment.ts';
import { visualRuntimeFailureMessage } from './visualRuntimeFailure.ts';
import { ensureWritableFolder } from './storage.ts';
import { saveVisualArtifact } from './visualArtifactProvenance.ts';
import { showToast } from './toastStore.ts';
import { meshPreview, reconstructTripo, renderTripoInput, type TripoBackgroundMode, type TripoClipPoint, type TripoMesh } from './tripoRuntime.ts';
import { motionPackageProvenance, onnxImageEngineProvenance, type VisualModelPackage } from './visualModelProvenance.ts';

type Props = { folder: FileSystemDirectoryHandle | null; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
type Report = { file: string; checkedAt: string; runtime: string; result: 'passed' | 'failed' | 'stopped'; detail: string; environment: VisualTestEnvironment; modelPackage?: VisualModelPackage; runtimePackage?: VisualModelPackage; inferenceBackend?: 'WebGPU primary; decoder may use WASM'; input?: { name: string; resolution: number; densityThreshold: number; marginPercent: number; backgroundMode: TripoBackgroundMode; backgroundTolerance?: number; clipPolygon?: TripoClipPoint[] }; triangles?: number; plyPath?: string; glbPath?: string; savedPath?: string };
const path = MOTION_MODELS.tripo.path;
const TripoMeshViewer = lazy(() => import('./TripoMeshViewer.tsx'));
const startingOutline = (): TripoClipPoint[] => [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }, { x: 0.04, y: 0.96 }];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function TripoModelDiagnostics({ folder, disabled, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const outlineSvg = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ index: number; pointerId: number } | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<TripoBackgroundMode>('auto');
  const [backgroundTolerance, setBackgroundTolerance] = useState(36);
  const clipEnabled = backgroundMode === 'clip';
  const [clipPoints, setClipPoints] = useState<TripoClipPoint[]>(startingOutline);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [paddingPercent, setPaddingPercent] = useState(8);
  const [needsPadding, setNeedsPadding] = useState<boolean | null>(null);
  const [backgroundRemoved, setBackgroundRemoved] = useState(0);
  const [sourceHasTransparency, setSourceHasTransparency] = useState(false);
  const [inputPreview, setInputPreview] = useState('');
  const [imageError, setImageError] = useState('');
  const [resolution, setResolution] = useState(64);
  const [threshold, setThreshold] = useState(25);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [mesh, setMesh] = useState<TripoMesh | null>(null);
  const [plyUrl, setPlyUrl] = useState('');
  const [glbUrl, setGlbUrl] = useState('');
  const [glbPath, setGlbPath] = useState('');
  const [openedPlyName, setOpenedPlyName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => { if (!openRequest || openRequest.path !== path || !folder || disabled) return; if (!dialog.current?.open) dialog.current?.showModal(); onOpenRequestHandled?.(); }, [openRequest?.token, folder, disabled]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (plyUrl) URL.revokeObjectURL(plyUrl); }, [plyUrl]);
  useEffect(() => () => { if (glbUrl) URL.revokeObjectURL(glbUrl); }, [glbUrl]);
  useEffect(() => {
    if (!source) { setSourceUrl(''); return; }
    const url = URL.createObjectURL(source); setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  useEffect(() => {
    if (!source) { setNeedsPadding(null); setImageSize(null); setInputPreview(''); setImageError(''); setBackgroundRemoved(0); setSourceHasTransparency(false); return; }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void renderTripoInput(source, paddingPercent, clipEnabled ? clipPoints : undefined, backgroundMode, backgroundTolerance).then(({ composited, needsPadding: fullFrame, sourceHasTransparency: transparent, backgroundRemoved: removed, sourceWidth, sourceHeight }) => {
        if (cancelled) return;
        setNeedsPadding(fullFrame); setBackgroundRemoved(removed); setSourceHasTransparency(transparent); setImageSize({ width: sourceWidth, height: sourceHeight }); setInputPreview(composited.toDataURL('image/png')); setImageError('');
      }).catch(cause => { if (!cancelled) { setInputPreview(''); setImageError(cause instanceof Error ? cause.message : String(cause)); } });
    }, clipEnabled ? 90 : 0);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [source, paddingPercent, backgroundMode, backgroundTolerance, clipPoints]);

  function imagePoint(event: ReactPointerEvent<SVGElement>): TripoClipPoint | null {
    const svg = outlineSvg.current, transform = svg?.getScreenCTM();
    if (!svg || !transform || !imageSize) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const position = point.matrixTransform(transform.inverse());
    return { x: clamp(position.x / imageSize.width), y: clamp(position.y / imageSize.height) };
  }
  function addPoint(after: number, point: TripoClipPoint) {
    if (busy) return;
    setClipPoints(current => [...current.slice(0, after + 1), point, ...current.slice(after + 1)]);
    setSelectedPoint(after + 1);
  }
  function addMidpoint() {
    const index = selectedPoint ?? clipPoints.reduce((best, point, i) => {
      const next = clipPoints[(i + 1) % clipPoints.length], other = clipPoints[(best + 1) % clipPoints.length];
      return Math.hypot(next.x - point.x, next.y - point.y) > Math.hypot(other.x - clipPoints[best].x, other.y - clipPoints[best].y) ? i : best;
    }, 0);
    const left = clipPoints[index], right = clipPoints[(index + 1) % clipPoints.length];
    addPoint(index, { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
  }
  function removePoint(index: number) {
    if (busy || clipPoints.length <= 3) return;
    setClipPoints(current => current.filter((_, pointIndex) => pointIndex !== index));
    setSelectedPoint(null);
  }
  function startDrag(event: ReactPointerEvent<SVGCircleElement>, index: number) {
    if (busy) return;
    event.preventDefault(); event.stopPropagation();
    setSelectedPoint(index);
    dragging.current = { index, pointerId: event.pointerId };
    outlineSvg.current?.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging.current || dragging.current.pointerId !== event.pointerId) return;
    const point = imagePoint(event);
    const draggedIndex = dragging.current.index;
    if (point) setClipPoints(current => current.map((existing, index) => index === draggedIndex ? point : existing));
  }
  function stopDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragging.current?.pointerId !== event.pointerId) return;
    if (outlineSvg.current?.hasPointerCapture(event.pointerId)) outlineSvg.current.releasePointerCapture(event.pointerId);
    dragging.current = null;
  }
  function pointKey(event: ReactKeyboardEvent<SVGCircleElement>, index: number) {
    if (busy) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removePoint(index); return; }
    const step = event.shiftKey ? 0.02 : 0.005;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault(); setSelectedPoint(index);
    setClipPoints(current => current.map((point, pointIndex) => pointIndex === index ? { x: clamp(point.x + dx), y: clamp(point.y + dy) } : point));
  }
  async function run() {
    if (!folder || !source || busy) return;
    const aborter = new AbortController(); controller.current = aborter;
    const checkedAt = new Date().toISOString();
    const outline = clipEnabled ? clipPoints.map(point => ({ x: point.x, y: point.y })) : undefined;
    const next: Report = { file: path, checkedAt, runtime: 'TripoSR Q8 · ONNX WebGPU', result: 'failed', detail: '', environment: captureVisualTestEnvironment(), input: { name: source.name, resolution, densityThreshold: threshold, marginPercent: paddingPercent, backgroundMode, ...(backgroundMode === 'auto' ? { backgroundTolerance } : {}), ...(outline ? { clipPolygon: outline } : {}) } };
    setBusy(true); setError(''); setPreview(''); setMesh(null); setPlyUrl(''); setGlbUrl(''); setGlbPath(''); setOpenedPlyName(''); setProgress(null); setStage('Checking files…');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the mesh in this workspace.');
      const mesh = await reconstructTripo(folder, source, resolution, threshold, aborter.signal, (message, current, total) => { setStage(message); setProgress(current !== undefined && total !== undefined ? { current, total } : null); }, paddingPercent, outline, backgroundMode, backgroundTolerance);
      next.modelPackage = motionPackageProvenance('tripo');
      next.runtimePackage = onnxImageEngineProvenance();
      next.inferenceBackend = 'WebGPU primary; decoder may use WASM';
      if (aborter.signal.aborted) throw aborter.signal.reason;
      next.triangles = mesh.triangles;
      next.plyPath = `media/meshes/triposr-${checkedAt.replace(/[:.]/g, '-')}.ply`;
      await saveVisualArtifact(folder, next.plyPath, mesh.ply,
        { kind: 'mesh', generatedAt: checkedAt, modelPackage: next.modelPackage, runtimePackage: next.runtimePackage, modelRequired: true,
          inferenceBackend: next.inferenceBackend, source: { name: source.name, origin: 'uploaded' }, settings: next.input });
      setPlyUrl(URL.createObjectURL(mesh.ply)); setPreview(meshPreview(mesh)); setMesh(mesh);
      next.result = 'passed'; next.detail = `Saved a colored mesh with ${mesh.triangles.toLocaleString()} triangles.`;
      try {
        setStage('Saving GLB…');
        const { exportTripoGlb } = await import('./tripoThree.ts');
        const glb = await exportTripoGlb(mesh);
        next.glbPath = `media/meshes/triposr-${checkedAt.replace(/[:.]/g, '-')}.glb`;
        await saveVisualArtifact(folder, next.glbPath, glb,
          { kind: 'mesh', generatedAt: checkedAt, modelPackage: next.modelPackage, runtimePackage: next.runtimePackage, modelRequired: true,
            inferenceBackend: next.inferenceBackend, source: { name: source.name, origin: 'uploaded' }, settings: next.input });
        setGlbUrl(URL.createObjectURL(glb)); setGlbPath(next.glbPath);
      } catch (cause) {
        next.glbPath = undefined;
        setError(`PLY saved, but GLB export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      showToast('3D mesh saved.');
    } catch (cause) {
      next.result = aborter.signal.aborted ? 'stopped' : 'failed';
      next.detail = aborter.signal.aborted ? 'Stopped by user.' : visualRuntimeFailureMessage(cause);
      if (!aborter.signal.aborted) setError(next.detail);
    } finally {
      try { next.savedPath = await saveDiagnosticJson(folder, path, checkedAt, 'mesh', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setReport({ ...next }); setBusy(false); setStage(''); setProgress(null); controller.current = null;
    }
  }
  async function openPly(file: File) {
    if (busy) return;
    setBusy(true); setError(''); setStage('Opening PLY…');
    try {
      const { importTripoPly } = await import('./tripoThree.ts');
      const imported = await importTripoPly(file);
      setMesh(imported); setPreview(meshPreview(imported));
      setPlyUrl(URL.createObjectURL(file)); setGlbUrl(''); setGlbPath('');
      setOpenedPlyName(file.name); setReport(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setStage(''); }
  }
  async function saveCurrentGlb() {
    if (!mesh || !folder || busy) return;
    setBusy(true); setError(''); setStage('Saving GLB…');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the GLB in this workspace.');
      const { exportTripoGlb } = await import('./tripoThree.ts');
      const glb = await exportTripoGlb(mesh);
      const stem = (openedPlyName || report?.plyPath?.split('/').at(-1) || `triposr-${Date.now()}.ply`).replace(/\.ply$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const savedPath = `media/meshes/${stem}-${crypto.randomUUID()}.glb`;
      await saveVisualArtifact(folder, savedPath, glb,
        { kind: report ? 'mesh' : 'mesh-conversion', generatedAt: new Date().toISOString(), modelPackage: report?.modelPackage,
          runtimePackage: report?.runtimePackage, modelRequired: !!report?.modelPackage,
          inferenceBackend: report?.inferenceBackend,
          source: { name: openedPlyName || report?.plyPath || 'Current mesh', origin: openedPlyName ? 'imported-ply' : 'generated' },
          settings: report?.input });
      setGlbPath(savedPath); setGlbUrl(URL.createObjectURL(glb));
      showToast('GLB saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setStage(''); }
  }
  async function copyReport() { if (!report) return; try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); showToast('3D report copied.'); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog motion-diagnostics-dialog" aria-labelledby="tripo-diagnostics-title">
      <div className="provider-heading"><h2 id="tripo-diagnostics-title">TripoSR Q8</h2><button className="model-limit-info" type="button" title="3D image tips" aria-label="3D image tips" onClick={() => helpDialog.current?.showModal()}><CircleHelp size={17}/></button><button className="button secondary compact" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      <p className="muted">Create a static 3D mesh from a PNG, WebP, or JPEG.</p>
      <div className="motion-controls">
        <label className="field"><span>Object image</span><input type="file" accept="image/png,image/webp,image/jpeg" disabled={busy} onChange={event => { setNeedsPadding(null); setImageSize(null); setInputPreview(''); setImageError(''); setBackgroundMode('auto'); setClipPoints(startingOutline()); setSelectedPoint(null); setReport(null); setPreview(''); setMesh(null); setPlyUrl(''); setGlbUrl(''); setGlbPath(''); setOpenedPlyName(''); setSource(event.target.files?.[0] || null); }}/></label>
        {source && <><label className="field"><span>Background</span><select value={backgroundMode} disabled={busy} onChange={event => { setBackgroundMode(event.target.value as TripoBackgroundMode); setSelectedPoint(null); }}><option value="auto">Remove solid background</option><option value="keep">Keep original background</option><option value="clip">Clip object manually</option></select></label>{backgroundMode === 'auto' && <label className="field"><span>Color tolerance · {backgroundTolerance}</span><input type="range" min={10} max={100} step={2} value={backgroundTolerance} disabled={busy} onChange={event => setBackgroundTolerance(Number(event.target.value))}/></label>}<label className="field"><span>Object margin · {paddingPercent}%</span><input type="range" min={0} max={30} step={1} value={paddingPercent} disabled={busy} onChange={event => setPaddingPercent(Number(event.target.value))}/></label></>}
        <label className="field"><span>Mesh detail · {resolution}³ ({(resolution ** 3).toLocaleString()} samples)</span><input type="range" min={32} max={128} step={16} value={resolution} disabled={busy} onChange={event => setResolution(Number(event.target.value))}/></label>
        <label className="field"><span>Surface threshold · {threshold}</span><input type="range" min={5} max={50} step={1} value={threshold} disabled={busy} onChange={event => setThreshold(Number(event.target.value))}/></label>
      </div>
      {clipEnabled && source && imageSize && <section className="tripo-clip-controls" aria-label="Image clipping"><div><button className="button secondary compact" type="button" disabled={busy} onClick={addMidpoint}>Add point</button><button className="button danger compact" type="button" disabled={busy || selectedPoint === null || clipPoints.length <= 3} onClick={() => { if (selectedPoint !== null) removePoint(selectedPoint); }}>Remove point</button><button className="button danger compact" type="button" disabled={busy} onClick={() => { setClipPoints(startingOutline()); setSelectedPoint(null); }}>Reset outline</button></div></section>}
      {source && needsPadding !== null && <small>{backgroundMode === 'auto' ? sourceHasTransparency ? 'Existing transparency preserved.' : backgroundRemoved ? 'Solid background removed. Increase tolerance if edges remain; decrease it if the object disappears.' : 'No solid background found. Use Clip object manually if the preview includes the background.' : backgroundMode === 'keep' && needsPadding ? 'The full image, including its background, will be sent to TripoSR.' : ''}</small>}
      {clipEnabled && sourceUrl && imageSize && <div className="tripo-clip-editor">
        <svg ref={outlineSvg} viewBox={['0', '0', imageSize.width, imageSize.height].join(' ')} role="group" aria-label="Drag clipping points; click an edge to add a point" onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <image href={sourceUrl} x={0} y={0} width={imageSize.width} height={imageSize.height}/>
          <path d={'M0 0 H' + imageSize.width + ' V' + imageSize.height + ' H0 Z M' + clipPoints.map(point => point.x * imageSize.width + ' ' + point.y * imageSize.height).join(' L') + ' Z'} fill="#15221799" fillRule="evenodd" pointerEvents="none"/>
          <polygon points={clipPoints.map(point => point.x * imageSize.width + ',' + point.y * imageSize.height).join(' ')} fill="none" stroke="#9bffae" strokeWidth={Math.max(2, Math.min(imageSize.width, imageSize.height) / 160)} pointerEvents="none"/>
          {clipPoints.map((point, index) => {
            const next = clipPoints[(index + 1) % clipPoints.length];
            return <line key={'edge-' + index} x1={point.x * imageSize.width} y1={point.y * imageSize.height} x2={next.x * imageSize.width} y2={next.y * imageSize.height} stroke="transparent" strokeWidth={Math.max(18, Math.min(imageSize.width, imageSize.height) / 18)} pointerEvents="stroke" onPointerDown={event => { if (busy) return; const position = imagePoint(event); if (position) addPoint(index, position); }}/>;
          })}
          {clipPoints.map((point, index) => <circle key={'point-' + index} cx={point.x * imageSize.width} cy={point.y * imageSize.height} r={Math.max(9, Math.min(imageSize.width, imageSize.height) / 42)} fill={selectedPoint === index ? '#ffcc64' : '#fff'} stroke="#245c36" strokeWidth={Math.max(2, Math.min(imageSize.width, imageSize.height) / 180)} tabIndex={0} role="button" aria-label={'Clipping point ' + (index + 1)} onPointerDown={event => startDrag(event, index)} onClick={() => setSelectedPoint(index)} onKeyDown={event => pointKey(event, index)}/>)}
        </svg>
        <small>Drag points to outline the object. Click an edge to add a point.</small>
      </div>}
      {inputPreview && <figure className="tripo-input-preview"><img src={inputPreview} alt="Image prepared for TripoSR with the final gray background"/><figcaption>Model input preview</figcaption></figure>}
      {imageError && <p role="alert" className="model-error">{imageError}</p>}
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={!source || needsPadding === null || !!imageError || busy} onClick={() => void run()}>{busy ? 'Working…' : 'Create mesh'}</button><label className="button secondary compact tripo-ply-picker">Open PLY<input type="file" accept=".ply" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openPly(file); }}/></label>{busy && controller.current && <button className="button danger compact" type="button" onClick={() => controller.current?.abort(new DOMException('Stopped by user.', 'AbortError'))}>Stop</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copyReport()}>Copy JSON</button></div>
      {stage && <p role="status">{stage}</p>}{progress && <progress value={progress.current} max={progress.total} aria-label="3D surface sampling progress"/>}{error && <p role="alert" className="model-error">{error}</p>}
      {mesh ? <Suspense fallback={preview && <figure><img className="motion-depth-preview" src={preview} alt="Projected preview of the generated 3D mesh"/><figcaption>Loading 3D viewer…</figcaption></figure>}><TripoMeshViewer mesh={mesh}/></Suspense> : preview && <figure><img className="motion-depth-preview" src={preview} alt="Projected preview of the generated 3D mesh"/><figcaption>Mesh preview</figcaption></figure>}
      {(report || mesh) && <div className="image-model-results">{report && <p>{report.result === 'passed' ? '✅' : report.result === 'failed' ? '❌' : '⏹️'} {report.detail}</p>}<div className="settings-actions">{mesh && !glbUrl && <button className="button secondary compact" type="button" disabled={busy || !folder} onClick={() => void saveCurrentGlb()}>Save GLB</button>}{glbUrl && <a className="button secondary compact" href={glbUrl} download={glbPath.split('/').at(-1)}>Download GLB</a>}{plyUrl && <a className="button secondary compact" href={plyUrl} download={report?.plyPath?.split('/').at(-1) || openedPlyName}>Download PLY</a>}</div>{glbPath && <small>GLB saved to {glbPath}</small>}{report?.plyPath && <small>PLY saved to {report.plyPath}</small>}{mesh && <small>GLB includes vertex colors. This model does not generate texture maps or UVs.</small>}{report?.savedPath && <small>Report saved to {report.savedPath}</small>}</div>}
    </dialog>
    <dialog ref={helpDialog} className="model-limit-dialog" aria-labelledby="tripo-help-title"><h2 id="tripo-help-title">Better 3D results</h2><p>Use one centered object, seen from an angle that shows its shape. A plain background works with automatic removal; use manual clipping if its color matches the object. Check the model input preview before generating.</p><p><strong>Object margin</strong> changes how much of the image the object fills. Start near 8%; try a smaller margin for thin objects or a larger one if edges are cut off.</p><p><strong>Mesh detail</strong> changes the 3D sampling grid. Higher values smooth blocky edges but take much longer and cannot restore detail the model did not predict. <strong>Surface threshold</strong> changes where the visible surface is cut from the predicted density; try small adjustments if parts are missing or bloated.</p><p>TripoSR guesses the unseen side from one photo. It does not produce UVs or an image texture in this browser workflow.</p><form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
  </>;
}
