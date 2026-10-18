import type { BrowserTools } from './browserModel.ts';
import { mayContainTerms, searchTerms, type ConversationMeta } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { searchableMessageText, toolActivityText } from './harnessCompaction.ts';
import { isBriefFollowUp } from './harnessFollowUp.ts';

const boundedNumber = (value: unknown, fallback: number, low: number, high: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(low, Math.min(high, Math.floor(number))) : fallback;
};

const RECALL_STOP = new Set('about after again already also and are before could decide decided earlier for from has have into its just last more most not only other our previous project remember should some that the their there these they this those through under was what when where which while with would your'.split(' '));

async function recallRecentExchange(store: HarnessStore, meta: ConversationMeta, limit: number, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason || new DOMException('Recall stopped.', 'AbortError');
  const messages = await store.messages(meta, Math.max(0, meta.activeFrom - 16), meta.activeFrom);
  if (signal?.aborted) throw signal.reason || new DOMException('Recall stopped.', 'AbortError');
  const task = [...messages].reverse().find(message => message.role === 'user' && !isBriefFollowUp(message.content));
  const answer = [...messages].reverse().find(message => message.role === 'assistant' && (!task || message.seq > task.seq));
  const selected = [task, answer].filter((message): message is NonNullable<typeof message> => !!message);
  const summary = !task ? meta.segments.at(-1) : undefined;
  if (!selected.length && !summary) return '';
  const perMessage = Math.max(150, Math.floor((limit - 160 - (summary ? 300 : 0)) / Math.max(1, selected.length)));
  const excerpts = selected.map(message => {
    const content = message.content.trim();
    const excerpt = content.length <= perMessage ? content : message.role === 'assistant' ? `…${content.slice(-(perMessage - 1))}` : `${content.slice(0, perMessage - 1)}…`;
    return `[Recent archived exchange · message #${message.seq} · ${message.createdAt.slice(0, 10)} · ${message.role}]\n${excerpt}`;
  });
  if (summary) excerpts.unshift(`[Recent archived topic · ${summary.title}]\n${summary.summary.slice(0, 260)}`);
  return excerpts.join('\n\n').slice(0, limit);
}

