export type AgentDraft = { name: string; task: string; identity: string; projectId: string };

/** Only a completed, bounded tool event may open the human-reviewed agent form. */
export function agentDraftFromToolEvent(event: string): AgentDraft | null {
  if (!event.startsWith('agent_draft: ')) return null;
  try {
    const value = JSON.parse(event.slice('agent_draft: '.length)) as { draft?: Partial<AgentDraft>; reviewRequired?: boolean };
    const draft = value.draft;
    if (value.reviewRequired !== true || !draft || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 80
      || typeof draft.task !== 'string' || !draft.task.trim() || draft.task.length > 2000
      || typeof draft.identity !== 'string' || draft.identity.length > 2000
      || typeof draft.projectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(draft.projectId)) return null;
    return { name: draft.name, task: draft.task, identity: draft.identity, projectId: draft.projectId };
  } catch { return null; }
}
