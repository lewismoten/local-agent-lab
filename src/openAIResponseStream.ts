import type { LiveCompletionProgress } from './ai.ts';

export function openAIReasoningSummary(body: Record<string, any>): string {
  return (Array.isArray(body.output) ? body.output : [])
    .filter((item: Record<string, any>) => item.type === 'reasoning')
    .flatMap((item: Record<string, any>) => Array.isArray(item.summary) ? item.summary : [])
    .map((part: Record<string, any>) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean).join('\n\n');
}

/** Stream OpenAI Responses text while retaining the final response object for safe tool handling. */
export async function streamOpenAIResponse(
  url: string,
  apiKey: string,
  request: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (progress: LiveCompletionProgress) => void,
): Promise<{ body: Record<string, any>; reasoningText: string }> {
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...request, stream: true }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  if (!response.body) throw new Error('OpenAI did not return a readable response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const started = performance.now();
  let pending = '', eventData: string[] = [], visibleText = '', reasoningText = '';
  let completed: Record<string, any> | null = null;
  const emit = (usage?: Record<string, number>) => {
    const generated = usage?.output_tokens || Math.max(0, Math.ceil((visibleText.length + reasoningText.length) / 4));
    onProgress?.({ promptProcessed: usage?.input_tokens || 0, promptTotal: usage?.input_tokens || 0,
      outputTokens: generated, maxOutputTokens: Number(request.max_output_tokens) || 0,
      outputTokensPerSecond: generated / Math.max(.001, (performance.now() - started) / 1000),
      visibleText, reasoningText });
  };
  const accept = () => {
    if (!eventData.length) return;
    const payload = eventData.join('\n').trim();
    eventData = [];
    if (payload === '[DONE]') return;
    let event: Record<string, any>;
    try { event = JSON.parse(payload); }
    catch { throw new Error('OpenAI returned malformed streaming data.'); }
    if (event.type === 'error') throw new Error(`OpenAI stream: ${event.message || 'request failed'}`);
    if (event.type === 'response.failed' || event.type === 'response.incomplete') {
      throw new Error(`OpenAI response ${event.type === 'response.failed' ? 'failed' : 'was incomplete'}: ${event.response?.error?.message || event.response?.incomplete_details?.reason || 'no details'}`);
    }
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      if (typeof event.delta === 'string') { visibleText += event.delta; emit(); }
    }
    if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
      if (typeof event.delta === 'string') { reasoningText += event.delta; emit(); }
    }
    if (event.type === 'response.completed') {
      if (!event.response || event.response.status !== 'completed') throw new Error('OpenAI returned an incomplete response.');
      completed = event.response;
      emit(event.response.usage);
    }
  };
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Cancelled.', 'AbortError');
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (!line) accept();
        else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      const line = pending.replace(/\r$/, '');
      if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
    }
    accept();
    if (!completed) throw new Error('OpenAI closed its stream before completing the response.');
    return { body: completed, reasoningText };
  } finally { reader.releaseLock(); }
}
