import { cleanTags, isoNow, newId } from './harnessData.ts';

export type AvatarAsset = {
  id: string;
  title: string;
  tags: string[];
  source: 'generated' | 'uploaded';
  createdAt: string;
  prompt?: string;
  originIdentityId?: string;
};

export type AvatarAssetInput = Pick<AvatarAsset, 'title' | 'tags' | 'source'> & Partial<Pick<AvatarAsset, 'prompt' | 'originIdentityId'>>;

export function createAvatarAsset(input: AvatarAssetInput): AvatarAsset {
  const title = input.title.trim().slice(0, 80) || 'Untitled avatar';
  return {
    id: newId(), title, tags: cleanTags(input.tags, 12), source: input.source, createdAt: isoNow(),
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim().slice(0, 1200) } : {}),
    ...(input.originIdentityId ? { originIdentityId: input.originIdentityId } : {}),
  };
}

export function avatarAssetMatches(asset: AvatarAsset, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${asset.title} ${asset.tags.join(' ')} ${asset.prompt || ''} ${asset.source}`.toLocaleLowerCase();
  return terms.every(term => haystack.includes(term));
}

export function validAvatarLibrary(value: unknown): value is { version: 1; assets: AvatarAsset[] } {
  if (!value || typeof value !== 'object') return false;
  const record = value as { version?: unknown; assets?: unknown };
  return record.version === 1 && Array.isArray(record.assets) && record.assets.every((asset: unknown) => {
    if (!asset || typeof asset !== 'object') return false;
    const item = asset as Partial<AvatarAsset>;
    return typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id)
      && typeof item.title === 'string' && Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string')
      && (item.source === 'generated' || item.source === 'uploaded') && typeof item.createdAt === 'string';
  });
}
