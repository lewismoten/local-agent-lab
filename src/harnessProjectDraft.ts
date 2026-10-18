export type ProjectDraft = { name: string; description: string; instructions: string; sourceProjectId: string };

/** Tool text is data. Only a bounded, complete proposal may open the editor. */
export function projectDraftFromToolEvent(event: string): ProjectDraft | null {
  if (!event.startsWith('project_draft: ')) return null;
  try {
    const value = JSON.parse(event.slice('project_draft: '.length)) as { draft?: Partial<ProjectDraft>; reviewRequired?: boolean; saved?: boolean };
    const draft = value.draft;
    if (value.reviewRequired !== true || value.saved !== false || !draft
      || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 80
      || typeof draft.description !== 'string' || !draft.description.trim() || draft.description.length > 500
      || typeof draft.instructions !== 'string' || draft.instructions.length > 2000
      || typeof draft.sourceProjectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(draft.sourceProjectId)) return null;
    return { name: draft.name, description: draft.description, instructions: draft.instructions, sourceProjectId: draft.sourceProjectId };
  } catch { return null; }
}
