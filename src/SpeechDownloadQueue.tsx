import { useSyncExternalStore } from 'react';
import DownloadRing from './DownloadRing.tsx';
import { getSpeechAssets, speechAssetsManager, speechTotal, subscribeSpeechAssets, type SpeechGroup } from './speechAssets.ts';
import { SPEECH_MODELS, speechModel } from './speechManifest.ts';

export default function SpeechDownloadQueue({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribeSpeechAssets, getSpeechAssets);
  if (!folder || state.folder !== folder) return null;
  const groups: SpeechGroup[] = ['engine', 'kokoro_engine', 'chatterbox_engine', 'qwen_engine', 'openvoice_engine', ...SPEECH_MODELS.map(model => model.id)];
  const pending = groups.filter(group => !state.installed[group] && (state.active === group || state.queue.includes(group) || state.saved[group] > 0));
  if (!pending.length) return null;
  return <section aria-label="Speech downloads" className="model-download-queue"><strong>Speech</strong>{pending.map(group => {
    const active = state.active === group;
    const queued = state.queue.includes(group);
    const action = active ? 'pause' : (state.paused && queued || !queued) ? 'resume' : undefined;
    return <div key={group} className="model-queue-item"><span>{group === 'engine' ? 'Pocket TTS engine' : group === 'kokoro_engine' ? 'Kokoro engine' : group === 'chatterbox_engine' ? 'Chatterbox engine' : group === 'qwen_engine' ? 'Qwen3-TTS engine' : group === 'openvoice_engine' ? 'OpenVoice engine' : speechModel(group).label}{active && state.current ? ` · ${state.current}` : queued ? state.paused ? ' · paused' : ' · queued' : ' · partial'}</span><DownloadRing bytes={state.saved[group]} total={speechTotal(group)} label={`${group} download progress`} action={action} onAction={active ? () => speechAssetsManager.pause() : () => { speechAssetsManager.queue(folder, group); speechAssetsManager.resume(folder); }}/></div>;
  })}</section>;
}
