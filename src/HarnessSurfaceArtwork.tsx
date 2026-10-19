import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Sparkles, Upload, X } from 'lucide-react';
import { HarnessAvatarGallery } from './HarnessAvatarGallery.tsx';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { SurfaceArtworkEntry, SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import { suggestedSurfaceArtworkPrompt } from './harnessSurfaceArtwork.ts';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { withModelLease } from './harnessLease.ts';
import { showCompletionToast } from './toastStore.ts';
import { openToastImagePreview } from './toastImagePreview.ts';
import './harnessSurfaceArtwork.css';

export function SurfaceArtworkButton({ store, title, assetId, onOpen }: {
  store: HarnessStore; title: string; assetId?: string; onOpen: () => void;
}) {
  const url = useAvatarAssetUrl(store, assetId);
  return <button type="button" className="harness-surface-artwork-button" aria-label={`Edit icon for ${title}`} title={`Edit icon for ${title}`} onClick={onOpen}>
    {url ? <img src={url} alt=""/> : <ImageIcon size={15} aria-hidden="true"/>}
  </button>;
}

export default function HarnessSurfaceArtwork({ store, surfaceKey, title, kind, entry, suggestedPrompt, replaceKeys = [], imageOptions, folder, onWrite, onSaved, onClose }: {
  store: HarnessStore;
  surfaceKey: string;
  title: string;
  kind: string;
  entry?: SurfaceArtworkEntry;
  suggestedPrompt?: string;
  replaceKeys?: string[];
  imageOptions: ImageConfig[];
  folder: FileSystemDirectoryHandle | null;
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
  onSaved: (map: SurfaceArtworkMap) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState(suggestedPrompt || entry?.prompt || suggestedSurfaceArtworkPrompt(title, kind));
  const [assets, setAssets] = useState<AvatarAsset[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const imageUrl = useAvatarAssetUrl(store, entry?.assetId);

  useEffect(() => {
    let active = true;
    if (!dialog.current?.open) dialog.current?.showModal();
    void store.avatarLibrary().then(items => { if (active) setAssets(items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; abort.current?.abort(); dialog.current?.close(); };
  }, [store]);
  const close = () => { if (!busy) { dialog.current?.close(); onClose(); } };
  const save = async (assetId: string | null, nextPrompt = prompt) => {
    const updated = await onWrite(() => store.saveSurfaceArtwork(surfaceKey, assetId, nextPrompt.trim().slice(0, 1200), replaceKeys));
    onSaved(updated);
    return updated;
  };
  const select = async (asset: AvatarAsset) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await save(asset.id); setProgress('Icon saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await save(null); setProgress('Icon removed.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const compact = await compactIdentityAvatar(file);
      const asset = await onWrite(() => store.saveAvatarAsset(compact,
        { title: `${title} icon`, tags: [kind, 'Icon'], source: 'uploaded' }));
      setAssets(current => [asset, ...current]);
      await save(asset.id);
      setProgress('Icon saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!imageOptions.length || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(''); setProgress('Waiting for image model…');
    const started = performance.now();
    const request = prompt.trim().slice(0, 1200) || suggestedSurfaceArtworkPrompt(title, kind);
    try {
      const image = await withModelLease(`artwork:${surfaceKey}`, async () => {
        const failures: string[] = [];
        for (const option of imageOptions) {
          if (controller.signal.aborted) break;
          if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
          try { return await generateImage(option, request, controller.signal, setProgress, undefined, folder); }
          catch (cause) { if (controller.signal.aborted) break; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
        throw new Error(`No image generator completed the icon. ${failures.join(' | ')}`);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const compact = await compactIdentityAvatar(image);
      const asset = await onWrite(() => store.saveAvatarAsset(compact,
        { title: `${title} icon`, tags: [kind, 'Icon'], source: 'generated', prompt: request }));
      setAssets(current => [asset, ...current]);
      await save(asset.id, request);
      setProgress('Icon saved.');
      showCompletionToast(`${title} icon ready.`, started, 2000, { label: 'View icon', onClick: () => openToastImagePreview(compact, `${title} icon`) });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (abort.current === controller) abort.current = null; setBusy(false); }
  };
  return <dialog ref={dialog} className="harness-dialog harness-surface-artwork-dialog" aria-label={`${title} icon`} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="harness-surface-artwork-head"><h2>{title} icon</h2><button type="button" className="harness-icon" aria-label="Close icon editor" disabled={busy} onClick={close}><X size={17}/></button></div>
    <div className="harness-surface-artwork-preview">{imageUrl ? <img src={imageUrl} alt={`${title} icon`}/> : <ImageIcon size={31} aria-hidden="true"/>}</div>
    <label>Image prompt<textarea rows={3} maxLength={1200} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)}/></label>
    <div className="harness-surface-artwork-actions"><button type="button" className="harness-secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14}/> Upload</button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>{imageOptions.length > 0 && <button type="button" className="harness-secondary" disabled={busy} onClick={() => void generate()}><Sparkles size={14}/> {entry?.assetId ? 'Regenerate' : 'Generate'}</button>}{busy && abort.current && <button type="button" className="harness-danger" onClick={() => abort.current?.abort()}>Stop</button>}{entry?.assetId && <button type="button" className="harness-danger" disabled={busy} onClick={() => void remove()}>Remove icon</button>}</div>
    <details><summary>Choose a saved image</summary><input aria-label="Search images for model icon" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search images or tags…"/><HarnessAvatarGallery store={store} assets={assets} legacy={[]} query={search} onUseAsset={asset => void select(asset)} onUseIdentity={() => {}}/></details>
    <span role="status">{progress}</span>{error && <p className="harness-git-error" role="alert">{error}</p>}
    <div className="harness-dialog-actions"><button type="button" className="harness-secondary" disabled={busy} onClick={close}>Close</button></div>
  </dialog>;
}
