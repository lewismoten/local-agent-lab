import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import HarnessSurfaceArtwork, { SurfaceArtworkButton } from './HarnessSurfaceArtwork.tsx';
import { emptySurfaceArtwork, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ImageConfig } from './imageGeneration.ts';
import { getPrismEngineDownload, PRISM_ASSETS, prismEngineManager, subscribePrismEngineDownload } from './prismEngine';
import { ensureWritableFolder } from './storage';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload, WLLAMA_ASSETS, wllamaEngineManager } from './wllamaEngine';
import NeedleAssetCard from './NeedleAssetCard';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, needleAssetsManager, subscribeNeedleAssets } from './needleAssets';
import { legacyEngineFileCount, organizeEngineFiles } from './engineFolders';
import { showToast } from './toastStore';
import { BROWSER_IMAGE_ENGINE_ASSETS, browserImageAssetsManager, browserImageTotal, getBrowserImageAssets, subscribeBrowserImageAssets } from './browserImageAssets';
import DownloadRing from './DownloadRing';
import { getSpeechAssets, speechAssetsManager, speechTotal, subscribeSpeechAssets } from './speechAssets.ts';
import { CHATTERBOX_ENGINE_ASSETS, KOKORO_ENGINE_ASSETS, OPENVOICE_ENGINE_ASSETS, QWEN_TTS_ENGINE_ASSETS, SPEECH_ENGINE_ASSETS } from './speechManifest.ts';
import { getTranscriptionAssets, subscribeTranscriptionAssets, transcriptionAssetsManager } from './transcriptionAssets.ts';
import { transcriptionTotal } from './transcriptionManifest.ts';
import SherpaArchiveImport from './SherpaArchiveImport.tsx';
import { getMotionAssets, MOTION_MODELS, motionAssetsManager, motionTotal, subscribeMotionAssets } from './motionAssets.ts';

const specs = [
  { group: 'PrismML' as const, assets: PRISM_ASSETS, queue: 'prism-bonsai-queue.json' },
  { group: 'Wllama' as const, assets: WLLAMA_ASSETS, queue: 'wllama-queue.json' },
  { group: 'Needle' as const, assets: NEEDLE_ENGINE_ASSETS, queue: 'needle-rs-queue.json' },
];
const legacyNames = specs.flatMap(spec => [...spec.assets.flatMap(asset => [asset.name, `${asset.name}.download.json`]), spec.queue]);
const prismBytes = PRISM_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
const wllamaBytes = WLLAMA_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);

