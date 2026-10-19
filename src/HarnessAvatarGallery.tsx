import { useEffect, useRef, useState } from 'react';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { avatarAssetMatches } from './harnessAvatarLibrary.ts';
import { identityAvatarPath, type HarnessIdentity } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { useAvatarAssetUrl, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';
import { Star } from 'lucide-react';

function AssetTile({ store, asset, onUse, onEdit, onFavorite, onPreview }: { store: HarnessStore; asset: AvatarAsset; onUse: (asset: AvatarAsset) => void; onEdit?: (asset: AvatarAsset) => void; onFavorite?: (asset: AvatarAsset) => void; onPreview: (asset: AvatarAsset) => void }) {
  const large = (asset.fileBytes || 0) > 20_000_000;
  const url = useAvatarAssetUrl(store, asset.id, large);
  return <article className="harness-avatar-tile">
    <button type="button" className="harness-avatar-tile-image harness-avatar-preview-trigger" onClick={() => onPreview(asset)} aria-label={`View ${asset.title}`}>{url ? <img src={url} alt=""/> : <span aria-hidden="true">{large ? 'Large image' : '✦'}</span>}</button>
    <strong title={asset.title}>{asset.title}</strong>
    <small>{asset.tags.slice(0, 3).join(' · ') || asset.source}</small>
    <div><button type="button" className="harness-secondary" onClick={() => onUse(asset)}>Use</button>{onEdit && <button type="button" className="harness-secondary" onClick={() => onEdit(asset)}>Edit</button>}{onFavorite && <button type="button" className="harness-secondary harness-avatar-favorite" aria-label={asset.favorite ? `Remove ${asset.title} from favorites` : `Add ${asset.title} to favorites`} aria-pressed={!!asset.favorite} onClick={() => onFavorite(asset)}><Star size={13} fill={asset.favorite ? 'currentColor' : 'none'}/></button>}</div>
  </article>;
}

function AssetPreview({ store, asset, onClose }: { store: HarnessStore; asset: AvatarAsset; onClose: () => void }) {
  const tooLarge = (asset.fileBytes || 0) > 50_000_000;
  const url = useAvatarAssetUrl(store, asset.id);
  const format = asset.mimeType === 'image/jpeg' ? 'JPEG' : asset.mimeType === 'image/webp' ? 'WebP' : asset.mimeType === 'image/avif' ? 'AVIF' : asset.mimeType === 'image/gif' ? 'GIF' : 'PNG';
  const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType?.slice(6) || 'png';
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="harness-dialog harness-avatar-preview-dialog" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <header><div><span className="harness-overline">SAVED IMAGE</span><h2>{asset.title}</h2></div><button type="button" className="harness-secondary" onClick={onClose}>Close</button></header>
    {url && !tooLarge && <img className="harness-avatar-preview-image" src={url} alt={asset.title}/>}
    {tooLarge && <p>This image is over 50 MB, so browser preview is unavailable. The original remains in the workspace as <code>{asset.path}</code>.</p>}
    {asset.prompt && <p><strong>Prompt</strong> {asset.prompt}</p>}
    {asset.collections?.length ? <p><strong>Collections</strong> {asset.collections.join(' · ')}</p> : null}
    {asset.tags.length ? <p><strong>Tags</strong> {asset.tags.join(' · ')}</p> : null}
    {url && <a className="harness-secondary" href={url} download={`${asset.title.replace(/[^a-z0-9-]+/gi, '-').slice(0, 64) || 'image'}.${extension}`}>Download {format}</a>}
  </dialog>;
}

function LegacyTile({ store, identity, onUse }: { store: HarnessStore; identity: HarnessIdentity; onUse: (identity: HarnessIdentity) => void }) {
  const url = useIdentityAvatarUrl(store, { ...identity, avatarPath: identityAvatarPath(identity.id) });
  if (!url) return null;
  return <article className="harness-avatar-tile">
    <div className="harness-avatar-tile-image"><img src={url} alt=""/></div>
    <strong title={identity.name}>{identity.name}'s image</strong>
    <small>{identity.focus} · existing image</small>
    <div><button type="button" className="harness-secondary" onClick={() => onUse(identity)}>Use</button></div>
  </article>;
}

export function HarnessAvatarGallery({ store, assets, legacy, query, onUseAsset, onUseIdentity, onEdit, onFavorite }: {
  store: HarnessStore;
  assets: AvatarAsset[];
  legacy: HarnessIdentity[];
  query: string;
  onUseAsset: (asset: AvatarAsset) => void;
  onUseIdentity: (identity: HarnessIdentity) => void;
  onEdit?: (asset: AvatarAsset) => void;
  onFavorite?: (asset: AvatarAsset) => void;
}) {
  const [preview, setPreview] = useState<AvatarAsset | null>(null);
  const shown = assets.filter(asset => avatarAssetMatches(asset, query));
  const legacyShown = legacy.filter(identity => `${identity.name} ${identity.focus} ${identity.icon || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="harness-avatar-gallery-grid">
    {shown.map(asset => <AssetTile key={asset.id} store={store} asset={asset} onUse={onUseAsset} onEdit={onEdit} onFavorite={onFavorite} onPreview={setPreview}/>)}
    {legacyShown.map(identity => <LegacyTile key={identity.id} store={store} identity={identity} onUse={onUseIdentity}/>)}
    {!shown.length && !legacyShown.length && <p className="harness-muted">No saved images match.</p>}
    {preview && <AssetPreview store={store} asset={preview} onClose={() => setPreview(null)}/>}
  </div>;
}
