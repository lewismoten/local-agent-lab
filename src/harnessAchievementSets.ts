import { ACHIEVEMENTS, type Achievement } from './harnessAchievements.ts';

export type AchievementCopy = { title: string; description: string; imagePrompt: string };
export type AchievementSet = {
  version: 1;
  id: string;
  name: string;
  direction: string;
  createdAt: string;
  entries: Record<string, AchievementCopy>;
};
export type AchievementSetLibrary = { version: 1; activeId: string | null; sets: AchievementSet[] };
export const emptyAchievementSetLibrary = (): AchievementSetLibrary => ({
  version: 1,
  activeId: null,
  sets: [],
});
const ids = new Set(ACHIEVEMENTS.map((item) => item.id));
export const achievementArtworkKey = (setId: string | null | undefined, achievementId: string): string =>
  setId ? `achievement-set:${setId}:${achievementId}` : `achievement:${achievementId}`;
const validText = (value: unknown, max: number) =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function defaultAchievementEntries(): Record<string, AchievementCopy> {
  return Object.fromEntries(
    ACHIEVEMENTS.map((achievement) => [
      achievement.id,
      {
        title: achievement.title,
        description: achievement.description,
        imagePrompt: `Original symbolic icon for ${achievement.title}: ${achievement.description}`,
      },
    ]),
  );
}

export function validAchievementSet(value: unknown): value is AchievementSet {
  if (!value || typeof value !== 'object') return false;
  const set = value as Partial<AchievementSet>;
  if (
    set.version !== 1 ||
    !validId(set.id) ||
    !validText(set.name, 80) ||
    !validText(set.direction, 600) ||
    !validDate(set.createdAt) ||
    !set.entries ||
    typeof set.entries !== 'object' ||
    Array.isArray(set.entries)
  )
    return false;
  const entries = Object.entries(set.entries);
  return (
    entries.length === ids.size &&
    entries.every(
      ([id, entry]) =>
        ids.has(id) &&
        !!entry &&
        validText(entry.title, 80) &&
        validText(entry.description, 280) &&
        validText(entry.imagePrompt, 600),
    )
  );
}

export function validAchievementSetLibrary(value: unknown): value is AchievementSetLibrary {
  if (!value || typeof value !== 'object') return false;
  const library = value as Partial<AchievementSetLibrary>;
  if (
    library.version !== 1 ||
    !Array.isArray(library.sets) ||
    library.sets.length > 24 ||
    !library.sets.every(validAchievementSet)
  )
    return false;
  const idsInLibrary = new Set(library.sets.map((set) => set.id));
  return (
    idsInLibrary.size === library.sets.length &&
    (library.activeId === null ||
      (typeof library.activeId === 'string' && idsInLibrary.has(library.activeId)))
  );
}

export function activeAchievementSet(library: AchievementSetLibrary): AchievementSet | null {
  return library.sets.find((set) => set.id === library.activeId) || null;
}

export function achievementWithCopy(achievement: Achievement, set: AchievementSet | null): Achievement {
  const copy = set?.entries[achievement.id];
  return copy ? { ...achievement, title: copy.title, description: copy.description } : achievement;
}

export function createAchievementSet(
  name: string,
  direction: string,
  entries = defaultAchievementEntries(),
): AchievementSet {
  const set: AchievementSet = {
    version: 1,
    id: crypto.randomUUID(),
    name: name.trim(),
    direction: direction.trim(),
    createdAt: new Date().toISOString(),
    entries,
  };
  if (!validAchievementSet(set))
    throw new Error('Achievement set needs valid copy and image prompts for every achievement.');
  return set;
}
