import type { ContextSegment } from './harnessData.ts';

export type Chapter = ContextSegment & { parts: number; entries: ContextSegment[]; searchText: string };

const TOPIC_FILLER = new Set('about after again also browser build change changes code coding continue file files from into local model models more project session setup that this tool tools with work'.split(' '));
function topicWords(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !TOPIC_FILLER.has(word)));
}

/** Used only when a metadata model cannot decide whether a compacted part starts a new topic. */
export function continuesChapter(previous: ContextSegment | undefined, title: string, tags: string[]): boolean {
  if (!previous) return false;
  const priorTitle = topicWords(previous.title), nextTitle = topicWords(title);
  const sharedTitle = [...nextTitle].filter(word => priorTitle.has(word)).length;
  if (sharedTitle < 2 || sharedTitle < Math.ceil(Math.min(priorTitle.size, nextTitle.size) / 2)) return false;
  const priorTags = topicWords(previous.tags.join(' ')), nextTags = topicWords(tags.join(' '));
  return [...nextTags].some(word => priorTags.has(word)) || (sharedTitle >= 3 && sharedTitle === Math.min(priorTitle.size, nextTitle.size));
}

export function groupChapters(segments: ContextSegment[]): Chapter[] {
  const chapters: Chapter[] = [];
  const byId = new Map<string, Chapter>();
  for (const part of segments) {
    const id = part.chapterId || part.id;
    const existing = byId.get(id);
    if (existing) {
      existing.parts++;
      existing.entries.push(part);
      existing.endSeq = part.endSeq;
      existing.endAt = part.endAt;
      existing.summary = part.summary;
      existing.tags = [...new Set([...existing.tags, ...part.tags])];
      existing.searchText += ` ${part.title} ${part.summary} ${part.tags.join(' ')}`;
    } else {
      const chapter = { ...part, parts: 1, entries: [part], tags: [...part.tags], searchText: `${part.title} ${part.summary} ${part.tags.join(' ')}` };
      chapters.push(chapter);
      byId.set(id, chapter);
    }
  }
  return chapters;
}
