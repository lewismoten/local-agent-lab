import type { ChatTurn } from './ai.ts';
import { estimatedTokens } from './harnessData.ts';

export type FittedTurns = { system: string; turns: ChatTurn[]; omitted: number };

/** Keep the most recent complete exchange when a smaller fallback needs less input. */
export function fitRecentTurns(turns: ChatTurn[], system: string, contextWindow: number, maxOutputTokens: number, toolTokens: number, canRecallOmitted: boolean): FittedTurns | null {
  const budget = Math.max(0, contextWindow - maxOutputTokens - 384 - Math.max(0, toolTokens));
  const contentChars = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  if (estimatedTokens(system) + estimatedTokens(turns.map(turn => turn.content).join('')) <= budget) return { system, turns, omitted: 0 };
  if (!canRecallOmitted || turns.at(-1)?.role !== 'user') return null;

  let suffixChars = contentChars;
  for (let start = 1; start < turns.length; start++) {
    suffixChars -= turns[start - 1].content.length;
    // Do not start the request with an assistant reply divorced from its user turn.
    if (turns[start].role !== 'user') continue;
    const note = `\n\nRECENT CONTEXT: ${start} earlier turns are omitted from this model request to fit its context window. The original messages are still saved. Use search_history and read_history when an omitted detail matters; do not guess from this notice.`;
    if (estimatedTokens(system + note) + Math.ceil(suffixChars / 4) <= budget) return { system: system + note, turns: turns.slice(start), omitted: start };
  }
  return null;
}
