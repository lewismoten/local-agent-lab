import type { BrowserTools } from './browserModel.ts';
import { journalDate, journalTarget } from './harnessJournal.ts';
import { journalTopics } from './harnessJournal.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';

const dayFormat = /^\d{4}-\d{2}-\d{2}$/;
const dayBefore = (date: string, offset: number) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
};

export async function journalEnabledReview(store: Pick<HarnessStore, 'journalIndex'>, requested: unknown): Promise<Record<string, unknown>> {
  if (typeof requested !== 'boolean') throw new Error('Choose true or false for the journal setting.');
  const current = await store.journalIndex();
  return { scope: 'Entire workspace', current: current.enabled, requested, effect: requested ? 'Start recording short local facts from future chat and agent messages.' : 'Stop recording new journal facts. Existing entries remain readable.' };
}

/** Project-scoped reading, plus an optional reviewed workspace-wide recording switch. */
export function browserJournalTools(store: HarnessStore, scope: ToolScope, signal?: AbortSignal, allowChange = false): BrowserTools {
  const checkStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Journal lookup stopped.', 'AbortError'); };
  const projectFor = (value: unknown) => {
    const id = typeof value === 'string' && value ? value : scope.defaultProjectId;
    if (!scope.projects.some(project => project.id === id)) throw new Error('This project is outside the agent’s scope.');
    return id;
  };
  const dateFor = (value: unknown, fallback: string) => {
    const date = typeof value === 'string' && value ? value : fallback;
    if (!dayFormat.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new Error('Use a date in YYYY-MM-DD format.');
    return date;
  };
  return {
    definitions: [
      { type: 'function', function: { name: 'get_journal_settings', description: 'Read whether the opt-in workspace journal records new activity. Existing entries remain available when paused.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'list_journal_days', description: 'Find days with saved journal activity for an allowed project. Scans a 14-day window; pass nextBefore to continue into older days.', parameters: { type: 'object', properties: { project: { type: 'string', description: 'Allowed project ID; defaults to the current project.' }, before: { type: 'string', description: 'First date to scan, YYYY-MM-DD; defaults to today.' } } } } },
      { type: 'function', function: { name: 'read_journal_day', description: 'Read short, source-linked summaries from one day of an allowed project journal. Use list_journal_days to find dates.', parameters: { type: 'object', properties: { date: { type: 'string', description: 'Date in YYYY-MM-DD; defaults to today.' }, project: { type: 'string', description: 'Allowed project ID; defaults to the current project.' }, offset: { type: 'number', description: 'Skip this many summaries.' } } } } },
      ...(allowChange ? [{ type: 'function', function: { name: 'set_journal_enabled', description: 'Turn future workspace journal recording on or off after the person reviews the workspace-wide change. Existing entries are retained.', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } } } as BrowserTools['definitions'][number]] : []),
    ],
    execute: async (name, args) => {
      checkStopped();
      if (name === 'get_journal_settings') {
        const index = await store.journalIndex();
        checkStopped();
        return JSON.stringify({ scope: 'workspace', enabled: index.enabled, timeZone: index.timeZone, savedDays: index.dates.length });
      }
      if (name === 'set_journal_enabled' && allowChange) {
        const expected = args.__reviewedCurrent;
        if (typeof expected !== 'boolean') throw new Error('Review the current journal setting before changing it.');
        const review = await journalEnabledReview(store, args.enabled);
        if (review.current !== expected) throw new Error('Journal setting changed during review. Read it again before changing it.');
        const manifest = await store.manifest();
        const project = manifest.projects.find(item => item.id === scope.defaultProjectId);
        if (scope.workspaceReadOnly || manifest.workspaceToolAccess === 'read-only' || !project || project.toolAccess === 'read-only') throw new Error('Workspace or project model tools are read-only.');
        checkStopped();
        const next = await store.setJournalEnabled(args.enabled as boolean, expected);
        return JSON.stringify({ scope: 'workspace', status: 'saved', enabled: next.enabled, existingDaysRetained: next.dates.length });
      }
      if (name !== 'list_journal_days' && name !== 'read_journal_day') throw new Error(`Unknown journal tool: ${name}`);
      const projectId = projectFor(args.project);
      const index = await store.journalIndex();
      checkStopped();
      const today = journalDate(new Date().toISOString(), index.timeZone);
      if (name === 'list_journal_days') {
        const before = dateFor(args.before, today);
        const dates: { date: string; messages: number }[] = [];
        for (let step = 0; step < 14; step++) {
          checkStopped();
          const date = dayBefore(before, step);
          if (!index.dates.includes(date)) continue;
          const day = await store.journalDay(date);
          checkStopped();
          const count = day?.facts.filter(fact => journalTarget(index, fact.projectId, fact.sessionId).projectId === projectId).length || 0;
          if (count) dates.push({ date, messages: count });
        }
        return JSON.stringify({ project: projectId, dates, nextBefore: dayBefore(before, 14) });
      }
      const date = dateFor(args.date, today);
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new Error('Journal offset must be a nonnegative integer up to 10000.');
      const day = await store.journalDay(date);
      checkStopped();
      const facts = day?.facts.filter(fact => journalTarget(index, fact.projectId, fact.sessionId).projectId === projectId) || [];
      if (!facts.length) return JSON.stringify({ project: projectId, date, topics: [], nextOffset: null });
      const sessionIds = [...new Set(facts.map(fact => fact.projectId))];
      const sessions = (await Promise.all(sessionIds.map(id => store.sessions(id)))).flat();
      checkStopped();
      const names = Object.fromEntries(scope.projects.map(project => [project.id, project.name]));
      const topics = journalTopics({ ...day!, facts }, names, sessions, {}, index.timeZone).map(topic => {
        const target = journalTarget(index, topic.projectId, topic.sessionId);
        return { project: target.projectId, session: target.sessionId, title: topic.sessionTitle, summary: topic.prose,
          firstSeq: topic.firstSeq, lastSeq: topic.lastSeq, chapterSeq: topic.chapterSeq };
      });
      return JSON.stringify({ project: projectId, date, topics: topics.slice(offset, offset + 4), nextOffset: offset + 4 < topics.length ? offset + 4 : null });
    },
  };
}
