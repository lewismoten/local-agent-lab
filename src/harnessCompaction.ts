import type { HarnessMessage } from './harnessData.ts';
import { isSavedChangeEvent } from './harnessToolActions.ts';

export type CompactionWindow = { startSeq: number; endSeq: number; text: string };

const IMPORTANT_CUE = /\b(?:agreed|blocked|changed|chose|created|decided|error|failed|fixed|implement(?:ed)?|keep|must|need|next|prefer|remember|switch(?:ed)?|todo|use)\b/gi;
const FILE_PATH = /(?:^|[\s"'`])(?:[\w.-]+\/)+[\w.-]+/g;

/** Index saved changes, but leave verbose read-only tool output out of search. */
export function searchableMessageText(message: Pick<HarnessMessage, 'content' | 'toolEvents'>): string {
  const actions = (message.toolEvents || []).filter(isSavedChangeEvent);
  return actions.length ? `${message.content}\n${actions.join('\n')}` : message.content;
}

/** A small action record for context; raw tool events remain in the archive. */
export function toolActivityText(events?: string[]): string {
  const actions = (events || []).filter(isSavedChangeEvent);
  if (!actions.length) return '';
  const recent = actions.slice(-6).map(event => event.replace(/\s+/g, ' ').slice(0, 190));
  return `${actions.length > recent.length ? `${actions.length - recent.length} earlier actions omitted; ` : ''}${recent.join(' | ')}`.slice(0, 1200);
}

function compactionMessageText(message: HarnessMessage): string {
  const actions = toolActivityText(message.toolEvents);
  return actions ? `${message.content}\nTool actions: ${actions}` : message.content;
}

function compactExcerpt(content: string, limit: number): string {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const path = FILE_PATH.exec(text);
  FILE_PATH.lastIndex = 0;
  const cue = IMPORTANT_CUE.exec(text);
  IMPORTANT_CUE.lastIndex = 0;
  const position = path?.index ?? cue?.index ?? 0;
  const start = Math.max(0, Math.min(text.length - limit, position - 16));
  const end = Math.min(text.length, start + limit - (start ? 1 : 0) - (start + limit < text.length ? 1 : 0));
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Keep both ends of a model window when a local summarizer cannot parse it. */
export function fallbackWindowSummary(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  const head = Math.max(20, Math.floor((limit - 3) * .45));
  return `${compact.slice(0, head)} … ${compact.slice(-(limit - head - 3))}`;
}

/** Keep a durable front and a recent tail when a small model cannot merge context. */
export function carryForwardContext(previous: string, latest: string, modelCarry = ''): string {
  const current = latest.trim().slice(0, 650);
  if (!previous.trim() && !modelCarry.trim()) return current;
  const priorNotes = previous.replace(/^Earlier notes \(verify if superseded\):\s*/, '').replace(/\nLatest part:\s*/g, ' | ').trim();
  const carry = modelCarry.trim()
    ? modelCarry.trim().slice(0, 850)
    : priorNotes.length <= 750 ? priorNotes : `${priorNotes.slice(0, 420).trimEnd()} … ${priorNotes.slice(-280).trimStart()}`;
  return [`Earlier notes (verify if superseded): ${carry}`, `Latest part: ${current}`].filter(Boolean).join('\n').slice(0, 1600);
}

/** A narrow prompt should retain both durable decisions and the newest update. */
export function contextHeadTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit < 24) return text.slice(-limit);
  const head = Math.floor((limit - 3) * .45);
  return `${text.slice(0, head)} … ${text.slice(-(limit - head - 3))}`;
}

/** Split at message boundaries where possible, retaining every character of long messages. */
export function compactionWindows(messages: HarnessMessage[], requestedChars: number): CompactionWindow[] {
  const limit = Math.max(300, Math.floor(requestedChars));
  const windows: CompactionWindow[] = [];
  let pieces: string[] = [];
  let size = 0;
  let first = 0;
  let last = 0;
  const flush = () => {
    if (!pieces.length) return;
    windows.push({ startSeq: first, endSeq: last, text: pieces.join('\n\n') });
    pieces = []; size = 0;
  };
  for (const message of messages) {
    const content = compactionMessageText(message) || '';
    const header = `${message.role.toUpperCase()} #${message.seq}: `;
    // Reserve room for a character-range label on split messages.
    const room = Math.max(100, limit - header.length - 55);
    for (let offset = 0; offset < content.length || offset === 0;) {
      const end = Math.min(content.length, offset + room);
      const part = `${header}[characters ${offset}–${end}] ${content.slice(offset, end)}`;
      const separator = pieces.length ? 2 : 0;
      if (pieces.length && size + separator + part.length > limit) flush();
      if (!pieces.length) first = message.seq;
      pieces.push(part);
      size += separator + part.length;
      last = message.seq;
      if (end >= content.length) break;
      offset = end;
    }
  }
  flush();
  return windows;
}

/** An honest fallback when a summarizer is unavailable or a paste is too large. */
export function fallbackCompactionSummary(messages: HarnessMessage[]): string {
  if (!messages.length) return '';
  const anchors = [messages[0], ...messages.filter(message => message.role === 'user').slice(-2), ...messages.filter(message => message.role === 'assistant').slice(-1), messages.at(-1)!];
  const anchored = new Set(anchors.map(message => message.seq));
  const salient = messages.filter(message => !anchored.has(message.seq)).map(message => {
    const source = compactionMessageText(message);
    const cues = [...source.matchAll(IMPORTANT_CUE)].length;
    const paths = [...source.matchAll(FILE_PATH)].length;
    IMPORTANT_CUE.lastIndex = 0; FILE_PATH.lastIndex = 0;
    return { message, score: Math.min(cues, 3) * 3 + Math.min(paths, 2) * 4 + (message.role === 'user' ? 2 : 0) };
  }).filter(item => item.score > 2).sort((a, b) => b.score - a.score || a.message.seq - b.message.seq).slice(0, 2).map(item => item.message);
  const selected = [...anchors, ...salient];
  const unique = [...new Map(selected.map(message => [message.seq, message])).values()].sort((a, b) => a.seq - b.seq);
  const opening = `Archived ${messages.length} messages (#${messages[0].seq}–#${messages.at(-1)!.seq}). Verify exact details with history tools. `;
  const labels = unique.map(message => `${message.role} #${message.seq}: `);
  const perMessage = Math.floor((700 - opening.length - labels.join('').length - Math.max(0, unique.length - 1) * 3) / unique.length);
  return opening + unique.map((message, index) => labels[index] + compactExcerpt(compactionMessageText(message), perMessage)).join(' | ');
}
