import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image as ImageIcon, Sparkles, X } from 'lucide-react';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { cleanTags } from './harnessData.ts';
import { AVATAR_VISION_TAG_PROMPT, applyAvatarTagReviews, parseAvatarVisionTags, scanAvatarLibraryTags, type AvatarTagReview } from './harnessAvatarVision.ts';
import { describeBrowserImage, getBrowserModelStatus, isBrowserVisionReady, subscribeBrowserModel } from './browserModel.ts';
import { withModelLease } from './harnessLease.ts';
import type { HarnessStore } from './harnessStore.ts';
import { showToast } from './toastStore.ts';
import { avatarVisionSetupMessage } from './harnessAvatarVisionReadiness.ts';

function AvatarTagThumbnail({ store, assetId }: { store: HarnessStore; assetId: string }) {
  const url = useAvatarAssetUrl(store, assetId);
  return <span className="harness-avatar-tag-thumbnail" aria-hidden="true">{url ? <img src={url} alt=""/> : <ImageIcon size={17}/>}</span>;
}

export default function HarnessAvatarTagBatch({ assets, store, onUpdateAsset, onSaved, onOpenModels }: {
  assets: AvatarAsset[];
  store: HarnessStore;
  onUpdateAsset: (id: string, title: string, tags: string[]) => Promise<AvatarAsset>;
  onSaved: (asset: AvatarAsset) => void;
  onOpenModels: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scan = useRef<AbortController | null>(null);
  const save = useRef<AbortController | null>(null);
  const model = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const visionReady = isBrowserVisionReady(model.path);
  const visionSetup = avatarVisionSetupMessage(model, visionReady);
  const [reviews, setReviews] = useState<AvatarTagReview[]>([]);
  const [done, setDone] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [phase, setPhase] = useState<'scan' | 'save'>('scan');
  const [status, setStatus] = useState('');
  const [currentAssetId, setCurrentAssetId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => { scan.current?.abort(); save.current?.abort(); }, []);

  const close = () => { scan.current?.abort(); save.current?.abort(); scan.current = null; save.current = null; setRunning(false); setSaving(false); dialog.current?.close(); };
  const start = async () => {
    if (running || saving || !assets.length) return;
    if (!visionReady) { setError(visionSetup); return; }
    const controller = new AbortController();
    const modelPath = model.path;
    const targets = [...assets];
    scan.current = controller;
    setReviews([]); setDone(0); setScanTotal(targets.length); setPhase('scan'); setRunning(true); setError(''); setStatus(`Inspecting 0/${targets.length} images…`); setCurrentAssetId('');
    try {
      const completed = await scanAvatarLibraryTags(targets, controller.signal, async (asset, index) => {
        if (!isBrowserVisionReady(modelPath)) { setError('The vision model was unloaded. Load it again to continue.'); controller.abort(); throw new Error('The vision model was unloaded.'); }
        setCurrentAssetId(asset.id);
        setStatus(`Inspecting ${index + 1}/${targets.length}: ${asset.title}`);
        const answer = await withModelLease(`avatar-tags:${asset.id}`, async () => {
          const image = await store.avatarAsset(asset.id);
          if (!image) throw new Error('Image missing from workspace.');
          return describeBrowserImage(modelPath, image, AVATAR_VISION_TAG_PROMPT, controller.signal);
        }, controller.signal);
        const tags = parseAvatarVisionTags(answer);
        if (!tags.length) throw new Error('No usable tag list returned.');
        return { answer, tags };
      }, (review, count) => { if (scan.current === controller) { setReviews(current => [...current, review]); setDone(count); } });
      if (scan.current === controller) setStatus(controller.signal.aborted ? `Stopped after ${completed}/${targets.length} images.` : `Reviewed ${completed} images.`);
    } catch (cause) {
      if (!controller.signal.aborted && scan.current === controller) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (scan.current === controller) { scan.current = null; setRunning(false); }
    }
  };
  const apply = async () => {
    if (running || saving) return;
    const selected = reviews.filter(review => review.selected && !review.applied && cleanTags(review.draft.split(','), 8).length);
    if (!selected.length) return;
    const controller = new AbortController();
    save.current = controller;
    setSaveDone(0); setSaveTotal(selected.length); setPhase('save'); setCurrentAssetId(selected[0].assetId);
    setSaving(true); setError(''); setStatus(`Saving 0/${selected.length} images…`);
    try {
      const completed = await applyAvatarTagReviews(reviews, controller.signal,
        async id => (await store.avatarLibrary()).find(asset => asset.id === id) || null,
        (asset, tags) => onUpdateAsset(asset.id, asset.title, tags),
        (updated, review, count, total) => {
          onSaved(updated);
          setSaveDone(count);
          setCurrentAssetId(selected[count]?.assetId || updated.id);
          setReviews(items => items.map(item => item.assetId === review.assetId ? { ...item, applied: true, selected: false } : item));
          setStatus(`Saved ${count}/${total} images.`);
        });
      if (completed) showToast(controller.signal.aborted ? `Tagging stopped. ${completed} images updated.` : `${completed} avatar${completed === 1 ? '' : 's'} tagged.`, 'success', { label: 'View images', onClick: () => { location.hash = '/images'; } });
    } catch (cause) {
      if (!controller.signal.aborted && save.current === controller) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (save.current === controller) { save.current = null; setSaving(false); }
    }
  };
  const selectable = reviews.filter(review => review.selected && !review.applied && cleanTags(review.draft.split(','), 8).length > 0).length;
  return <>
    <button type="button" className="harness-secondary" disabled={!assets.length} onClick={() => dialog.current?.showModal()}><Sparkles size={15}/> Tag library</button>
    <dialog ref={dialog} className="harness-dialog harness-avatar-tag-batch" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="harness-identity-dialog-head"><h2>Tag saved avatars</h2><button type="button" className="harness-icon" aria-label="Close avatar tagging" onClick={close}><X size={16}/></button></div>
      <p className="harness-muted">{assets.length} images · Suggestions are reviewed before saving.</p>
      {!visionReady && <p className="harness-avatar-tag-setup">{visionSetup} <button type="button" className="harness-secondary" onClick={() => { close(); onOpenModels(); }}>Open Models</button></p>}
      {(running || saving || done > 0) && <div className="harness-avatar-pack-progress" role="status"><progress max={phase === 'save' ? Math.max(1, saveTotal) : Math.max(1, scanTotal)} value={phase === 'save' ? saveDone : done} aria-label={phase === 'save' ? 'Avatar tag save progress' : 'Avatar tag analysis progress'}/><span className="harness-avatar-tag-current">{(running || saving) && currentAssetId && <AvatarTagThumbnail store={store} assetId={currentAssetId}/>}<span>{status}</span></span></div>}
      {error && <p role="alert" className="harness-git-error">{error}</p>}
      {!!reviews.length && <div className="harness-avatar-tag-review" aria-label="Avatar tag suggestions">{reviews.map(review => <div className="harness-avatar-tag-review-row" key={review.assetId}><label><input type="checkbox" checked={review.selected} disabled={running || saving || !!review.error || !!review.applied} onChange={event => setReviews(items => items.map(item => item.assetId === review.assetId ? { ...item, selected: event.target.checked } : item))}/><AvatarTagThumbnail store={store} assetId={review.assetId}/><strong>{review.title}</strong>{review.applied && <small>Saved</small>}</label>{review.error ? <small role="status">{review.error}</small> : <><input aria-label={`Suggested tags for ${review.title}`} value={review.draft} disabled={running || saving || !!review.applied} onChange={event => setReviews(items => items.map(item => item.assetId === review.assetId ? { ...item, draft: event.target.value } : item))}/><details><summary>Model answer</summary><pre>{review.answer}</pre></details></>}</div>)}</div>}
      <div className="harness-dialog-actions"><button type="button" className="harness-secondary" onClick={close}>Close</button>{running || saving ? <button type="button" className="harness-danger" onClick={() => { scan.current?.abort(); save.current?.abort(); setStatus('Stopping…'); }}>Stop</button> : <><button type="button" className="harness-secondary" disabled={!visionReady || !assets.length} onClick={() => void start()}>{reviews.length ? 'Analyze again' : 'Analyze images'}</button><button type="button" className="harness-primary" disabled={!selectable} onClick={() => void apply()}>Apply to {selectable} image{selectable === 1 ? '' : 's'}</button></>}</div>
    </dialog>
  </>;
}