/** Read a few original passages from archived chapters whose metadata matches this request. */
export async function recallHistory(store: HarnessStore, meta: ConversationMeta, query: string, maxChars = 1600, signal?: AbortSignal): Promise<string> {
  if (!meta.activeFrom || !meta.segments.length) return '';
  const limit = Math.max(400, Math.min(2400, Math.floor(maxChars)));
  if (isBriefFollowUp(query)) return recallRecentExchange(store, meta, limit, signal);
  const terms = searchTerms(query).filter(term => term.length >= 3 && !RECALL_STOP.has(term)).slice(0, 12);
  if (!terms.length) return '';
  const ranked = meta.segments.filter(part => part.startSeq < meta.activeFrom).map(part => {
    const title = part.title.toLowerCase(), tags = part.tags.join(' ').toLowerCase(), summary = part.summary.toLowerCase();
    const weighted = terms.map(term => ({ term, weight: (title.includes(term) ? 5 : 0) + (tags.includes(term) ? 4 : 0) + (summary.includes(term) ? 2 : 0) }));
    return { part, score: weighted.reduce((sum, item) => sum + item.weight, 0), term: weighted.sort((a, b) => b.weight - a.weight)[0]?.term };
  }).filter(item => item.score >= 2).sort((a, b) => b.score - a.score || b.part.startSeq - a.part.startSeq).slice(0, 2);
  const originalFallback = async (covered = new Set<string>()): Promise<string> => {
    // A compact chapter label can omit a useful detail. The original messages
    // remain indexed by chunk, so verify one informative term there before
    // treating the archive as irrelevant to the current request.
    for (const term of [...terms].sort((a, b) => b.length - a.length).filter(term => !covered.has(term) && mayContainTerms(meta.searchBits, term)).slice(0, 3)) {
      if (signal?.aborted) throw signal.reason || new DOMException('Recall stopped.', 'AbortError');
      const [hit] = await store.searchMessages(meta, term, 1, meta.activeFrom, 0, signal);
      if (!hit) continue;
      const part = meta.segments.find(segment => segment.startSeq <= hit.seq && hit.seq <= segment.endSeq);
      const content = searchableMessageText(hit);
      const at = content.toLowerCase().indexOf(term);
      const from = Math.max(0, at - 180);
      const excerpt = content.slice(from, from + 560).replace(/\s+/g, ' ');
      return `[${part?.title || 'Earlier conversation'} · message #${hit.seq} · ${hit.createdAt.slice(0, 10)} · ${hit.role}]\n${from ? '…' : ''}${excerpt}${from + 560 < content.length ? '…' : ''}`.slice(0, limit);
    }
    return '';
  };
  if (!ranked.length) return originalFallback();
  const excerpts: string[] = [];
  let foundOriginal = false;
  const coveredTerms = new Set<string>();
  for (const { part, term } of ranked) {
    if (signal?.aborted) throw signal.reason || new DOMException('Recall stopped.', 'AbortError');
    if (!term) continue;
    const hits = await store.searchMessages(meta, term, 4, Math.min(meta.activeFrom, part.endSeq + 1), part.startSeq, signal);
    const hit = hits.find(message => message.role === 'assistant') || hits[0];
    if (hit) {
      foundOriginal = true;
      const content = searchableMessageText(hit).toLowerCase();
      for (const candidate of terms) if (content.includes(candidate)) coveredTerms.add(candidate);
    }
    const content = hit ? searchableMessageText(hit) : '';
    const at = content.toLowerCase().indexOf(term);
    const from = Math.max(0, at - 180);
    const excerpt = hit ? content.slice(from, from + 560).replace(/\s+/g, ' ') : part.summary.slice(0, 300);
    const source = hit ? `message #${hit.seq} · ${hit.createdAt.slice(0, 10)} · ${hit.role}` : `chapter summary #${part.startSeq}–${part.endSeq}`;
    const entry = `[${part.title} · ${source}]\n${from ? '…' : ''}${excerpt}${hit && from + 560 < content.length ? '…' : ''}`;
    if (excerpts.join('\n\n').length + entry.length > limit && excerpts.length) break;
    excerpts.push(entry.slice(0, limit - excerpts.join('\n\n').length));
  }
  if (!foundOriginal) return await originalFallback() || excerpts.join('\n\n');
  // A chapter may match a broad topic while its first matching message omits
  // the detail in the question. Verify one uncovered term in the originals.
  if (terms.some(term => term.length >= 5 && !coveredTerms.has(term))) {
    const specific = await originalFallback(coveredTerms);
    if (specific && !excerpts.some(entry => entry.includes(specific))) {
      const remaining = limit - excerpts.join('\n\n').length - (excerpts.length ? 2 : 0);
      if (remaining > 100) excerpts.push(specific.slice(0, remaining));
    }
  }
  return excerpts.join('\n\n');
}

