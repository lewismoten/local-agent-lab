import type { ContextSegment, ConversationMeta } from './harnessData.ts';

export type TimelineChapter = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  startSeq: number;
  startAt: string;
  endAt: string;
  position: number;
};
export type TimelineLane = {
  meta: ConversationMeta;
  start: number;
  width: number;
  chapters: TimelineChapter[];
};
export type TimelinePage = {
  lanes: TimelineLane[];
  ticks: { label: string; position: number }[];
  page: number;
  pages: number;
};

export type TimelineTopic = { meta: ConversationMeta; segment: ContextSegment };
export type TimelineScale = 'page' | 'all';

/** Keep only the newest requested topics while scanning long conversation histories. */
export function recentTimelineTopics(sessions: ConversationMeta[], limit: number): { items: TimelineTopic[]; total: number } {
  type Ranked = TimelineTopic & { order: number };
  const heap: Ranked[] = [];
  const count = Math.max(0, Math.floor(limit));
  const rank = (a: Ranked, b: Ranked) => a.segment.startAt.localeCompare(b.segment.startAt) || b.order - a.order;
  const siftUp = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (rank(heap[parent], heap[index]) <= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const siftDown = (index: number) => {
    while (index * 2 + 1 < heap.length) {
      const left = index * 2 + 1, right = left + 1;
      const worst = right < heap.length && rank(heap[right], heap[left]) < 0 ? right : left;
      if (rank(heap[index], heap[worst]) <= 0) break;
      [heap[index], heap[worst]] = [heap[worst], heap[index]];
      index = worst;
    }
  };
  let total = 0;
  for (const meta of sessions) for (const segment of meta.segments || []) {
    const item: Ranked = { meta, segment, order: total++ };
    if (!count) continue;
    if (heap.length < count) { heap.push(item); siftUp(heap.length - 1); }
    else if (rank(item, heap[0]) > 0) { heap[0] = item; siftDown(0); }
  }
  return { items: heap.sort((a, b) => rank(b, a)).map(({ meta, segment }) => ({ meta, segment })), total };
}

const timestamp = (value: string, fallback: number) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function chaptersFor(segments: ContextSegment[]): ContextSegment[] {
  const chapters: ContextSegment[] = [];
  for (const segment of segments) {
    const previous = chapters.at(-1);
    if (previous?.chapterId === segment.chapterId) {
      chapters[chapters.length - 1] = { ...previous, title: segment.title, endSeq: segment.endSeq, endAt: segment.endAt, summary: segment.summary, tags: [...new Set([...previous.tags, ...segment.tags])] };
    } else chapters.push(segment);
  }
  return chapters;
}

/** Focus on the visible page by default; retain an all-time scale for comparison. */
export function buildTimelinePage(sessions: ConversationMeta[], requestedPage = 0, pageSize = 8, scale: TimelineScale = 'page'): TimelinePage {
  const ordered = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.max(0, Math.min(pages - 1, Math.floor(requestedPage) || 0));
  if (!ordered.length) return { lanes: [], ticks: [], page, pages };
  const visible = ordered.slice(page * pageSize, (page + 1) * pageSize);

  const now = Date.now();
  let first = Infinity, last = -Infinity;
  for (const item of scale === 'all' ? ordered : visible) {
    first = Math.min(first, timestamp(item.createdAt, now));
    last = Math.max(last, timestamp(item.updatedAt, now));
  }
  const padding = Math.max((last - first) * .03, 60_000);
  const startTime = first - padding;
  const endTime = Math.max(last + padding, startTime + 120_000);
  const position = (time: number) => clamp((time - startTime) / (endTime - startTime) * 100);
  const dateLabel = (time: number) => endTime - startTime < 48 * 60 * 60_000
    ? new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  const ticks = [0, .25, .5, .75, 1].map(fraction => ({ position: fraction * 100, label: dateLabel(startTime + (endTime - startTime) * fraction) }));
  const lanes = visible.map(meta => {
    const start = position(timestamp(meta.createdAt, startTime));
    const end = position(timestamp(meta.updatedAt, endTime));
    return {
      meta, start, width: Math.max(1, end - start),
      chapters: chaptersFor(meta.segments).map(chapter => ({
        id: chapter.chapterId, title: chapter.title, summary: chapter.summary, tags: chapter.tags,
        startSeq: chapter.startSeq, startAt: chapter.startAt, endAt: chapter.endAt,
        position: position(timestamp(chapter.startAt, startTime)),
      })),
    };
  });
  return { lanes, ticks, page, pages };
}
