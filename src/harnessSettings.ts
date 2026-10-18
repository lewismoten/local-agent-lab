import type { AIConfig } from './ai.ts';
import type { ImageConfig } from './imageGeneration.ts';

export type WorkspaceSettings = {
  version: 1;
  profiles: AIConfig[];
  selectedProfileId: string;
  imageConfig: ImageConfig;
  compactionAt: number;
};

export const DEFAULT_COMPACTION_AT = 86;
export function cleanCompactionAt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 60 && value <= 95 ? value : DEFAULT_COMPACTION_AT;
}

/** Legacy browser preferences belong to browser storage, never to a newly attached drive. */
export function shouldMigrateLegacySettings(workspaceId: string, alreadyMigrated: boolean, hasLegacyProfiles: boolean): boolean {
  return workspaceId === 'browser-home' && !alreadyMigrated && hasLegacyProfiles;
}

export function cleanWorkspaceSettings(value: unknown): WorkspaceSettings | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Partial<WorkspaceSettings>;
  if (saved.version !== 1 || !Array.isArray(saved.profiles)) return null;
  const profiles = saved.profiles.filter((item): item is AIConfig =>
    !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.provider === 'string' && typeof item.label === 'string' && typeof item.model === 'string')
    .map(item => ({ ...item, apiKey: '' }));
  const selectedProfileId = profiles.some(item => item.id === saved.selectedProfileId) ? saved.selectedProfileId! : profiles[0]?.id || 'browser';
  const image = saved.imageConfig;
  const imageConfig = image && typeof image === 'object' && typeof image.preset === 'string'
    ? { ...image, apiKey: '' }
    : { preset: 'none', provider: 'compatible', endpoint: '', model: '', apiKey: '' } as ImageConfig;
  return { version: 1, profiles, selectedProfileId, imageConfig, compactionAt: cleanCompactionAt(saved.compactionAt) };
}

export function workspaceSettings(profiles: AIConfig[], selectedProfileId: string, imageConfig: ImageConfig, compactionAt = DEFAULT_COMPACTION_AT): WorkspaceSettings {
  return {
    version: 1,
    profiles: profiles.map(profile => ({ ...profile, apiKey: '' })),
    selectedProfileId,
    imageConfig: { ...imageConfig, apiKey: '' },
    compactionAt: cleanCompactionAt(compactionAt),
  };
}
