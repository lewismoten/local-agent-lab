const MAX_TOOL_RESULT_CHARS = 12_000;
const TRUNCATED = '\n[Tool output shortened to fit this model’s context. Request a smaller range or narrower search.]';
const EXHAUSTED = '[Tool output omitted because this model’s context is full. Continue with what is available or start a narrower request.]';

/** Reserve room for the model's answer and subsequent tool calls in a small context. */
export function toolResultBudget(contextWindow: number, maxOutputTokens: number, system: string, turns: { content: string }[], definitions: unknown[]): number {
  const promptChars = system.length + turns.reduce((total, turn) => total + turn.content.length, 0) + JSON.stringify(definitions).length;
  const remainingTokens = Math.max(0, contextWindow - maxOutputTokens - 384 - Math.ceil(promptChars / 4));
  return Math.min(MAX_TOOL_RESULT_CHARS, Math.floor(remainingTokens * 4 * .6));
}

export function createToolResultLimiter(budgetChars: number): (value: string) => string {
  let used = 0;
  let exhaustionReported = false;
  return value => {
    const remaining = Math.max(0, Math.floor(budgetChars) - used);
    if (value.length <= remaining) { used += value.length; return value; }
    if (remaining <= TRUNCATED.length + 32) {
      if (exhaustionReported) return '';
      exhaustionReported = true;
      used = Math.max(used, Math.floor(budgetChars));
      return EXHAUSTED;
    }
    used += remaining;
    return value.slice(0, remaining - TRUNCATED.length) + TRUNCATED;
  };
}
