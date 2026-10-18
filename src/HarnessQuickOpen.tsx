import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { ConversationMeta, HarnessProject } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';

const MAX_RESULTS = 10;

export default function HarnessQuickOpen({ store, projects, onOpen }: {
  store: HarnessStore;
  projects: HarnessProject[];
  onOpen: (session: ConversationMeta) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects]);
  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return sessions.filter(session => {
      const haystack = `${session.title} ${(session.tags || []).join(' ')} ${session.preview || ''} ${projectNames.get(session.projectId) || ''}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_RESULTS);
  }, [sessions, projectNames, query]);

  const open = () => {
    if (dialog.current?.open || document.querySelector('dialog[open]')) return;
    const current = ++request.current;
    setQuery(''); setSelected(0); setVisible(true); setLoading(true); setError(''); setSessions([]);
    dialog.current?.showModal();
    input.current?.focus();
    void Promise.allSettled(projects.map(project => store.sessions(project.id))).then(groups => {
      if (request.current !== current || !dialog.current?.open) return;
      setSessions(groups.flatMap(group => group.status === 'fulfilled' ? group.value : []));
      const failures = groups.filter(group => group.status === 'rejected');
      if (failures.length) setError(`${failures.length} project${failures.length === 1 ? '' : 's'} could not be read.`);
    }).finally(() => { if (request.current === current) setLoading(false); });
  };
  const close = () => { request.current++; dialog.current?.close(); setVisible(false); setLoading(false); };
  const choose = (session: ConversationMeta) => { close(); onOpen(session); };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k' && (!document.querySelector('dialog[open]') || dialog.current?.open)) {
        event.preventDefault();
        if (dialog.current?.open) input.current?.focus(); else open();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  });

  return <>
    <button type="button" className="harness-quick-trigger" onClick={open} title="Quick open · ⌘K or Ctrl+K" aria-label="Quick open conversations"><Search size={15}/><span>Quick open</span><kbd>⌘K</kbd></button>
    <dialog ref={dialog} className="harness-dialog harness-quick-dialog" aria-label="Quick open conversations" onClose={() => setVisible(false)}>
      <div className="harness-quick-head"><strong>Quick open</strong><button type="button" className="harness-icon" onClick={close} aria-label="Close quick open"><X size={16}/></button></div>
      <div className="harness-quick-search"><Search size={17}/><input ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => Math.min(Math.max(0, results.length - 1), value + 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
        if (event.key === 'Enter' && results[selected]) { event.preventDefault(); choose(results[selected]); }
      }} placeholder="Find a conversation or project…" aria-label="Find a conversation or project"/></div>
      <div className="harness-quick-results" aria-label="Conversations" aria-busy={loading}>
        {results.map((session, index) => <button type="button" key={session.id} className={index === selected ? 'selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => choose(session)}><span><strong>{session.pinned ? '◆ ' : ''}{session.title}</strong><small>{projectNames.get(session.projectId) || 'Project'} · {new Date(session.updatedAt).toLocaleDateString()}</small></span><span className="harness-quick-tags">{(session.tags || []).slice(0, 2).join(' · ')}</span></button>)}
        {visible && loading && <p role="status">Loading conversations…</p>}
        {visible && error && <p role="alert">Could not load conversations: {error}</p>}
        {visible && !loading && !error && !results.length && <p>{query.trim() ? 'No conversations matched.' : 'No conversations yet.'}</p>}
      </div>
      <small className="harness-quick-hint">↑↓ Select · Enter Open · Esc Close</small>
    </dialog>
  </>;
}