/** Read archived messages, or all saved turns when a smaller fallback omits some. */
export function browserHistoryTools(store: HarnessStore, meta: ConversationMeta, signal?: AbortSignal, includeActive = false): BrowserTools | undefined {
  const beforeSeq = includeActive ? meta.messageCount : meta.activeFrom;
  if (!beforeSeq) return undefined;
  return {
    definitions: [
      { type: 'function', function: { name: 'list_history_topics', description: 'Browse titled chapters in the current conversation archive. Optional query filters titles, tags, and summaries. Verify important details with read_history.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Optional topic or tag to find.' }, offset: { type: 'number', description: 'Skip this many matching chapters, newest first.' } } } } },
      { type: 'function', function: { name: 'search_history', description: includeActive ? 'Search saved messages from this conversation, including recent turns omitted for this smaller model. Return matching sequence numbers; use read_history for context.' : 'Search the current conversation before its last compaction. Return recent matching messages with sequence numbers; use read_history for surrounding context.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Exact word or phrase, 2–200 characters.' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_history', description: includeActive ? 'Read a small range of saved original messages from this conversation, including recent turns omitted for this smaller model.' : 'Read a small range of original messages from the current conversation before its last compaction.', parameters: { type: 'object', properties: { from_seq: { type: 'number', description: 'First sequence number from a chapter or search result.' }, count: { type: 'number', description: 'Number of messages, up to 6.' }, offset: { type: 'number', description: 'Character offset within one long message; use with count 1.' } }, required: ['from_seq'] } } },
    ],
    execute: async (name, args) => {
      if (signal?.aborted) throw signal.reason || new DOMException('History lookup stopped.', 'AbortError');
      if (name === 'list_history_topics') {
        const query = String(args.query || '').trim().toLowerCase();
        if (query.length > 200) throw new Error('Topic query is limited to 200 characters.');
        const chapters: { id: string; segments: typeof meta.segments }[] = [];
        for (const segment of meta.segments) {
          if (segment.startSeq >= meta.activeFrom) continue;
          const last = chapters.at(-1);
          if (last?.id === segment.chapterId) last.segments.push(segment);
          else chapters.push({ id: segment.chapterId, segments: [segment] });
        }
        const matches = chapters.filter(chapter => !query || chapter.segments.some(segment => `${segment.title} ${segment.tags.join(' ')} ${segment.summary}`.toLowerCase().includes(query))).reverse();
        const offset = boundedNumber(args.offset, 0, 0, 100_000);
        const page = matches.slice(offset, offset + 12);
        if (!page.length) return query ? `No archived topic matched ${JSON.stringify(query)}.` : 'No archived topic is available. Search the original messages by phrase instead.';
        const entries = page.map(chapter => {
          const first = chapter.segments[0], last = chapter.segments.at(-1)!;
          const matched = query ? chapter.segments.find(segment => `${segment.title} ${segment.tags.join(' ')} ${segment.summary}`.toLowerCase().includes(query)) || last : last;
          const tags = [...new Set(chapter.segments.flatMap(segment => segment.tags))].slice(0, 6);
          return `#${first.startSeq}–${Math.min(meta.activeFrom - 1, last.endSeq)} · ${first.startAt.slice(0, 10)}–${last.endAt.slice(0, 10)} · ${last.title}${tags.length ? ` [${tags.join(', ')}]` : ''}\n${matched.summary.slice(0, 260)}`;
        });
        const more = offset + page.length < matches.length ? `\nMore topics available: call with offset ${offset + page.length}.` : '';
        return `Archived topics ${offset + 1}–${offset + page.length} of ${matches.length}, newest first. Summaries are navigation aids; verify facts in the original messages.\n\n${entries.join('\n\n')}${more}`;
      }
      if (name === 'search_history') {
        const query = String(args.query || '').trim();
        const hits = await store.searchMessages(meta, query, 8, beforeSeq, 0, signal);
        if (!hits.length) return `No earlier message matched ${JSON.stringify(query)} in this conversation.`;
        const needle = query.toLowerCase();
        return hits.map(message => {
          const content = searchableMessageText(message);
          const at = content.toLowerCase().indexOf(needle);
          const from = Math.max(0, at - 140);
          const excerpt = content.slice(from, from + 360).replace(/\s+/g, ' ');
          return `#${message.seq} · ${message.createdAt} · ${message.role}\n${from ? '…' : ''}${excerpt}${from + 360 < content.length ? '…' : ''}`;
        }).join('\n\n');
      }
      if (name === 'read_history') {
        const from = boundedNumber(args.from_seq, 0, 0, Math.max(0, beforeSeq - 1));
        const count = boundedNumber(args.count, 4, 1, 6);
        const offset = count === 1 ? boundedNumber(args.offset, 0, 0, 10_000_000) : 0;
        const messages = await store.messages(meta, from, Math.min(beforeSeq, from + count));
        if (!messages.length) return 'No earlier messages at that sequence. Search history for a matching topic.';
        return messages.map(message => `#${message.seq} · ${message.createdAt} · ${message.role}${message.model ? ` · ${message.model.model}` : ''} · characters ${offset}–${Math.min(message.content.length, offset + 1300)} of ${message.content.length}\n${message.content.slice(offset, offset + 1300)}${message.content.length > offset + 1300 ? '\n[More available; read with a higher offset and count 1.]' : ''}${toolActivityText(message.toolEvents) ? `\nTool actions: ${toolActivityText(message.toolEvents)}` : ''}`).join('\n\n');
      }
      throw new Error(`Unknown history tool: ${name}`);
    },
  };
}
