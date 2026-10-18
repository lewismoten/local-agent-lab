import { useEffect, useRef, useState } from 'react';
import { assertMotionFiles, MOTION_MODELS } from './motionAssets.ts';
import { saveDiagnosticJson } from './diagnosticReports.ts';
import { detectImagePose, detectVideoPoses, poseOverlay, type PoseFrame } from './poseRuntime.ts';
import { ensureWritableFolder, writeBlob } from './storage.ts';
import { showToast } from './toastStore.ts';

type Props = { folder: FileSystemDirectoryHandle | null; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
type Report = { file: string; checkedAt: string; runtime: string; result: 'passed' | 'failed' | 'stopped'; detail: string; input?: { name: string; type: string; durationSeconds?: number }; frames: number; people: number; savedPath?: string; posePath?: string };
const path = MOTION_MODELS.pose.path;

async function videoFromFile(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video'); video.preload = 'auto'; video.muted = true; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Could not open this video.'));
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('This video has no readable duration.');
    return { video, url };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export default function PoseModelDiagnostics({ folder, disabled, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.path !== path || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled]);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    if (!folder || !source || busy) return;
    const aborter = new AbortController(); controller.current = aborter;
    const checkedAt = new Date().toISOString();
    const next: Report = { file: path, checkedAt, runtime: 'MediaPipe Vision 1.1.1', result: 'failed', detail: '', input: { name: source.name, type: source.type }, frames: 0, people: 0 };
    setBusy(true); setError(''); setPreview(''); setStage('Checking files…');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save poses in this workspace.');
      await Promise.all([assertMotionFiles(folder, 'pose'), assertMotionFiles(folder, 'pose_engine')]);
      let frames: PoseFrame[];
      if (source.type.startsWith('video/')) {
        const { video, url } = await videoFromFile(source);
        try {
          next.input!.durationSeconds = video.duration;
          setStage('Reading video frames…');
          frames = await detectVideoPoses(folder, video, video.duration, aborter.signal, (done, total) => setStage(`Detecting poses · ${done}/${total} frames`));
          if (frames.length) setPreview(poseOverlay(video, video.videoWidth, video.videoHeight, frames[frames.length - 1]));
        } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
      } else if (source.type.startsWith('image/')) {
        const bitmap = await createImageBitmap(source);
        try {
          setStage('Detecting body landmarks…');
          frames = [await detectImagePose(folder, bitmap)];
          setPreview(poseOverlay(bitmap, bitmap.width, bitmap.height, frames[0]));
        } finally { bitmap.close(); }
      } else throw new Error('Choose a photo or video file.');
      if (aborter.signal.aborted) throw aborter.signal.reason;
      next.frames = frames.length;
      next.people = Math.max(0, ...frames.map(item => item.landmarks.length));
      const name = `pose-${checkedAt.replace(/[:.]/g, '-')}.json`;
      next.posePath = `media/poses/${name}`;
      await writeBlob(folder, next.posePath, new Blob([JSON.stringify({ schemaVersion: 1, source: source.name, model: path, checkedAt, frames }, null, 2)], { type: 'application/json' }));
      next.result = 'passed';
      next.detail = next.people ? `${frames.length} frame${frames.length === 1 ? '' : 's'} analyzed; up to ${next.people} person${next.people === 1 ? '' : 's'} found.` : 'No person was detected in the selected file.';
      showToast('Pose landmarks saved.');
    } catch (cause) {
      next.result = aborter.signal.aborted ? 'stopped' : 'failed';
      next.detail = aborter.signal.aborted ? 'Stopped by user.' : cause instanceof Error ? cause.message : String(cause);
      if (!aborter.signal.aborted) setError(next.detail);
    } finally {
      try { next.savedPath = await saveDiagnosticJson(folder, path, checkedAt, 'pose', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setReport({ ...next }); setBusy(false); setStage(''); controller.current = null;
    }
  }
  async function copyReport() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); showToast('Pose report copied.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog motion-diagnostics-dialog" aria-labelledby="pose-diagnostics-title">
      <div className="provider-heading"><h2 id="pose-diagnostics-title">Pose Landmarker Full</h2><button className="button secondary compact" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      <p className="muted">Choose a photo or video. Video is sampled at 2 frames per second, up to 90 frames.</p>
      <label className="field"><span>Photo or video</span><input type="file" accept="image/*,video/*" onChange={event => setSource(event.target.files?.[0] || null)}/></label>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={!source || busy} onClick={() => void run()}>{busy ? 'Analyzing…' : 'Detect poses'}</button>{busy && <button className="button danger compact" type="button" onClick={() => controller.current?.abort(new DOMException('Stopped by user.', 'AbortError'))}>Stop</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copyReport()}>Copy JSON</button></div>
      {stage && <p role="status">{stage}</p>}{error && <p role="alert" className="model-error">{error}</p>}
      {preview && <figure><img className="motion-depth-preview" src={preview} alt="Detected body skeleton overlaid on the selected image"/><figcaption>Detected pose</figcaption></figure>}
      {report && <div className="image-model-results"><p>{report.result === 'passed' ? '✅' : report.result === 'failed' ? '❌' : '⏹️'} {report.detail}</p>{report.posePath && <small>Landmarks saved to {report.posePath}</small>}{report.savedPath && <small>Report saved to {report.savedPath}</small>}</div>}
    </dialog>
  </>;
}
