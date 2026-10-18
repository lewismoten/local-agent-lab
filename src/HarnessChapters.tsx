import { useMemo, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import type { ContextSegment } from './harnessData.ts';
import { groupChapters } from './harnessChapters.ts';

const PAGE_SIZE = 40;

export default function HarnessChapters({ segments, onOpen, onLatest }: {
  segments: ContextSegment[];
  onOpen: (seq: number) => void;
  onLatest: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const chapters = useMemo(() => groupChapters(segments), [segments]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const latestFirst = [...chapters].reverse();
    return term ? latestFirst.filter(part => part.searchText.toLocaleLowerCase().includes(term)) : latestFirst;
  }, [chapters, query]);
  const open = () => { setQuery(''); setLimit(PAGE_SIZE); dialog.current?.showModal(); };
  const choose = (seq: number) => { dialog.current?.close(); onOpen(seq); };
  return <>
    <button className="harness-chapter-trigger" onClick={open} aria-label={`Browse ${chapters.length} compacted chapters`}><BookOpen size={14}/> Chapters <span>{chapters.length}</span></button>
    <dialog ref={dialog} className="harness-dialog harness-chapter-dialog" aria-label="Conversation chapters">
      <div className="harness-chapter-dialog-head"><div><span className="harness-overline">CONVERSATION HISTORY</span><h2>Chapters</h2></div><button className="harness-icon" onClick={() => dialog.current?.close()} aria-label="Close chapters"><X size={17}/></button></div>
      <label className="harness-chapter-search"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Find a topic or tag…" aria-label="Search chapters"/></label>
      <div className="harness-chapter-results">
        {matches.slice(0, limit).map(part => <div className="harness-chapter-result" key={part.id}>
          <button className="harness-chapter-main" onClick={() => choose(part.startSeq)}>
            <span><strong>{part.title}</strong><time>{part.startAt.slice(0, 10)}–{part.endAt.slice(0, 10)}{part.parts > 1 ? ` · ${part.parts} parts` : ''}</time></span>
            <p>{part.summary}</p><small>{part.tags.join(' · ')}</small>
          </button>
          {part.parts > 1 && <details open={!!query.trim()}><summary>Browse {part.parts} parts</summary><div className="harness-chapter-parts">{part.entries.filter(entry => !query.trim() || `${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(entry => <button key={entry.id} onClick={() => choose(entry.startSeq)}><span><strong>{entry.title}</strong> · <time>{entry.startAt.slice(0, 10)}–{entry.endAt.slice(0, 10)}</time></span><span>{entry.summary}</span>{entry.tags.length > 0 && <small>{entry.tags.join(" · ")}</small>}</button>)}</div></details>}
        </div>)}
        {!matches.length && <p className="harness-muted">No chapters matched.</p>}
      </div>
      <div className="harness-chapter-dialog-actions">
        <span>{Math.min(limit, matches.length)} of {matches.length}</span>
        {limit < matches.length && <button className="harness-secondary" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show more</button>}
        <button className="harness-secondary" onClick={() => { dialog.current?.close(); onLatest(); }}>Latest messages</button>
      </div>
    </dialog>
  </>;
}
