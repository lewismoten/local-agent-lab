import { useState, useSyncExternalStore } from 'react';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, NEEDLE_LABELS, NEEDLE_MODEL_ASSETS, needleAssetsManager, subscribeNeedleAssets, type NeedleVersion } from './needleAssets';
import { ensureWritableFolder } from './storage';

type Group = 'engine' | NeedleVersion;
const names: Record<Group, string> = { engine: 'Needle browser engine', ...NEEDLE_LABELS };
const groups: Group[] = ['engine', 'needle', 'needle2', 'needle3'];
const totalBytes = (group: Group) => (group === 'engine' ? NEEDLE_ENGINE_ASSETS : NEEDLE_MODEL_ASSETS[group]).reduce((sum, asset) => sum + asset.bytes, 0);

export default function NeedleDownloadQueue({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const [error, setError] = useState('');
  if (!folder || state.folder !== folder) return null;
  const items = [...new Set<Group>([
    ...(state.active ? [state.active] : []),
    ...state.queue,
    ...groups.filter(group => !state.installed[group] && state.saved[group] > 0),
  ])];
  if (!items.length) return null;
  const start = async (group?: Group) => {
    setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to resume Needle downloads.');
      if (group) await needleAssetsManager.download(folder, group);
      else needleAssetsManager.resume(folder);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <div className="model-queue-order" aria-label="Needle download queue"><strong>Needle downloads</strong>{items.map(group => {
    const active = state.active === group && state.status === 'downloading';
    const index = state.queue.indexOf(group);
    const queued = index >= 0;
    const total = totalBytes(group);
    const bytes = active ? state.currentBytes : state.saved[group];
    const status = active ? 'downloading' : queued ? state.queuePaused ? index === 0 ? state.errorGroup === group ? 'needs retry' : 'paused' : 'queued · paused' : `queued #${index + 1}` : bytes >= total ? 'needs retry' : 'partial';
    return <div className="model-queue-item needle-download-item" key={group}>
      <span>{names[group]} · {status}{bytes > 0 ? ` · ${(bytes / total * 100).toFixed(1)}%` : ''}{active && state.currentAsset ? ` · ${state.currentAsset}` : ''}</span>
      <div>
        {active && <button type="button" className="button secondary compact" onClick={() => needleAssetsManager.pause()}>Pause</button>}
        {queued && state.queuePaused && index === 0 && <button type="button" className="button secondary compact" onClick={() => void start()}>{state.errorGroup === group ? 'Retry' : 'Resume'}</button>}
        {!active && !queued && <button type="button" className="button secondary compact" onClick={() => void start(group)}>{bytes >= total ? 'Retry' : 'Resume'}</button>}
        {queued && !active && <button type="button" className="button danger compact" title="Remove from queue; saved bytes remain" onClick={() => needleAssetsManager.removeQueued(folder, group)}>Remove</button>}
      </div>
      {(active || bytes > 0) && <progress value={bytes} max={total} aria-label={`${names[group]} download progress`}/>}
    </div>;
  })}{error && <p className="model-error" role="alert">{error}</p>}{state.error && <p className="model-error" role="alert">{state.error}</p>}</div>;
}
