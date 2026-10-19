import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Sparkles, Upload, X } from 'lucide-react';
import type { AvatarAsset, AvatarAssetInput } from './harnessAvatarLibrary.ts';
import { avatarPackPlan, runAvatarPack, type AvatarPackAge, type AvatarPackGender, type AvatarPackKind } from './harnessAvatarPack.ts';
import { exportAvatarPack, importAvatarPack } from './harnessAvatarPackTransfer.ts';
import { AVATAR_DIRECTION_PRESETS, AVATAR_STYLE_PRESETS, cleanAvatarPackPreferences, type AvatarPackPreferences } from './harnessAvatarPackPreferences.ts';
import { IMAGE_USES, imageUseIndex, type ImageUse } from './harnessImageUse.ts';
import { scanLegacyAvatarLinks, type LegacyAvatarScan } from './harnessLegacyAvatarLinks.ts';
import { AVATAR_VISION_TAG_PROMPT, mergeAvatarVisionTags, parseAvatarVisionTags } from './harnessAvatarVision.ts';
import { identityAvatarPath, isoNow, newId, type HarnessIdentity } from './harnessData.ts';
import { IDENTITY_ICONS, compactIdentityAvatar, identityAvatarPrompt, identityDraft } from './harnessIdentityAvatar.ts';
import { HarnessAvatarGallery } from './HarnessAvatarGallery.tsx';
import HarnessAvatarPackPreview from './HarnessAvatarPackPreview.tsx';
import HarnessAvatarTagBatch from './HarnessAvatarTagBatch.tsx';
import { IdentityAvatar, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { describeBrowserImage, getBrowserModelStatus, isBrowserVisionReady, subscribeBrowserModel } from './browserModel.ts';
import { withModelLease } from './harnessLease.ts';
import type { HarnessStore } from './harnessStore.ts';
import { showCompletionToast, showToast } from './toastStore.ts';
import { avatarVisionSetupMessage } from './harnessAvatarVisionReadiness.ts';

function IdentityCard({ identity, store, selected, onEdit, onSelect }: { identity: HarnessIdentity; store: HarnessStore; selected: boolean; onEdit: () => void; onSelect: () => void }) {
  const url = useIdentityAvatarUrl(store, identity);
  return <article className="harness-card harness-identity-card"><div><IdentityAvatar identity={identity} url={url} size={42}/><span className="harness-overline">{identity.focus.toUpperCase()}</span></div><h2>{identity.name}</h2><p>{identity.instructions}</p><div><button className="harness-secondary" onClick={onEdit}>Edit</button><button className="harness-secondary" disabled={selected} onClick={onSelect}>{selected ? 'Chat default' : 'Use for chat'}</button></div></article>;
}

export default function HarnessIdentities({ identities, chatIdentityId, store, folder, imageOptions, onSave, onSelectChat, onSaveAvatar, onSaveAsset, onUpdateAsset, onOpenModels, mode = 'identities', onOpenImages }: {
  identities: HarnessIdentity[];
  chatIdentityId: string;
  store: HarnessStore;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onSave: (identity: HarnessIdentity) => Promise<void>;
  onSelectChat: (id: string) => Promise<void>;
  onSaveAvatar: (id: string, blob: Blob) => Promise<string>;
  onSaveAsset: (blob: Blob, input: AvatarAssetInput) => Promise<AvatarAsset>;
  onUpdateAsset: (id: string, title: string, tags: string[], favorite?: boolean, collections?: string[]) => Promise<AvatarAsset>;
  onOpenModels: () => void;
  mode?: 'identities' | 'images';
  onOpenImages?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const assetDialog = useRef<HTMLDialogElement>(null);
  const packDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const packImportInput = useRef<HTMLInputElement>(null);
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
  const [imageCategory, setImageCategory] = useState<ImageUse | ''>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState('');
  const [imageUses, setImageUses] = useState<Map<string, Set<ImageUse>>>(new Map());
  const [imageUseProgress, setImageUseProgress] = useState('');
  const [legacyReview, setLegacyReview] = useState<{ scan: LegacyAvatarScan; linked: number } | null>(null);
  const identitiesRef = useRef(identities);
  const saveIdentityRef = useRef(onSave);
  identitiesRef.current = identities;
  saveIdentityRef.current = onSave;
  const [selectedPackId, setSelectedPackId] = useState('');
  const [packName, setPackName] = useState('');
  const [packTransfer, setPackTransfer] = useState(false);
  const [packTransferProgress, setPackTransferProgress] = useState('');
  const [packTransferError, setPackTransferError] = useState('');
  const [editingAsset, setEditingAsset] = useState<AvatarAsset | null>(null);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetTags, setAssetTags] = useState('');
  const [assetFavorite, setAssetFavorite] = useState(false);
  const [assetCollections, setAssetCollections] = useState('');
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
  const [styleChoice, setStyleChoice] = useState('');
  const [directions, setDirections] = useState<string[]>([]);
  const [customDirection, setCustomDirection] = useState('');
  const [packPreferences, setPackPreferences] = useState<AvatarPackPreferences>(() => cleanAvatarPackPreferences(null));
  const [packRunning, setPackRunning] = useState(false);
  const [packDone, setPackDone] = useState(0);
  const [packSaved, setPackSaved] = useState<AvatarAsset[]>([]);
  const [packProgress, setPackProgress] = useState('');
  const [packError, setPackError] = useState('');
  const browserModel = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const visionReady = isBrowserVisionReady(browserModel.path);
  useEffect(() => () => { generation.current?.abort(); packGeneration.current?.abort(); tagGeneration.current?.abort(); }, []);
  useEffect(() => {
    let active = true;
    void store.avatarPackPreferences().then(saved => { if (active) setPackPreferences(saved); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [store]);
  const packDetail = directions.join(', ');
  const styleOptions = [...new Map([...AVATAR_STYLE_PRESETS, ...packPreferences.styles].map(value => [value.toLocaleLowerCase(), value])).values()];
  const directionOptions = [...new Map([...AVATAR_DIRECTION_PRESETS, ...packPreferences.directions].map(value => [value.toLocaleLowerCase(), value])).values()];
  const rememberPackOptions = async () => {
    const next = cleanAvatarPackPreferences({ version: 1,
      styles: [...packPreferences.styles, ...(styleChoice === 'other' ? [packStyle] : [])],
      directions: [...packPreferences.directions, ...directions.filter(value => !AVATAR_DIRECTION_PRESETS.some(preset => preset.toLocaleLowerCase() === value.toLocaleLowerCase()))],
    });
    await store.saveAvatarPackPreferences(next);
    setPackPreferences(next);
  };
  const addDirection = () => {
    const value = customDirection.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (value && !directions.some(item => item.toLocaleLowerCase() === value.toLocaleLowerCase())) setDirections(current => [...current, value].slice(0, 5));
    setCustomDirection('');
  };
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
    if (mode !== 'images' || !assets.length) return;
    const controller = new AbortController();
    void (async () => {
      const scan = await scanLegacyAvatarLinks(store, assets, identitiesRef.current, controller.signal,
        (done, total) => setImageUseProgress(`Checking older avatar links ${done}/${total}…`));
      if (scan.unique.length || scan.ambiguous.length || scan.missing.length)
        setLegacyReview(previous => ({ scan, linked: previous?.linked || 0 }));
      for (const candidate of scan.unique) {
        if (controller.signal.aborted) return;
        const current = (await store.manifest()).identities.find(item => item.id === candidate.identity.id);
        if (!current || current.avatarPath !== candidate.identity.avatarPath || current.avatarAssetId) continue;
        await saveIdentityRef.current({ ...current, avatarAssetId: candidate.assetIds[0], updatedAt: isoNow() });
        setLegacyReview(previous => ({ scan: previous?.scan || scan, linked: (previous?.linked || 0) + 1 }));
      }
      if (controller.signal.aborted) return;
      if (scan.ambiguous.length || scan.missing.length) setLegacyReview(previous => ({ scan, linked: previous?.linked || 0 }));
      const uses = await imageUseIndex(store, assets, controller.signal, (done, total) => setImageUseProgress(`Checking image uses ${done}/${total}…`));
      if (!controller.signal.aborted) { setImageUses(uses); setImageUseProgress(''); }
    })().catch(cause => { if (!controller.signal.aborted) setImageUseProgress(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [mode, store, assets]);
  const resolveLegacyAvatar = async (identityId: string, assetId: string) => {
    try {
      const current = (await store.manifest()).identities.find(item => item.id === identityId);
      if (!current?.avatarPath || current.avatarAssetId || !assets.some(asset => asset.id === assetId)) return;
      await onSave({ ...current, avatarAssetId: assetId, updatedAt: isoNow() });
      setLegacyReview(previous => previous ? { ...previous, linked: previous.linked + 1,
        scan: { ...previous.scan, ambiguous: previous.scan.ambiguous.filter(item => item.identity.id !== identityId) } } : null);
      setImageUses(await imageUseIndex(store, assets));
    } catch (cause) { setImageUseProgress(cause instanceof Error ? cause.message : String(cause)); }
  };
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
    setDraft(next); setPendingAvatar(null); setPendingAssetId(identity?.avatarAssetId || ''); setPrompt(automaticPrompt.current); setProgress(''); setError(''); dialog.current?.showModal();
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
      let assetId = pendingAssetId;
      if (pendingAvatar && !pendingAssetId) {
        const asset = await onSaveAsset(pendingAvatar, { title: `${draft.name.trim()} avatar`, tags: [draft.icon || 'person', draft.focus], source: pendingSource,
          ...(pendingSource === 'generated' ? { prompt } : {}), originIdentityId: draft.id });
        assetId = asset.id;
        setPendingAssetId(asset.id);
        setAssets(current => [asset, ...current]);
      }
      const savedPath = pendingAvatar ? await onSaveAvatar(draft.id, pendingAvatar) : undefined;
      const avatarPath = draft.avatarPath ? savedPath || draft.avatarPath : undefined;
      await onSave({ ...draft, name: draft.name.trim().slice(0, 80), instructions: draft.instructions.trim().slice(0, 4000), avatarPath,
        avatarAssetId: avatarPath && assetId || undefined, updatedAt: isoNow() });
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
      setPendingAvatar(await compactIdentityAvatar(blob)); setPendingAssetId(asset.id); setPendingSource(asset.source);
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
  const editAsset = (asset: AvatarAsset) => { setEditingAsset(asset); setAssetTitle(asset.title); setAssetTags(asset.tags.join(', ')); setAssetFavorite(!!asset.favorite); setAssetCollections((asset.collections || []).join(', ')); setTagError(''); setTagMessage(''); setTagAnswer(''); assetDialog.current?.showModal(); };
  const closeAsset = () => { tagGeneration.current?.abort(); tagGeneration.current = null; setTagging(false); setEditingAsset(null); assetDialog.current?.close(); };
  const suggestAssetTags = async () => {
    if (!editingAsset || tagging || busy) return;
    if (!visionReady) { setTagError(avatarVisionSetupMessage(browserModel, visionReady)); return; }
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
      const updated = await onUpdateAsset(editingAsset.id, assetTitle, assetTags.split(','), assetFavorite, assetCollections.split(','));
      setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset));
      closeAsset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const openPack = () => { setPackError(''); setPackProgress(''); setPackDone(0); setPackSaved([]); setPackName(`Avatar pack ${new Date().toLocaleDateString()}`); packDialog.current?.showModal(); };
  const closePack = () => { if (packRunning) return; void rememberPackOptions().catch(cause => setPackError(cause instanceof Error ? cause.message : String(cause))); packDialog.current?.close(); };
  const generatePack = async () => {
    if (packRunning || !imageOptions.length) return;
    if (!packName.trim()) { setPackError('Name this pack first.'); return; }
    try { await rememberPackOptions(); }
    catch (cause) { setPackError(cause instanceof Error ? cause.message : String(cause)); return; }
    const plan = avatarPackPlan(packKind, packCount, packStyle, packDetail, { age: packAge, gender: packGender });
    const groupId = crypto.randomUUID();
    const groupName = packName.trim().slice(0, 80);
    const controller = new AbortController();
    packGeneration.current = controller;
    setPackRunning(true); setPackDone(0); setPackSaved([]); setPackError('');
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
            { title: item.title, tags: item.tags, source: 'generated', prompt: item.prompt, packId: groupId, packName: groupName });
        }, (asset, count) => {
          completed = count;
          setAssets(current => [asset, ...current]);
          setPackSaved(current => [...current, asset]);
          setPackDone(count);
        });
      }, controller.signal);
      setPackProgress(controller.signal.aborted ? `Stopped · ${completed} saved` : `${completed} avatars ready`);
      if (completed > 0) setSelectedPackId(groupId);
      if (controller.signal.aborted) showToast(`Avatar pack stopped. ${completed} saved.`, 'success', { label: 'View images', onClick: () => { location.hash = '/images'; } });
      else showCompletionToast(`${completed} avatar${completed === 1 ? '' : 's'} added to your library.`, startedAt, 2000, { label: 'View images', onClick: () => { location.hash = '/images'; } });
    } catch (cause) {
      if (completed > 0) setSelectedPackId(groupId);
      if (controller.signal.aborted) {
        setPackProgress(`Stopped · ${completed} saved`);
        showToast(`Avatar pack stopped. ${completed} saved.`, 'success', { label: 'View images', onClick: () => { location.hash = '/images'; } });
      } else setPackError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (packGeneration.current === controller) packGeneration.current = null;
      setPackRunning(false);
    }
  };
  const packs = [...new Map(assets.filter(asset => asset.packId && asset.packName).map(asset => [asset.packId!, asset.packName!])).entries()];
  const collections = [...new Set(assets.flatMap(asset => asset.collections || []))].sort((left, right) => left.localeCompare(right));
  const shownAssets = selectedPackId ? assets.filter(asset => asset.packId === selectedPackId) : assets;
  const categoryAssets = shownAssets.filter(asset => (!imageCategory || imageUses.get(asset.id)?.has(imageCategory))
    && (!favoritesOnly || asset.favorite) && (!collectionFilter || asset.collections?.includes(collectionFilter)));
  const toggleFavorite = async (asset: AvatarAsset) => {
    try {
      const updated = await onUpdateAsset(asset.id, asset.title, asset.tags, !asset.favorite, asset.collections || []);
      setAssets(current => current.map(item => item.id === updated.id ? updated : item));
      setPackTransferError('');
    } catch (cause) { setPackTransferError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const exportSelectedPack = async () => {
    const selected = packs.find(([id]) => id === selectedPackId);
    if (!selected || packTransfer) return;
    setPackTransfer(true); setPackTransferError(''); setPackTransferProgress('Preparing avatar pack…');
    try {
      const json = await exportAvatarPack(selected[1], shownAssets, id => store.avatarAsset(id));
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `${selected[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'avatars'}.avatar-pack.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPackTransferProgress('Pack exported.');
    } catch (cause) { setPackTransferError(cause instanceof Error ? cause.message : String(cause)); setPackTransferProgress(''); }
    finally { setPackTransfer(false); }
  };
  const importPackFile = async (file: File | undefined) => {
    if (!file || packTransfer) return;
    setPackTransfer(true); setPackTransferError(''); setPackTransferProgress('Reading avatar pack…');
    let imported = 0;
    try {
      if (file.size > 17_000_000) throw new Error('Avatar pack exceeds 17 MB.');
      const pack = importAvatarPack(JSON.parse(await file.text()));
      const groupId = crypto.randomUUID();
      for (const avatar of pack.avatars) {
        const decoded = await createImageBitmap(avatar.image);
        decoded.close();
        setPackTransferProgress(`Importing ${imported + 1}/${pack.avatars.length}…`);
        await onSaveAsset(avatar.image, { ...avatar.input, packId: groupId, packName: pack.name });
        imported++;
      }
      setAssets(await store.avatarLibrary());
      setSelectedPackId(groupId);
      setPackTransferProgress(`${imported} avatars imported.`);
      showToast(`${pack.name} imported.`, 'success');
    } catch (cause) {
      if (imported) setAssets(await store.avatarLibrary());
      setPackTransferError(`${imported ? `${imported} avatars were imported. ` : ''}${cause instanceof Error ? cause.message : String(cause)}`);
      setPackTransferProgress('');
    } finally { setPackTransfer(false); }
  };
  const legacy = identities.filter(identity => legacyIds.includes(identity.id) && !assets.some(asset => asset.originIdentityId === identity.id));
  return <section className="harness-page">
    {mode === 'identities' ? <>
      <div className="harness-heading harness-identity-heading"><div><span className="harness-overline">REUSABLE GUIDANCE</span><h1>Identities</h1><p>Choose how chat and agents work. Project instructions can add local context.</p></div><div className="harness-identity-generate"><button className="harness-secondary" onClick={surprise}><Sparkles size={16}/> Surprise me</button>{imageOptions.length > 0 && <button className="harness-secondary" onClick={() => { const random = crypto.getRandomValues(new Uint32Array(1))[0]; const next = identityDraft(random, identities.map(identity => identity.name)); edit(next); void generate(next, identityAvatarPrompt(next)); }}><Sparkles size={16}/> Surprise + avatar</button>}<button className="harness-primary" onClick={() => edit()}><Plus size={16}/> New identity</button></div></div>
      <div className="harness-card harness-identity-default"><label>Workspace chat identity<select aria-label="Workspace chat identity" value={chatIdentityId} onChange={event => void selectChat(event.target.value)}><option value="">No identity</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></label><small>Projects can override this in Project settings.</small>{error && !dialog.current?.open && <p role="alert" className="harness-git-error">{error}</p>}</div>
      <div className="harness-identity-grid">{identities.map(identity => <IdentityCard key={identity.id} identity={identity} store={store} selected={chatIdentityId === identity.id} onEdit={() => edit(identity)} onSelect={() => void selectChat(identity.id)}/>)}</div>
      {onOpenImages && <button className="harness-secondary" type="button" onClick={onOpenImages}>Open image library</button>}
    </> : <div className="harness-heading"><div><span className="harness-overline">WORKSPACE IMAGES</span><h1>Images</h1><p>Browse saved artwork and avatar packs by use.</p></div></div>}
    {mode === 'images' && <section className="harness-avatar-library" aria-label="Image library"><div className="harness-avatar-library-head"><div><span className="harness-overline">IMAGE LIBRARY</span><h2>Saved images</h2></div><div className="harness-avatar-library-actions"><select aria-label="Image use" value={imageCategory} onChange={event => setImageCategory(event.target.value as ImageUse | '')}><option value="">All uses</option>{IMAGE_USES.filter(use => assets.some(asset => imageUses.get(asset.id)?.has(use))).map(use => <option key={use} value={use}>{use}</option>)}</select><button className="harness-secondary harness-image-favorites-filter" type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>★ Favorites</button>{collections.length > 0 && <select aria-label="Image collection" value={collectionFilter} onChange={event => setCollectionFilter(event.target.value)}><option value="">All collections</option>{collections.map(name => <option key={name} value={name}>{name}</option>)}</select>}{packs.length > 0 && <select aria-label="Avatar pack" value={selectedPackId} onChange={event => setSelectedPackId(event.target.value)}><option value="">All packs</option>{packs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}<input aria-label="Search saved images" value={gallerySearch} onChange={event => setGallerySearch(event.target.value)} placeholder="Search images or tags…"/><HarnessAvatarTagBatch assets={assets} store={store} onUpdateAsset={onUpdateAsset} onSaved={updated => setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset))} onOpenModels={onOpenModels}/>{selectedPackId && <button className="harness-secondary" disabled={packTransfer} onClick={() => void exportSelectedPack()}>Export pack</button>}<button className="harness-secondary" disabled={packTransfer} onClick={() => packImportInput.current?.click()}>Import pack</button><input ref={packImportInput} type="file" accept=".json,application/json" hidden onChange={event => { void importPackFile(event.target.files?.[0]); event.target.value = ''; }}/><button className="harness-secondary" onClick={openPack}><Sparkles size={15}/> Generate pack</button></div></div>{imageUseProgress && <p className="harness-muted" role="status">{imageUseProgress}</p>}{legacyReview && <details className="harness-image-legacy" open={legacyReview.scan.ambiguous.length > 0 || undefined}><summary>Older avatars: {legacyReview.linked} linked · {legacyReview.scan.ambiguous.length} to review · {legacyReview.scan.missing.length} without a match</summary>{legacyReview.scan.ambiguous.map(candidate => <div key={candidate.identity.id}><strong>{candidate.identity.name}</strong><span>Choose the saved image to link:</span>{candidate.assetIds.map(id => <button key={id} className="harness-secondary" type="button" onClick={() => void resolveLegacyAvatar(candidate.identity.id, id)}>{assets.find(asset => asset.id === id)?.title || 'Image'} · {id.slice(0, 6)}</button>)}</div>)}{legacyReview.scan.missing.map(identity => <p key={identity.id}>{identity.name}: no matching saved image.</p>)}</details>}{packTransferProgress && <p className="harness-muted" role="status">{packTransferProgress}</p>}{packTransferError && <p className="harness-git-error" role="alert">{packTransferError}</p>}{assets.length || legacy.length ? <HarnessAvatarGallery store={store} assets={categoryAssets} legacy={!selectedPackId && (!imageCategory || imageCategory === 'Avatars') ? legacy : []} query={gallerySearch} onUseAsset={asset => void useAsset(asset)} onUseIdentity={identity => void useLegacyImage(identity)} onEdit={editAsset} onFavorite={asset => void toggleFavorite(asset)}/> : <p className="harness-muted">Images you upload or generate will appear here for reuse.</p>}</section>}
    <dialog ref={packDialog} className="harness-dialog harness-avatar-pack-dialog" onCancel={event => { event.preventDefault(); if (!packRunning) closePack(); }}>
      <div className="harness-identity-dialog-head"><h2>Generate avatar pack</h2><button className="harness-icon" aria-label="Close avatar pack" disabled={packRunning} onClick={closePack}><X size={16}/></button></div>
      <label>Pack name<input value={packName} maxLength={80} disabled={packRunning} onChange={event => setPackName(event.target.value)} placeholder="Name this group of avatars"/></label>
      <div className="harness-avatar-pack-fields"><label>Subjects<select value={packKind} disabled={packRunning} onChange={event => setPackKind(event.target.value as AvatarPackKind)}><option value="mixed">Mixed</option><option value="people">People</option><option value="robots">Robots</option><option value="animals">Animals</option><option value="fantasy">Fantasy beings</option><option value="objects">Objects & plants</option><option value="symbols">Symbols</option></select></label><label>Images<select value={packCount} disabled={packRunning} onChange={event => setPackCount(Number(event.target.value))}><option value={4}>4</option><option value={8}>8</option><option value={12}>12</option><option value={16}>16</option><option value={24}>24</option></select></label></div>
      {(packKind === 'mixed' || packKind === 'people') && <div className="harness-avatar-pack-people-fields"><label>Age<select value={packAge} disabled={packRunning} onChange={event => setPackAge(event.target.value as AvatarPackAge)}><option value="any">Varied</option><option value="young-adult">Young adult</option><option value="middle-aged">Middle-aged</option><option value="older-adult">Older adult</option></select></label><label>Gender<select value={packGender} disabled={packRunning} onChange={event => setPackGender(event.target.value as AvatarPackGender)}><option value="varied">Varied</option><option value="women">Women</option><option value="men">Men</option><option value="nonbinary">Nonbinary</option></select></label></div>}
      <label>Visual style<select value={styleChoice} disabled={packRunning} onChange={event => { const value = event.target.value; setStyleChoice(value); setPackStyle(value === 'other' ? '' : value); }}><option value="">Model default</option>{styleOptions.map(style => <option key={style} value={style}>{style}</option>)}<option value="other">Other…</option></select></label>
      {styleChoice === 'other' && <label>Custom visual style<input maxLength={60} disabled={packRunning} value={packStyle} onChange={event => setPackStyle(event.target.value)} placeholder="Describe a visual style"/></label>}
      <fieldset className="harness-avatar-direction"><legend>Subject direction</legend><div className="harness-avatar-direction-chips">{directionOptions.map(option => <button key={option} type="button" disabled={packRunning} aria-pressed={directions.some(item => item.toLocaleLowerCase() === option.toLocaleLowerCase())} onClick={() => setDirections(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option].slice(0, 5))}>{option}</button>)}</div>{directions.filter(item => !directionOptions.some(option => option.toLocaleLowerCase() === item.toLocaleLowerCase())).map(item => <button key={item} type="button" className="harness-avatar-custom-chip" disabled={packRunning} onClick={() => setDirections(current => current.filter(value => value !== item))}>{item} ×</button>)}<div className="harness-avatar-direction-add"><input aria-label="Custom subject direction" maxLength={60} disabled={packRunning} value={customDirection} onChange={event => setCustomDirection(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDirection(); } }} placeholder="Add a direction…"/><button type="button" className="harness-secondary" disabled={packRunning || !customDirection.trim()} onClick={addDirection}>Add</button></div></fieldset>
      <div className="harness-avatar-pack-plan"><span className="harness-overline">IN THIS PACK</span><p>{avatarPackPlan(packKind, packCount, packStyle, packDetail, { age: packAge, gender: packGender }).map(item => item.title).join(' · ')}</p></div>
      {packRunning || packDone > 0 ? <div className="harness-avatar-pack-progress" role="status"><progress max={packCount} value={packDone} aria-label="Avatar pack progress"/><span>{packProgress}</span></div> : null}
      {packSaved.length > 0 && <div className="harness-avatar-pack-preview" aria-label="Generated avatars, newest first">{[...packSaved].reverse().map(asset => <HarnessAvatarPackPreview key={asset.id} asset={asset} store={store}/>)}</div>}
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
    <dialog ref={assetDialog} className="harness-dialog harness-avatar-asset-dialog" onCancel={event => { event.preventDefault(); closeAsset(); }}><h2>Edit image</h2><label>Name<input value={assetTitle} maxLength={80} onChange={event => setAssetTitle(event.target.value)}/></label><label>Tags, separated by commas<input value={assetTags} onChange={event => setAssetTags(event.target.value)}/></label><label className="harness-image-favorite-label"><input type="checkbox" checked={assetFavorite} onChange={event => setAssetFavorite(event.target.checked)}/> Favorite</label><label>Collections, separated by commas<input value={assetCollections} onChange={event => setAssetCollections(event.target.value)} placeholder="Add a collection name"/></label><div className="harness-avatar-tag-actions"><button type="button" className="harness-secondary" disabled={busy || tagging} onClick={() => void suggestAssetTags()}>{tagging ? 'Inspecting…' : 'Suggest tags from image'}</button>{tagging && <button type="button" className="harness-danger" onClick={() => { tagGeneration.current?.abort(); setTagMessage('Stopped.'); }}>Stop</button>}</div>{tagMessage && <p role="status" className="harness-muted">{tagMessage}</p>}{tagError && <p role="alert" className="harness-git-error">{tagError}{!visionReady && <button type="button" className="harness-secondary" onClick={() => { closeAsset(); onOpenModels(); }}>Open Models</button>}</p>}{tagAnswer && <details className="harness-avatar-tag-answer"><summary>Vision model answer</summary><pre>{tagAnswer}</pre></details>}{error && <p role="alert" className="harness-git-error">{error}</p>}<div className="harness-dialog-actions"><button className="harness-secondary" onClick={closeAsset}>Cancel</button><button className="harness-primary" disabled={busy || tagging || !assetTitle.trim()} onClick={() => void saveAssetLabels()}>Save</button></div></dialog>
  </section>;
}
