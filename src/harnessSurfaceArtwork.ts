export type SurfaceArtworkEntry = { assetId: string; prompt: string };
export type SurfaceArtworkMap = { version: 1; items: Record<string, SurfaceArtworkEntry> };

export const emptySurfaceArtwork = (): SurfaceArtworkMap => ({ version: 1, items: {} });
export const validSurfaceArtworkKey = (key: string) => /^[a-zA-Z0-9:._-]{1,160}$/.test(key);
export const modelFamilyArtworkKey = (kind: string, family: string): string =>
  `model-family:${kind}:${family.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model'}`;
export const modelFamilyArtworkEntry = (map: SurfaceArtworkMap, familyKey: string, oldKeys: string[]): SurfaceArtworkEntry | undefined =>
  map.items[familyKey] || oldKeys.map(key => map.items[key]).find(Boolean);

export function validSurfaceArtwork(value: unknown): value is SurfaceArtworkMap {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SurfaceArtworkMap>;
  if (data.version !== 1 || !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) return false;
  return Object.entries(data.items).every(([key, entry]) => validSurfaceArtworkKey(key)
    && !!entry && typeof entry === 'object'
    && typeof entry.assetId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(entry.assetId)
    && typeof entry.prompt === 'string' && entry.prompt.length <= 1200);
}

export function suggestedSurfaceArtworkPrompt(title: string, kind: string): string {
  return `Original square symbolic icon for ${title.slice(0, 100)}, a ${kind.slice(0, 50)}. Abstract geometric form, clear silhouette, teal and violet light on a dark background. No words, logos, or recognizable existing characters.`;
}
