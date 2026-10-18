import type { MemoryScope } from './harnessData.ts';

export type MemoryDraft = { title: string; content: string; scope: MemoryScope; tags: string; category?: string };

/** Only a completed tool event may populate the person's editable memory form. */
export function memoryDraftFromToolEvent(event: string): MemoryDraft | null {
  if (!event.startsWith('memory_draft: ')) return null;
  try {
    const value = JSON.parse(event.slice('memory_draft: '.length)) as { draft?: Partial<MemoryDraft>; reviewRequired?: boolean };
    const draft = value.draft;
    if (value.reviewRequired !== true || !draft || typeof draft.title !== 'string' || typeof draft.content !== 'string'
      || !draft.title.trim() || draft.title.length > 100 || !draft.content.trim() || draft.content.length > 2000
      || !['global', 'project', 'session'].includes(String(draft.scope)) || typeof draft.tags !== 'string'
      || draft.category !== undefined && (typeof draft.category !== 'string' || draft.category.length > 40)) return null;
    return { title: draft.title, content: draft.content, scope: draft.scope as MemoryScope, tags: draft.tags,
      ...(draft.category ? { category: draft.category } : {}) };
  } catch { return null; }
}
