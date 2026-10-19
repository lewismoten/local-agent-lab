import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { validIdentityAvatarPath } from './harnessIdentityAvatar.ts';
import type { HarnessIdentity } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';

export type LegacyAvatarCandidate = { identity: HarnessIdentity; assetIds: string[] };
export type LegacyAvatarScan = { unique: LegacyAvatarCandidate[]; ambiguous: LegacyAvatarCandidate[]; missing: HarnessIdentity[]; scannedAssets: number };

async function fingerprint(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `${bytes.length}:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Reads at most four 512 KB assets at a time; only exact byte matches can be linked automatically. */
export async function scanLegacyAvatarLinks(store: Pick<HarnessStore, 'avatarAsset' | 'identityAvatar'>,
  assets: AvatarAsset[], identities: HarnessIdentity[], signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void): Promise<LegacyAvatarScan> {
  const candidates = identities.filter(identity => validIdentityAvatarPath(identity) && !identity.avatarAssetId);
  if (!candidates.length) return { unique: [], ambiguous: [], missing: [], scannedAssets: 0 };
  const missing: HarnessIdentity[] = [];
  const identityKeys: { identity: HarnessIdentity; key: string }[] = [];
  const sizes = new Set<number>();
  let done = 0;
  const total = candidates.length + assets.length;
  for (const identity of candidates) {
    if (signal?.aborted) throw new DOMException('Avatar link scan stopped.', 'AbortError');
    const blob = await store.identityAvatar(identity.id);
    if (!blob || !blob.size || blob.size > 512_000) missing.push(identity);
    else { sizes.add(blob.size); identityKeys.push({ identity, key: await fingerprint(blob) }); }
    onProgress?.(++done, total);
  }
  if (!identityKeys.length) return { unique: [], ambiguous: [], missing, scannedAssets: 0 };
  const matchingAssets = new Map<string, string[]>();
  let next = 0;
  const workers = Array.from({ length: Math.min(4, assets.length) }, async () => {
    while (next < assets.length && !signal?.aborted) {
      const asset = assets[next++];
      const blob = await store.avatarAsset(asset.id);
      if (blob && sizes.has(blob.size)) {
        const key = await fingerprint(blob);
        matchingAssets.set(key, [...(matchingAssets.get(key) || []), asset.id]);
      }
      onProgress?.(++done, total);
    }
  });
  await Promise.all(workers);
  if (signal?.aborted) throw new DOMException('Avatar link scan stopped.', 'AbortError');
  const unique: LegacyAvatarCandidate[] = [];
  const ambiguous: LegacyAvatarCandidate[] = [];
  for (const item of identityKeys) {
    const assetIds = matchingAssets.get(item.key) || [];
    if (assetIds.length === 1) unique.push({ identity: item.identity, assetIds });
    else if (assetIds.length > 1) ambiguous.push({ identity: item.identity, assetIds });
    else missing.push(item.identity);
  }
  return { unique, ambiguous, missing, scannedAssets: assets.length };
}
