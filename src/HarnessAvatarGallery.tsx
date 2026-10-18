import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { avatarAssetMatches } from './harnessAvatarLibrary.ts';
import { identityAvatarPath, type HarnessIdentity } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { useAvatarAssetUrl, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';

function AssetTile({ store, asset, onUse, onEdit }: { store: HarnessStore; asset: AvatarAsset; onUse: (asset: AvatarAsset) => void; onEdit?: (asset: AvatarAsset) => void }) {
  const url = useAvatarAssetUrl(store, asset.id);
  return <article className="harness-avatar-tile">
    <div className="harness-avatar-tile-image">{url ? <img src={url} alt=""/> : <span aria-hidden="true">✦</span>}</div>
    <strong title={asset.title}>{asset.title}</strong>
    <small>{asset.tags.slice(0, 3).join(' · ') || asset.source}</small>
    <div><button type="button" className="harness-secondary" onClick={() => onUse(asset)}>Use</button>{onEdit && <button type="button" className="harness-secondary" onClick={() => onEdit(asset)}>Edit</button>}</div>
  </article>;
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

export function HarnessAvatarGallery({ store, assets, legacy, query, onUseAsset, onUseIdentity, onEdit }: {
  store: HarnessStore;
  assets: AvatarAsset[];
  legacy: HarnessIdentity[];
  query: string;
  onUseAsset: (asset: AvatarAsset) => void;
  onUseIdentity: (identity: HarnessIdentity) => void;
  onEdit?: (asset: AvatarAsset) => void;
}) {
  const shown = assets.filter(asset => avatarAssetMatches(asset, query));
  const legacyShown = legacy.filter(identity => `${identity.name} ${identity.focus} ${identity.icon || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="harness-avatar-gallery-grid">
    {shown.map(asset => <AssetTile key={asset.id} store={store} asset={asset} onUse={onUseAsset} onEdit={onEdit}/>)}
    {legacyShown.map(identity => <LegacyTile key={identity.id} store={store} identity={identity} onUse={onUseIdentity}/>)}
    {!shown.length && !legacyShown.length && <p className="harness-muted">No saved images match.</p>}
  </div>;
}
