import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Sparkles, Upload, X } from 'lucide-react';
import type { AvatarAsset, AvatarAssetInput } from './harnessAvatarLibrary.ts';
import { avatarPackPlan, runAvatarPack, type AvatarPackAge, type AvatarPackGender, type AvatarPackKind } from './harnessAvatarPack.ts';
import { AVATAR_VISION_TAG_PROMPT, mergeAvatarVisionTags, parseAvatarVisionTags } from './harnessAvatarVision.ts';
import { identityAvatarPath, isoNow, newId, type HarnessIdentity } from './harnessData.ts';
import { IDENTITY_ICONS, compactIdentityAvatar, identityAvatarPrompt, identityDraft } from './harnessIdentityAvatar.ts';
import { HarnessAvatarGallery } from './HarnessAvatarGallery.tsx';
import HarnessAvatarTagBatch from './HarnessAvatarTagBatch.tsx';
import { IdentityAvatar, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { describeBrowserImage, getBrowserModelStatus, isBrowserVisionReady, subscribeBrowserModel } from './browserModel.ts';
import { withModelLease } from './harnessLease.ts';
import type { HarnessStore } from './harnessStore.ts';
import { showCompletionToast, showToast } from './toastStore.ts';

function IdentityCard({ identity, store, selected, onEdit, onSelect }: { identity: HarnessIdentity; store: HarnessStore; selected: boolean; onEdit: () => void; onSelect: () => void }) {
  const url = useIdentityAvatarUrl(store, identity);
  return <article className="harness-card harness-identity-card"><div><IdentityAvatar identity={identity} url={url} size={42}/><span className="harness-overline">{identity.focus.toUpperCase()}</span></div><h2>{identity.name}</h2><p>{identity.instructions}</p><div><button className="harness-secondary" onClick={onEdit}>Edit</button><button className="harness-secondary" disabled={selected} onClick={onSelect}>{selected ? 'Chat default' : 'Use for chat'}</button></div></article>;
}

export default function HarnessIdentities({ identities, chatIdentityId, store, folder, imageOptions, onSave, onSelectChat, onSaveAvatar, onSaveAsset, onUpdateAsset, onOpenModels }: {
  identities: HarnessIdentity[];
  chatIdentityId: string;
  store: HarnessStore;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onSave: (identity: HarnessIdentity) => Promise<void>;
  onSelectChat: (id: string) => Promise<void>;
  onSaveAvatar: (id: string, blob: Blob) => Promise<string>;
  onSaveAsset: (blob: Blob, input: AvatarAssetInput) => Promise<AvatarAsset>;
  onUpdateAsset: (id: string, title: string, tags: string[]) => Promise<AvatarAsset>;
  onOpenModels: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const assetDialog = useRef<HTMLDialogElement>(null);
  const packDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef<AbortController | null>(null);
  const packGeneration = useRef<AbortController | null>(null);
  const tagGeneration = useRef<AbortController | null>(null);
  const automaticPrompt = useRef('');
  const [draft, setDraft] = useState<HarnessIdentity | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<Blob | null>(null);
  const [pendingAssetId, setPendingAssetId] = useState('');
  const [pendingSource, setPendingSource] = useState<'generated' | 'uploaded'>('uploaded');
  const [assets, setAssets] = useState<AvatarAsset[]>([]);
  const [legacyIds, setLegacyIds] = useState<string[]>([]);
  const [gallerySearch, setGallerySearch] = useState('');
  const [editingAsset, setEditingAsset] = useState<AvatarAsset | null>(null);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetTags, setAssetTags] = useState('');
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [tagAnswer, setTagAnswer] = useState('');
  const [pendingUrl, setPendingUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [packKind, setPackKind] = useState<AvatarPackKind>('mixed');
  const [packCount, setPackCount] = useState(4);
  const [packAge, setPackAge] = useState<AvatarPackAge>('any');
  const [packGender, setPackGender] = useState<AvatarPackGender>('varied');
  const [packStyle, setPackStyle] = useState('');
  const [packDetail, setPackDetail] = useState('');
  const [packRunning, setPackRunning] = useState(false);
  const [packDone, setPackDone] = useState(0);
  const [packProgress, setPackProgress] = useState('');
  const [packError, setPackError] = useState('');
  const browserModel = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const visionReady = isBrowserVisionReady(browserModel.path);
  useEffect(() => () => { generation.current?.abort(); packGeneration.current?.abort(); tagGeneration.current?.abort(); }, []);
  // The image remains available after the identity switches back to a drawn icon.
  const savedUrl = useIdentityAvatarUrl(store, draft ? { ...draft, avatarPath: identityAvatarPath(draft.id) } : undefined);
  const identityRevision = identities.map(identity => `${identity.id}:${identity.updatedAt}`).join('|');
  useEffect(() => {
    let active = true;
    void Promise.all([store.avatarLibrary(), Promise.all(identities.map(async identity => (await store.identityAvatar(identity.id)) ? identity.id : ''))]).then(([saved, existing]) => {
      if (!active) return;
      setAssets(saved);
      setLegacyIds(existing.filter(Boolean));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [store, identityRevision]);
  useEffect(() => {
    if (!pendingAvatar) { setPendingUrl(''); return; }
    const url = URL.createObjectURL(pendingAvatar);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAvatar]);
  const edit = (identity?: HarnessIdentity): HarnessIdentity => {
    const now = isoNow();
    const next = identity || { id: newId(), name: '', focus: 'general' as const, icon: 'person' as const, instructions: '', createdAt: now, updatedAt: now };
    automaticPrompt.current = identityAvatarPrompt(next);
    setDraft(next); setPendingAvatar(null); setPendingAssetId(''); setPrompt(automaticPrompt.current); setProgress(''); setError(''); dialog.current?.showModal();
    return next;
  };
  const updateSuggestedPrompt = (next: HarnessIdentity) => {
    const suggested = identityAvatarPrompt(next);
    setPrompt(current => current === automaticPrompt.current ? suggested : current);
    automaticPrompt.current = suggested;
  };
  const surprise = () => {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    edit(identityDraft(random, identities.map(identity => identity.name)));
  };
  const close = () => { generation.current?.abort(); dialog.current?.close(); setDraft(null); setPendingAvatar(null); setPendingAssetId(''); setProgress(''); };
  const save = async () => {
    if (!draft?.name.trim() || !draft.instructions.trim() || busy || generating) return;
    setBusy(true); setError('');
    try {
      if (pendingAvatar && !pendingAssetId) {
        const asset = await onSaveAsset(pendingAvatar, { title: `${draft.name.trim()} avatar`, tags: [draft.icon || 'person', draft.focus], source: pendingSource,
          ...(pendingSource === 'generated' ? { prompt } : {}), originIdentityId: draft.id });
        setPendingAssetId(asset.id);
        setAssets(current => [asset, ...current]);
      }
      const savedPath = pendingAvatar ? await onSaveAvatar(draft.id, pendingAvatar) : undefined;
      const avatarPath = draft.avatarPath ? savedPath || draft.avatarPath : undefined;
      await onSave({ ...draft, name: draft.name.trim().slice(0, 80), instructions: draft.instructions.trim().slice(0, 4000), avatarPath, updatedAt: isoNow() });
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const selectChat = async (id: string) => {
    setError('');
    try { await onSelectChat(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const upload = async (file: File | undefined) => {
    if (!file || !draft) return;
    setBusy(true); setError('');
    try { setPendingAvatar(await compactIdentityAvatar(file)); setPendingAssetId(''); setPendingSource('uploaded'); setDraft({ ...draft, avatarPath: identityAvatarPath(draft.id) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const generate = async (identity: HarnessIdentity | null = draft, imagePrompt = prompt) => {
    if (!identity || !imageOptions.length || generating) return;
    const controller = new AbortController();
    generation.current = controller;
    setGenerating(true); setProgress('Waiting for image model…'); setError('');
    try {
      const result = await withModelLease(`avatar:${identity.id}`, async () => {
        const failures: string[] = [];
        for (const option of imageOptions) {
          if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
          try { return await generateImage(option, imagePrompt.trim() || identityAvatarPrompt(identity), controller.signal, setProgress, undefined, folder); }
          catch (cause) { if (controller.signal.aborted) throw cause; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
        throw new Error(`No image generator completed the avatar. ${failures.join(' | ')}`);
      }, controller.signal);
      if (!controller.signal.aborted) {
        setPendingAvatar(await compactIdentityAvatar(result));
        setPendingAssetId(''); setPendingSource('generated');
        setDraft(current => current?.id === identity.id ? { ...current, avatarPath: identityAvatarPath(current.id) } : current);
        setProgress('Avatar ready. Save the identity to keep it.');
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === controller) generation.current = null; setGenerating(false); }
  };
  const useAsset = async (asset: AvatarAsset) => {
    const target = draft || edit();
    setBusy(true); setError('');
    try {
      const blob = await store.avatarAsset(asset.id);
      if (!blob) throw new Error('This avatar image is missing from the workspace.');
      setPendingAvatar(blob); setPendingAssetId(asset.id); setPendingSource(asset.source);
      setDraft(current => current?.id === target.id ? { ...current, avatarPath: identityAvatarPath(target.id) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const useLegacyImage = async (identity: HarnessIdentity) => {
    const target = draft || edit();
    setBusy(true); setError('');
    try {
      const blob = await store.identityAvatar(identity.id);
      if (!blob) throw new Error('This identity image is missing from the workspace.');
      setPendingAvatar(blob); setPendingAssetId(''); setPendingSource('uploaded');
      setDraft(current => current?.id === target.id ? { ...current, avatarPath: identityAvatarPath(target.id) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const editAsset = (asset: AvatarAsset) => { setEditingAsset(asset); setAssetTitle(asset.title); setAssetTags(asset.tags.join(', ')); setTagError(''); setTagMessage(''); setTagAnswer(''); assetDialog.current?.showModal(); };
  const closeAsset = () => { tagGeneration.current?.abort(); tagGeneration.current = null; setTagging(false); setEditingAsset(null); assetDialog.current?.close(); };
  const suggestAssetTags = async () => {
    if (!editingAsset || tagging || busy) return;
    if (!visionReady) { setTagError('Load a browser model with its vision projector in Models first.'); return; }
    const controller = new AbortController();
    tagGeneration.current = controller;
    setTagging(true); setTagError(''); setTagMessage('Waiting for vision model…'); setTagAnswer('');
    try {
      const answer = await withModelLease(`avatar-tags:${editingAsset.id}`, async () => {
        const image = await store.avatarAsset(editingAsset.id);
        if (!image) throw new Error('This avatar image is missing from the workspace.');
        setTagMessage('Inspecting image…');
        return describeBrowserImage(browserModel.path, image, AVATAR_VISION_TAG_PROMPT, controller.signal);
      }, controller.signal);
      if (controller.signal.aborted || tagGeneration.current !== controller) return;
      setTagAnswer(answer);
      const suggestions = parseAvatarVisionTags(answer);
      if (!suggestions.length) throw new Error('The vision model returned no usable tag list. Review its answer below.');
      setAssetTags(current => mergeAvatarVisionTags(current, suggestions));
      setTagMessage(`${suggestions.length} suggested tag${suggestions.length === 1 ? '' : 's'} added. Review before saving.`);
    } catch (cause) {
      if (!controller.signal.aborted && tagGeneration.current === controller) { setTagMessage(''); setTagError(cause instanceof Error ? cause.message : String(cause)); }
    } finally {
      if (tagGeneration.current === controller) { tagGeneration.current = null; setTagging(false); }
    }
  };
  const saveAssetLabels = async () => {
    if (!editingAsset || busy || tagging) return;
    setBusy(true); setError('');
    try {
      const updated = await onUpdateAsset(editingAsset.id, assetTitle, assetTags.split(','));
      setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset));
      closeAsset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const openPack = () => { setPackError(''); setPackProgress(''); setPackDone(0); packDialog.current?.showModal(); };
  const closePack = () => { if (packRunning) return; packDialog.current?.close(); };
  const generatePack = async () => {
    if (packRunning || !imageOptions.length) return;
    const plan = avatarPackPlan(packKind, packCount, packStyle, packDetail, { age: packAge, gender: packGender });
    const controller = new AbortController();
    packGeneration.current = controller;
    setPackRunning(true); setPackDone(0); setPackError('');
    const startedAt = performance.now();
    let completed = 0;
    try {
      await withModelLease('avatar-pack', async () => {
        completed = await runAvatarPack(plan, controller.signal, async (item, index) => {
          setPackProgress(`${index + 1}/${plan.length} · ${item.title} · waiting for image model…`);
          const failures: string[] = [];
          for (const option of imageOptions) {
            if (controller.signal.aborted) break;
            if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
            try {
              return await generateImage(option, item.prompt, controller.signal,
                message => setPackProgress(`${index + 1}/${plan.length} · ${item.title} · ${message}`), undefined, folder);
            } catch (cause) {
              if (controller.signal.aborted) break;
              failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
          }
          throw new Error(`Could not generate ${item.title}. ${failures.join(' | ')}`);
        }, async (result, item, index) => {
          setPackProgress(`${index + 1}/${plan.length} · Saving ${item.title}…`);
          return onSaveAsset(await compactIdentityAvatar(result),
            { title: item.title, tags: item.tags, source: 'generated', prompt: item.prompt });
        }, (asset, count) => {
          completed = count;
          setAssets(current => [asset, ...current]);
          setPackDone(count);
        });
      }, controller.signal);
      setPackProgress(controller.signal.aborted ? `Stopped · ${completed} saved` : `${completed} avatars ready`);
      if (controller.signal.aborted) showToast(`Avatar pack stopped. ${completed} saved.`);
      else showCompletionToast(`${completed} avatar${completed === 1 ? '' : 's'} added to your library.`, startedAt);
    } catch (cause) {
      if (controller.signal.aborted) {
        setPackProgress(`Stopped · ${completed} saved`);
        showToast(`Avatar pack stopped. ${completed} saved.`);
      } else setPackError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (packGeneration.current === controller) packGeneration.current = null;
      setPackRunning(false);
    }
  };
  const legacy = identities.filter(identity => legacyIds.includes(identity.id) && !assets.some(asset => asset.originIdentityId === identity.id));
  return <section className="harness-page">
    <div className="harness-heading harness-identity-heading"><div><span className="harness-overline">REUSABLE GUIDANCE</span><h1>Identities</h1><p>Choose how chat and agents work. Project instructions can add local context.</p></div><div className="harness-identity-generate"><button className="harness-secondary" onClick={surprise}><Sparkles size={16}/> Surprise me</button>{imageOptions.length > 0 && <button className="harness-secondary" onClick={() => { const random = crypto.getRandomValues(new Uint32Array(1))[0]; const next = identityDraft(random, identities.map(identity => identity.name)); edit(next); void generate(next, identityAvatarPrompt(next)); }}><Sparkles size={16}/> Surprise + avatar</button>}<button className="harness-primary" onClick={() => edit()}><Plus size={16}/> New identity</button></div></div>
    <div className="harness-card harness-identity-default"><label>Workspace chat identity<select aria-label="Workspace chat identity" value={chatIdentityId} onChange={event => void selectChat(event.target.value)}><option value="">No identity</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></label><small>Projects can override this in Project settings.</small>{error && !dialog.current?.open && <p role="alert" className="harness-git-error">{error}</p>}</div>
    <div className="harness-identity-grid">{identities.map(identity => <IdentityCard key={identity.id} identity={identity} store={store} selected={chatIdentityId === identity.id} onEdit={() => edit(identity)} onSelect={() => void selectChat(identity.id)}/>)}</div>
    <section className="harness-avatar-library" aria-label="Saved avatars"><div className="harness-avatar-library-head"><div><span className="harness-overline">IMAGE LIBRARY</span><h2>Saved avatars</h2></div><div className="harness-avatar-library-actions"><input aria-label="Search saved avatars" value={gallerySearch} onChange={event => setGallerySearch(event.target.value)} placeholder="Search images or tags…"/><HarnessAvatarTagBatch assets={assets} store={store} onUpdateAsset={onUpdateAsset} onSaved={updated => setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset))} onOpenModels={onOpenModels}/><button className="harness-secondary" onClick={openPack}><Sparkles size={15}/> Generate pack</button></div></div>{assets.length || legacy.length ? <HarnessAvatarGallery store={store} assets={assets} legacy={legacy} query={gallerySearch} onUseAsset={asset => void useAsset(asset)} onUseIdentity={identity => void useLegacyImage(identity)} onEdit={editAsset}/> : <p className="harness-muted">Images you upload or generate will appear here for reuse.</p>}</section>
    <dialog ref={packDialog} className="harness-dialog harness-avatar-pack-dialog" onCancel={event => { event.preventDefault(); if (!packRunning) closePack(); }}>
      <div className="harness-identity-dialog-head"><h2>Generate avatar pack</h2><button className="harness-icon" aria-label="Close avatar pack" disabled={packRunning} onClick={closePack}><X size={16}/></button></div>
      <div className="harness-avatar-pack-fields"><label>Subjects<select value={packKind} disabled={packRunning} onChange={event => setPackKind(event.target.value as AvatarPackKind)}><option value="mixed">Mixed</option><option value="people">People</option><option value="robots">Robots</option><option value="symbols">Symbols</option></select></label><label>Images<select value={packCount} disabled={packRunning} onChange={event => setPackCount(Number(event.target.value))}><option value={4}>4</option><option value={8}>8</option><option value={12}>12</option></select></label></div>
      {(packKind === 'mixed' || packKind === 'people') && <div className="harness-avatar-pack-people-fields"><label>Age<select value={packAge} disabled={packRunning} onChange={event => setPackAge(event.target.value as AvatarPackAge)}><option value="any">Varied</option><option value="young-adult">Young adult</option><option value="middle-aged">Middle-aged</option><option value="older-adult">Older adult</option></select></label><label>Gender<select value={packGender} disabled={packRunning} onChange={event => setPackGender(event.target.value as AvatarPackGender)}><option value="varied">Varied</option><option value="women">Women</option><option value="men">Men</option><option value="nonbinary">Nonbinary</option></select></label></div>}
      <label>Visual style<input maxLength={150} disabled={packRunning} value={packStyle} onChange={event => setPackStyle(event.target.value)} placeholder="Cyberpunk, watercolor, cartoon…"/></label>
      <label>Subject direction<input maxLength={150} disabled={packRunning} value={packDetail} onChange={event => setPackDetail(event.target.value)} placeholder="Adult women, friendly androids…"/></label>
      <div className="harness-avatar-pack-plan"><span className="harness-overline">IN THIS PACK</span><p>{avatarPackPlan(packKind, packCount, packStyle, packDetail, { age: packAge, gender: packGender }).map(item => item.title).join(' · ')}</p></div>
      {packRunning || packDone > 0 ? <div className="harness-avatar-pack-progress" role="status"><progress max={packCount} value={packDone} aria-label="Avatar pack progress"/><span>{packProgress}</span></div> : null}
      {packError && <p role="alert" className="harness-git-error">{packError}</p>}
      <div className="harness-dialog-actions"><button className="harness-secondary" disabled={packRunning} onClick={closePack}>Close</button>{packRunning ? <button className="harness-danger" onClick={() => packGeneration.current?.abort()}>Stop</button> : imageOptions.length ? <button className="harness-primary" onClick={() => void generatePack()}>{packDone ? 'Generate again' : 'Generate pack'}</button> : <button className="harness-primary" onClick={() => { closePack(); onOpenModels(); }}>Set up image model</button>}</div>
    </dialog>
    <dialog ref={dialog} className="harness-dialog harness-identity-dialog" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="harness-identity-dialog-head"><h2>{identities.some(item => item.id === draft?.id) ? 'Edit identity' : 'New identity'}</h2><button className="harness-icon" aria-label="Close identity editor" onClick={close}><X size={16}/></button></div>
      {draft && <><div className="harness-identity-avatar-controls"><IdentityAvatar identity={draft} url={draft.avatarPath ? pendingUrl || savedUrl : undefined} size={64}/><button className="harness-secondary" disabled={busy || generating} onClick={() => fileInput.current?.click()}><Upload size={14}/> Upload image</button><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/></div>
        <span className="harness-overline">AVATAR CHOICES</span><div className="harness-identity-icon-grid">{(pendingUrl || savedUrl) && <button type="button" aria-label="Image avatar" aria-pressed={!!draft.avatarPath} onClick={() => setDraft({ ...draft, avatarPath: identityAvatarPath(draft.id) })}><IdentityAvatar identity={draft} url={pendingUrl || savedUrl} size={27}/>Image</button>}{IDENTITY_ICONS.map(item => <button key={item.id} type="button" aria-label={`${item.label} icon`} aria-pressed={(draft.icon || 'person') === item.id && !draft.avatarPath} onClick={() => { const next = { ...draft, icon: item.id, avatarPath: undefined }; setDraft(next); updateSuggestedPrompt(next); }}><IdentityAvatar identity={{ ...draft, icon: item.id }} size={27}/>{item.label}</button>)}</div>
        {(assets.length > 0 || legacy.length > 0) && <details className="harness-identity-library-details"><summary>Choose a saved avatar</summary><input aria-label="Search avatars in editor" value={gallerySearch} onChange={event => setGallerySearch(event.target.value)} placeholder="Search images or tags…"/><HarnessAvatarGallery store={store} assets={assets} legacy={legacy} query={gallerySearch} onUseAsset={asset => void useAsset(asset)} onUseIdentity={identity => void useLegacyImage(identity)}/></details>}
        <label>Name<input value={draft.name} maxLength={80} onChange={event => { const next = { ...draft, name: event.target.value }; setDraft(next); updateSuggestedPrompt(next); }}/></label><label>Focus<select value={draft.focus} onChange={event => { const next = { ...draft, focus: event.target.value as HarnessIdentity['focus'] }; setDraft(next); updateSuggestedPrompt(next); }}><option value="coding">Coding</option><option value="research">Research</option><option value="review">Review</option><option value="general">General</option></select></label><label>Instructions<textarea value={draft.instructions} rows={5} maxLength={4000} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
        <div className="harness-identity-avatar-prompt"><label>Image prompt<textarea rows={2} value={prompt} onChange={event => setPrompt(event.target.value)}/></label><div className="harness-identity-generate">{prompt !== automaticPrompt.current && <button className="harness-secondary" disabled={busy || generating} onClick={() => setPrompt(automaticPrompt.current)}>Use suggested prompt</button>}{imageOptions.length ? <button className="harness-secondary" disabled={busy || generating} onClick={() => void generate()}>{generating ? 'Generating…' : 'Generate avatar'}</button> : <button className="harness-secondary" onClick={() => { close(); onOpenModels(); }}>Set up image model</button>}{generating && <button className="harness-danger" onClick={() => generation.current?.abort()}>Stop</button>}<span className="harness-identity-avatar-progress" role="status">{progress}</span></div>{imageOptions.length > 0 && <small className="harness-identity-avatar-progress">Image prompt goes to {imageOptions[0].provider === 'browser' ? 'your browser model' : imageOptions[0].provider === 'openai' ? 'OpenAI' : 'your configured image endpoint'} when you choose Generate avatar.</small>}</div>
        {error && <p role="alert" className="harness-git-error">{error}</p>}<div className="harness-dialog-actions"><button className="harness-secondary" disabled={busy} onClick={close}>Cancel</button><button className="harness-primary" disabled={busy || generating || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save identity'}</button></div></>}
    </dialog>
    <dialog ref={assetDialog} className="harness-dialog harness-avatar-asset-dialog" onCancel={event => { event.preventDefault(); closeAsset(); }}><h2>Edit avatar image</h2><label>Name<input value={assetTitle} maxLength={80} onChange={event => setAssetTitle(event.target.value)}/></label><label>Tags, separated by commas<input value={assetTags} onChange={event => setAssetTags(event.target.value)}/></label><div className="harness-avatar-tag-actions"><button type="button" className="harness-secondary" disabled={busy || tagging} onClick={() => void suggestAssetTags()}>{tagging ? 'Inspecting…' : 'Suggest tags from image'}</button>{tagging && <button type="button" className="harness-danger" onClick={() => { tagGeneration.current?.abort(); setTagMessage('Stopped.'); }}>Stop</button>}</div>{tagMessage && <p role="status" className="harness-muted">{tagMessage}</p>}{tagError && <p role="alert" className="harness-git-error">{tagError}{!visionReady && <button type="button" className="harness-secondary" onClick={() => { closeAsset(); onOpenModels(); }}>Open Models</button>}</p>}{tagAnswer && <details className="harness-avatar-tag-answer"><summary>Vision model answer</summary><pre>{tagAnswer}</pre></details>}{error && <p role="alert" className="harness-git-error">{error}</p>}<div className="harness-dialog-actions"><button className="harness-secondary" onClick={closeAsset}>Cancel</button><button className="harness-primary" disabled={busy || tagging || !assetTitle.trim()} onClick={() => void saveAssetLabels()}>Save</button></div></dialog>
  </section>;
}
