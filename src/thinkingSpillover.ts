export type ThinkingSpillover = { detail: string; reasoningTokens: number; thinkingBudgetTokens: number };

export function detectThinkingSpillover({ reasoning, visible, reasoningTokens, thinkingBudgetTokens, finishReason }: {
  reasoning: string | null | undefined;
  visible: string | null | undefined;
  reasoningTokens: number;
  thinkingBudgetTokens: number;
  finishReason?: string | null;
}): ThinkingSpillover | null {
  if (!reasoning?.trim() || !visible?.trim() || thinkingBudgetTokens < 1) return null;
  // Streaming counters may differ by a token or two from the runtime's final count.
  if (reasoningTokens < Math.max(1, thinkingBudgetTokens - 8)) return null;
  const text = visible.trimStart();
  const startsMidThought = /^[,:;.)\]}]/.test(text) || /^(?:and|but|so|because|wait|however|then|also|let's)\b/i.test(text);
  const selfCorrections = [...text.matchAll(/\b(?:wait|let's|let me|double.check|recheck|contradiction|why did i|i was wrong)\b/gi)].length;
  if (!startsMidThought && !(finishReason === 'length' && text.length > 500 && selfCorrections >= 3)) return null;
  return {
    detail: `Reasoning appears to continue in the visible answer after the thinking cap (${reasoningTokens}/${thinkingBudgetTokens} thinking tokens). The answer is not treated as a completed response.`,
    reasoningTokens,
    thinkingBudgetTokens,
  };
}
