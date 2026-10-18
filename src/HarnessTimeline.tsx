import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ConversationMeta } from './harnessData.ts';
import { buildTimelinePage, type TimelineChapter } from './harnessTimeline.ts';

export default function HarnessTimeline({ sessions, onOpen }: { sessions: ConversationMeta[]; onOpen: (meta: ConversationMeta, seq?: number) => void }) {
  const [requestedPage, setPage] = useState(0);
  const [scale, setScale] = useState<'page' | 'all'>('page');
  const [focused, setFocused] = useState<TimelineChapter | null>(null);
  const timeline = useMemo(() => buildTimelinePage(sessions, requestedPage, 8, scale), [sessions, requestedPage, scale]);
  if (!timeline.lanes.length) return null;
  return <section className="harness-timeline-chart" aria-label="Conversations over time">
    <div className="harness-timeline-chart-head"><div><span className="harness-overline">PARALLEL WORK</span><h2>Conversations over time</h2></div><div className="harness-timeline-controls"><button className="harness-timeline-scale" aria-pressed={scale === 'all'} title={scale === 'page' ? 'Show the full workspace date range' : 'Focus the date range on these conversations'} onClick={() => setScale(value => value === 'page' ? 'all' : 'page')}>{scale === 'page' ? 'This page' : 'All time'}</button><div className="harness-timeline-pager"><button aria-label="Newer conversations" disabled={timeline.page === 0} onClick={() => setPage(page => page - 1)}><ChevronLeft size={16}/></button><span>{timeline.page + 1} / {timeline.pages}</span><button aria-label="Older conversations" disabled={timeline.page >= timeline.pages - 1} onClick={() => setPage(page => page + 1)}><ChevronRight size={16}/></button></div></div></div>
    <div className="harness-timeline-axis"><span aria-hidden="true"/><div className="harness-timeline-ticks">{timeline.ticks.map(tick => <time key={tick.position} style={{ left: `${tick.position}%` }}>{tick.label}</time>)}</div></div>
    <div className="harness-timeline-lanes">{timeline.lanes.map(lane => <div className="harness-timeline-lane" key={lane.meta.id}>
      <button className="harness-timeline-label" title={lane.meta.title} onClick={() => onOpen(lane.meta)}>{lane.meta.title}</button>
      <div className="harness-timeline-track"><span className="harness-timeline-span" style={{ left: `${lane.start}%`, width: `${lane.width}%` }}/>{lane.chapters.map(chapter => <button key={chapter.id} className="harness-timeline-marker" style={{ left: `${chapter.position}%` }} aria-label={`${chapter.title}, began ${new Date(chapter.startAt).toLocaleDateString()}`} onMouseEnter={() => setFocused(chapter)} onMouseLeave={() => setFocused(null)} onFocus={() => setFocused(chapter)} onBlur={() => setFocused(null)} onClick={() => onOpen(lane.meta, chapter.startSeq)}/>)}</div>
    </div>)}</div>
    <div className="harness-timeline-detail" aria-live="polite">{focused ? <><strong>{focused.title}</strong><span>{new Date(focused.startAt).toLocaleDateString()} · {focused.summary}</span></> : <span>Diamonds mark where a topic began. Select one to open its original conversation.</span>}</div>
  </section>;
}
