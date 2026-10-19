import { BROWSER_IMAGE_GROUPS } from './browserImageAssets.ts';
import { MODEL_CATALOG } from './catalogModels.ts';
import { ACHIEVEMENTS } from './harnessAchievements.ts';
import { achievementArtworkKey, type AchievementSet } from './harnessAchievementSets.ts';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import type { HarnessIdentity } from './harnessData.ts';
import {
  modelFamilyArtworkEntry,
  modelFamilyArtworkKey,
  type SurfaceArtworkMap,
} from './harnessSurfaceArtwork.ts';
import { MOTION_MODEL_IDS } from './motionAssets.ts';
import { NEEDLE_CATALOG } from './needleCatalog.ts';
import { SPEECH_MODELS } from './speechManifest.ts';
import { TRANSCRIPTION_MODELS } from './transcriptionManifest.ts';

export type IconStudioKind = 'models' | 'achievements' | 'identities';
export type IconStudioScope = 'missing' | 'all' | 'preserve-uploads';
export type IconStudioTarget = {
  kind: IconStudioKind;
  id: string;
  label: string;
  basePrompt: string;
  currentAssetId?: string;
  legacyKeys?: string[];
  identity?: HarnessIdentity;
};

export const imageIconFamily = (group: string) =>
  group === 'model'
    ? 'Stable Diffusion'
    : group === 'sdxs'
      ? 'SDXS'
      : group === 'lcm'
        ? 'DreamShaper'
        : group === 'supra-mobile'
          ? 'Supra-IMG'
          : 'Tiny-SD';
export const speechIconFamily = (engine?: string) =>
  engine === 'kokoro'
    ? 'Kokoro'
    : engine === 'chatterbox'
      ? 'Chatterbox'
      : engine === 'qwen'
        ? 'Qwen3-TTS'
        : engine === 'openvoice'
          ? 'OpenVoice'
          : 'Pocket TTS';
export const motionIconFamily = (id: string) =>
  id === 'depth'
    ? 'Depth Anything'
    : id === 'rife'
      ? 'RIFE'
      : id === 'pose'
        ? 'Pose Landmarker'
        : id === 'vector'
          ? 'VTracer'
          : 'TripoSR';

export function modelIconStudioTargets(artwork: SurfaceArtworkMap): IconStudioTarget[] {
  const rows = [
    ...MODEL_CATALOG.map((model) => ({ kind: 'gguf', id: model.id, family: model.family })),
    ...NEEDLE_CATALOG.map((model) => ({ kind: 'needle', id: model.id, family: model.family })),
    ...BROWSER_IMAGE_GROUPS.map((group) => ({
      kind: 'image',
      id: `${group}-image`,
      family: imageIconFamily(group),
    })),
    ...SPEECH_MODELS.map((model) => ({
      kind: 'speech',
      id: `${model.id}-speech`,
      family: speechIconFamily(model.engine),
    })),
    ...TRANSCRIPTION_MODELS.map((model) => ({ kind: 'transcription', id: model.id, family: model.family })),
    ...MOTION_MODEL_IDS.map((id) => ({ kind: 'motion', id: `${id}-motion`, family: motionIconFamily(id) })),
  ];
  const families = new Map<string, { family: string; legacyKeys: string[] }>();
  for (const row of rows) {
    const key = modelFamilyArtworkKey(row.kind, row.family);
    const family = families.get(key) || { family: row.family, legacyKeys: [] };
    family.legacyKeys.push(`model:${row.kind}:${row.id}`);
    families.set(key, family);
  }
  return [...families].map(([key, family]) => ({
    kind: 'models',
    id: key,
    label: family.family,
    legacyKeys: family.legacyKeys,
    currentAssetId: modelFamilyArtworkEntry(artwork, key, family.legacyKeys)?.assetId,
    basePrompt: `An original symbol representing the ${family.family} model family.`,
  }));
}

export function iconStudioTargets(
  artwork: SurfaceArtworkMap,
  identities: HarnessIdentity[],
  achievementSet: AchievementSet | null = null,
): IconStudioTarget[] {
  return [
    ...modelIconStudioTargets(artwork),
    ...ACHIEVEMENTS.map((achievement) => ({
      kind: 'achievements' as const,
      id: achievementArtworkKey(achievementSet?.id, achievement.id),
      label: achievementSet?.entries[achievement.id]?.title || achievement.title,
      basePrompt:
        achievementSet?.entries[achievement.id]?.imagePrompt ||
        `An icon representing the milestone ${achievement.title}: ${achievement.description}`,
      currentAssetId: artwork.items[achievementArtworkKey(achievementSet?.id, achievement.id)]?.assetId,
    })),
    ...identities.map((identity) => ({
      kind: 'identities' as const,
      id: identity.id,
      label: identity.name,
      basePrompt: `An icon representing ${identity.name}, a ${identity.focus} assistant. ${identity.instructions.slice(0, 450)}`,
      currentAssetId: identity.avatarAssetId,
      identity,
    })),
  ];
}

export function plannedIconStudioTargets(
  targets: IconStudioTarget[],
  kinds: IconStudioKind[],
  scope: IconStudioScope,
  assets: AvatarAsset[],
): IconStudioTarget[] {
  const assetSources = new Map(assets.map((asset) => [asset.id, asset.source]));
  return targets.filter((target) => {
    if (!kinds.includes(target.kind)) return false;
    if (scope === 'all') return true;
    if (scope === 'missing') return !target.currentAssetId && !target.identity?.avatarPath;
    if (target.currentAssetId) return assetSources.get(target.currentAssetId) !== 'uploaded';
    return !target.identity?.avatarPath;
  });
}

export function iconStudioPrompt(target: IconStudioTarget, style: string, globalPrompt: string): string {
  return [target.basePrompt.trim(), style.trim() && `Style: ${style.trim()}.`, globalPrompt.trim()]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1200);
}
