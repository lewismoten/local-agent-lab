import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { ConversationMeta, HarnessMessage } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { searchableMessageText } from './harnessCompaction.ts';

const PAGE_SIZE = 12;

function excerpt(message: HarnessMessage, query: string): string {
  const content = searchableMessageText(message);
  const at = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const from = Math.max(0, at - 90);
  const end = Math.min(content.length, Math.max(at, 0) + query.length + 170);
  return `${from ? '…' : ''}${content.slice(from, end).replace(/\s+/g, ' ')}${end < content.length ? '…' : ''}`;
}

export default function HarnessConversationSearch({ store, meta, onOpen }: {
  store: HarnessStore;
  meta: ConversationMeta;
  onOpen: (seq: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const run = useRef(0);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<HarnessMessage[]>([]);
  const [before, setBefore] = useState(meta.messageCount);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stop = () => { run.current++; active.current?.abort(); active.current = null; setBusy(false); };
  useEffect(() => () => { run.current++; active.current?.abort(); }, [store, meta.id]);
  const open = () => { stop(); setQuery(''); setSearched(''); setResults([]); setBefore(meta.messageCount); setMore(false); setError(''); dialog.current?.showModal(); input.current?.focus(); };
  const close = () => { stop(); dialog.current?.close(); };
  const changeQuery = (value: string) => { stop(); setQuery(value); setSearched(''); setResults([]); setMore(false); setError(''); };
  async function search(older = false) {
    const term = (older ? searched : query).trim();
    if (term.length < 2 || term.length > 200) { setError('Use 2 to 200 characters.'); return; }
    stop();
    const request = ++run.current;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError('');
    if (!older) { setResults([]); setSearched(term); setBefore(meta.messageCount); setMore(false); }
    try {
      const found = await store.searchMessages(meta, term, PAGE_SIZE, older ? before : meta.messageCount, 0, controller.signal);
      if (request !== run.current || !dialog.current?.open) return;
      setResults(current => older ? [...current, ...found] : found);
      setBefore(found.at(-1)?.seq ?? 0);
      setMore(found.length === PAGE_SIZE && (found.at(-1)?.seq ?? 0) > 0);
    } catch (cause) {
      if (request === run.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === run.current) { active.current = null; setBusy(false); }
    }
  }
  return <>
    <button className="harness-chapter-trigger" onClick={open} aria-label="Search this conversation"><Search size={14}/> Search history</button>
    <dialog ref={dialog} className="harness-dialog harness-history-search-dialog" aria-label="Search conversation messages" onCancel={stop}>
      <div className="harness-chapter-dialog-head"><div><span className="harness-overline">CONVERSATION HISTORY</span><h2>Search messages</h2></div><button className="harness-icon" onClick={close} aria-label="Close message search"><X size={17}/></button></div>
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="harness-history-search-form"><label className="harness-chapter-search"><Search size={16}/><input ref={input} value={query} onChange={event => changeQuery(event.target.value)} placeholder="Find a phrase in this conversation…" aria-label="Message search phrase"/></label><button className="harness-primary" disabled={busy || query.trim().length < 2}>Search</button></form>
      {error && <p className="harness-git-error" role="alert">{error}</p>}
      <div className="harness-history-search-results" aria-live="polite">{results.map(message => <button key={message.id} onClick={() => { close(); onOpen(message.seq); }}><span><strong>Message #{message.seq + 1} · {message.role}</strong><time>{new Date(message.createdAt).toLocaleString()}</time></span><p>{excerpt(message, searched)}</p></button>)}{!busy && searched && !results.length && !error && <p className="harness-muted">No messages matched.</p>}</div>
      <div className="harness-chapter-dialog-actions"><span>{busy ? 'Searching…' : searched ? `${results.length} match${results.length === 1 ? '' : 'es'} shown` : 'Search the complete conversation.'}</span>{more && <button className="harness-secondary" disabled={busy} onClick={() => void search(true)}>Older matches</button>}</div>
    </dialog>
  </>;
}
