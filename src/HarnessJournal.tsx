import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, RefreshCw } from 'lucide-react';
import type { HarnessAgent, HarnessProject } from './harnessData.ts';
import { journalTarget, journalTopics, type JournalDay, type JournalIndex } from './harnessJournal.ts';
import type { ConversationMeta } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import './harnessJournal.css';

export default function HarnessJournal({ store, projects, agents, onOpen, onWrite }: {
  store: HarnessStore;
  projects: HarnessProject[];
  agents: HarnessAgent[];
  onOpen: (projectId: string, sessionId: string, seq: number) => void;
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
}) {
  const [index, setIndex] = useState<JournalIndex | null>(null);
  const [date, setDate] = useState('');
  const [day, setDay] = useState<JournalDay | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [limit, setLimit] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const projectNames = useMemo(() => Object.fromEntries(projects.map(project => [project.id, project.name])), [projects]);
  const agentNames = useMemo(() => Object.fromEntries(agents.map(agent => [agent.id, agent.name])), [agents]);
  const topics = useMemo(() => day ? journalTopics(day, projectNames, sessions, agentNames, index?.timeZone) : [], [day, projectNames, sessions, agentNames, index?.timeZone]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void store.journalIndex().then(current => {
        if (!active) return;
        setIndex(current);
        setDate(previous => previous && current.dates.includes(previous) ? previous : current.dates[0] || '');
      }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store]);
  useEffect(() => {
    if (!date) { setDay(null); setSessions([]); setLoadingDay(false); return; }
    let active = true;
    setDay(null);
    setSessions([]);
    setLoadingDay(true);
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const current = await store.journalDay(date);
        if (!active) return;
        const projectIds = [...new Set((current?.facts || []).map(fact => fact.projectId))];
        const linked = (await Promise.all(projectIds.map(id => store.sessions(id)))).flat();
        if (active) { setDay(current); setSessions(linked); setLoadingDay(false); }
      } catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoadingDay(false); } }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store, date]);

  async function toggle() {
    if (!index) return;
    setBusy(true); setError('');
    try { setIndex(await onWrite(() => store.setJournalEnabled(!index.enabled))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const open = (projectId: string, sessionId: string, seq: number) => {
    const target = index ? journalTarget(index, projectId, sessionId) : { projectId, sessionId };
    onOpen(target.projectId, target.sessionId, seq);
  };
  const formatted = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <section className="harness-page harness-journal-page">
    <div className="harness-heading"><div><span className="harness-overline">YOUR WORK, DAY BY DAY</span><h1>Journal</h1><p>A private record of projects, conversations, and agent work.</p></div><button className={index?.enabled ? 'harness-secondary' : 'harness-primary'} onClick={() => void toggle()} disabled={busy || !index}>{busy ? 'Saving…' : index?.enabled ? 'Pause journal' : 'Start journal'}</button></div>
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    <div className="harness-journal-explain"><BookOpen size={17}/><span>{index?.enabled ? `Recording short excerpts from new messages in ${index.timeZone}.` : 'Off by default. Turn it on to record new activity; earlier entries stay available when paused.'} Everything stays in this workspace.</span><button className="harness-icon" aria-label="Refresh journal" title="Refresh journal" onClick={() => { void store.journalIndex().then(setIndex).catch(cause => setError(String(cause))); if (date) void store.journalDay(date).then(setDay).catch(cause => setError(String(cause))); }}><RefreshCw size={15}/></button></div>
    <div className="harness-journal-layout"><aside className="harness-journal-dates" aria-label="Journal dates">{index?.dates.slice(0, limit).map(item => <button key={item} className={date === item ? 'active' : ''} onClick={() => setDate(item)}><time dateTime={item}>{formatted(item)}</time><ChevronRight size={14}/></button>)}{index && index.dates.length > limit && <button className="harness-secondary" onClick={() => setLimit(current => current + 15)}>Older days</button>}</aside>
      <div className="harness-journal-entries">{!index && <div className="harness-card">Opening journal…</div>}{index && !index.dates.length && <div className="harness-card harness-journal-empty"><BookOpen size={31}/><h2>No journal entries yet</h2><p>{index.enabled ? 'Your next saved conversation will start today’s entry.' : 'Start the journal when you want to keep a day-by-day record.'}</p></div>}
        {index && !!date && !day && !error && <div className="harness-card" role="status">{loadingDay ? `Opening ${formatted(date)}…` : 'This day has no saved entry.'}</div>}
        {day && <article className="harness-card harness-journal-article"><header><span className="harness-overline">DAILY ENTRY</span><h2>{formatted(day.date)}</h2><p>{day.facts.length} saved message{day.facts.length === 1 ? '' : 's'} across {topics.length} conversation{topics.length === 1 ? '' : 's'}</p></header>
          {topics.map(topic => <section key={`${topic.projectId}:${topic.sessionId}`} className="harness-journal-topic"><span>{topic.projectName}{topic.agentId ? ` · ${agentNames[topic.agentId] || 'Agent'}` : ''}</span><h3>{topic.sessionTitle}</h3><p>{topic.prose}</p><div className="harness-journal-links"><button onClick={() => open(topic.projectId, topic.sessionId, topic.firstSeq)}>Start of day’s work <ChevronRight size={13}/></button><button onClick={() => open(topic.projectId, topic.sessionId, topic.lastSeq)}>Latest message <ChevronRight size={13}/></button>{topic.chapterSeq !== undefined && <button onClick={() => open(topic.projectId, topic.sessionId, topic.chapterSeq!)}>Chapter <ChevronRight size={13}/></button>}</div></section>)}
        </article>}
      </div>
    </div>
  </section>;
}
