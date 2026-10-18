export type ProjectProfileDraft = { projectId: string; profileId: string; profileLabel: string };

/** Only a completed, bounded proposal becomes a review action in chat. */
export function projectProfileDraftFromToolEvent(event: string): ProjectProfileDraft | null {
  if (!event.startsWith('project_profile_draft: ')) return null;
  try {
    const value = JSON.parse(event.slice('project_profile_draft: '.length)) as { draft?: Partial<ProjectProfileDraft>; reviewRequired?: boolean; saved?: boolean };
    const draft = value.draft;
    if (value.reviewRequired !== true || value.saved !== false || !draft
      || typeof draft.projectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(draft.projectId)
      || typeof draft.profileId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(draft.profileId)
      || typeof draft.profileLabel !== 'string' || !draft.profileLabel.trim() || draft.profileLabel.length > 100) return null;
    return { projectId: draft.projectId, profileId: draft.profileId, profileLabel: draft.profileLabel };
  } catch { return null; }
}
