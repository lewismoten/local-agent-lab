import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPrismEngineDownload, PRISM_ASSETS, prismEngineManager, subscribePrismEngineDownload } from './prismEngine';
import { ensureWritableFolder } from './storage';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload, WLLAMA_ASSETS, wllamaEngineManager } from './wllamaEngine';
import NeedleAssetCard from './NeedleAssetCard';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, needleAssetsManager, subscribeNeedleAssets } from './needleAssets';
import { legacyEngineFileCount, organizeEngineFiles } from './engineFolders';
import { showToast } from './toastStore';
import { BROWSER_IMAGE_ENGINE_ASSETS, browserImageAssetsManager, browserImageTotal, getBrowserImageAssets, subscribeBrowserImageAssets } from './browserImageAssets';
import DownloadRing from './DownloadRing';

const specs = [
  { group: 'PrismML' as const, assets: PRISM_ASSETS, queue: 'prism-bonsai-queue.json' },
  { group: 'Wllama' as const, assets: WLLAMA_ASSETS, queue: 'wllama-queue.json' },
  { group: 'Needle' as const, assets: NEEDLE_ENGINE_ASSETS, queue: 'needle-rs-queue.json' },
];
const legacyNames = specs.flatMap(spec => [...spec.assets.flatMap(asset => [asset.name, `${asset.name}.download.json`]), spec.queue]);
const prismBytes = PRISM_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
const wllamaBytes = WLLAMA_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);

