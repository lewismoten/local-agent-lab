import type { HarnessMessage } from './harnessData.ts';
import { isSavedChangeEvent } from './harnessToolActions.ts';

export type CompactionWindow = { startSeq: number; endSeq: number; text: string };

const IMPORTANT_CUE = /\b(?:agreed|blocked|changed|chose|created|decided|error|failed|fixed|implement(?:ed)?|keep|must|need|next|prefer|remember|switch(?:ed)?|todo|use)\b/gi;
const FILE_PATH = /(?:^|[\s"'`])(?:[\w.-]+\/)+[\w.-]+/g;
const COMPLETED_ACTION = /\b(?:added|adding|adds|built|building|builds|completed|completing|completes|created|creating|creates|deployed|deploying|deploys|fixed|fixing|fixes|implemented|implementing|implements|inspected|inspecting|inspects|merged|merging|merges|published|publishing|publishes|ran|runs|removed|removing|removes|renamed|renaming|renames|resolved|resolving|resolves|saved|saving|saves|tested|testing|updated|updating|updates|verified|verifying|verifies|wrote|writing|writes)\b/gi;
const COMPLETED_FORM: Record<string, string> = {
  adding: 'added', adds: 'added', building: 'built', builds: 'built', completing: 'completed', completes: 'completed', creating: 'created', creates: 'created', deploying: 'deployed', deploys: 'deployed', fixing: 'fixed', fixes: 'fixed', implementing: 'implemented', implements: 'implemented',
  inspecting: 'inspected', inspects: 'inspected', merging: 'merged', merges: 'merged', publishing: 'published', publishes: 'published', runs: 'ran', removing: 'removed', removes: 'removed', renaming: 'renamed', renames: 'renamed', resolving: 'resolved', resolves: 'resolved', saving: 'saved', saves: 'saved', testing: 'tested', updating: 'updated', updates: 'updated', verifying: 'verified', verifies: 'verified', writing: 'wrote', writes: 'wrote',
};
const CLAIM_STOP = new Set('about after along also and are been before for from into its more that the their then there these this those through under using with'.split(' '));

/** Reject a model's completed-work claim unless an affirmative source clause supports the action and subject. */
export function unsupportedCompletedActions(modelText: string, sourceText: string): string[] {
  const clauses = sourceText.split(/(?:[.!?;]\s+|\n+)/).filter(Boolean);
  const terms = (text: string) => [...text.toLowerCase().matchAll(/\b[a-z][a-z0-9_-]{2,}\b/g)]
    .map(match => match[0]).filter(word => !CLAIM_STOP.has(word));
  const unsupported: string[] = [];
  for (const clause of modelText.split(/(?:[.!?;]\s+|\n+)/).filter(Boolean)) {
    const matches = [...clause.matchAll(COMPLETED_ACTION)];
    for (const [index, match] of matches.entries()) {
      const verb = COMPLETED_FORM[match[0].toLowerCase()] || match[0].toLowerCase();
      const tail = clause.slice(match.index! + match[0].length, matches[index + 1]?.index ?? clause.length).split(/\b(?:but|however|though|while)\b/i)[0];
      const subject = terms(tail).slice(0, 7);
      const supported = clauses.some(source => {
        const action = [...source.matchAll(COMPLETED_ACTION)].find(item => item[0].toLowerCase() === verb);
        if (!action) return false;
        const before = source.slice(Math.max(0, action.index! - 28), action.index!);
        if (/\b(?:not|never|didn't|wasn't|failed to)\b/i.test(before)) return false;
        const evidence = new Set(terms(source.slice(action.index! + action[0].length).split(/\b(?:but|however|though|while)\b/i)[0]).slice(0, 14));
        return !subject.length || subject.filter(word => evidence.has(word)).length >= Math.min(2, subject.length);
      });
      if (!supported) unsupported.push(`${verb}${tail}`.trim().slice(0, 120));
    }
  }
  return unsupported;
}

/** A new segment needs a fresh description even if the model repeats older context. */
export function repeatsPreviousSummary(current: string, previous = ''): boolean {
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const now = normalized(current);
  const before = normalized(previous);
  return now.length >= 35 && before.length >= 35 && (now === before || now.length >= 50 && before.includes(now) || before.length >= 50 && now.includes(before));
}

/** Small models often wrap a valid JSON object in prose or a code fence. */
export function parseModelMetadataJson<T>(text: string): T {
  const source = text.trim();
  try { return JSON.parse(source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as T; }
  catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(source)?.[1];
    const first = source.indexOf('{');
    const last = source.lastIndexOf('}');
    const object = fenced || (first >= 0 && last > first ? source.slice(first, last + 1) : '');
    if (!object.trim().startsWith('{')) throw new SyntaxError('No JSON object in model metadata.');
    return JSON.parse(object.trim()) as T;
  }
}

export function usefulCompactionSummary(text: string): boolean {
  return text.trim().length >= 40 && !/^(?:new|none|n\/a|conversation summary|summary|part\s*\d+)\.?$/i.test(text.trim());
}

/** A long, multi-topic exchange should not collapse into a boilerplate status shared by every message. */
export function summaryHasSourceDetail(summary: string, messages: HarnessMessage[]): boolean {
  if (messages.length < 12) return true;
  const words = (text: string) => [...text.toLowerCase().matchAll(/\b[a-z][a-z0-9_-]{3,}\b/g)].map(match => match[0]);
  const frequency = new Map<string, number>();
  for (const message of messages) for (const word of new Set(words(message.content))) frequency.set(word, (frequency.get(word) || 0) + 1);
  const details = new Set([...frequency].filter(([, count]) => count <= Math.max(2, Math.floor(messages.length * .35))).map(([word]) => word));
  return !details.size || words(summary).some(word => details.has(word));
}

/** Carry a few explicit user constraints independently of a small model's summary. */
export function userConstraintAnchors(messages: HarnessMessage[], limit = 260): string {
  const candidates = messages.filter(message => message.role === 'user').flatMap(message =>
    message.content.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(sentence =>
      /\b(?:must|never|always|do not|don't|keep|prefer|preserve|only|remain|stay|without)\b/i.test(sentence)));
  const selected: string[] = [];
  for (const sentence of candidates) {
    const value = sentence.trim().slice(0, 170);
    if (!value || selected.some(item => item.toLowerCase() === value.toLowerCase())) continue;
    if (selected.join(' | ').length + value.length + (selected.length ? 3 : 0) > limit) continue;
    selected.push(value);
  }
  return selected.join(' | ');
}

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
export function carryForwardContext(previous: string, latest: string, modelCarry = '', userConstraints = ''): string {
  const current = latest.trim().slice(0, 650);
  const oldAnchor = /^User constraints \(verify if current\): ([^\n]*)/.exec(previous)?.[1] || '';
  const anchorParts: string[] = [];
  for (const [source, allowance] of [[oldAnchor, 250], [userConstraints, 160]] as const) {
    let used = 0;
    for (const piece of source.split(' | ')) {
      const value = piece.trim();
      if (!value || anchorParts.some(other => other.toLowerCase().includes(value.toLowerCase()))) continue;
      const next = value.length + (used ? 3 : 0);
      if (used + next > allowance || anchorParts.join(' | ').length + value.length + (anchorParts.length ? 3 : 0) > 415) continue;
      anchorParts.push(value); used += next;
    }
  }
  const anchor = anchorParts.join(' | ');
  const anchorLine = anchor ? `User constraints (verify if current): ${anchor}` : '';
  const oldNotes = previous.replace(/^User constraints \(verify if current\): [^\n]*\n?/, '');
  const cleanCarry = /^(?:none|n\/a|nothing|no prior context)\.?$/i.test(modelCarry.trim()) ? '' : modelCarry.trim();
  if (!oldNotes.trim() && !cleanCarry) return [anchorLine, current].filter(Boolean).join('\n').slice(0, 1600);
  const priorNotes = oldNotes.replace(/^Earlier notes \(verify if superseded\):\s*/, '').replace(/\nLatest part:\s*/g, ' | ').trim();
  const carry = cleanCarry
    ? cleanCarry.slice(0, 650)
    : priorNotes.length <= 650 ? priorNotes : `${priorNotes.slice(0, 350).trimEnd()} … ${priorNotes.slice(-240).trimStart()}`;
  const available = Math.max(0, 1600 - anchorLine.length - current.length - 58);
  return [anchorLine, carry && `Earlier notes (verify if superseded): ${carry.slice(0, available)}`, `Latest part: ${current}`].filter(Boolean).join('\n');
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
