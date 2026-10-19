import { useEffect, useRef, useState } from 'react';
import { Sparkles, Upload, UserRound, X } from 'lucide-react';
import type { AvatarAsset, AvatarAssetInput } from './harnessAvatarLibrary.ts';
import { HarnessAvatarGallery } from './HarnessAvatarGallery.tsx';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import type { HarnessManifest } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { withModelLease } from './harnessLease.ts';
import { showCompletionToast } from './toastStore.ts';
import { openToastImagePreview } from './toastImagePreview.ts';
import './harnessUserProfile.css';

type UserProfile = NonNullable<HarnessManifest['userProfile']>;

export default function HarnessUserProfile({ open, profile, store, folder, imageOptions, onSave, onSaveAsset, onOpenModels, onClose }: {
  open: boolean;
  profile: UserProfile;
  store: HarnessStore;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onSave: (profile: UserProfile) => Promise<void>;
  onSaveAsset: (image: Blob, input: AvatarAssetInput) => Promise<AvatarAsset>;
  onOpenModels: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [name, setName] = useState(profile.name);
  const [avatarId, setAvatarId] = useState(profile.avatarAssetId || '');
  const [assets, setAssets] = useState<AvatarAsset[]>([]);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('A friendly original portrait, centered face, clear silhouette, dark teal background with soft violet light. No words, logos, or recognizable existing characters.');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const avatarUrl = useAvatarAssetUrl(store, avatarId);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    setName(profile.name);
    setAvatarId(profile.avatarAssetId || '');
    setSearch(''); setError(''); setProgress('');
    let active = true;
    void store.avatarLibrary().then(saved => { if (active) setAssets(saved); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => { active = false; controller.current?.abort(); };
  }, [open, store, profile.name, profile.avatarAssetId]);

  const close = () => { if (saving || generating) return; dialog.current?.close(); onClose(); };
  const upload = async (file: File | undefined) => {
    if (!file || saving || generating) return;
    setSaving(true); setError('');
    try {
      const asset = await onSaveAsset(await compactIdentityAvatar(file),
        { title: `${name.trim() || 'My'} avatar`, tags: ['Person', 'My Avatar'], source: 'uploaded' });
      setAssets(current => [asset, ...current]);
      setAvatarId(asset.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const generate = async () => {
    if (!imageOptions.length || saving || generating) return;
    const active = new AbortController();
    controller.current = active;
    setGenerating(true); setError(''); setProgress('Waiting for image model…');
    const startedAt = performance.now();
    const request = `Original square user avatar portrait. ${prompt.trim()} Distinctive silhouette, no words, logos, or recognizable existing characters.`;
    try {
      const result = await withModelLease('user-avatar', async () => {
        const failures: string[] = [];
        for (const option of imageOptions) {
          if (active.signal.aborted) break;
          if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
          try { return await generateImage(option, request, active.signal, setProgress, undefined, folder); }
          catch (cause) { if (active.signal.aborted) break; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
        throw new Error(`No image generator completed the avatar. ${failures.join(' | ')}`);
      }, active.signal);
      if (active.signal.aborted) return;
      const compact = await compactIdentityAvatar(result);
      const asset = await onSaveAsset(compact,
        { title: `${name.trim() || 'My'} avatar`, tags: ['Person', 'My Avatar'], source: 'generated', prompt: request });
      setAssets(current => [asset, ...current]);
      setAvatarId(asset.id);
      setProgress('Avatar ready. Save your profile to use it in chat.');
      showCompletionToast('Your avatar is ready.', startedAt, 2000, { label: 'View avatar', onClick: () => openToastImagePreview(compact, 'Your avatar') });
    } catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (controller.current === active) controller.current = null; setGenerating(false); }
  };
  const save = async () => {
    if (saving || generating) return;
    setSaving(true); setError('');
    try {
      await onSave({ name: name.trim().slice(0, 80) || 'You', ...(avatarId ? { avatarAssetId: avatarId } : {}) });
      dialog.current?.close(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="harness-dialog harness-user-profile-dialog" aria-label="Your profile" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="harness-identity-dialog-head"><h2>Your profile</h2><button type="button" className="harness-icon" aria-label="Close your profile" disabled={saving || generating} onClick={close}><X size={17}/></button></div>
    <div className="harness-user-profile-preview"><span className="harness-user-profile-avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt=""/> : <UserRound size={30}/>}</span><label>Name<input aria-label="Your name" value={name} maxLength={80} disabled={saving || generating} onChange={event => setName(event.target.value)} placeholder="You"/></label></div>
    <div className="harness-user-profile-actions"><button type="button" className="harness-secondary" disabled={saving || generating} onClick={() => uploadInput.current?.click()}><Upload size={14}/> Upload image</button><input ref={uploadInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>{avatarId && <button type="button" className="harness-secondary" disabled={saving || generating} onClick={() => setAvatarId('')}>Use default icon</button>}</div>
    <details className="harness-user-profile-gallery"><summary>Choose a saved avatar</summary><input aria-label="Search avatars for your profile" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search images or tags…"/>{assets.length ? <HarnessAvatarGallery store={store} assets={assets} legacy={[]} query={search} onUseAsset={asset => setAvatarId(asset.id)} onUseIdentity={() => {}}/> : <p className="harness-muted">No saved avatars yet.</p>}</details>
    <label className="harness-user-profile-prompt">Generate an avatar<textarea rows={3} value={prompt} disabled={saving || generating} onChange={event => setPrompt(event.target.value)}/></label>
    <div className="harness-user-profile-actions">{imageOptions.length ? <button type="button" className="harness-secondary" disabled={saving || generating} onClick={() => void generate()}><Sparkles size={14}/> Generate avatar</button> : <button type="button" className="harness-secondary" onClick={() => { dialog.current?.close(); onClose(); onOpenModels(); }}>Set up image model</button>}{generating && <button type="button" className="harness-danger" onClick={() => controller.current?.abort()}>Stop</button>}<span role="status">{progress}</span></div>
    {error && <p role="alert" className="harness-git-error">{error}</p>}
    <div className="harness-dialog-actions"><button type="button" className="harness-secondary" disabled={saving || generating} onClick={close}>Cancel</button><button type="button" className="harness-primary" disabled={saving || generating} onClick={() => void save()}>{saving ? 'Saving…' : 'Save profile'}</button></div>
  </dialog>;
}
