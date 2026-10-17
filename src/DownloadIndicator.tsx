import { useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { getModelDownload, subscribeModelDownload } from './modelDownloadSession';
import { getPrismEngineDownload, subscribePrismEngineDownload } from './prismEngine';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload } from './wllamaEngine';
import { getNeedleAssets, subscribeNeedleAssets } from './needleAssets';

export default function DownloadIndicator({ onOpen, onResume }: { onOpen: () => void; onResume: () => void }) {
  const download = useSyncExternalStore(subscribeModelDownload, getModelDownload);
  const engine = useSyncExternalStore(subscribePrismEngineDownload, getPrismEngineDownload);
  const wllama = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const needle = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const enginePending = !engine.installed && (engine.status === 'downloading' || engine.status === 'queued' || engine.status === 'paused' || engine.bytes > 0);
  const wllamaPending = !wllama.installed && (wllama.status === 'downloading' || wllama.status === 'queued' || wllama.status === 'paused' || wllama.bytes > 0);
  const modelPending = download.status !== 'idle' || !!download.recovery || !!download.queue.length;
  const needlePending = !!needle.active || !!needle.queue.length || (['engine', 'needle', 'needle2', 'needle3'] as const).some(group => needle.saved[group] > 0 && !needle.installed[group]);
  const openNeedle = () => { sessionStorage.setItem('browser-model-tab', 'downloads'); window.dispatchEvent(new Event('open-browser-model-downloads')); onOpen(); };
  if (!modelPending && !enginePending && !wllamaPending && !needlePending) return null;
  if (needle.active && needle.status === 'downloading') return <button className="download-indicator" type="button" onClick={openNeedle} title="View Needle downloads"><Download size={15}/>{`${needle.active === 'engine' ? 'Needle engine' : 'Needle model'} ${(needle.currentBytes / Math.max(1, needle.totalBytes) * 100).toFixed(1)}%`}</button>;
  if (enginePending && (engine.status === 'downloading' || !modelPending)) return <button className="download-indicator" type="button" onClick={() => { sessionStorage.setItem('browser-model-tab', 'engines'); window.dispatchEvent(new Event('open-browser-model-tab')); onOpen(); }} title="View PrismML engine download"><Download size={15}/>{engine.status === 'downloading' && engine.total ? `Engine download ${(engine.bytes / engine.total * 100).toFixed(1)}%` : 'Resume engine download'}</button>;
  if (wllamaPending && (wllama.status === 'downloading' || !modelPending)) return <button className="download-indicator" type="button" onClick={() => { sessionStorage.setItem('browser-model-tab', 'engines'); window.dispatchEvent(new Event('open-browser-model-tab')); onOpen(); }} title="View Wllama download"><Download size={15}/>{wllama.status === 'downloading' && wllama.total ? `Wllama download ${(wllama.bytes / wllama.total * 100).toFixed(1)}%` : 'Resume Wllama download'}</button>;
  if (needlePending && !modelPending) return <button className="download-indicator" type="button" onClick={openNeedle} title="View Needle downloads"><Download size={15}/>Resume Needle downloads</button>;
  const percent = download.progress ? Math.min(100, download.progress.bytes / download.progress.total * 100) : 0;
  const queuedLicenseFirst = !!download.queue[0]?.licenseOnly;
  return <button className="download-indicator" type="button" disabled={download.status === 'discarding'} onClick={download.status === 'idle' ? onResume : () => { sessionStorage.setItem('browser-model-tab', 'downloads'); window.dispatchEvent(new Event('open-browser-model-downloads')); onOpen(); }} title={download.status === 'idle' ? queuedLicenseFirst ? 'Save the queued model license first' : 'Resume the saved model download' : 'View model download'}>
    <Download size={15}/>
    {download.status === 'discarding' ? 'Discarding model…' : download.status === 'idle' ? queuedLicenseFirst ? 'Save queued license' : download.recovery ? 'Resume model download' : `Resume model queue (${download.queue.length})` : `Model download ${percent.toFixed(1)}%${download.queue.length > 1 ? ` · ${download.queue.length - 1} queued` : ''}`}
  </button>;
}
