import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BROWSER_IMAGE_GROUPS, browserImageAssetsManager, browserImageModelLabel, getBrowserImageAssets, subscribeBrowserImageAssets, type BrowserImageModelGroup } from './browserImageAssets.ts';
import { generateBrowserImage } from './browserImage.ts';
import { saveDiagnosticJson } from './diagnosticReports.ts';
import { assertMotionFiles, MOTION_MODELS, type MotionModel } from './motionAssets.ts';
import { depthPreview, estimateDepth, imageDataFromBlob, interpolateRife, parallaxFrame, recordFrames } from './motionRuntime.ts';
import { ensureWritableFolder, writeBlob } from './storage.ts';
import { showToast } from './toastStore.ts';

type Props = { folder: FileSystemDirectoryHandle | null; model: MotionModel; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
type Report = { file: string; checkedAt: string; runtime: string; test: string; result: 'passed' | 'failed' | 'stopped'; detail: string; inputs: { prompt?: string; firstFrame?: string; lastFrame?: string; imageModel?: string; cameraMotionPx?: number }; videoPath?: string; savedPath?: string };

function previewUrl(image: ImageData) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
export default function MotionModelDiagnostics({ folder, model, disabled, openRequest, onOpenRequestHandled }: Props) {
  const path = MOTION_MODELS[model].path;
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const imageAssets = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const [imageGroup, setImageGroup] = useState<BrowserImageModelGroup>('tiny-q4');
  const [prompt, setPrompt] = useState('A small river winding between green hills, soft morning light');
  const [first, setFirst] = useState<File | null>(null);
  const [last, setLast] = useState<File | null>(null);
  const [motion, setMotion] = useState(20);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [depthImage, setDepthImage] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const installedImages = BROWSER_IMAGE_GROUPS.filter(id => imageAssets.folder === folder && imageAssets.installed[id]);
  useEffect(() => { if (folder && imageAssets.folder !== folder) void browserImageAssetsManager.discover(folder).catch(error => setError(error instanceof Error ? error.message : String(error))); }, [folder, imageAssets.folder]);
  useEffect(() => { if (installedImages.length && !installedImages.includes(imageGroup)) setImageGroup(installedImages[0]); }, [installedImages.join(','), imageGroup]);
  useEffect(() => {
    if (!openRequest || openRequest.path !== path || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled, path]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => { setDepthImage(''); setReport(null); setError(''); }, [model]);

  async function run() {
    if (!folder || busy) return;
    const aborter = new AbortController(); controller.current = aborter;
    setBusy(true); setError(''); setDepthImage(''); setStage('Checking files…');
    const checkedAt = new Date().toISOString();
    const next: Report = {
      file: path, checkedAt, runtime: 'ONNX image engine', test: model === 'depth' ? first ? 'Image to video · depth camera motion' : 'Text to video · depth camera motion' : 'Frame interpolation',
      result: 'failed', detail: '',
      inputs: model === 'depth' ? { prompt: first ? undefined : prompt.trim(), firstFrame: first?.name, imageModel: first ? undefined : browserImageModelLabel(imageGroup), cameraMotionPx: motion } : { firstFrame: first?.name, lastFrame: last?.name },
    };
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the video in this workspace.');
      await assertMotionFiles(folder, model);
      let frames: ImageData[];
      if (model === 'depth') {
        if (!first && (!prompt.trim() || !installedImages.includes(imageGroup))) throw new Error('Add a prompt and download an image model, or choose a first frame.');
        let image: Blob;
        if (first) image = first;
        else {
          setStage('Generating keyframe…');
          image = await generateBrowserImage(prompt.trim(), aborter.signal, setStage, undefined, imageGroup);
        }
        if (aborter.signal.aborted) throw aborter.signal.reason;
        setStage('Estimating depth…');
        const source = await imageDataFromBlob(image);
        const depth = await estimateDepth(folder, source);
        if (aborter.signal.aborted) throw aborter.signal.reason;
        setDepthImage(previewUrl(depthPreview(depth)));
        setStage('Rendering 24 camera-motion frames…');
        frames = Array.from({ length: 24 }, (_, index) => parallaxFrame(source, depth, index / 24, motion));
      } else {
        if (!first || !last) throw new Error('Choose a first and last frame.');
        const start = await imageDataFromBlob(first);
        const end = await imageDataFromBlob(last);
        setStage('Interpolating middle frame…');
        const middle = await interpolateRife(folder, start, end, 0.5);
        if (aborter.signal.aborted) throw aborter.signal.reason;
        frames = [start, middle, end];
      }
      const fps = model === 'depth' ? 12 : 2;
      const clip = await recordFrames(frames, fps, index => setStage(`Encoding frame ${index}/${frames.length}…`), aborter.signal);
      if (aborter.signal.aborted) throw aborter.signal.reason;
      const name = `${model === 'depth' ? first ? 'depth-camera' : 'text-to-video' : 'rife-interpolation'}-${checkedAt.replace(/[:.]/g, '-')}.webm`;
      next.videoPath = `media/videos/${name}`;
      await writeBlob(folder, next.videoPath, clip);
      setVideoUrl(URL.createObjectURL(clip));
      next.result = 'passed';
      next.detail = model === 'depth' ? 'Encoded a 24-frame camera-motion clip and estimated a depth map. Review the preview for quality.' : 'Encoded a three-frame clip with one interpolated middle frame. Review the preview for quality.';
      showToast(`${MOTION_MODELS[model].label} video saved.`);
    } catch (cause) {
      next.result = aborter.signal.aborted ? 'stopped' : 'failed';
      next.detail = aborter.signal.aborted ? 'Stopped by user.' : cause instanceof Error ? cause.message : String(cause);
      if (!aborter.signal.aborted) setError(next.detail);
    } finally {
      try { next.savedPath = await saveDiagnosticJson(folder, path, checkedAt, 'video', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setReport({ ...next }); setBusy(false); setStage(''); controller.current = null;
    }
  }
  async function copyReport() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); showToast('Video report copied.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog motion-diagnostics-dialog" aria-labelledby="motion-diagnostics-title">
      <div className="provider-heading"><h2 id="motion-diagnostics-title">{MOTION_MODELS[model].label}</h2><button className="button secondary compact" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      <p className="muted">{model === 'depth' ? 'Generate a keyframe from text or choose an image, then add camera motion.' : 'Choose two images to generate one in-between frame.'}</p>
      <div className="motion-controls">
        {model === 'depth' && <><label className="field"><span>Prompt</span><textarea rows={2} value={prompt} onChange={event => setPrompt(event.target.value)}/></label><label className="field"><span>Image model</span><select value={imageGroup} onChange={event => setImageGroup(event.target.value as BrowserImageModelGroup)}>{installedImages.map(id => <option key={id} value={id}>{browserImageModelLabel(id)}</option>)}{!installedImages.length && <option value={imageGroup}>No image model downloaded</option>}</select></label></>}
        <div className="field"><label htmlFor="motion-first-frame">{model === 'depth' ? 'Image instead of prompt' : 'First frame'}</label><input id="motion-first-frame" type="file" accept="image/*" onChange={event => setFirst(event.target.files?.[0] || null)}/>{first && <button type="button" className="button secondary compact" onClick={event => { setFirst(null); const input = event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null; if (input) input.value = ''; }}>Clear</button>}</div>
        {model === 'rife' && <div className="field"><label htmlFor="motion-last-frame">Last frame</label><input id="motion-last-frame" type="file" accept="image/*" onChange={event => setLast(event.target.files?.[0] || null)}/>{last && <button type="button" className="button secondary compact" onClick={event => { setLast(null); const input = event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null; if (input) input.value = ''; }}>Clear</button>}</div>}
        {model === 'depth' && <label className="field"><span>Camera motion · {motion}px</span><input type="range" min={4} max={40} value={motion} onChange={event => setMotion(Number(event.target.value))}/></label>}
      </div>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={busy || model === 'rife' && (!first || !last) || model === 'depth' && !first && !installedImages.length} onClick={() => void run()}>{busy ? 'Running…' : model === 'depth' ? 'Run video test' : 'Run interpolation test'}</button>{busy && <button className="button danger compact" type="button" onClick={() => { controller.current?.abort(new DOMException('Stopped by user.', 'AbortError')); setStage('Stopping…'); }}>Stop</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copyReport()}>Copy JSON</button></div>
      {stage && <p role="status">{stage}</p>}{error && <p role="alert" className="model-error">{error}</p>}
      {report && <div className="image-model-results"><p>{report.result === 'passed' ? '✅' : report.result === 'failed' ? '❌' : '⏹️'} {report.detail}</p>{report.savedPath && <small>Report saved to {report.savedPath}</small>}</div>}
      {depthImage && <figure><img className="motion-depth-preview" src={depthImage} alt="Estimated relative depth in grayscale"/><figcaption>Estimated depth</figcaption></figure>}
      {videoUrl && report?.videoPath && <div className="motion-result"><video src={videoUrl} controls loop muted playsInline/><a className="button secondary compact" href={videoUrl} download={report.videoPath.split('/').at(-1) || 'motion.webm'}>Download WebM</a><small>Saved to {report.videoPath}</small></div>}
    </dialog>
  </>;
}
