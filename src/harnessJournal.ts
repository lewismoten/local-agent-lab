import type { ConversationMeta, HarnessMessage } from './harnessData.ts';

export type JournalIndex = { version: 1; enabled: boolean; timeZone: string; dates: string[]; redirects?: Record<string, { projectId: string; sessionId: string }> };
export type JournalFact = {
  id: string;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  agentId?: string;
  seq: number;
  at: string;
  role: HarnessMessage['role'];
  excerpt: string;
  toolActions: string[];
};
export type JournalDay = { version: 1; date: string; updatedAt: string; facts: JournalFact[] };
export type JournalTopic = {
  projectId: string;
  sessionId: string;
  projectName: string;
  sessionTitle: string;
  agentId?: string;
  firstSeq: number;
  lastSeq: number;
  chapterSeq?: number;
  messages: number;
  prose: string;
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const validId = (value: string) => /^[a-zA-Z0-9-]{1,80}$/.test(value);
const compact = (value: string, limit: number) => value.replace(/\s+/g, ' ').trim().slice(0, limit);

export function journalDate(at: string, timeZone: string): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid journal timestamp.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function journalFact(meta: ConversationMeta, message: HarnessMessage): JournalFact {
  return {
    id: message.id, projectId: meta.projectId, sessionId: meta.id, sessionTitle: compact(meta.title || 'Conversation', 100),
    ...(meta.agentId ? { agentId: meta.agentId } : {}), seq: message.seq, at: message.createdAt, role: message.role,
    excerpt: compact(message.content, 240),
    toolActions: (message.toolEvents || []).filter(event => /^(?:write_file|replace_in_file|replace_many_in_file|apply_patch|move_file|delete_file|restore_backup|generate_image|git_commit|git_create_branch|claim_task|add_task_note|set_task_status):/.test(event))
      .slice(0, 5).map(event => compact(event, 120)),
  };
}

export function validJournalIndex(value: unknown): value is JournalIndex {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<JournalIndex>;
  if (item.version !== 1 || typeof item.enabled !== 'boolean' || typeof item.timeZone !== 'string' || !Array.isArray(item.dates)
    || item.dates.length > 20_000 || !item.dates.every(date => typeof date === 'string' && validDate(date))) return false;
  if (item.redirects !== undefined && (typeof item.redirects !== 'object' || item.redirects === null || Array.isArray(item.redirects)
    || Object.entries(item.redirects).length > 20_000 || Object.entries(item.redirects).some(([key, target]) => {
      const [projectId, sessionId, extra] = key.split(':');
      return !!extra || !validId(projectId) || !validId(sessionId) || !target || !validId(target.projectId) || !validId(target.sessionId);
    }))) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: item.timeZone }); return true; }
  catch { return false; }
}

/** Follow move records without changing the historical journal facts. */
export function journalTarget(index: JournalIndex, projectId: string, sessionId: string): { projectId: string; sessionId: string } {
  let current = { projectId, sessionId };
  const visited = new Set<string>();
  for (let step = 0; step < 20; step++) {
    const key = `${current.projectId}:${current.sessionId}`;
    if (visited.has(key)) break;
    visited.add(key);
    const next = index.redirects?.[key];
    if (!next) break;
    current = next;
  }
  return current;
}

export function validJournalDay(value: unknown): value is JournalDay {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<JournalDay>;
  return item.version === 1 && typeof item.date === 'string' && validDate(item.date)
    && typeof item.updatedAt === 'string' && Array.isArray(item.facts) && item.facts.length <= 20_000
    && item.facts.every(fact => fact && validId(fact.id) && validId(fact.projectId) && validId(fact.sessionId)
      && typeof fact.sessionTitle === 'string' && fact.sessionTitle.length <= 100
      && Number.isSafeInteger(fact.seq) && fact.seq >= 0 && typeof fact.at === 'string'
      && ['user', 'assistant', 'tool'].includes(fact.role) && typeof fact.excerpt === 'string' && fact.excerpt.length <= 240
      && Array.isArray(fact.toolActions) && fact.toolActions.length <= 5 && fact.toolActions.every((action: string) => typeof action === 'string' && action.length <= 120));
}

/** Source-linked prose derived from the journal facts and current chapter metadata. */
export function journalTopics(day: JournalDay, projects: Record<string, string>, sessions: ConversationMeta[], agents: Record<string, string> = {}, timeZone = 'UTC'): JournalTopic[] {
  const bySession = new Map<string, JournalFact[]>();
  for (const fact of day.facts) {
    const key = `${fact.projectId}:${fact.sessionId}`;
    bySession.set(key, [...(bySession.get(key) || []), fact]);
  }
  const metadata = new Map(sessions.map(session => [`${session.projectId}:${session.id}`, session]));
  return [...bySession.entries()].map(([key, facts]) => {
    const ordered = facts.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
    const first = ordered[0], latest = ordered.at(-1)!;
    const meta = metadata.get(key);
    const projectName = projects[first.projectId] || first.projectId;
    const sessionTitle = meta?.title || latest.sessionTitle || 'Conversation';
    const chapters = (meta?.segments || []).filter(segment => journalDate(segment.startAt, timeZone) <= day.date && journalDate(segment.endAt, timeZone) >= day.date);
    const chapter = chapters.at(-1);
    const user = ordered.find(fact => fact.role === 'user' && fact.excerpt);
    const response = [...ordered].reverse().find(fact => fact.role === 'assistant' && fact.excerpt);
    const changed = [...new Set(ordered.flatMap(fact => fact.toolActions.map(action => action.split(':')[0])))];
    const agentName = first.agentId ? agents[first.agentId] || 'An agent' : '';
    const lead = agentName ? `${agentName} worked on ${sessionTitle}.` : `You worked on ${sessionTitle}.`;
    const details = chapter?.summary ? compact(chapter.summary, 450)
      : user ? `The discussion included “${compact(user.excerpt, 130)}${user.excerpt.length > 130 ? '…' : ''}”${response ? ` and reached “${compact(response.excerpt, 150)}${response.excerpt.length > 150 ? '…' : ''}”` : ''}.`
        : response ? `The latest saved result was “${compact(response.excerpt, 180)}${response.excerpt.length > 180 ? '…' : ''}”.` : 'Activity was recorded in this conversation.';
    const actions = changed.length ? ` Saved actions included ${changed.slice(0, 3).map(name => name.replaceAll('_', ' ')).join(', ')}.` : '';
    return { projectId: first.projectId, sessionId: first.sessionId, projectName, sessionTitle, agentId: first.agentId,
      firstSeq: first.seq, lastSeq: latest.seq, ...(chapter ? { chapterSeq: chapter.startSeq } : {}), messages: ordered.length, prose: `${lead} ${details}${actions}` };
  }).sort((a, b) => b.messages - a.messages || a.projectName.localeCompare(b.projectName));
}
