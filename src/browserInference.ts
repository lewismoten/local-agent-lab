// Qwen3.5's thinking choice must be applied when loading and per request.
export function qwen35LoadOptions(thinking: boolean) {
  return {
    default_template_kwargs: { enable_thinking: thinking },
    reasoning: thinking,
    reasoning_format: thinking ? 'deepseek' as const : 'none' as const,
  };
}
export const qwen35ChatOptions = { chat_template_kwargs: { enable_thinking: false } };

/** A partial generation must never trigger a file or Git tool. */
export function assertExecutableToolCalls(callCount: number, finishReason: string | null | undefined, signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason || new DOMException('Stopped.', 'AbortError');
  if (callCount && ['length', 'incomplete', 'max_tokens', 'MAX_TOKENS'].includes(finishReason || '')) {
    throw new Error('The model stopped before finishing its tool calls. Increase the output limit or narrow the request, then try again.');
  }
}

export function visibleBrowserText(content: string | null | undefined): string {
  const raw = content?.trim() || '';
  if (raw.startsWith('<think>') && !raw.includes('</think>')) return '';
  if (raw.startsWith('<|channel>thought') && !raw.includes('<|channel>text')) return '';
  return raw
    .replace(/^<think>[\s\S]*?<\/think>\s*/, '')
    .replace(/^<\/think>\s*/, '')
    .replace(/^<\|channel>thought[\s\S]*?<\|channel>text\s*/, '')
    .replace(/^<\|channel>text\s*/, '')
    .trim();
}

// Stream previews are provisional. Hide incomplete reasoning envelopes and
// tool-call markup so only the eventual answer appears in the chat bubble.
export function liveBrowserAnswer(content: string): string {
  const raw = content.split(/<tool_call\b|<\|tool_call\b/i)[0];
  if (raw.trimStart().startsWith('<') && !/^\s*(?:<think>[\s\S]*?<\/think>|<\|channel>thought[\s\S]*?<\|channel>text)/.test(raw)) return '';
  return visibleBrowserText(raw.replace(/<(?:tool_call|\|tool_call)?$/i, ''));
}

export function visibleReasoningEnvelope(content: string | null | undefined): 'think-tags' | 'channel-tags' | null {
  const raw = content?.trim() || '';
  if (/^<think>[\s\S]*?<\/think>/.test(raw)) return 'think-tags';
  if (/^<\|channel>thought[\s\S]*?<\|channel>text/.test(raw)) return 'channel-tags';
  return null;
}

export function parsePromptedSteps(content: string | null | undefined): { steps: string; answer: string } | null {
  const match = content?.match(/^\s*<think>([\s\S]+?)<\/think>\s*([\s\S]+?)\s*$/i);
  if (!match?.[1]?.trim() || !match[2]?.trim()) return null;
  const answer = match[2].trim();
  const wrappedAnswer = answer.match(/^<answer>\s*([\s\S]+?)\s*<\/answer>$/i);
  return { steps: match[1].trim(), answer: (wrappedAnswer?.[1] || answer).trim() };
}

export function scorePromptedSteps(content: string | null | undefined, finishReason?: string | null): { result: 'passed' | 'answer-correct-no-tags' | 'incorrect-answer' | 'inconclusive'; answerAccuracy?: 'passed' | 'failed'; detail: string } {
  const parsed = parsePromptedSteps(content);
  if (parsed) {
    if (finishReason === 'length') return { result: 'passed', detail: 'Followed the requested <think> format; the output limit was reached, so the answer was not scored.' };
    const conclusion = machineConclusion(parsed.answer);
    const answerCorrect = isFiveMinutesAnswer(parsed.answer) || !!conclusion && isFiveMinutesAnswer(conclusion.answer);
    return { result: 'passed', answerAccuracy: answerCorrect ? 'passed' : 'failed', detail: answerCorrect ? 'Followed the requested <think> format and gave the correct answer. This is prompted text, not a native thinking mode.' : `Followed the requested <think> format; the final answer was not scored as correct: ${parsed.answer.slice(0, 160)}.` };
  }
  if (finishReason === 'length') return { result: 'inconclusive', detail: 'Output limit reached before a final answer; this task was not scored.' };
  const conclusion = machineConclusion(content);
  if (!conclusion) return { result: 'inconclusive', detail: 'No complete <think> steps or final answer could be identified.' };
  const answerCorrect = isFiveMinutesAnswer(conclusion.answer);
  return { result: answerCorrect ? 'answer-correct-no-tags' : 'incorrect-answer', answerAccuracy: answerCorrect ? 'passed' : 'failed', detail: answerCorrect ? 'Gave the correct answer, but did not use the requested <think> tags.' : `Did not use the requested <think> tags; answer read as ${conclusion.answer}, expected 5.` };
}

export function scoreStructuredToolUse(calls: { function: { name: string; arguments: string } }[] | undefined, name: string, expectedArguments: Record<string, unknown>): { observed: boolean; argumentAccuracy?: 'passed' | 'failed' } {
  const call = calls?.find(item => item.function.name === name);
  if (!call) return { observed: false };
  try {
    const args = JSON.parse(call.function.arguments) as unknown;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { observed: false };
    const actual = args as Record<string, unknown>;
    const correct = Object.entries(expectedArguments).every(([key, value]) => actual[key] === value);
    return { observed: true, argumentAccuracy: correct ? 'passed' : 'failed' };
  } catch { return { observed: false }; }
}

export function isFiveMinutesAnswer(content: string): boolean {
  return /^(?:5|five)(?:\s+minutes?)?[.!]?$/iu.test(content.trim());
}

export function machineConclusion(content: string | null | undefined): { answer: string; source: 'boxed' | 'final-answer' | 'last-line' | 'time-phrase' | 'last-number' } | null {
  const text = visibleBrowserText(content);
  if (!text) return null;
  const numeral = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  const answer = `(${numeral}|five)`;
  const normalized = (value: string) => value.replaceAll(',', '');
  const boxed = [...text.matchAll(new RegExp(String.raw`\\boxed\{\s*${answer}\s*\}`, 'gi'))].at(-1);
  if (boxed) return { answer: normalized(boxed[1]), source: 'boxed' };
  const final = [...text.matchAll(new RegExp(String.raw`final\s+answer[^\n]*?\b${answer}\b`, 'gi'))].at(-1);
  if (final) return { answer: normalized(final[1]), source: 'final-answer' };
  const lastLine = text.match(new RegExp(String.raw`(?:^|\n)\s*(?:\*\*|__)?${answer}(?:\*\*|__)?(?:\s+minutes?)?[.!]?\s*$`, 'i'));
  if (lastLine) return { answer: normalized(lastLine[1]), source: 'last-line' };
  const time = [...text.matchAll(new RegExp(String.raw`\b${answer}(?:\*\*|__)?\s+minutes?\b`, 'gi'))].at(-1);
  if (time) return { answer: normalized(time[1]), source: 'time-phrase' };
  const last = [...text.matchAll(new RegExp(String.raw`\b${answer}\b`, 'gi'))].at(-1);
  return last ? { answer: normalized(last[1]), source: 'last-number' } : null;
}

export function completedMachineConclusion(content: string | null | undefined, finishReason: string | null | undefined) {
  return finishReason === 'stop' ? machineConclusion(content) : null;
}

export function gemmaBrowserMessages(system: string, turns: { role: 'user' | 'assistant'; content: string }[]) {
  return [
    { role: 'user' as const, content: `${system}\n\n${turns[0]?.role === 'user' ? turns[0].content : ''}` },
    ...(turns[0]?.role === 'user' ? turns.slice(1) : turns),
  ];
}
