import { useSyncExternalStore } from 'react';
import DownloadRing from './DownloadRing.tsx';
import { TRANSCRIPTION_MODELS } from './transcriptionManifest.ts';
import { getTranscriptionAssets, subscribeTranscriptionAssets, transcriptionAssetsManager } from './transcriptionAssets.ts';
import SherpaArchiveImport from './SherpaArchiveImport.tsx';
export default function TranscriptionDownloadQueue({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribeTranscriptionAssets, getTranscriptionAssets);
  if (!folder || state.folder !== folder) return null;
  const pending = (['engine', ...TRANSCRIPTION_MODELS.map(model => model.id)] as const).filter(kind => !state.installed[kind] && (state.active === kind || state.queue.includes(kind) || state.saved[kind] > 0));
  if (!pending.length) return null;
  return <section aria-label="Transcription downloads" className="model-download-queue"><strong>Transcription</strong>{pending.map(kind => <div key={kind} className="model-queue-item"><span>{kind === 'engine' ? 'Transformers ASR engine' : TRANSCRIPTION_MODELS.find(model => model.id === kind)?.label}{state.active === kind && state.current ? ` · ${state.current}` : state.queue.includes(kind) ? state.paused ? ' · paused' : ' · queued' : ' · partial'}</span>{kind === 'sherpa' && !state.sherpaArchiveReady && state.active !== kind ? <SherpaArchiveImport folder={folder} compact/> : <DownloadRing bytes={state.saved[kind]} total={transcriptionAssetsManager.total(kind)} label={`${kind} download progress`} action={state.active === kind ? 'pause' : state.paused || !state.queue.includes(kind) ? 'resume' : undefined} onAction={state.active === kind ? () => transcriptionAssetsManager.pause() : () => { transcriptionAssetsManager.queue(folder, kind); transcriptionAssetsManager.resume(folder); }}/>}</div>)}{state.error && <p className="model-error" role="alert">{state.error}</p>}</section>;
}