export default function EngineCatalog({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribePrismEngineDownload, getPrismEngineDownload);
  const wllama = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const needle = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const browserImage = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const [actionError, setActionError] = useState('');
  const [legacyCount, setLegacyCount] = useState(0);
  const [organizing, setOrganizing] = useState(false);
  const [organizeStatus, setOrganizeStatus] = useState('');
  const autoAttempted = useRef<FileSystemDirectoryHandle | null>(null);
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
        <td className="model-catalog-name"><strong>PrismML</strong></td><td>Prism ML · United States</td><td title="Pinned source commit dd85c7b5d686fc6d2acc8fba005960e4bb6b5346">dd85c7b</td><td>{(prismBytes / 1e6).toFixed(1)} MB</td><td><a href="https://github.com/PrismML-Eng/Talk/blob/dd85c7b5d686fc6d2acc8fba005960e4bb6b5346/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a></td>
        <td><div className="model-catalog-buttons">{!installed && !busy && !checking && <button className="button secondary engine-action-button" type="button" data-tooltip={state.bytes ? 'Resume PrismML download' : 'Download PrismML'} aria-label={state.bytes ? 'Resume PrismML download' : 'Download PrismML'} disabled={!folder || organizing} onClick={() => void start()}>{state.bytes ? '🔄' : '📥'}</button>}{busy && <button className="button secondary engine-action-button" type="button" data-tooltip="Pause PrismML download" aria-label="Pause PrismML download" disabled={organizing} onClick={() => prismEngineManager.pause()}>⏸</button>}</div></td>
      </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Bonsai 2 · WebGPU required · up to 32K context in this app. <a href="https://github.com/PrismML-Eng/Talk/blob/dd85c7b5d686fc6d2acc8fba005960e4bb6b5346/kernels.ts" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{!installed && !checking && state.status !== 'idle' && <span>{state.status === 'queued' ? 'Queued' : state.status === 'paused' ? 'Paused' : state.status === 'error' ? 'Needs retry' : `${(state.bytes / state.total * 100).toFixed(1)}%`}</span>}{state.total > 0 && !installed && !checking && state.bytes > 0 && <progress value={state.bytes} max={state.total} aria-label="PrismML engine download progress"/>}</span></div>{state.error && <p className="model-error" role="alert">{state.error}</p>}</td></tr></tbody>
      <tbody><tr>
        <td className="model-catalog-name"><strong>Wllama</strong></td><td>ngxson</td><td>3.8.1</td><td>{(wllamaBytes / 1e6).toFixed(1)} MB</td><td><a href="https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/LICENCE" target="_blank" rel="noreferrer">MIT</a></td>
        <td><div className="model-catalog-buttons">{!wllama.installed && wllama.status !== 'downloading' && <button className="button secondary engine-action-button" type="button" data-tooltip={wllama.bytes ? 'Resume Wllama download' : 'Download Wllama'} aria-label={wllama.bytes ? 'Resume Wllama download' : 'Download Wllama'} disabled={!folder || organizing} onClick={() => void startWllama()}>{wllama.bytes ? '🔄' : '📥'}</button>}{wllama.status === 'downloading' && <button className="button secondary engine-action-button" type="button" data-tooltip="Pause Wllama download" aria-label="Pause Wllama download" disabled={organizing} onClick={() => wllamaEngineManager.pause()}>⏸</button>}</div></td>
      </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Browser GGUF models · single files up to 2 GB · up to 32K context in this app. <a href="https://github.com/ngxson/wllama" target="_blank" rel="noreferrer">Source</a></span><span className="model-catalog-detail-state">{!wllama.installed && wllama.status !== 'idle' && <span>{wllama.status === 'queued' ? 'Queued' : wllama.status === 'paused' ? 'Paused' : wllama.status === 'error' ? 'Needs retry' : `${(wllama.bytes / wllama.total * 100).toFixed(1)}%`}</span>}{wllama.total > 0 && !wllama.installed && wllama.bytes > 0 && <progress value={wllama.bytes} max={wllama.total} aria-label="Wllama download progress"/>}</span></div>{wllama.error && <p className="model-error" role="alert">{wllama.error}</p>}</td></tr></tbody>
      <NeedleAssetCard folder={folder} group="engine" inTable disabled={organizing}/>
      {(() => {
        const installed = browserImage.folder === folder && browserImage.installed.engine;
        const active = browserImage.folder === folder && browserImage.active === 'engine';
        const queued = browserImage.folder === folder && browserImage.queue.includes('engine');
        const bytes = browserImage.folder === folder ? browserImage.saved.engine : 0;
        const total = browserImageTotal('engine');
        const resumeHere = queued && browserImage.paused && browserImage.queue[0] === 'engine';
        const ringAction = active ? 'pause' : resumeHere || !queued && bytes > 0 ? 'resume' : undefined;
        return <tbody><tr>
          <td className="model-catalog-name"><strong>ONNX image</strong></td><td>Microsoft / Scribbler</td><td>1.22.0</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href={BROWSER_IMAGE_ENGINE_ASSETS[1].url} target="_blank" rel="noreferrer">MIT</a></td>
          <td><div className="model-catalog-buttons">{!installed && !active && !queued && bytes === 0 && <button className="button secondary engine-action-button" type="button" data-tooltip="Download ONNX image" aria-label="Download ONNX image" disabled={!folder || organizing} onClick={() => void startBrowserImage()}>📥</button>}{queued && !resumeHere && <span className="muted">Queued</span>}{!installed && (active || bytes > 0 || resumeHere) && <DownloadRing bytes={bytes} total={total} label="ONNX image engine download progress" action={ringAction} onAction={ringAction === 'pause' ? () => browserImageAssetsManager.pause() : ringAction === 'resume' ? () => void startBrowserImage() : undefined} disabled={organizing}/>}</div></td>
        </tr><tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Runs Stable Diffusion in this browser. WebGPU and shader-f16 required.</span><span className="model-catalog-detail-state">{!installed && queued && !active && <span>{browserImage.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{browserImage.paused && browserImage.queue[0] === 'engine' && browserImage.error && <p className="model-error">{browserImage.error}</p>}</td></tr></tbody>;
      })()}
    </table></div>
    {actionError && <p className="model-error" role="alert">{actionError}</p>}
  </section>;
}
