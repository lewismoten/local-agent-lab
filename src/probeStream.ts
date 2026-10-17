import type { ChatCompletionChunk, ChatCompletionResponse, ChatCompletionToolCall } from './browserEngineTypes';

export type ProbeTokenProgress = {
  promptProcessed: number;
  promptTotal: number;
  outputTokens: number;
  reasoningTokens: number;
  responseTokens: number;
  maxOutputTokens: number;
  outputEstimated: boolean;
  outputTokensPerSecond: number;
  reasoningText?: string;
  responseText?: string;
};

export function splitInlineReasoning(content: string): { reasoning: string; response: string } {
  const think = content.match(/^\s*<think>([\s\S]*?)(?:<\/think>([\s\S]*)|$)/);
  if (think) return { reasoning: think[1], response: think[2] || '' };
  const channel = content.match(/^\s*<\|channel>thought([\s\S]*?)(?:<\|channel>text([\s\S]*)|$)/);
  if (channel) return { reasoning: channel[1], response: channel[2] || '' };
  return { reasoning: '', response: content };
}

// Wllama streams prompt counters and generated deltas, then reports exact usage
// in its final chunk. During generation, one nonempty delta approximates a token.
export async function collectProbeStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  maxOutputTokens: number,
  onProgress: (progress: ProbeTokenProgress) => void,
): Promise<ChatCompletionResponse> {
  let promptTotal = 0;
  let promptProcessed = 0;
  let outputTokens = 0;
  let observedOutputChunks = 0;
  let outputStartedAt = 0;
  let reasoningTokens = 0;
  let responseTokens = 0;
  let content = '';
  let reasoningContent = '';
  let finishReason: ChatCompletionResponse['choices'][number]['finish_reason'] = null;
  let usage: ChatCompletionResponse['usage'] | undefined;
  let id = '';
  let created = 0;
  let model = '';
  const calls = new Map<number, ChatCompletionToolCall>();
  for await (const chunk of stream) {
    id = chunk.id || id;
    created = chunk.created || created;
    model = chunk.model || model;
    if (chunk.prompt_progress) {
      promptTotal = chunk.prompt_progress.total;
      promptProcessed = Math.min(promptTotal, chunk.prompt_progress.cache + chunk.prompt_progress.processed);
    }
    if (chunk.usage) {
      usage = chunk.usage;
      promptProcessed = chunk.usage.prompt_tokens;
      promptTotal = Math.max(promptTotal, promptProcessed);
    }
    for (const choice of chunk.choices) {
      if (choice.delta.content) {
        content += choice.delta.content;
        observedOutputChunks++;
        const inline = splitInlineReasoning(content);
        if (!reasoningContent && inline.reasoning && !inline.response) reasoningTokens++;
        else responseTokens++;
      }
      // Wllama's published chunk type omits this llama.cpp field, but the
      // runtime can still include it for models with a reasoning parser.
      const reasoning = (choice.delta as typeof choice.delta & { reasoning_content?: string | null }).reasoning_content;
      if (reasoning) { reasoningContent += reasoning; observedOutputChunks++; reasoningTokens++; }
      for (const delta of choice.delta.tool_calls || []) {
        const call = calls.get(delta.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
        calls.set(delta.index, call);
        observedOutputChunks++;
        responseTokens++;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    outputTokens = Math.max(observedOutputChunks, usage?.completion_tokens ?? 0);
    if (observedOutputChunks && !outputStartedAt) outputStartedAt = performance.now();
    const outputTokensPerSecond = outputStartedAt ? observedOutputChunks / Math.max(1, (performance.now() - outputStartedAt) / 1000) : 0;
    const live = reasoningContent ? { reasoning: reasoningContent, response: content } : splitInlineReasoning(content);
    const liveCalls = [...calls.values()].map(call => `Tool: ${call.function.name || 'function'}\n${call.function.arguments}`).join('\n\n');
    const responseText = [live.response, liveCalls].filter(Boolean).join('\n\n');
    onProgress({ promptProcessed, promptTotal, outputTokens, reasoningTokens, responseTokens, maxOutputTokens, outputEstimated: !usage || observedOutputChunks > usage.completion_tokens, outputTokensPerSecond, ...(live.reasoning ? { reasoningText: live.reasoning } : {}), ...(responseText ? { responseText } : {}) });
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter(call => call.function.name);
  return {
    id, object: 'chat.completion', created, model,
    choices: [{ index: 0, message: { role: 'assistant', content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason, logprobs: null }],
    usage: usage || { prompt_tokens: promptProcessed, completion_tokens: outputTokens, total_tokens: promptProcessed + outputTokens },
  };
}
