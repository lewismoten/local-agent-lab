import { useEffect, useState } from 'react';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import type { HarnessStore } from './harnessStore.ts';

export default function HarnessAvatarPackPreview({ asset, store }: { asset: AvatarAsset; store: HarnessStore }) {
  const [url, setUrl] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    let created = '';
    void store.avatarAsset(asset.id).then(blob => {
      if (!active) return;
      if (!blob) { setMissing(true); return; }
      created = URL.createObjectURL(blob);
      setUrl(created);
    }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [asset.id, store]);
  return <figure className="harness-avatar-pack-tile">
    {url ? <img src={url} alt={asset.title}/> : <span aria-label={missing ? `${asset.title} image unavailable` : `${asset.title} loading`} aria-busy={!missing}>{missing ? '!' : '✦'}</span>}
    <figcaption>{asset.title}</figcaption>
  </figure>;
}
