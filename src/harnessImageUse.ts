import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import type { HarnessStore } from './harnessStore.ts';

export type ImageUse = 'Generated' | 'Avatars' | 'Achievements' | 'Projects' | 'Journals' | 'Conversations' | 'Models' | 'Voices' | 'Other';
export const IMAGE_USES: ImageUse[] = ['Generated', 'Avatars', 'Achievements', 'Projects', 'Journals', 'Conversations', 'Models', 'Voices', 'Other'];

const surfaceUse = (key: string): ImageUse => key.startsWith('achievement:') ? 'Achievements'
  : key.startsWith('project:') ? 'Projects'
  : key.startsWith('conversation:') ? 'Conversations'
  : key.startsWith('voice:') ? 'Voices'
  : key.startsWith('model:') || key.startsWith('engine:') ? 'Models' : 'Other';

export async function imageUseIndex(store: Pick<HarnessStore, 'surfaceArtwork' | 'journalStyleSettings' | 'journalIndex' | 'journalRenderings' | 'manifest'>,
  assets: AvatarAsset[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<Map<string, Set<ImageUse>>> {
  const uses = new Map<string, Set<ImageUse>>();
  const known = new Set(assets.map(asset => asset.id));
  const add = (id: string, use: ImageUse) => { if (known.has(id)) { const current = uses.get(id) || new Set<ImageUse>(); current.add(use); uses.set(id, current); } };
  for (const asset of assets) {
    if (asset.tags.some(tag => /^generated$/i.test(tag))) add(asset.id, 'Generated');
    if (asset.packId || asset.originIdentityId || asset.tags.some(tag => /^(avatar|person|robot|animal|fantasy|object|symbol)$/i.test(tag))) add(asset.id, 'Avatars');
    if (asset.tags.some(tag => /^journal$/i.test(tag))) add(asset.id, 'Journals');
  }
  const [surfaces, styles, journal, manifest] = await Promise.all([store.surfaceArtwork(), store.journalStyleSettings(), store.journalIndex(), store.manifest()]);
  for (const [key, entry] of Object.entries(surfaces.items)) add(entry.assetId, surfaceUse(key));
  for (const identity of manifest.identities) if (identity.avatarAssetId) add(identity.avatarAssetId, 'Avatars');
  if (manifest.userProfile?.avatarAssetId) add(manifest.userProfile.avatarAssetId, 'Avatars');
  for (const id of Object.values(styles.iconAssetIds)) if (id) add(id, 'Journals');
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(8, journal.dates.length) }, async () => {
    while (next < journal.dates.length && !signal?.aborted) {
      const date = journal.dates[next++];
      const rendering = await store.journalRenderings(date);
      if (rendering.artworkAssetId) add(rendering.artworkAssetId, 'Journals');
      done++;
      if (done % 25 === 0 || done === journal.dates.length) onProgress?.(done, journal.dates.length);
    }
  });
  await Promise.all(workers);
  if (signal?.aborted) throw new DOMException('Image use scan stopped.', 'AbortError');
  for (const asset of assets) if (!uses.has(asset.id)) add(asset.id, 'Other');
  return uses;
}
