import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BROWSER_IMAGE_GROUPS, browserImageAssetsManager, browserImageModelLabel, getBrowserImageAssets, subscribeBrowserImageAssets, type BrowserImageModelGroup } from './browserImageAssets.ts';
import { generateBrowserImage } from './browserImage.ts';
import { browserImagePresetForGroup, IMAGE_PRESETS } from './imageGeneration.ts';
import { imageRunProvenance, saveImageOutput } from './imageProvenance.ts';
import { saveDiagnosticJson } from './diagnosticReports.ts';
import { framePngBlob, saveFrameSequenceZip } from './motionFrameExport.ts';
import { assertMotionFiles, MOTION_MODELS, type MotionModel } from './motionAssets.ts';
import { cameraAtKeyframes, cameraFrame, depthFromBlob, depthPreview, estimateDepth, imageDataFromBlob, interpolateRifeBatch, loopCameraAt, parallaxFrame, recordFrames, type CameraKeyframe, type FrameSource, type ParallaxControls } from './motionRuntime.ts';
import { loadMotionProjectSettings, motionProjectSettingsPath, saveMotionProjectSettings, type MotionProjectSettings } from './motionProjectSettings.ts';
import { ensureWritableFolder } from './storage.ts';
import { saveVisualArtifact, writeVisualArtifactSidecar, type VisualArtifactDetails } from './visualArtifactProvenance.ts';
import { showToast } from './toastStore.ts';
import { captureVisualTestEnvironment, type VisualTestEnvironment } from './visualTestEnvironment.ts';
import { visualRuntimeFailureMessage } from './visualRuntimeFailure.ts';
import { measureWebmTiming, videoTimingWarnings, type VideoTiming } from './webmTiming.ts';
import { measureMp4Timing } from './mp4Timing.ts';
import { probeVideoEncodingSupport, type VideoEncodingSupport, type VideoExportFormat } from './videoEncodingSupport.ts';
import { motionPackageProvenance, onnxImageEngineProvenance, type VisualModelPackage } from './visualModelProvenance.ts';

