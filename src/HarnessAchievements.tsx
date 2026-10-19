import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import HarnessAchievementSetManager from './HarnessAchievementSetManager.tsx';
import { activeAchievementSet, achievementArtworkKey, achievementWithCopy, emptyAchievementSetLibrary, type AchievementSetLibrary } from './harnessAchievementSets.ts';
import type { AIConfig } from './ai.ts';
import HarnessSurfaceArtwork from './HarnessSurfaceArtwork.tsx';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import { ACHIEVEMENTS, emptyAchievementLedger, scanAchievementInventory, visibleAchievements, type Achievement, type AchievementLedger } from './harnessAchievements.ts';
import { emptySurfaceArtwork, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import type { HarnessManifest } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ImageConfig } from './imageGeneration.ts';
import { showCompletionToast } from './toastStore.ts';
import './harnessAchievements.css';

function AchievementBadge({ store, achievement, assetId, onOpen }: {
  store: HarnessStore; achievement: Achievement; assetId?: string; onOpen: () => void;
}) {
  const url = useAvatarAssetUrl(store, assetId);
  return <button type="button" className="harness-achievement-symbol" aria-label={`${assetId ? 'Edit' : 'Add'} image for ${achievement.title}`} onClick={onOpen}>
    {url ? <img src={url} alt=""/> : achievement.icon}
  </button>;
}

export default function HarnessAchievements({ store, manifest, folder, imageOptions, chatConfig, onWrite }: {
  store: HarnessStore;
  manifest: HarnessManifest;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  chatConfig: AIConfig | null;
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
}) {
  const [ledger, setLedger] = useState<AchievementLedger>(emptyAchievementLedger);
  const [artwork, setArtwork] = useState<SurfaceArtworkMap>(emptySurfaceArtwork);
  const [sets, setSets] = useState<AchievementSetLibrary>(emptyAchievementSetLibrary);
  const [editing, setEditing] = useState<Achievement | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scan = useRef<AbortController | null>(null);
  const run = async () => {
    scan.current?.abort();
    const controller = new AbortController();
    scan.current = controller;
    setLoading(true); setError(''); setProgress({ done: 0, total: 0 });
    const started = performance.now();
    try {
      const observed = await scanAchievementInventory(store, manifest, (done, total) => {
        if (!controller.signal.aborted) setProgress({ done, total });
      }, controller.signal);
      if (controller.signal.aborted) return;
      setLedger(await onWrite(() => store.updateAchievementLedger(observed.counts, observed.modelsSeen, observed.modelTypesSeen)));
      showCompletionToast('Achievements updated.', started, 2000, { label: 'View achievements', onClick: () => { location.hash = '/achievements'; } });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (scan.current === controller) { scan.current = null; setLoading(false); }
    }
  };
  useEffect(() => {
    let active = true;
    void Promise.all([store.achievementLedger(), store.surfaceArtwork(), store.achievementSets()]).then(([saved, images, savedSets]) => {
      if (active) { setLedger(saved); setArtwork(images); setSets(savedSets); void run(); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; scan.current?.abort(); };
    // The view is keyed to the workspace, so it scans when opened or refreshed.
  }, [store]);
  useEffect(() => {
    let active = true;
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ workspaceId: string }>).detail?.workspaceId !== store.workspaceId) return;
      void store.achievementLedger().then(value => { if (active) setLedger(value); })
        .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    window.addEventListener('harness:achievements-changed', refresh);
    return () => { active = false; window.removeEventListener('harness:achievements-changed', refresh); };
  }, [store]);

  const activeSet = activeAchievementSet(sets);
  const entries = visibleAchievements(ledger).map(item => ({ ...item, achievement: achievementWithCopy(item.achievement, activeSet) }));
  const unlockedCount = entries.filter(item => item.unlocked).length;
  return <section className="harness-page harness-achievements-page">
    <div className="harness-heading"><div><span className="harness-overline">YOUR JOURNEY</span><h1>Achievements</h1><p>Milestones are calculated from saved workspace activity. Some goals reveal the next one.</p></div><div className="harness-achievement-heading-actions"><HarnessAchievementSetManager store={store} library={sets} config={chatConfig} onWrite={onWrite} onChanged={setSets} onArtworkChanged={setArtwork}/><button className="harness-secondary" onClick={() => void run()} disabled={loading}><RefreshCw size={15}/> Refresh</button></div></div>
    <div className="harness-achievements-summary"><div><Trophy size={24}/><strong>{unlockedCount}<span> / {ACHIEVEMENTS.length}</span></strong><small>UNLOCKED</small></div><p>{loading ? `Reading history… ${progress.done} of ${progress.total} parts` : `${ledger.counts.conversations.toLocaleString()} conversations · ${ledger.counts.models.toLocaleString()} models · ${ledger.counts.generatedArtwork.toLocaleString()} generated images`}</p></div>
    {loading && <div className="harness-achievements-progress"><progress max={Math.max(1, progress.total)} value={progress.done} aria-label="Achievement scan progress"/><button className="harness-secondary" onClick={() => scan.current?.abort()}>Stop</button></div>}
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    <div className="harness-achievements-grid">{entries.map(({ achievement, hidden, unlocked }) => {
      const current = ledger.counts[achievement.metric];
      const artworkKey = achievementArtworkKey(activeSet?.id, achievement.id);
      return <article key={achievement.id} className={`harness-card harness-achievement-card${unlocked ? ' unlocked' : ''}${hidden ? ' hidden-goal' : ''}`}>
        <div className="harness-achievement-top">{hidden ? <span className="harness-achievement-symbol" aria-hidden="true">◇</span> : <AchievementBadge store={store} achievement={achievement} assetId={artwork.items[artworkKey]?.assetId} onOpen={() => setEditing(achievement)}/>}<span className="harness-achievement-state">{unlocked ? 'UNLOCKED' : hidden ? 'HIDDEN GOAL' : 'IN PROGRESS'}</span></div>
        <h2>{hidden ? '???' : achievement.title}</h2><p>{hidden ? 'Complete the previous milestone to reveal this goal.' : achievement.description}</p>
        {!hidden && <div className="harness-achievement-meter"><progress max={achievement.target} value={Math.min(current, achievement.target)} aria-label={`${achievement.title} progress`}/><span>{Math.min(current, achievement.target).toLocaleString()} / {achievement.target.toLocaleString()}</span></div>}
        {unlocked && <small>Earned {new Date(ledger.unlockedAt[achievement.id]).toLocaleDateString()}</small>}
      </article>;
    })}</div>
    <p className="harness-achievements-note">Token and response-time goals use recorded model usage. Image goals count successful generation in this app and older generated artwork saved in its library.</p>
    {editing && <HarnessSurfaceArtwork key={`${activeSet?.id || 'original'}:${editing.id}`} store={store} surfaceKey={achievementArtworkKey(activeSet?.id, editing.id)} title={editing.title} kind="achievement" entry={artwork.items[achievementArtworkKey(activeSet?.id, editing.id)]} suggestedPrompt={activeSet?.entries[editing.id]?.imagePrompt} imageOptions={imageOptions} folder={folder} onWrite={onWrite} onSaved={setArtwork} onClose={() => setEditing(null)}/>}
  </section>;
}
