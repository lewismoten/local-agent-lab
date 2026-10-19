import { cleanTags, isoNow, newId } from './harnessData.ts';
import { validGeneratedImagePath, validLibraryImagePath, type LibraryImageMimeType } from './harnessGeneratedImageIndex.ts';

export type AvatarAsset = {
  id: string;
  title: string;
  tags: string[];
  source: 'generated' | 'uploaded';
  createdAt: string;
  prompt?: string;
  originIdentityId?: string;
  packId?: string;
  packName?: string;
  favorite?: boolean;
  collections?: string[];
  path?: string;
  fileBytes?: number;
  mimeType?: LibraryImageMimeType;
  relatedPaths?: string[];
};

export type AvatarAssetInput = Pick<AvatarAsset, 'title' | 'tags' | 'source'> & Partial<Pick<AvatarAsset, 'prompt' | 'originIdentityId' | 'packId' | 'packName'>>;

export function cleanImageCollections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().replace(/\s+/g, ' ')).filter(item => item.length > 0 && item.length <= 50 && !/[<>]/.test(item));
  return [...new Map(names.map(name => [name.toLocaleLowerCase(), name])).values()].slice(0, 12);
}

export function createAvatarAsset(input: AvatarAssetInput): AvatarAsset {
  const title = input.title.trim().slice(0, 80) || 'Untitled avatar';
  return {
    id: newId(), title, tags: cleanTags(input.tags, 12), source: input.source, createdAt: isoNow(),
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim().slice(0, 1200) } : {}),
    ...(input.originIdentityId ? { originIdentityId: input.originIdentityId } : {}),
    ...(input.packId && /^[a-zA-Z0-9-]{1,80}$/.test(input.packId) && input.packName?.trim()
      ? { packId: input.packId, packName: input.packName.trim().slice(0, 80) } : {}),
  };
}

export function avatarAssetMatches(asset: AvatarAsset, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${asset.title} ${asset.tags.join(' ')} ${asset.prompt || ''} ${asset.source} ${asset.packName || ''} ${(asset.collections || []).join(' ')}`.toLocaleLowerCase();
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
      && (item.packId === undefined || (typeof item.packId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.packId)))
      && (item.packName === undefined || (typeof item.packName === 'string' && item.packName.length <= 80))
      && (item.favorite === undefined || typeof item.favorite === 'boolean')
      && (item.collections === undefined || (Array.isArray(item.collections) && item.collections.length <= 12
        && item.collections.every(name => typeof name === 'string' && name.length > 0 && name.length <= 50)))
      && (item.path === undefined || (item.source === 'generated' && typeof item.path === 'string' && validLibraryImagePath(item.path)))
      && (item.fileBytes === undefined || (Number.isSafeInteger(item.fileBytes) && item.fileBytes > 0))
      && (item.mimeType === undefined || ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'].includes(item.mimeType))
      && (item.relatedPaths === undefined || (Array.isArray(item.relatedPaths) && item.relatedPaths.length <= 256
        && item.relatedPaths.every(path => typeof path === 'string' && validGeneratedImagePath(path))))
      && (item.source === 'generated' || item.source === 'uploaded') && typeof item.createdAt === 'string';
  });
}
