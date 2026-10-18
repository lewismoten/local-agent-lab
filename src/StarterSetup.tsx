import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Download, FolderOpen, Sparkles } from 'lucide-react';
import { MODEL_CATALOG } from './catalogModels.ts';
import { getBrowserModelStatus, subscribeBrowserModel } from './browserModel.ts';
import { ensureModelLicenseFiles, assertModelLicenseFiles } from './modelLicenses.ts';
import { maybeModelFile } from './modelFolders.ts';
import { getModelDownload, modelDownloadManager, resumeQueuedModels, subscribeModelDownload } from './modelDownloadSession.ts';
import { ensureWritableFolder } from './storage.ts';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload, wllamaEngineManager } from './wllamaEngine.ts';

const starter = (() => {
  const model = MODEL_CATALOG.find(item => item.id === 'qwen3-17b');
  if (!model) throw new Error('The browser starter model is missing from the catalog.');
  return model;
})();
const path = `models/${starter.name}`;

export default function StarterSetup({ folder, onConnectFolder, onLoad }: {
  folder: FileSystemDirectoryHandle | null;
  onConnectFolder: () => Promise<FileSystemDirectoryHandle | null>;
  onLoad: (path: string) => Promise<void>;
}) {
  const engine = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const download = useSyncExternalStore(subscribeModelDownload, getModelDownload);
  const browserModel = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const [checked, setChecked] = useState(false);
  const [engineChecked, setEngineChecked] = useState(false);
  const [modelPresent, setModelPresent] = useState(false);
  const [licensed, setLicensed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setEngineChecked(false);
    if (!folder) return;
    void wllamaEngineManager.discover(folder)
      .catch(cause => { if (active) setError(`Could not check the browser engine: ${cause instanceof Error ? cause.message : String(cause)}`); })
      .finally(() => { if (active) setEngineChecked(true); });
    void modelDownloadManager.discover(folder)
      .catch(cause => { if (active) setError(`Could not check model downloads: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { active = false; };
  }, [folder]);
  useEffect(() => {
    let active = true;
    setChecked(false); setModelPresent(false); setLicensed(false);
    if (!folder) return;
    void (async () => {
      const file = await maybeModelFile(folder, starter.name);
      const present = file?.size === starter.bytes;
      let hasLicense = false;
      if (present) { try { await assertModelLicenseFiles(folder, path); hasLicense = true; } catch { /* Offer license repair. */ } }
      if (active) { setModelPresent(present); setLicensed(hasLicense); setChecked(true); }
    })().catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setChecked(true); } });
    return () => { active = false; };
  }, [folder, download.revision]);

  const queued = download.queue.some(item => item.url === starter.url);
  const activeDownload = download.status === 'downloading' && download.url === starter.url;
  const modelBytes = activeDownload ? download.progress?.bytes || 0 : download.recovery?.name === starter.name ? download.recovery.bytes : 0;
  const modelPercent = Math.min(100, Math.round(modelBytes / starter.bytes * 100));
  const enginePercent = engine.total ? Math.min(100, Math.round(engine.bytes / engine.total * 100)) : 0;
  const ready = !!folder && checked && engineChecked && engine.installed && modelPresent && licensed;
  const storageUnavailable = !folder && typeof window !== 'undefined' && !window.showDirectoryPicker;

  async function begin() {
    setWorking(true); setError('');
    try {
      const target = folder || await onConnectFolder();
      if (!target) return;
      if (!await ensureWritableFolder(target)) throw new Error('Allow read and edit access to the selected folder.');
      await modelDownloadManager.discover(target);
      if (!getWllamaEngineDownload().installed) {
        await wllamaEngineManager.queue(target);
        if (!getWllamaEngineDownload().installed) throw new Error(getWllamaEngineDownload().error || 'The browser engine download stopped. Resume it in Engines.');
      }
      const file = await maybeModelFile(target, starter.name);
      if (file?.size === starter.bytes) {
        await ensureModelLicenseFiles(target, starter.url);
        await assertModelLicenseFiles(target, path);
        setModelPresent(true); setLicensed(true);
      } else {
        const current = getModelDownload();
        const alreadyQueued = current.queue.some(item => item.url === starter.url);
        if (alreadyQueued && current.queuePaused) await resumeQueuedModels(target, () => {});
        else if (!alreadyQueued && !(current.status === 'downloading' && current.url === starter.url)) modelDownloadManager.enqueue(target, [{ name: starter.name, url: starter.url, bytes: starter.bytes }], () => {});
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  }
  async function load() {
    setWorking(true);
    try { await onLoad(path); }
    finally { setWorking(false); }
  }

  return <section className="harness-starter" aria-label="Offline starter model">
    <div className="harness-starter-mark"><Sparkles size={20}/></div>
    <div className="harness-starter-copy"><span className="harness-overline">START OFFLINE</span><h2>Qwen3 1.7B</h2><p>Browser-tested chat, tools, and thinking · 1.28 GB · Apache 2.0</p><p>Keep the model and your work on a USB drive to use them on another compatible computer.</p>
      <div className="harness-starter-steps"><span className={folder ? 'done' : ''}>1 Storage</span><span className={engineChecked && engine.installed ? 'done' : ''}>2 Engine</span><span className={checked && modelPresent && licensed ? 'done' : ''}>3 Model</span><span>4 Load</span></div>
      {(engine.status === 'downloading' || engine.status === 'paused' && engine.bytes > 0) && !engine.installed && <div className="harness-starter-progress" role="status"><span>Engine · {enginePercent}%</span><progress value={engine.bytes} max={engine.total}/></div>}
      {(activeDownload || queued && modelBytes > 0) && <div className="harness-starter-progress" role="status"><span>Model · {modelPercent}%</span><progress value={modelBytes} max={starter.bytes}/></div>}
      {queued && !activeDownload && <small>{download.queuePaused ? 'Download paused. Resume when ready.' : 'Model queued in Downloads.'}</small>}
      {storageUnavailable && <small role="status">This browser cannot save local model files. You can still configure a server profile.</small>}
      {working && browserModel.state === 'loading' && browserModel.path === path && <small role="status">{browserModel.message}</small>}
      {error && <p className="harness-starter-error" role="alert">{error}</p>}
      {!error && engine.status === 'error' && !engine.installed && <p className="harness-starter-error" role="alert">{engine.error}</p>}
      {!error && !!download.error && download.url === starter.url && <p className="harness-starter-error" role="alert">{download.error}</p>}
    </div>
    <div className="harness-starter-action">{ready ? <button className="harness-primary" disabled={working} onClick={() => void load()}>{working ? 'Loading…' : 'Load & test'} <ArrowRight size={15}/></button>
      : <button className="harness-primary" disabled={storageUnavailable || working || !!folder && (!checked || !engineChecked || engine.status === 'downloading' || activeDownload || queued && !download.queuePaused)} onClick={() => void begin()}>{storageUnavailable ? 'Storage unavailable' : !folder ? <><FolderOpen size={15}/> Connect folder</> : working ? 'Preparing…' : queued && download.queuePaused ? <><Download size={15}/> Resume model</> : modelPresent && !licensed ? 'Save license' : <><Download size={15}/> Get starter model</>}</button>}</div>
  </section>;
}
