export type ProjectInstructionDraft = { projectId: string; instructions: string; expectedUpdatedAt: string };

/** Tool output is untrusted; only a bounded, complete draft can open Project settings. */
export function projectInstructionDraftFromToolEvent(event: string): ProjectInstructionDraft | null {
  if (!event.startsWith('project_instruction_draft: ')) return null;
  try {
    const value = JSON.parse(event.slice('project_instruction_draft: '.length)) as { draft?: Partial<ProjectInstructionDraft>; reviewRequired?: boolean; saved?: boolean };
    const draft = value.draft;
    if (value.reviewRequired !== true || value.saved !== false || !draft
      || typeof draft.projectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(draft.projectId)
      || typeof draft.instructions !== 'string' || draft.instructions.length > 2000
      || typeof draft.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(draft.expectedUpdatedAt))) return null;
    return { projectId: draft.projectId, instructions: draft.instructions, expectedUpdatedAt: draft.expectedUpdatedAt };
  } catch { return null; }
}
