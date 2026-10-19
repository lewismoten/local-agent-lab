import { completeMetadata, type AIConfig } from './ai.ts';
import { withModelLease } from './harnessLease.ts';
import { ACHIEVEMENTS } from './harnessAchievements.ts';
import {
  createAchievementSet,
  defaultAchievementEntries,
  type AchievementCopy,
  type AchievementSet,
} from './harnessAchievementSets.ts';

const PRESETS = {
  witty: 'Witty and concise, with a warm sense of humor.',
  comedy: 'Comedic and playful, with short surprising titles.',
  future: 'Optimistic near-future language, clear to new users.',
  robotic: 'Playful robot voice with precise, brief wording.',
} as const;
export type AchievementTone = keyof typeof PRESETS | 'custom';
export const ACHIEVEMENT_TONES: { id: AchievementTone; label: string }[] = [
  { id: 'witty', label: 'Witty' },
  { id: 'comedy', label: 'Comedic' },
  { id: 'future', label: 'Future' },
  { id: 'robotic', label: 'Robotic' },
  { id: 'custom', label: 'Custom' },
];
export function achievementDirection(tone: AchievementTone, custom: string): string {
  return tone === 'custom' ? custom.trim() : PRESETS[tone];
}

function readRows(text: string, expected: string[]): Record<string, AchievementCopy> {
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) throw new Error('The model did not return a JSON list.');
  const parsed: unknown = JSON.parse(match[0]);
  if (!Array.isArray(parsed) || parsed.length !== expected.length)
    throw new Error('The model returned the wrong number of achievements.');
  const result: Record<string, AchievementCopy> = {};
  for (const row of parsed) {
    if (!row || typeof row !== 'object') throw new Error('An achievement entry is missing.');
    const item = row as Record<string, unknown>;
    if (typeof item.id !== 'string' || !expected.includes(item.id) || result[item.id])
      throw new Error('The model changed an achievement ID.');
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const imagePrompt = typeof item.imagePrompt === 'string' ? item.imagePrompt.trim() : '';
    if (
      !title ||
      title.length > 80 ||
      !description ||
      description.length > 280 ||
      !imagePrompt ||
      imagePrompt.length > 600
    )
      throw new Error(`The model returned incomplete copy for ${item.id}.`);
    result[item.id] = { title, description, imagePrompt };
  }
  return result;
}

export function parseAchievementRows(text: string, expected: string[]): Record<string, AchievementCopy> {
  return readRows(text, expected);
}

/** Small batches let a 1B browser model draft a whole set without losing earlier rows. */
export function generateAchievementSetDraft(
  config: AIConfig,
  name: string,
  direction: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<AchievementSet> {
  return withModelLease(
    'achievement-copy',
    async () => {
      const entries = defaultAchievementEntries();
      const chunkSize = config.maxOutputTokens >= 900 ? 3 : 2;
      let done = 0;
      onProgress?.(done, ACHIEVEMENTS.length);
      for (let start = 0; start < ACHIEVEMENTS.length; start += chunkSize) {
        if (signal.aborted) throw signal.reason || new DOMException('Stopped.', 'AbortError');
        const group = ACHIEVEMENTS.slice(start, start + chunkSize);
        const facts = group.map(({ id, title, description, metric, target }) => ({
          id,
          title,
          description,
          metric,
          target,
        }));
        const user = `Direction: ${direction.slice(0, 600)}\nRewrite these achievement titles and descriptions, and describe each icon's subject. This is a private, single-user creative workspace; do not imply a community, other users, or activity beyond the stated metric. Keep the goal and quantity accurate. Use original wording. Image prompts describe subject only; do not specify art style, color, text, typography, or logos. Return a JSON array with exactly these IDs, each with id, title, description, imagePrompt:\n${JSON.stringify(facts)}`;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await completeMetadata(
            config,
            [
              {
                role: 'user',
                content: lastError ? `${user}\nFix your previous invalid JSON: ${lastError.message}` : user,
              },
            ],
            'You write brief, accurate achievement copy for a private creative workspace. Return JSON only. Never alter milestone rules or IDs.',
            signal,
            Math.max(512, Math.min(1500, config.maxOutputTokens)),
          );
          try {
            Object.assign(
              entries,
              readRows(
                response.text,
                group.map((item) => item.id),
              ),
            );
            lastError = null;
            break;
          } catch (cause) {
            lastError = cause instanceof Error ? cause : new Error(String(cause));
          }
        }
        if (lastError) throw lastError;
        onProgress?.((done += group.length), ACHIEVEMENTS.length);
      }
      return createAchievementSet(name, direction, entries);
    },
    signal,
  );
}
