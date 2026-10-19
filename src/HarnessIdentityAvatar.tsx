import { useEffect, useState } from 'react';
import { Bot, Brain, Code2, Compass, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import type { HarnessIdentity } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { validIdentityAvatarPath } from './harnessIdentityAvatar.ts';
import './harnessIdentityAvatar.css';

const ICONS = { person: UserRound, robot: Bot, code: Code2, brain: Brain, compass: Compass, shield: ShieldCheck, spark: Sparkles };
const focusIcon = { coding: 'code', research: 'compass', review: 'shield', general: 'spark' } as const;

export function useIdentityAvatarUrl(store: Pick<HarnessStore, 'identityAvatar'> | null, identity: HarnessIdentity | undefined): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    if (!store || !identity || !validIdentityAvatarPath(identity)) return;
    let active = true;
    let objectUrl = '';
    void store.identityAvatar(identity.id).then(blob => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => console.warn('Could not load identity avatar:', error));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [store, identity?.id, identity?.avatarPath, identity?.updatedAt]);
  return url;
}

export function useAvatarAssetUrl(store: Pick<HarnessStore, 'avatarAsset'> | null, id: string | undefined, skip = false): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    if (!store || !id || skip || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
    let active = true;
    let objectUrl = '';
    void store.avatarAsset(id).then(blob => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => console.warn('Could not load avatar asset:', error));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [store, id, skip]);
  return url;
}

export function IdentityAvatar({ identity, url, size = 40 }: { identity?: HarnessIdentity; url?: string; size?: number }) {
  const key = identity?.icon && identity.icon in ICONS ? identity.icon : focusIcon[identity?.focus || 'general'];
  const Icon = ICONS[key];
  return <span className="harness-identity-avatar" style={{ width: size, height: size }} aria-hidden="true">
    {url ? <img src={url} alt=""/> : <Icon size={Math.max(15, Math.round(size * .48))}/>}
  </span>;
}
