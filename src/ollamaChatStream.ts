import type { LiveCompletionProgress } from './ai.ts';

type OllamaToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };
export type OllamaChatResponse = {
  message: { role: 'assistant'; content: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  eval_count?: number;
  done_reason?: string;
};

/** Read Ollama's NDJSON chat stream, preserving the assistant message for tool follow-ups. */
export async function streamOllamaChat(
  endpoint: string,
  request: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (progress: LiveCompletionProgress) => void,
): Promise<OllamaChatResponse> {
  const response = await fetch(endpoint.replace(/\/$/, '') + '/api/chat', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: true }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  if (!response.body) throw new Error('Ollama did not return a readable stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const maxOutputTokens = Number(request.options && typeof request.options === 'object' && 'num_predict' in request.options
    ? request.options.num_predict : 0) || 0;
  const started = performance.now();
  let pending = '';
  let content = '';
  let thinking = '';
  let promptTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let done = false;
  let doneReason: string | undefined;
  const toolCalls: OllamaToolCall[] = [];
  const emit = () => onProgress?.({
    promptProcessed: promptTokens,
    promptTotal: promptTokens,
    promptCachedTokens: cachedTokens,
    outputTokens: outputTokens || (content ? Math.max(1, Math.ceil(content.length / 4)) : 0),
    maxOutputTokens,
    outputTokensPerSecond: (outputTokens || Math.ceil(content.length / 4)) / Math.max(.001, (performance.now() - started) / 1000),
    visibleText: content,
    reasoningText: thinking,
  });
  const accept = (line: string) => {
    if (!line.trim()) return;
    let chunk: Record<string, any>;
    try { chunk = JSON.parse(line); }
    catch { throw new Error('Ollama returned malformed streaming data.'); }
    if (chunk.error) throw new Error(`Ollama: ${String(chunk.error)}`);
    const message = chunk.message || {};
    if (typeof message.thinking === 'string') thinking += message.thinking;
    if (typeof message.content === 'string') content += message.content;
    if (Array.isArray(message.tool_calls)) toolCalls.push(...message.tool_calls);
    if (typeof chunk.prompt_eval_count === 'number') promptTokens = chunk.prompt_eval_count;
    if (typeof chunk.prompt_eval_cached_count === 'number') cachedTokens = chunk.prompt_eval_cached_count;
    if (typeof chunk.eval_count === 'number') outputTokens = chunk.eval_count;
    if (chunk.done === true) {
      done = true;
      if (typeof chunk.done_reason === 'string') doneReason = chunk.done_reason;
    }
    if (message.content || message.thinking || (chunk.done && (content || thinking))) emit();
  };
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Cancelled.', 'AbortError');
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        accept(line);
      }
    }
    pending += decoder.decode();
    accept(pending);
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled.', 'AbortError');
    if (!done) throw new Error('Ollama closed its stream before finishing the response.');
    return {
      message: { role: 'assistant', content, ...(thinking ? { thinking } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      prompt_eval_count: promptTokens,
      prompt_eval_cached_count: cachedTokens,
      eval_count: outputTokens,
      ...(doneReason ? { done_reason: doneReason } : {}),
    };
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
