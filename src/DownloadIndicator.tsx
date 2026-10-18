import { useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { getModelDownload, subscribeModelDownload } from './modelDownloadSession';
import { getPrismEngineDownload, subscribePrismEngineDownload } from './prismEngine';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload } from './wllamaEngine';
import { getNeedleAssets, subscribeNeedleAssets } from './needleAssets';
import { BROWSER_IMAGE_GROUPS, browserImageModelLabel, browserImageTotal, getBrowserImageAssets, subscribeBrowserImageAssets } from './browserImageAssets';
import { getSpeechAssets, speechTotal, subscribeSpeechAssets } from './speechAssets.ts';
import { SPEECH_MODELS, speechModel } from './speechManifest.ts';

export default function DownloadIndicator({ onOpen, onResume, folder }: { onOpen: () => void; onResume: () => void; folder: FileSystemDirectoryHandle | null }) {
  const download = useSyncExternalStore(subscribeModelDownload, getModelDownload);
  const engine = useSyncExternalStore(subscribePrismEngineDownload, getPrismEngineDownload);
  const wllama = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const needle = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const image = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const speech = useSyncExternalStore(subscribeSpeechAssets, getSpeechAssets);
  const enginePending = !engine.installed && (engine.status === 'downloading' || engine.status === 'queued' || engine.status === 'paused' || engine.bytes > 0);
  const wllamaPending = !wllama.installed && (wllama.status === 'downloading' || wllama.status === 'queued' || wllama.status === 'paused' || wllama.bytes > 0);
  const modelPending = download.status !== 'idle' || !!download.recovery || !!download.queue.length;
  const needlePending = !!needle.active || !!needle.queue.length || (['engine', 'needle', 'needle2', 'needle3'] as const).some(group => needle.saved[group] > 0 && !needle.installed[group]);
  const imagePending = !!folder && image.folder === folder && (!!image.active || !!image.queue.length || (['engine', ...BROWSER_IMAGE_GROUPS] as const).some(group => image.saved[group] > 0 && !image.installed[group] && !(group === 'engine' && image.legacyInstalled)));
  const speechPending = !!folder && speech.folder === folder && (!!speech.active || !!speech.queue.length || (['engine', 'kokoro_engine', 'chatterbox_engine', 'qwen_engine', 'openvoice_engine', ...SPEECH_MODELS.map(model => model.id)] as const).some(group => speech.saved[group] > 0 && !speech.installed[group]));
  const openNeedle = () => { sessionStorage.setItem('browser-model-tab', 'downloads'); window.dispatchEvent(new Event('open-browser-model-downloads')); onOpen(); };
  if (!modelPending && !enginePending && !wllamaPending && !needlePending && !imagePending && !speechPending) return null;
  if (speechPending && speech.active) return <button className="download-indicator" type="button" onClick={openNeedle} title="View speech downloads"><Download size={15}/>{`${speech.active === 'engine' ? 'Pocket TTS engine' : speech.active === 'kokoro_engine' ? 'Kokoro engine' : speech.active === 'chatterbox_engine' ? 'Chatterbox engine' : speech.active === 'qwen_engine' ? 'Qwen3-TTS engine' : speech.active === 'openvoice_engine' ? 'OpenVoice engine' : speechModel(speech.active).label} ${(speech.saved[speech.active] / speechTotal(speech.active) * 100).toFixed(1)}%`}</button>;
  if (imagePending && image.active) return <button className="download-indicator" type="button" onClick={openNeedle} title="View image downloads"><Download size={15}/>{`${image.active === 'engine' ? 'ONNX image engine' : browserImageModelLabel(image.active)} ${(image.saved[image.active] / browserImageTotal(image.active) * 100).toFixed(1)}%`}</button>;
  if (needle.active && needle.status === 'downloading') return <button className="download-indicator" type="button" onClick={openNeedle} title="View Needle downloads"><Download size={15}/>{`${needle.active === 'engine' ? 'Needle engine' : 'Needle model'} ${(needle.currentBytes / Math.max(1, needle.totalBytes) * 100).toFixed(1)}%`}</button>;
  if (enginePending && (engine.status === 'downloading' || !modelPending)) return <button className="download-indicator" type="button" onClick={() => { sessionStorage.setItem('browser-model-tab', 'engines'); window.dispatchEvent(new Event('open-browser-model-tab')); onOpen(); }} title="View PrismML engine download"><Download size={15}/>{engine.status === 'downloading' && engine.total ? `Engine download ${(engine.bytes / engine.total * 100).toFixed(1)}%` : 'Resume engine download'}</button>;
  if (wllamaPending && (wllama.status === 'downloading' || !modelPending)) return <button className="download-indicator" type="button" onClick={() => { sessionStorage.setItem('browser-model-tab', 'engines'); window.dispatchEvent(new Event('open-browser-model-tab')); onOpen(); }} title="View Wllama download"><Download size={15}/>{wllama.status === 'downloading' && wllama.total ? `Wllama download ${(wllama.bytes / wllama.total * 100).toFixed(1)}%` : 'Resume Wllama download'}</button>;
  if (needlePending && !modelPending) return <button className="download-indicator" type="button" onClick={openNeedle} title="View Needle downloads"><Download size={15}/>Resume Needle downloads</button>;
  if (imagePending && !modelPending) return <button className="download-indicator" type="button" onClick={openNeedle} title="View image downloads"><Download size={15}/>Resume image downloads</button>;
  if (speechPending && !modelPending) return <button className="download-indicator" type="button" onClick={openNeedle} title="View speech downloads"><Download size={15}/>Resume speech downloads</button>;
  const percent = download.progress ? Math.min(100, download.progress.bytes / download.progress.total * 100) : 0;
  const queuedLicenseFirst = !!download.queue[0]?.licenseOnly;
  return <button className="download-indicator" type="button" disabled={download.status === 'discarding'} onClick={download.status === 'idle' ? onResume : () => { sessionStorage.setItem('browser-model-tab', 'downloads'); window.dispatchEvent(new Event('open-browser-model-downloads')); onOpen(); }} title={download.status === 'idle' ? queuedLicenseFirst ? 'Save the queued model license first' : 'Resume the saved model download' : 'View model download'}>
    <Download size={15}/>
    {download.status === 'discarding' ? 'Discarding model…' : download.status === 'idle' ? queuedLicenseFirst ? 'Save queued license' : download.recovery ? 'Resume model download' : `Resume model queue (${download.queue.length})` : `Model download ${percent.toFixed(1)}%${download.queue.length > 1 ? ` · ${download.queue.length - 1} queued` : ''}`}
  </button>;
}
