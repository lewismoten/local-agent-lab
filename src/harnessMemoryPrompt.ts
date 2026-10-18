import { searchTerms, type MemoryRecord } from './harnessData.ts';

const STOP_WORDS = new Set('about after again also and are been before can could does every for from have how into just more most only other over should some that the their there these this those through under was what where which while who why with would you your'.split(' '));
export const memoryQueryTerms = (query: string) => searchTerms(query).filter(word => !STOP_WORDS.has(word)).slice(0, 12);
export function memoryMatchScore(record: Pick<MemoryRecord, 'title' | 'tags' | 'content'>, words: string[]): number {
  const header = new Set(searchTerms(`${record.title} ${record.tags.join(' ')}`));
  const body = new Set(searchTerms(record.content));
  return words.reduce((score, word) => score + (header.has(word) ? 4 : 0) + (body.has(word) ? 1 : 0), 0);
}

export function relatedMemory(records: MemoryRecord[], projectId: string, sessionId: string, query: string, limit = 5): MemoryRecord[] {
  const words = memoryQueryTerms(query);
  const ranked = records.filter(record => record.scope === 'global' || record.scope === 'project' && record.ownerId === projectId || record.scope === 'session' && record.ownerId === sessionId)
    .map(record => ({ record, score: memoryMatchScore(record, words) }))
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt));
  const max = Math.max(0, Math.floor(limit));
  if (max < 3) return ranked.slice(0, max).map(item => item.record);
  const reserved = (['session', 'project', 'global'] as const).flatMap(scope => {
    const item = ranked.find(candidate => candidate.record.scope === scope);
    return item ? [item] : [];
  });
  // Keep the newest scoped note available, then spend the remaining context
  // only on memories that actually match the request.
  const chosen = [...reserved, ...ranked.filter(item => item.score > 0)]
    .filter((item, index, all) => all.findIndex(other => other.record.id === item.record.id) === index).slice(0, max);
  return chosen.sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt)).map(item => item.record);
}

/** Give every selected memory an excerpt before expanding the highest ranked ones. */
export function memoryPromptExcerpt(records: Pick<MemoryRecord, 'scope' | 'title' | 'tags' | 'content'>[], maxChars: number): string {
  const limit = Math.max(0, Math.floor(maxChars));
  if (!records.length || limit < 40) return '';
  const entries = records.map(record => ({
    header: `[${record.scope}: ${record.title.slice(0, 80)}${record.tags.length ? ` · ${record.tags.slice(0, 4).join(', ').slice(0, 80)}` : ''}] `,
    content: record.content.trim(),
  }));
  const selected: typeof entries = [];
  let headerChars = 0;
  for (const entry of entries) {
    const addition = entry.header.length + (selected.length ? 1 : 0);
    if (headerChars + addition + selected.length + 1 > limit) break;
    selected.push(entry);
    headerChars += addition;
  }
  if (!selected.length) return '';
  let remaining = limit - headerChars;
  const portions = selected.map(entry => Math.min(entry.content.length, Math.floor(remaining / selected.length)));
  remaining -= portions.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; index < selected.length && remaining > 0; index++) {
    const extra = Math.min(remaining, selected[index].content.length - portions[index]);
    portions[index] += extra;
    remaining -= extra;
  }
  return selected.map((entry, index) => entry.header + entry.content.slice(0, portions[index])).join('\n');
}