export default function EngineCatalog({ folder, store, imageOptions = [], onWrite }: {
  folder: FileSystemDirectoryHandle | null;
  store?: HarnessStore;
  imageOptions?: ImageConfig[];
  onWrite?: <T,>(action: () => Promise<T>) => Promise<T>;
}) {
  const state = useSyncExternalStore(subscribePrismEngineDownload, getPrismEngineDownload);
  const wllama = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const needle = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const browserImage = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const speech = useSyncExternalStore(subscribeSpeechAssets, getSpeechAssets);
  const transcription = useSyncExternalStore(subscribeTranscriptionAssets, getTranscriptionAssets);
  const motion = useSyncExternalStore(subscribeMotionAssets, getMotionAssets);
  const [actionError, setActionError] = useState('');
  const [legacyCount, setLegacyCount] = useState(0);
  const [organizing, setOrganizing] = useState(false);
  const [organizeStatus, setOrganizeStatus] = useState('');
  const [surfaceMap, setSurfaceMap] = useState<SurfaceArtworkMap>(emptySurfaceArtwork);
  const [artworkEngine, setArtworkEngine] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => { if (!store) return; let active = true; void store.surfaceArtwork().then(value => { if (active) setSurfaceMap(value); }).catch(error => { if (active) setActionError(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, [store]);
  const artworkControl = (id: string, title: string) => store && onWrite ? <SurfaceArtworkButton store={store} title={title} assetId={surfaceMap.items[`engine:${id}`]?.assetId} onOpen={() => setArtworkEngine({ id, title })}/> : null;
  const autoAttempted = useRef<FileSystemDirectoryHandle | null>(null);
  useEffect(() => {
    if (folder && (browserImage.folder !== folder || !browserImage.checked.engine)) {
      void browserImageAssetsManager.discover(folder).catch(error => setActionError(error instanceof Error ? error.message : String(error)));
    }
  }, [folder, browserImage.folder, browserImage.checked.engine]);
  useEffect(() => {
    if (folder && (needle.folder !== folder || !needle.checked.engine)) {
      void needleAssetsManager.discover(folder).catch(error => setActionError(error instanceof Error ? error.message : String(error)));
    }
  }, [folder, needle.folder, needle.checked.engine]);
  useEffect(() => { if (folder && (speech.folder !== folder || !speech.checked.engine || !speech.checked.kokoro_engine || !speech.checked.chatterbox_engine || !speech.checked.qwen_engine || !speech.checked.openvoice_engine)) void speechAssetsManager.discover(folder).catch(error => setActionError(error instanceof Error ? error.message : String(error))); }, [folder, speech.folder, speech.checked.engine, speech.checked.kokoro_engine, speech.checked.chatterbox_engine, speech.checked.qwen_engine, speech.checked.openvoice_engine]);
  useEffect(() => { if (folder && transcription.folder !== folder) void transcriptionAssetsManager.discover(folder).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))); }, [folder, transcription.folder]);
  useEffect(() => { if (folder && motion.folder !== folder) void motionAssetsManager.discover(folder).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))); }, [folder, motion.folder]);
  useEffect(() => {
    let current = true;
    if (!folder) { setLegacyCount(0); return; }
    void legacyEngineFileCount(folder, legacyNames).then(count => { if (current) setLegacyCount(count); }).catch(error => { if (current) setActionError(error instanceof Error ? error.message : String(error)); });
    return () => { current = false; };
  }, [folder, state.revision, wllama.revision, needle.revision]);
  async function organize() {
    if (!folder || organizing || state.status === 'downloading' || wllama.status === 'downloading' || needle.active) return;
    setOrganizing(true); setOrganizeStatus('Checking engine files…'); setActionError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to organize engine files.');
      let moved = 0;
      for (const spec of specs) {
        setOrganizeStatus(`Organizing ${spec.group}…`);
        moved += await organizeEngineFiles(folder, spec.group, spec.assets, spec.queue, name => setOrganizeStatus(`Moving ${name}…`));
      }
      const remaining = await legacyEngineFileCount(folder, legacyNames);
      setLegacyCount(remaining);
      await Promise.all([prismEngineManager.discover(folder), wllamaEngineManager.discover(folder), needleAssetsManager.discover(folder)]);
      const message = remaining ? 'Engine files copied into folders; some originals could not be removed from this drive.' : `Done · organized ${moved} engine file${moved === 1 ? '' : 's'}.`;
      setOrganizeStatus(message);
      showToast(message, remaining ? 'error' : 'success');
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setActionError(message); setOrganizeStatus('Engine organization stopped.'); }
    finally { setOrganizing(false); }
  }
  useEffect(() => {
    if (!folder || !legacyCount || organizing || state.status === 'downloading' || wllama.status === 'downloading' || needle.active || autoAttempted.current === folder) return;
    autoAttempted.current = folder;
    const access = folder as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState> };
    if (access.queryPermission) void access.queryPermission({ mode: 'readwrite' }).then(permission => { if (permission === 'granted') void organize(); }).catch(() => {});
  }, [folder, legacyCount, organizing, state.status, wllama.status, needle.active]);
  const checking = !!folder && (state.folder !== folder || state.status === 'checking');
  const installed = !checking && state.installed;
  const busy = !checking && state.status === 'downloading';
  const start = async () => {
    if (!folder) return;
    setActionError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the engine.');
      if (state.status === 'paused' || state.status === 'error' && state.bytes > 0) await prismEngineManager.resume(folder);
      else await prismEngineManager.queue(folder);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  };
  const startWllama = async () => {
    if (!folder) return;
    setActionError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save Wllama.');
      if (wllama.status === 'paused' || wllama.status === 'error' && wllama.bytes > 0) await wllamaEngineManager.resume(folder);
      else await wllamaEngineManager.queue(folder);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  };
  const startBrowserImage = async () => {
    if (!folder) return;
    setActionError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the image files.');
      browserImageAssetsManager.queue(folder, 'engine');
      if (browserImage.paused && browserImage.folder === folder) browserImageAssetsManager.resume(folder);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="engine-catalog" aria-label="Browser engines">
    {(legacyCount > 0 || organizing || organizeStatus) && <div className="engine-organize-status" role="status" aria-live="polite">{organizing ? <><progress aria-label="Organizing engine files"/><span>{organizeStatus}</span></> : legacyCount > 0 ? <><span>{organizeStatus || `${legacyCount} engine file${legacyCount === 1 ? '' : 's'} can be moved into folders.`}</span><button className="button secondary compact" type="button" disabled={!folder || state.status === 'downloading' || wllama.status === 'downloading' || !!needle.active} onClick={() => void organize()}>Organize engines</button></> : <span>{organizeStatus}</span>}</div>}
    <div className="model-catalog-scroll engine-table-scroll"><table className="model-catalog-table engine-table"><thead><tr><th scope="col">Engine</th><th scope="col">Developer</th><th scope="col">Version</th><th scope="col">Size</th><th scope="col">License</th><th scope="col">Download</th></tr></thead>
      <tbody><tr>
        <td className="model-catalog-name">{artworkControl('prismml', 'PrismML')}<strong>PrismML</strong></td><td>Prism ML · United States</td><td title="Pinned source commit dd85c7b5d686fc6d2acc8fba005960e4bb6b5346">dd85c7b</td><td>{(prismBytes / 1e6).toFixed(1)} MB</td><td><a href="https://github.com/PrismML-Eng/Talk/blob/dd85c7b5d686fc6d2acc8fba005960e4bb6b5346/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a></td>
        <td><div className="model-catalog-buttons">{!installed && !busy && !checking && <button className="button secondary engine-action-button" type="button" data-tooltip={state.bytes ? 'Resume PrismML download' : 'Download PrismML'} aria-label={state.bytes ? 'Resume PrismML download' : 'Download PrismML'} disabled={!folder || organizing} onClick={() => void start()}>{state.bytes ? '🔄' : '📥'}</button>}{busy && <button className="button secondary engine-action-button" type="button" data-tooltip="Pause PrismML download" aria-label="Pause PrismML download" disabled={organizing} onClick={() => prismEngineManager.pause()}>⏸</button>}</div></td>
      </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Bonsai 2 · WebGPU required · up to 32K context in this app. <a href="https://github.com/PrismML-Eng/Talk/blob/dd85c7b5d686fc6d2acc8fba005960e4bb6b5346/kernels.ts" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{!installed && !checking && state.status !== 'idle' && <span>{state.status === 'queued' ? 'Queued' : state.status === 'paused' ? 'Paused' : state.status === 'error' ? 'Needs retry' : `${(state.bytes / state.total * 100).toFixed(1)}%`}</span>}{state.total > 0 && !installed && !checking && state.bytes > 0 && <progress value={state.bytes} max={state.total} aria-label="PrismML engine download progress"/>}</span></div>{state.error && <p className="model-error" role="alert">{state.error}</p>}</td></tr></tbody>
      <tbody><tr>
        <td className="model-catalog-name">{artworkControl('wllama', 'Wllama')}<strong>Wllama</strong></td><td>ngxson</td><td>3.8.1</td><td>{(wllamaBytes / 1e6).toFixed(1)} MB</td><td><a href="https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/LICENCE" target="_blank" rel="noreferrer">MIT</a></td>
        <td><div className="model-catalog-buttons">{!wllama.installed && wllama.status !== 'downloading' && <button className="button secondary engine-action-button" type="button" data-tooltip={wllama.bytes ? 'Resume Wllama download' : 'Download Wllama'} aria-label={wllama.bytes ? 'Resume Wllama download' : 'Download Wllama'} disabled={!folder || organizing} onClick={() => void startWllama()}>{wllama.bytes ? '🔄' : '📥'}</button>}{wllama.status === 'downloading' && <button className="button secondary engine-action-button" type="button" data-tooltip="Pause Wllama download" aria-label="Pause Wllama download" disabled={organizing} onClick={() => wllamaEngineManager.pause()}>⏸</button>}</div></td>
      </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Browser GGUF models · single files up to 2 GB · up to 32K context in this app. <a href="https://github.com/ngxson/wllama" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{!wllama.installed && wllama.status !== 'idle' && <span>{wllama.status === 'queued' ? 'Queued' : wllama.status === 'paused' ? 'Paused' : wllama.status === 'error' ? 'Needs retry' : `${(wllama.bytes / wllama.total * 100).toFixed(1)}%`}</span>}{wllama.total > 0 && !wllama.installed && wllama.bytes > 0 && <progress value={wllama.bytes} max={wllama.total} aria-label="Wllama download progress"/>}</span></div>{wllama.error && <p className="model-error" role="alert">{wllama.error}</p>}</td></tr></tbody>
      <NeedleAssetCard folder={folder} group="engine" inTable artworkControl={artworkControl('needle', 'Needle')} disabled={organizing}/>
      {(() => {
        const installed = browserImage.folder === folder && browserImage.installed.engine;
        const checked = browserImage.folder === folder && browserImage.checked.engine;
        const active = browserImage.folder === folder && browserImage.active === 'engine';
        const queued = browserImage.folder === folder && browserImage.queue.includes('engine');
        const bytes = browserImage.folder === folder ? browserImage.saved.engine : 0;
        const total = browserImageTotal('engine');
        const resumeHere = queued && browserImage.paused && browserImage.queue[0] === 'engine';
        const ringAction = active ? 'pause' : resumeHere || !queued && bytes > 0 ? 'resume' : undefined;
        return <tbody><tr>
          <td className="model-catalog-name">{artworkControl('onnx-image', 'ONNX image')}<strong>ONNX image</strong></td><td>Microsoft / Scribbler</td><td>1.30.0</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={BROWSER_IMAGE_ENGINE_ASSETS[1].url} target="_blank" rel="noreferrer">MIT</a></td>
          <td><div className="model-catalog-buttons">{checked && !installed && !active && !queued && (bytes === 0 || browserImage.updateAvailable) && <button className="button secondary engine-action-button" type="button" data-tooltip={browserImage.updateAvailable ? 'Update ONNX image engine' : 'Download ONNX image'} aria-label={browserImage.updateAvailable ? 'Update ONNX image engine' : 'Download ONNX image'} disabled={!folder || organizing} onClick={() => void startBrowserImage()}>{browserImage.updateAvailable ? '🔄' : '📥'}</button>}{queued && !resumeHere && <span className="muted">Queued</span>}{!installed && (active || resumeHere || bytes > 0 && !browserImage.updateAvailable) && <DownloadRing bytes={bytes} total={total} label="ONNX image engine download progress" action={ringAction} onAction={ringAction === 'pause' ? () => browserImageAssetsManager.pause() : ringAction === 'resume' ? () => void startBrowserImage() : undefined} disabled={organizing}/>}</div></td>
        </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Runs compatible ONNX image models from Catalog. WebGPU and shader-f16 required.</span><span className="model-catalog-detail-state">{!checked && folder && <span>Checking files…</span>}{checked && !installed && browserImage.legacyInstalled && !active && !queued && <span>1.22 installed · update for new models</span>}{checked && !installed && browserImage.updateAvailable && !browserImage.legacyInstalled && !active && !queued && <span>Engine update needed</span>}{!installed && queued && !active && <span>{browserImage.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{browserImage.paused && browserImage.queue[0] === 'engine' && browserImage.error && <p className="model-error">{browserImage.error}</p>}</td></tr></tbody>;
      })()}
      {(() => {
        const id = 'pose_engine' as const;
        const checked = motion.folder === folder && motion.checked[id];
        const installed = motion.folder === folder && motion.installed[id];
        const active = motion.folder === folder && motion.active === id;
        const queued = motion.folder === folder && motion.queue.includes(id);
        const bytes = motion.folder === folder ? motion.saved[id] : 0;
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save MediaPipe Vision.'); motionAssetsManager.queue(folder, id); if (motion.paused) motionAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={id}><tr><td className="model-catalog-name">{artworkControl('mediapipe-vision', 'MediaPipe Vision')}<strong>MediaPipe Vision</strong></td><td>Google · United States</td><td>1.1.1</td><td>{(motionTotal(id) / 1e6).toFixed(1)} MB</td><td><a href="https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a></td><td><div className="model-catalog-buttons">{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download MediaPipe Vision" aria-label="Download MediaPipe Vision" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={motionTotal(id)} label="MediaPipe Vision download progress" action={active ? 'pause' : motion.paused || !queued ? 'resume' : undefined} onAction={active ? () => motionAssetsManager.pause() : () => void start()}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Pose detection in photos and video · WebAssembly. <a href={MOTION_MODELS[id].source} target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{motion.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const id = 'vector_engine' as const;
        const checked = motion.folder === folder && motion.checked[id];
        const installed = motion.folder === folder && motion.installed[id];
        const active = motion.folder === folder && motion.active === id;
        const queued = motion.folder === folder && motion.queue.includes(id);
        const bytes = motion.folder === folder ? motion.saved[id] : 0;
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save VTracer.'); motionAssetsManager.queue(folder, id); if (motion.paused) motionAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={id}><tr><td className="model-catalog-name">{artworkControl('vtracer', 'VTracer')}<strong>VTracer</strong></td><td>Visioncortex</td><td>1.0 alpha 4</td><td>{(motionTotal(id) / 1e6).toFixed(1)} MB</td><td><a href="https://github.com/visioncortex/vtracer/blob/master/LICENSE" target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download VTracer" aria-label="Download VTracer" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={motionTotal(id)} label="VTracer download progress" action={active ? 'pause' : motion.paused || !queued ? 'resume' : undefined} onAction={active ? () => motionAssetsManager.pause() : () => void start()}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Raster images to editable SVG paths · WebAssembly. <a href={MOTION_MODELS[id].source} target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{motion.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const checked = speech.folder === folder && speech.checked.engine;
        const installed = speech.folder === folder && speech.installed.engine;
        const active = speech.folder === folder && speech.active === 'engine';
        const queued = speech.folder === folder && speech.queue.includes('engine');
        const bytes = speech.folder === folder ? speech.saved.engine : 0;
        const total = speechTotal('engine');
        const resume = !active && (speech.paused && speech.queue[0] === 'engine' || !queued && bytes > 0);
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the speech engine.'); speechAssetsManager.queue(folder, 'engine'); if (speech.paused) speechAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody><tr><td className="model-catalog-name">{artworkControl('pocket-tts', 'Pocket TTS')}<strong>Pocket TTS</strong></td><td>Kyutai / vlapky · France</td><td>0.1 / ORT 1.20</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={SPEECH_ENGINE_ASSETS[0].url} target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download Pocket TTS engine" aria-label="Download Pocket TTS engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="Pocket TTS engine download progress" action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void start() : undefined}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Speech synthesis and short voice references · WebAssembly. <a href="https://github.com/vlapky/pocket-tts-js" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const group = 'kokoro_engine' as const;
        const checked = speech.folder === folder && speech.checked[group];
        const installed = speech.folder === folder && speech.installed[group];
        const active = speech.folder === folder && speech.active === group;
        const queued = speech.folder === folder && speech.queue.includes(group);
        const bytes = speech.folder === folder ? speech.saved[group] : 0;
        const total = speechTotal(group);
        const resume = !active && (speech.paused && speech.queue[0] === group || !queued && bytes > 0);
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the speech engine.'); speechAssetsManager.queue(folder, group); if (speech.paused) speechAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={group}><tr><td className="model-catalog-name">{artworkControl('kokoro', 'Kokoro')}<strong>Kokoro</strong></td><td>hexgrad / Hugging Face</td><td>1.2.1 / ORT 1.22</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={KOKORO_ENGINE_ASSETS[0].url} target="_blank" rel="noreferrer">Apache 2.0</a> · <a href={KOKORO_ENGINE_ASSETS[3].url} target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download Kokoro engine" aria-label="Download Kokoro engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="Kokoro engine download progress" action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void start() : undefined}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">English speech with selectable voices · WebAssembly. <a href="https://github.com/hexgrad/kokoro/tree/main/kokoro.js" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const group = 'chatterbox_engine' as const;
        const checked = speech.folder === folder && speech.checked[group];
        const installed = speech.folder === folder && speech.installed[group];
        const active = speech.folder === folder && speech.active === group;
        const queued = speech.folder === folder && speech.queue.includes(group);
        const bytes = speech.folder === folder ? speech.saved[group] : 0;
        const total = speechTotal(group);
        const resume = !active && (speech.paused && speech.queue[0] === group || !queued && bytes > 0);
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the speech engine.'); speechAssetsManager.queue(folder, group); if (speech.paused) speechAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={group}><tr><td className="model-catalog-name">{artworkControl('chatterbox', 'Chatterbox')}<strong>Chatterbox</strong></td><td>Hugging Face / Microsoft</td><td>Transformers 4 / ORT 1.25</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={CHATTERBOX_ENGINE_ASSETS[0].url} target="_blank" rel="noreferrer">Apache 2.0</a> / <a href={CHATTERBOX_ENGINE_ASSETS[1].url} target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download Chatterbox engine" aria-label="Download Chatterbox engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="Chatterbox engine download progress" action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void start() : undefined}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Runs Chatterbox and Chatterbox Turbo in WebAssembly. <a href="https://github.com/huggingface/transformers.js" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const group = 'qwen_engine' as const;
        const checked = speech.folder === folder && speech.checked[group];
        const installed = speech.folder === folder && speech.installed[group];
        const active = speech.folder === folder && speech.active === group;
        const queued = speech.folder === folder && speech.queue.includes(group);
        const bytes = speech.folder === folder ? speech.saved[group] : 0;
        const total = speechTotal(group);
        const resume = !active && (speech.paused && speech.queue[0] === group || !queued && bytes > 0);
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the speech engine.'); speechAssetsManager.queue(folder, group); if (speech.paused) speechAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={group}><tr><td className="model-catalog-name">{artworkControl('qwen3-tts', 'Qwen3-TTS')}<strong>Qwen3-TTS</strong></td><td>llama-web-bridge · MIT</td><td>0.1.65</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={QWEN_TTS_ENGINE_ASSETS[0].url} target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download Qwen3-TTS engine" aria-label="Download Qwen3-TTS engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="Qwen3-TTS engine download progress" action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void start() : undefined}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Memory64 browser bridge for Qwen3-TTS audio generation. <a href="https://github.com/leehack/llama-web-bridge" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const group = 'openvoice_engine' as const;
        const checked = speech.folder === folder && speech.checked[group];
        const installed = speech.folder === folder && speech.installed[group];
        const active = speech.folder === folder && speech.active === group;
        const queued = speech.folder === folder && speech.queue.includes(group);
        const bytes = speech.folder === folder ? speech.saved[group] : 0;
        const total = speechTotal(group);
        const resume = !active && (speech.paused && speech.queue[0] === group || !queued && bytes > 0);
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the speech engine.'); speechAssetsManager.queue(folder, group); if (speech.paused) speechAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key={group}><tr><td className="model-catalog-name">{artworkControl('openvoice', 'OpenVoice')}<strong>OpenVoice</strong></td><td>Microsoft</td><td>ONNX Runtime 1.25</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={OPENVOICE_ENGINE_ASSETS[0].url} target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download OpenVoice engine" aria-label="Download OpenVoice engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="OpenVoice engine download progress" action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void start() : undefined}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Runs OpenVoice V2 audio conversion in WebAssembly. <a href="https://github.com/myshell-ai/OpenVoice" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const checked = transcription.folder === folder && transcription.checked.engine;
        const installed = transcription.folder === folder && transcription.installed.engine;
        const active = transcription.folder === folder && transcription.active === 'engine';
        const queued = transcription.folder === folder && transcription.queue.includes('engine');
        const bytes = transcription.folder === folder ? transcription.saved.engine : 0;
        const total = transcriptionTotal('engine');
        const start = async () => { if (!folder) return; try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the transcription engine.'); transcriptionAssetsManager.queue(folder, 'engine'); if (transcription.paused) transcriptionAssetsManager.resume(folder); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } };
        return <tbody key="transformers-asr"><tr><td className="model-catalog-name">{artworkControl('transformers-asr', 'Transformers ASR')}<strong>Transformers ASR</strong></td><td>Hugging Face / Microsoft</td><td>3.8.1 / ORT 1.22</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href="https://github.com/huggingface/transformers.js/blob/v3.8.1/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a> · <a href="https://github.com/microsoft/onnxruntime/blob/v1.22.0/LICENSE" target="_blank" rel="noreferrer">MIT</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download transcription engine" aria-label="Download transcription engine" disabled={!folder} onClick={() => void start()}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={total} label="Transcription engine download progress" action={active ? 'pause' : transcription.paused || !queued ? 'resume' : undefined} onAction={active ? () => transcriptionAssetsManager.pause() : () => void start()}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Runs Whisper, Moonshine, and Wav2Vec2 speech recognition in WebAssembly. <a href="https://github.com/huggingface/transformers.js" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{transcription.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
      {(() => {
        const kind = 'sherpa' as const;
        const checked = transcription.folder === folder && transcription.checked[kind];
        const installed = transcription.folder === folder && transcription.installed[kind];
        const active = transcription.folder === folder && transcription.active === kind;
        const queued = transcription.folder === folder && transcription.queue.includes(kind);
        const bytes = transcription.folder === folder ? transcription.saved[kind] : 0;
        return <tbody key="sherpa-asr"><tr><td className="model-catalog-name">{artworkControl('sherpa-asr', 'Sherpa ONNX ASR')}<strong>Sherpa ONNX ASR</strong></td><td>k2-fsa</td><td>1.12.32</td><td>174.7 MB bundle</td><td><a href="https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.32/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !transcription.sherpaArchiveReady && <SherpaArchiveImport folder={folder} compact/>}{!installed && (active || transcription.sherpaArchiveReady) && <DownloadRing bytes={bytes} total={transcriptionTotal(kind)} label="Sherpa bundle download progress" action={active ? 'pause' : transcription.paused || !queued ? 'resume' : undefined} onAction={active ? () => transcriptionAssetsManager.pause() : () => { transcriptionAssetsManager.queue(folder!, kind); transcriptionAssetsManager.resume(folder!); }}/>}</div></td></tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Streaming English transcription. The upstream download includes its model and engine together. <a href="https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.32" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{transcription.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div></td></tr></tbody>;
      })()}
    </table></div>
    {actionError && <p className="model-error" role="alert">{actionError}</p>}
    {artworkEngine && store && onWrite && <HarnessSurfaceArtwork key={artworkEngine.id} store={store} surfaceKey={`engine:${artworkEngine.id}`} title={artworkEngine.title} kind="browser engine" entry={surfaceMap.items[`engine:${artworkEngine.id}`]} imageOptions={imageOptions} folder={folder} onWrite={onWrite} onSaved={setSurfaceMap} onClose={() => setArtworkEngine(null)}/>}
  </section>;
}
