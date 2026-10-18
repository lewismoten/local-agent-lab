import { useSyncExternalStore } from 'react';
import { getMotionAssets, MOTION_MODELS, motionAssetsManager, motionTotal, subscribeMotionAssets } from './motionAssets.ts';

export default function MotionDownloadQueue({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribeMotionAssets, getMotionAssets);
  const partial = (['depth', 'rife', 'pose', 'pose_engine', 'vector', 'vector_engine', 'tripo'] as const).filter(id => state.saved[id] > 0 && !state.installed[id] && state.active !== id && !state.queue.includes(id));
  if (state.folder !== folder || !folder || !state.active && !state.queue.length && !partial.length) return null;
  return <div className="model-queue-order"><strong>Graphics and motion</strong>
    {state.active && <div><span>{MOTION_MODELS[state.active].label} · downloading</span><progress value={state.saved[state.active]} max={motionTotal(state.active)}/><button className="button secondary compact" type="button" onClick={() => motionAssetsManager.pause()}>Pause</button></div>}
    {state.queue.map(id => <div key={id}><span>{MOTION_MODELS[id].label} · {state.paused ? 'paused' : 'queued'}</span><progress value={state.saved[id]} max={motionTotal(id)}/></div>)}
    {partial.map(id => <div key={id}><span>{MOTION_MODELS[id].label} · partial</span><progress value={state.saved[id]} max={motionTotal(id)}/><button className="button secondary compact" type="button" onClick={() => { motionAssetsManager.queue(folder, id); motionAssetsManager.resume(folder); }}>Resume</button></div>)}
    {state.paused && state.queue.length > 0 && <button className="button secondary compact" type="button" onClick={() => motionAssetsManager.resume(folder)}>Resume</button>}
    {state.error && <p role="alert" className="model-error">{state.error}</p>}
  </div>;
}
