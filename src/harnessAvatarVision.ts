import { cleanTags } from './harnessData.ts';

export const AVATAR_VISION_TAG_PROMPT = 'Inspect only this image. Return JSON in the form {"tags":["..."]} with up to eight short, searchable visual tags. Describe visible subjects, motifs, colors, and art style. Do not use a filename or generation prompt. Do not guess identity, gender, ethnicity, health, or an exact age. Omit uncertain details. Return no prose outside the JSON.';

/** Models may wrap an otherwise valid JSON answer in Markdown or reasoning tags. */
export function parseAvatarVisionTags(answer: string): string[] {
  const visible = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(visible);
  const raw = (fenced?.[1] || visible).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let values: unknown;
  try { values = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); }
  catch { return []; }
  const tags = Array.isArray(values) ? values : values && typeof values === 'object' ? (values as { tags?: unknown }).tags : null;
  if (!Array.isArray(tags)) return [];
  return cleanTags(tags.filter(value => typeof value === 'string' && value.trim().length <= 40), 8);
}

export function mergeAvatarVisionTags(current: string, suggestions: string[]): string {
  return cleanTags([...current.split(','), ...suggestions], 12).join(', ');
}

export type AvatarTagReview = { assetId: string; title: string; suggestions: string[]; draft: string; answer: string; error?: string; selected: boolean; applied?: boolean };

/** Keep completed suggestions available when a long library scan is stopped. */
export async function scanAvatarLibraryTags<T extends { id: string; title: string }>(
  assets: T[], signal: AbortSignal, inspect: (asset: T, index: number) => Promise<{ answer: string; tags: string[] }>,
  onResult: (review: AvatarTagReview, completed: number) => void,
): Promise<number> {
  let completed = 0;
  for (const [index, asset] of assets.entries()) {
    if (signal.aborted) break;
    let review: AvatarTagReview;
    try {
      const result = await inspect(asset, index);
      if (signal.aborted) break;
      review = { assetId: asset.id, title: asset.title, suggestions: result.tags, draft: result.tags.join(', '), answer: result.answer, selected: result.tags.length > 0 };
    } catch (cause) {
      if (signal.aborted) break;
      review = { assetId: asset.id, title: asset.title, suggestions: [], draft: '', answer: '', error: cause instanceof Error ? cause.message : String(cause), selected: false };
    }
    onResult(review, ++completed);
    if (completed % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return completed;
}

/** Apply only reviewed selections, using current saved tags so another tab's edits survive. */
export async function applyAvatarTagReviews<T extends { id: string; title: string; tags: string[] }>(
  reviews: AvatarTagReview[], signal: AbortSignal,
  read: (id: string) => Promise<T | null>,
  update: (asset: T, tags: string[]) => Promise<T>,
  onApplied: (asset: T, review: AvatarTagReview, completed: number, total: number) => void,
): Promise<number> {
  const selected = reviews.filter(review => review.selected && !review.applied && cleanTags(review.draft.split(','), 8).length);
  let completed = 0;
  for (const review of selected) {
    if (signal.aborted) break;
    const current = await read(review.assetId);
    if (signal.aborted) break;
    if (!current) throw new Error(`${review.title} is no longer in the library.`);
    const suggestions = cleanTags(review.draft.split(','), 8);
    const tags = mergeAvatarVisionTags(current.tags.join(', '), suggestions).split(', ');
    const saved = await update(current, tags);
    onApplied(saved, review, ++completed, selected.length);
  }
  return completed;
}
