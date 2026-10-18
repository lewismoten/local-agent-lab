import type { LiveCompletionProgress } from './ai.ts';

type StreamResult = { body: Record<string, any>; streamed: boolean };
type ToolDelta = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };

/** OpenAI-compatible chat SSE, with JSON fallback only when a server rejects streaming. */
export async function streamCompatibleChat(
  url: string,
  headers: Record<string, string>,
  request: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (progress: LiveCompletionProgress) => void,
): Promise<StreamResult> {
  const send = (body: Record<string, unknown>) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal,
  });
  let streamed = true;
  let response = await send({ ...request, stream: true });
  if (!response.ok && [400, 422, 501].includes(response.status)) {
    streamed = false;
    response = await send(request);
  }
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  if (!streamed || response.headers.get('content-type')?.includes('application/json')) {
    return { body: await response.json(), streamed };
  }
  if (!response.body) throw new Error('The model server did not return a readable stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const started = performance.now();
  const tools = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();
  let pending = '', eventData: string[] = [], text = '', thinking = '', finishReason: string | null = null;
  let usage: Record<string, number> | undefined;
  let done = false;
  const emit = () => {
    const generated = usage?.completion_tokens || Math.max(0, Math.ceil((text.length + thinking.length) / 4));
    onProgress?.({ promptProcessed: usage?.prompt_tokens || 0, promptTotal: usage?.prompt_tokens || 0,
      outputTokens: generated, maxOutputTokens: Number(request.max_tokens) || 0,
      outputTokensPerSecond: generated / Math.max(.001, (performance.now() - started) / 1000),
      visibleText: text, reasoningText: thinking });
  };
  const accept = () => {
    if (!eventData.length) return;
    const payload = eventData.join('\n').trim();
    eventData = [];
    if (payload === '[DONE]') { done = true; return; }
    let chunk: Record<string, any>;
    try { chunk = JSON.parse(payload); }
    catch { throw new Error('The model server returned malformed streaming data.'); }
    if (chunk.error) throw new Error(`Model server: ${typeof chunk.error === 'string' ? chunk.error : chunk.error.message || 'stream failed'}`);
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') text += delta.content;
    if (typeof delta.reasoning_content === 'string') thinking += delta.reasoning_content;
    if (typeof delta.thinking === 'string') thinking += delta.thinking;
    for (const call of (delta.tool_calls || []) as ToolDelta[]) {
      const index = Number.isInteger(call.index) ? call.index! : 0;
      const current = tools.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (call.id) current.id = call.id;
      if (call.type) current.type = call.type;
      if (call.function?.name) current.function.name += call.function.name;
      if (call.function?.arguments) current.function.arguments += call.function.arguments;
      tools.set(index, current);
    }
    if (delta.content || delta.reasoning_content || delta.thinking || chunk.usage) emit();
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
    if (!done) throw new Error('The model server closed its stream before completion.');
    if (tools.size && !finishReason) throw new Error('The model server did not finish its tool call stream.');
    return { streamed, body: { choices: [{ message: { role: 'assistant', content: text,
      ...(thinking ? { reasoning_content: thinking } : {}),
      ...(tools.size ? { tool_calls: [...tools].sort(([a], [b]) => a - b).map(([, call]) => call) } : {}),
    }, finish_reason: finishReason }], ...(usage ? { usage } : {}) } };
  } finally {
    reader.releaseLock();
  }
}