type Props = { folder: FileSystemDirectoryHandle | null; model: MotionModel; projectId?: string; projectName?: string; onWrite?: <T,>(action: () => Promise<T>) => Promise<T>; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
type Report = { file: string; checkedAt: string; runtime: string; test: string; motionMethod: 'depth-camera' | 'frame-interpolation'; result: 'passed' | 'failed' | 'stopped'; detail: string; environment: VisualTestEnvironment; modelPackage?: VisualModelPackage; runtimePackage?: VisualModelPackage; encodingSupport?: VideoEncodingSupport; inferenceBackend?: 'WebGPU' | 'WASM'; inputImageBackend?: 'WebGPU'; inputImageProvenance?: ReturnType<typeof imageRunProvenance>; sourceImagePath?: string; videoExport?: { mimeType: string; bytes: number; recorderVideoBitsPerSecond: number }; videoEncodingError?: string; timing?: VideoTiming & { container: 'WebM' | 'MP4'; expectedDurationSeconds: number; expectedFps: number; warning?: string }; timingError?: string; inputs: { prompt?: string; imageSeed?: number; firstFrame?: string; intermediateFrames?: string[]; lastFrame?: string; depthMap?: string; imageModel?: string; cameraMotionPx?: number; camera?: ParallaxControls; cameraAnimation?: { mode: 'loop' | 'keyframes'; keyframes?: CameraKeyframe[] }; clip?: { durationSeconds: number; fps: number; frameCount: number }; exportFormat?: VideoExportFormat; requestedVideoBitsPerSecond?: number; frameMultiplier?: number; frameSizePx?: number; exportPngFrames?: boolean }; depthPath?: string; videoPath?: string; frameSequencePath?: string; savedPath?: string };

const keyframeFields = [
  { key: 'strengthPx', label: 'Depth', unit: 'px', min: -40, max: 40 },
  { key: 'panXPx', label: 'Pan X', unit: 'px', min: -80, max: 80 },
  { key: 'panYPx', label: 'Pan Y', unit: 'px', min: -80, max: 80 },
  { key: 'zoomPercent', label: 'Zoom', unit: '%', min: -20, max: 50 },
  { key: 'tiltDegrees', label: 'Tilt', unit: '°', min: -30, max: 30 },
] as const;
const loopAsKeyframes = (camera: ParallaxControls): CameraKeyframe[] => [0, .25, .5, .75, 1].map(at => ({ at, camera: loopCameraAt(camera, at), easing: 'linear' }));

function previewUrl(image: ImageData) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
export default function MotionModelDiagnostics({ folder, model, projectId, projectName, onWrite, disabled, openRequest, onOpenRequestHandled }: Props) {
  const path = MOTION_MODELS[model].path;
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const imageAssets = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const [imageGroup, setImageGroup] = useState<BrowserImageModelGroup>('tiny-q4');
  const [prompt, setPrompt] = useState('A small river winding between green hills, soft morning light');
  const [first, setFirst] = useState<File | null>(null);
  const [last, setLast] = useState<File | null>(null);
  const [intermediate, setIntermediate] = useState<File[]>([]);
  const [depthMapFile, setDepthMapFile] = useState<File | null>(null);
  const [motion, setMotion] = useState(20);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [cameraMode, setCameraMode] = useState<'loop' | 'keyframes'>('loop');
  const [keyframes, setKeyframes] = useState<CameraKeyframe[]>([]);
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(2);
  const [frameRate, setFrameRate] = useState(12);
  const [rifePlaybackFps, setRifePlaybackFps] = useState(0);
  const [frameMultiplier, setFrameMultiplier] = useState<2 | 4 | 8>(2);
  const [rifeSize, setRifeSize] = useState<256 | 512>(256);
  const [exportPngFrames, setExportPngFrames] = useState(false);
  const [exportFormat, setExportFormat] = useState<VideoExportFormat>('auto');
  const [videoBitrateMbps, setVideoBitrateMbps] = useState(0);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsPath, setSettingsPath] = useState('');
  const [savedSettingsKey, setSavedSettingsKey] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [depthImage, setDepthImage] = useState('');
  const [rifePreviews, setRifePreviews] = useState<{ label: string; url: string }[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [frameZipUrl, setFrameZipUrl] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [encodingSupport, setEncodingSupport] = useState<VideoEncodingSupport | null>(null);
  const mobileBatch = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const maxBatchImages = mobileBatch ? 3 : 6;
  const batchImages = intermediate.length + 2;
  const batchFrameCount = (batchImages - 1) * frameMultiplier + 1;
  const installedImages = BROWSER_IMAGE_GROUPS.filter(id => imageAssets.folder === folder && imageAssets.installed[id]);
  const loopSettings: ParallaxControls = { strengthPx: motion, panXPx: panX, panYPx: panY, zoomPercent: zoom, tiltDegrees: tilt };
  const settingsKey = JSON.stringify({ mode: cameraMode, loop: loopSettings, keyframes, durationSeconds, frameRate, exportFormat, videoBitrateMbps });
  useEffect(() => { if (folder && imageAssets.folder !== folder) void browserImageAssetsManager.discover(folder).catch(error => setError(error instanceof Error ? error.message : String(error))); }, [folder, imageAssets.folder]);
  useEffect(() => { let active = true; void probeVideoEncodingSupport().then(support => { if (active) setEncodingSupport(support); }); return () => { active = false; }; }, []);
  useEffect(() => { if (installedImages.length && !installedImages.includes(imageGroup)) setImageGroup(installedImages[0]); }, [installedImages.join(','), imageGroup]);
  useEffect(() => {
    if (!openRequest || openRequest.path !== path || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled, path]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (frameZipUrl) URL.revokeObjectURL(frameZipUrl); }, [frameZipUrl]);
  useEffect(() => { setDepthImage(''); setRifePreviews([]); setDepthMapFile(null); setReport(null); setError(''); }, [model]);
  useEffect(() => {
    if (!folder || !projectId) { setSettingsPath(''); setSavedSettingsKey(''); setSettingsLoading(false); return; }
    let cancelled = false;
    setSettingsLoading(true); setSettingsError('');
    setMotion(20); setPanX(0); setPanY(0); setZoom(0); setTilt(0);
    setCameraMode('loop'); setKeyframes([]); setSelectedKeyframe(null);
    setDurationSeconds(2); setFrameRate(12); setExportFormat('auto'); setVideoBitrateMbps(0); setSettingsPath(''); setSavedSettingsKey('');
    void loadMotionProjectSettings(folder, projectId).then(saved => {
      if (cancelled) return;
      const loop = saved?.loop || { strengthPx: 20, panXPx: 0, panYPx: 0, zoomPercent: 0, tiltDegrees: 0 };
      setMotion(loop.strengthPx); setPanX(loop.panXPx); setPanY(loop.panYPx); setZoom(loop.zoomPercent); setTilt(loop.tiltDegrees);
      setCameraMode(saved?.mode || 'loop'); setKeyframes(saved?.keyframes || []); setSelectedKeyframe(null);
      setDurationSeconds(saved?.durationSeconds || 2); setFrameRate(saved?.frameRate || 12); setExportFormat(saved?.exportFormat || 'auto'); setVideoBitrateMbps(saved?.videoBitrateMbps || 0);
      setSavedSettingsKey(saved ? JSON.stringify({ mode: saved.mode, loop: saved.loop, keyframes: saved.keyframes, durationSeconds: saved.durationSeconds, frameRate: saved.frameRate, exportFormat: saved.exportFormat || 'auto', videoBitrateMbps: saved.videoBitrateMbps || 0 }) : '');
      setSettingsPath(saved ? motionProjectSettingsPath(projectId) : '');
    }).catch(cause => { if (!cancelled) setSettingsError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setSettingsLoading(false); });
    return () => { cancelled = true; };
  }, [folder, projectId]);

  function addKeyframe() {
    if (keyframes.length >= 12) return;
    let widest = 0;
    for (let index = 1; index < keyframes.length - 1; index++) if (keyframes[index + 1].at - keyframes[index].at > keyframes[widest + 1].at - keyframes[widest].at) widest = index;
    const at = (keyframes[widest].at + keyframes[widest + 1].at) / 2;
    const frame = { at, camera: cameraAtKeyframes(keyframes, at), easing: 'ease-in-out' as const };
    setKeyframes([...keyframes.slice(0, widest + 1), frame, ...keyframes.slice(widest + 1)]);
    setSelectedKeyframe(widest + 1);
  }
  function changeKeyframe(index: number, change: Partial<CameraKeyframe>) {
    setKeyframes(current => current.map((frame, position) => position === index ? { ...frame, ...change } : frame));
  }
  async function saveSettings() {
    if (!folder || !projectId || settingsSaving || settingsLoading) return;
    setSettingsSaving(true); setSettingsError('');
    const settings: MotionProjectSettings = { version: 1, updatedAt: new Date().toISOString(), mode: cameraMode, loop: loopSettings, keyframes: keyframes.map(frame => ({ ...frame, camera: { ...frame.camera } })), durationSeconds, frameRate, exportFormat, videoBitrateMbps };
    const key = settingsKey;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save camera settings.');
      const action = () => saveMotionProjectSettings(folder, projectId, settings);
      const savedPath = await (onWrite ? onWrite(action) : action());
      setSettingsPath(savedPath); setSavedSettingsKey(key);
      showToast(`Camera settings saved to ${projectName || 'project'}.`);
    } catch (cause) { setSettingsError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSettingsSaving(false); }
  }

  async function run() {
    if (!folder || busy) return;
    const aborter = new AbortController(); controller.current = aborter;
    setBusy(true); setError(''); setDepthImage(''); setRifePreviews([]); setVideoUrl(''); setFrameZipUrl(''); setReport(null); setStage('Checking files…');
    const checkedAt = new Date().toISOString();
    const camera: ParallaxControls = { strengthPx: motion, panXPx: panX, panYPx: panY, zoomPercent: zoom, tiltDegrees: tilt };
    const frameCount = Math.round(durationSeconds * frameRate);
    const requestedVideoBitsPerSecond = videoBitrateMbps ? Math.round(videoBitrateMbps * 1_000_000) : undefined;
    const rifeFps = rifePlaybackFps || frameMultiplier;
    const imageSeed = model === 'depth' && !first ? crypto.getRandomValues(new Uint32Array(1))[0] : undefined;
    const next: Report = {
      file: path, checkedAt, runtime: 'ONNX image engine', test: model === 'depth' ? first ? 'Image-based camera motion' : 'Prompt image with camera motion' : 'Frame interpolation', motionMethod: model === 'depth' ? 'depth-camera' : 'frame-interpolation', environment: captureVisualTestEnvironment(),
      result: 'failed', detail: '',
      inputs: model === 'depth' ? { prompt: first ? undefined : prompt.trim(), imageSeed, firstFrame: first?.name, depthMap: depthMapFile?.name, imageModel: first ? undefined : browserImageModelLabel(imageGroup), cameraMotionPx: cameraMode === 'loop' ? motion : undefined, camera: cameraMode === 'loop' ? camera : undefined, cameraAnimation: cameraMode === 'keyframes' ? { mode: 'keyframes', keyframes: keyframes.map(frame => ({ ...frame, camera: { ...frame.camera } })) } : { mode: 'loop' }, clip: { durationSeconds, fps: frameRate, frameCount }, exportFormat, requestedVideoBitsPerSecond, exportPngFrames } : { firstFrame: first?.name, intermediateFrames: intermediate.map(file => file.name), lastFrame: last?.name, frameMultiplier, frameSizePx: rifeSize, clip: { durationSeconds: batchFrameCount / rifeFps, fps: rifeFps, frameCount: batchFrameCount }, exportFormat, requestedVideoBitsPerSecond, exportPngFrames },
    };
    const artifactDetails = (kind: VisualArtifactDetails['kind']): VisualArtifactDetails => ({
      kind, generatedAt: checkedAt, modelPackage: next.modelPackage, runtimePackage: next.runtimePackage,
      inputImageProvenance: next.inputImageProvenance,
      modelRequired: !!(next.modelPackage || next.runtimePackage || next.inputImageProvenance?.modelPackage),
      inferenceBackend: next.inferenceBackend,
      source: first ? { name: first.name, origin: 'uploaded' } : { name: next.sourceImagePath || 'Generated keyframe', origin: 'generated' },
      settings: next.inputs,
    });
    try {
      next.encodingSupport = encodingSupport || await probeVideoEncodingSupport();
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the video in this workspace.');
      if (model !== 'depth' || !depthMapFile) {
        await assertMotionFiles(folder, model);
        next.modelPackage = motionPackageProvenance(model);
      }
      let frames: FrameSource;
      if (model === 'depth') {
        if (!first && (!prompt.trim() || !installedImages.includes(imageGroup))) throw new Error('Add a prompt and download an image model, or choose a first frame.');
        let image: Blob;
        if (first) image = first;
        else {
          setStage('Generating keyframe…');
          image = await generateBrowserImage(prompt.trim(), aborter.signal, setStage, undefined, imageGroup, { seed: imageSeed });
          next.inputImageBackend = 'WebGPU';
          const sourcePath = `sources/generated/motion-first-frame-${checkedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.png`;
          const saved = await saveImageOutput(folder, image, IMAGE_PRESETS[browserImagePresetForGroup(imageGroup)], prompt.trim(), sourcePath, checkedAt, imageSeed);
          next.sourceImagePath = sourcePath;
          next.inputImageProvenance = saved.provenance;
        }
        if (aborter.signal.aborted) throw aborter.signal.reason;
        const source = await imageDataFromBlob(image);
        setStage(depthMapFile ? 'Reading depth map…' : 'Estimating depth…');
        const depth = depthMapFile ? await depthFromBlob(depthMapFile, source.width, source.height) : await estimateDepth(folder, source, backend => { next.inferenceBackend = backend; });
        if (!depthMapFile) next.runtimePackage = onnxImageEngineProvenance();
        if (aborter.signal.aborted) throw aborter.signal.reason;
        const preview = depthPreview(depth);
        setDepthImage(previewUrl(preview));
        next.depthPath = `media/depth/depth-map-${checkedAt.replace(/[:.]/g, '-')}.png`;
        await saveVisualArtifact(folder, next.depthPath, await framePngBlob(preview), artifactDetails('depth-map'));
        setStage(`Rendering ${frameCount} camera-motion frames…`);
        frames = { count: frameCount, frame: index => cameraMode === 'keyframes'
          ? cameraFrame(source, depth, cameraAtKeyframes(keyframes, index / (frameCount - 1)))
          : parallaxFrame(source, depth, index / frameCount, camera) };
      } else {
        if (!first || !last) throw new Error('Choose a first and last frame.');
        if (batchImages > maxBatchImages) throw new Error(`Choose at most ${maxBatchImages} images on this device.`);
        const sources = await Promise.all([first, ...intermediate, last].map(file => imageDataFromBlob(file, rifeSize, rifeSize)));
        const previews = new Map<number, { label: string; url: string }>();
        const showPreviews = () => setRifePreviews([...previews.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
        sources.forEach((source, index) => previews.set(index * frameMultiplier, { label: index === 0 ? 'First' : index === sources.length - 1 ? 'Last' : `${Math.round(index / (sources.length - 1) * 100)}%`, url: previewUrl(source) }));
        showPreviews();
        const interpolatedCount = (sources.length - 1) * (frameMultiplier - 1);
        setStage(`Interpolating ${interpolatedCount} frames…`);
        frames = await interpolateRifeBatch(folder, sources, frameMultiplier, (index, total, frame) => {
          const segment = Math.floor((index - 1) / (frameMultiplier - 1));
          const position = segment * frameMultiplier + (index - 1) % (frameMultiplier - 1) + 1;
          previews.set(position, { label: `${Math.round(position / (batchFrameCount - 1) * 100)}%`, url: previewUrl(frame) });
          showPreviews();
          setStage(`Interpolated ${index}/${total} frames…`);
        }, aborter.signal, backend => { next.inferenceBackend = backend; setStage(`Interpolating ${interpolatedCount} frames · ${backend}…`); });
        next.runtimePackage = onnxImageEngineProvenance();
        if (aborter.signal.aborted) throw aborter.signal.reason;
      }
      const fps = model === 'depth' ? frameRate : rifeFps;
      const totalFrames = Array.isArray(frames) ? frames.length : frames.count;
      const name = `${model === 'depth' ? first ? 'depth-camera' : 'prompt-camera-motion' : 'rife-interpolation'}-${checkedAt.replace(/[:.]/g, '-')}`;
      let clip: Blob | null = null;
      let recorderVideoBitsPerSecond = 0;
      try {
        const encoded = await recordFrames(frames, fps, index => setStage(`Encoding frame ${index}/${totalFrames}…`), aborter.signal, { format: exportFormat, videoBitsPerSecond: requestedVideoBitsPerSecond });
        clip = encoded.blob; recorderVideoBitsPerSecond = encoded.recorderVideoBitsPerSecond;
      }
      catch (cause) {
        if (aborter.signal.aborted) throw cause;
        next.videoEncodingError = cause instanceof Error ? cause.message : String(cause);
      }
      if (aborter.signal.aborted) throw aborter.signal.reason;
      if (clip) {
        next.videoExport = { mimeType: clip.type, bytes: clip.size, recorderVideoBitsPerSecond };
        const isWebm = clip.type.startsWith('video/webm');
        setStage('Measuring video timing…');
        try {
          const measured = isWebm ? await measureWebmTiming(clip) : await measureMp4Timing(clip);
          const expectedDurationSeconds = totalFrames / fps;
          const warnings = videoTimingWarnings(measured, totalFrames, fps);
          next.timing = { ...measured, container: isWebm ? 'WebM' : 'MP4', expectedDurationSeconds, expectedFps: fps, warning: warnings.length ? warnings.join(' ') : undefined };
        } catch (cause) { next.timingError = cause instanceof Error ? cause.message : String(cause); }
        next.videoPath = `media/videos/${name}.${isWebm ? 'webm' : 'mp4'}`;
        await saveVisualArtifact(folder, next.videoPath, clip, artifactDetails('video'));
        setVideoUrl(URL.createObjectURL(clip));
      }
      if (exportPngFrames || !clip) {
        const sequencePath = `media/frames/${name}.zip`;
        const archive = await saveFrameSequenceZip(folder, sequencePath, frames, fps, aborter.signal, (index, count) => setStage(`Exporting PNG frame ${index}/${count}…`));
        next.frameSequencePath = sequencePath;
        await writeVisualArtifactSidecar(folder, sequencePath, archive.size, artifactDetails('frame-sequence'));
        setFrameZipUrl(URL.createObjectURL(archive));
      }
      next.result = 'passed';
      next.detail = clip ? model === 'depth' ? `Encoded ${frameCount} camera-motion frames${exportPngFrames ? ' and a PNG sequence' : ''} and ${depthMapFile ? 'used an imported' : 'estimated a'} depth map. Review the preview for quality.` : `Encoded ${batchFrameCount} frames from ${batchImages} source images${exportPngFrames ? ' and a PNG sequence' : ''}. Review the preview for quality.` : `Video encoding failed; saved ${totalFrames} PNG frames as a ZIP instead.`;
      showToast(`${MOTION_MODELS[model].label} ${clip ? exportPngFrames ? 'video and frames' : 'video' : 'PNG frames'} saved.`);
    } catch (cause) {
      next.result = aborter.signal.aborted ? 'stopped' : 'failed';
      next.detail = aborter.signal.aborted ? 'Stopped by user.' : visualRuntimeFailureMessage(cause);
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
      <p className="muted">{model === 'depth' ? 'Generate a keyframe from text or choose an image, then add camera motion.' : 'Choose two or more ordered images and interpolate the frames between them.'}</p>
      <div className="motion-controls">
        {model === 'depth' && <><label className="field"><span>Prompt</span><textarea rows={2} value={prompt} onChange={event => setPrompt(event.target.value)}/></label><label className="field"><span>Image model</span><select value={imageGroup} onChange={event => setImageGroup(event.target.value as BrowserImageModelGroup)}>{installedImages.map(id => <option key={id} value={id}>{browserImageModelLabel(id)}</option>)}{!installedImages.length && <option value={imageGroup}>No image model downloaded</option>}</select></label></>}
        <div className="field"><label htmlFor="motion-first-frame">{model === 'depth' ? 'Image instead of prompt' : 'First frame'}</label><input id="motion-first-frame" type="file" accept="image/*" disabled={busy} onChange={event => { setFirst(event.target.files?.[0] || null); setRifePreviews([]); }}/>{first && <button type="button" className="button secondary compact" disabled={busy} onClick={event => { setFirst(null); setRifePreviews([]); const input = event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null; if (input) input.value = ''; }}>Clear</button>}</div>
        {model === 'depth' && <div className="field"><label htmlFor="motion-depth-map">Depth map (optional PNG)</label><input id="motion-depth-map" type="file" accept="image/png" onChange={event => setDepthMapFile(event.target.files?.[0] || null)}/>{depthMapFile && <button type="button" className="button secondary compact" onClick={event => { setDepthMapFile(null); const input = event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null; if (input) input.value = ''; }}>Clear</button>}</div>}
        {model === 'rife' && <div className="field"><label htmlFor="motion-intermediate-frames">Intermediate images · {intermediate.length}/{maxBatchImages - 2}</label><input id="motion-intermediate-frames" type="file" accept="image/*" multiple disabled={busy || batchImages >= maxBatchImages} onChange={event => {
          const added = [...(event.target.files || [])];
          event.target.value = '';
          if (intermediate.length + added.length > maxBatchImages - 2) { setError(`Choose at most ${maxBatchImages} images on this device.`); return; }
          setIntermediate(current => [...current, ...added]); setError(''); setRifePreviews([]);
        }}/>{intermediate.length > 0 && <ol className="motion-batch-list">{intermediate.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span title={file.name}>{file.name}</span><button type="button" className="button secondary compact" aria-label={`Move ${file.name} earlier`} disabled={busy || index === 0} onClick={() => { setIntermediate(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); setRifePreviews([]); }}>↑</button><button type="button" className="button secondary compact" aria-label={`Move ${file.name} later`} disabled={busy || index === intermediate.length - 1} onClick={() => { setIntermediate(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; }); setRifePreviews([]); }}>↓</button><button type="button" className="button danger compact" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => { setIntermediate(current => current.filter((_, position) => position !== index)); setRifePreviews([]); }}>×</button></li>)}</ol>}</div>}
        {model === 'rife' && <div className="field"><label htmlFor="motion-last-frame">Last frame</label><input id="motion-last-frame" type="file" accept="image/*" disabled={busy} onChange={event => { setLast(event.target.files?.[0] || null); setRifePreviews([]); }}/>{last && <button type="button" className="button secondary compact" disabled={busy} onClick={event => { setLast(null); setRifePreviews([]); const input = event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null; if (input) input.value = ''; }}>Clear</button>}</div>}
        {model === 'rife' && <label className="field"><span>Frame multiplier · {batchFrameCount} total frames</span><select aria-label="Frame multiplier" value={frameMultiplier} disabled={busy} onChange={event => { setFrameMultiplier(Number(event.target.value) as 2 | 4 | 8); setRifePreviews([]); }}><option value={2}>2×</option><option value={4}>4×</option><option value={8}>8×</option></select></label>}
        {model === 'rife' && <label className="field"><span>Playback frame rate</span><select aria-label="Playback frame rate" value={rifePlaybackFps} disabled={busy} onChange={event => setRifePlaybackFps(Number(event.target.value))}><option value={0}>Auto · {frameMultiplier} fps</option>{[2, 4, 8, 12, 16, 24].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label>}
        {model === 'rife' && <label className="field"><span>Frame size</span><select aria-label="Frame size" value={rifeSize} disabled={busy} onChange={event => { setRifeSize(Number(event.target.value) as 256 | 512); setRifePreviews([]); }}><option value={256}>256 × 256 · faster</option><option value={512}>512 × 512 · more detail</option></select></label>}
        {model === 'depth' && <div className="motion-camera-panel">
          <div className="motion-clip-settings">
            <label className="field"><span>Duration · {durationSeconds}s</span><input type="range" min={1} max={6} step={0.5} value={durationSeconds} disabled={busy} onChange={event => setDurationSeconds(Number(event.target.value))}/></label>
            <label className="field"><span>Frame rate</span><select value={frameRate} disabled={busy} onChange={event => setFrameRate(Number(event.target.value))}><option value={8}>8 fps</option><option value={12}>12 fps</option><option value={16}>16 fps</option><option value={24}>24 fps</option></select></label>
            <small>{Math.round(durationSeconds * frameRate)} frames</small>
          </div>
          <label className="field"><span>Camera motion</span><select value={cameraMode} disabled={busy} onChange={event => {
            const mode = event.target.value as 'loop' | 'keyframes';
            if (mode === 'keyframes' && !keyframes.length) setKeyframes(loopAsKeyframes({ strengthPx: motion, panXPx: panX, panYPx: panY, zoomPercent: zoom, tiltDegrees: tilt }));
            setCameraMode(mode);
          }}><option value="loop">Loop</option><option value="keyframes">Keyframes</option></select></label>
          {cameraMode === 'loop' ? <div className="motion-camera-controls">
            <label className="field"><span>Depth parallax · {motion}px</span><input type="range" min={0} max={40} value={motion} onChange={event => setMotion(Number(event.target.value))}/></label>
            <label className="field"><span>Horizontal pan · {panX}px</span><input type="range" min={-40} max={40} value={panX} onChange={event => setPanX(Number(event.target.value))}/></label>
            <label className="field"><span>Vertical pan · {panY}px</span><input type="range" min={-40} max={40} value={panY} onChange={event => setPanY(Number(event.target.value))}/></label>
            <label className="field"><span>Zoom · {zoom}%</span><input type="range" min={0} max={20} value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
            <label className="field"><span>Tilt · {tilt}°</span><input type="range" min={-8} max={8} value={tilt} onChange={event => setTilt(Number(event.target.value))}/></label>
          </div> : <div className="motion-keyframes">
            <div className="motion-keyframe-heading"><span>Camera poses · % of clip</span><button type="button" className="button secondary compact" disabled={keyframes.length >= 12 || busy} onClick={addKeyframe}>Add keyframe</button></div>
            {keyframes.map((frame, index) => <section className="motion-keyframe" key={index}>
              <button type="button" className="motion-keyframe-toggle" aria-expanded={selectedKeyframe === index} onClick={() => setSelectedKeyframe(current => current === index ? null : index)}><strong>{Math.round(frame.at * 100)}%</strong><span>{index === 0 ? 'Start' : index === keyframes.length - 1 ? 'End' : 'Keyframe'} · {frame.easing === 'ease-in-out' ? 'Smooth' : frame.easing}</span></button>
              {selectedKeyframe === index && <div className="motion-keyframe-fields">
                <label>Time %<input type="number" min={index ? Math.ceil(keyframes[index - 1].at * 100) + 1 : 0} max={index < keyframes.length - 1 ? Math.floor(keyframes[index + 1].at * 100) - 1 : 100} value={Math.round(frame.at * 100)} disabled={index === 0 || index === keyframes.length - 1 || busy} onChange={event => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) changeKeyframe(index, { at: Math.max(keyframes[index - 1].at + .01, Math.min(keyframes[index + 1].at - .01, value / 100)) });
                }}/></label>
                {index < keyframes.length - 1 && <label>Ease to next<select value={frame.easing} disabled={busy} onChange={event => changeKeyframe(index, { easing: event.target.value as CameraKeyframe['easing'] })}><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Smooth</option></select></label>}
                {keyframeFields.map(field => <label key={field.key}>{field.label} {field.unit}<input type="number" min={field.min} max={field.max} value={Math.round(frame.camera[field.key] * 10) / 10} disabled={busy} onChange={event => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) changeKeyframe(index, { camera: { ...frame.camera, [field.key]: Math.max(field.min, Math.min(field.max, value)) } });
                }}/></label>)}
                {index > 0 && index < keyframes.length - 1 && <button type="button" className="button danger compact" disabled={busy} onClick={() => { setKeyframes(current => current.filter((_, position) => position !== index)); setSelectedKeyframe(null); }}>Remove keyframe</button>}
              </div>}
            </section>)}
          </div>}
          {projectId && <div className="motion-project-settings"><button type="button" className="button secondary compact" disabled={busy || settingsLoading || settingsSaving || !!settingsPath && settingsKey === savedSettingsKey} onClick={() => void saveSettings()}>{settingsSaving ? 'Saving…' : 'Save settings to project'}</button><small role={settingsError ? 'alert' : 'status'}>{settingsError || (settingsLoading ? 'Loading project settings…' : settingsPath ? settingsKey === savedSettingsKey ? `Saved in ${projectName || 'project'}` : 'Unsaved changes' : 'Not saved to project')}</small></div>}
        </div>}
        <label className="motion-frame-export"><input type="checkbox" checked={exportPngFrames} disabled={busy} onChange={event => setExportPngFrames(event.target.checked)}/> Export PNG frames as ZIP</label>
        <label className="field"><span>Video format</span><select value={exportFormat} disabled={busy} onChange={event => setExportFormat(event.target.value as VideoExportFormat)}><option value="auto">Auto</option><option value="webm" disabled={!!encodingSupport && !encodingSupport.mediaRecorder.webm.length}>WebM</option><option value="mp4" disabled={!!encodingSupport && !encodingSupport.mediaRecorder.mp4.length}>MP4</option></select></label>
        <label className="field"><span>Video bitrate</span><select aria-label="Video bitrate" value={videoBitrateMbps} disabled={busy} onChange={event => setVideoBitrateMbps(Number(event.target.value))}><option value={0}>Auto</option>{[0.5, 1, 2, 4, 8].map(mbps => <option key={mbps} value={mbps}>{mbps} Mbps</option>)}</select></label>
        <details><summary>Encoding support</summary><small>{encodingSupport ? <>WebM recording: {encodingSupport.mediaRecorder.webm.join(', ') || 'unavailable'}. MP4 recording: {encodingSupport.mediaRecorder.mp4.join(', ') || 'unavailable'}. WebCodecs at 256 × 256: {encodingSupport.webCodecs.available ? encodingSupport.webCodecs.codecs.join(', ') || 'no tested codecs' : 'unavailable'}. Auto prefers WebM, then MP4; PNG ZIP is the fallback. WebCodecs is not the current export path.</> : 'Checking…'}</small></details>
      </div>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={busy || model === 'rife' && (!first || !last) || model === 'depth' && !first && !installedImages.length} onClick={() => void run()}>{busy ? 'Running…' : model === 'depth' ? 'Run video test' : 'Run interpolation test'}</button>{busy && <button className="button danger compact" type="button" onClick={() => { controller.current?.abort(new DOMException('Stopped by user.', 'AbortError')); setStage('Stopping…'); }}>Stop</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copyReport()}>Copy JSON</button></div>
      {stage && <p role="status">{stage}</p>}{error && <p role="alert" className="model-error">{error}</p>}
      {report && <div className="image-model-results"><p>{report.result === 'passed' ? '✅' : report.result === 'failed' ? '❌' : '⏹️'} {report.detail}</p>{report.videoEncodingError && <p className="motion-timing-warning" role="alert">⚠️ {report.videoEncodingError}</p>}{report.timing?.warning && <p className="motion-timing-warning" role="alert">⚠️ {report.timing.warning}</p>}{report.timingError && <p className="motion-timing-warning" role="alert">⚠️ Timing could not be measured: {report.timingError}</p>}{report.timing && <small>Playback {report.timing.durationSeconds.toFixed(2)}s · {report.timing.effectiveFps.toFixed(2)} effective fps</small>}{report.sourceImagePath && <small>First frame saved to {report.sourceImagePath}</small>}{report.savedPath && <small>Report saved to {report.savedPath}</small>}</div>}
      {model === 'rife' && rifePreviews.length > 0 && <div className="motion-rife-previews" aria-label="Interpolation frames">{rifePreviews.map(frame => <figure key={frame.label}><img src={frame.url} alt={`${frame.label} interpolation frame`}/><figcaption>{frame.label}</figcaption></figure>)}</div>}
      {depthImage && <figure><img className="motion-depth-preview" src={depthImage} alt="Relative depth in grayscale"/><figcaption>Depth map</figcaption><a className="button secondary compact" href={depthImage} download={report?.depthPath?.split('/').at(-1) || 'depth-map.png'}>Download PNG</a>{report?.depthPath && <small>Saved to {report.depthPath}</small>}</figure>}
      {videoUrl && report?.videoPath && <div className="motion-result"><video src={videoUrl} controls loop={report.inputs.cameraAnimation?.mode !== 'keyframes'} muted playsInline/><a className="button secondary compact" href={videoUrl} download={report.videoPath.split('/').at(-1) || 'motion.webm'}>Download {report.videoPath.endsWith('.mp4') ? 'MP4' : 'WebM'}</a><small>Saved to {report.videoPath}</small></div>}
      {frameZipUrl && report?.frameSequencePath && <div className="motion-result"><a className="button secondary compact" href={frameZipUrl} download={report.frameSequencePath.split('/').at(-1) || 'frames.zip'}>Download PNG frames</a><small>Saved to {report.frameSequencePath}</small></div>}
    </dialog>
  </>;
}
