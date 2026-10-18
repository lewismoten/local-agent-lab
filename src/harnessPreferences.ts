import type { AIConfig } from './ai.ts';
import { orderedPreferenceIds, type ModelPurpose, type ModelPreferences } from './harnessData.ts';
import { isModelConfirmed, isModelReady } from './modelSession.ts';
import { canRunProfile } from './harnessProfileEligibility.ts';
import { IMAGE_PRESETS, imageConfigured, type ImageConfig, type ImagePreset } from './imageGeneration.ts';

export const MODEL_PURPOSES: { id: ModelPurpose; label: string }[] = [
  { id: 'chat', label: 'Chat' }, { id: 'code', label: 'Agent coding' }, { id: 'image', label: 'Images' },
];

export function imageCandidates(primary: ImageConfig, preferenceIds: string[]): ImageConfig[] {
  const presets = orderedPreferenceIds(preferenceIds, primary.preset);
  return presets.map(id => id === primary.preset ? primary : IMAGE_PRESETS[id as ImagePreset]).filter((config): config is ImageConfig => !!config && imageConfigured(config));
}

export function readyProfiles(primaryId: string, purpose: ModelPurpose, preferences: ModelPreferences, profiles: AIConfig[], apiKeys: Record<string, string>, browserWorkspaceAvailable = false): AIConfig[] {
  const order = [primaryId, ...(preferences[purpose] || [])];
  const ready: AIConfig[] = [];
  for (const id of new Set(order)) {
    const base = profiles.find(profile => profile.id === id);
    if (!base || !base.model.trim()) continue;
    const profile = { ...base, apiKey: apiKeys[id] || '' };
    if (canRunProfile(profile, isModelReady(profile), isModelConfirmed(profile), browserWorkspaceAvailable)) ready.push(profile);
  }
  return ready;
}

export function readyProfile(primaryId: string, purpose: ModelPurpose, preferences: ModelPreferences, profiles: AIConfig[], apiKeys: Record<string, string>, browserWorkspaceAvailable = false): AIConfig | null {
  return readyProfiles(primaryId, purpose, preferences, profiles, apiKeys, browserWorkspaceAvailable)[0] || null;
}
