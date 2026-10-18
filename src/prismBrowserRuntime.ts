import type { ChatCompletionMessage, ChatCompletionResponse, ChatCompletionTool } from './browserEngineTypes';
import type { ProbeTokenProgress } from './probeStream';
import { loadPrismModule } from './prismEngine';
import { BONSAI_2_Q2_BROWSER_WARNING } from './modelCompatibility';
import { runSerialGeneration, waitForSerialGeneration } from './serialGeneration';
import { detectThinkingSpillover, type ThinkingSpillover } from './thinkingSpillover';
import { parsePrismToolCalls } from './prismTools';

type PrismMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; images?: Blob[]; toolCalls?: { name: string; arguments?: Record<string, unknown> }[] };
type PrismEvent = { type: 'token'; phase: 'think' | 'answer'; text: string } | { type: 'done'; reason: string; stats: { promptTokens: number; newTokens: number; thinkTokens?: number } };
type PrismModel = {
  info: { name?: string; contextLength?: number };
  gguf: { metadata?: Record<string, unknown> };
  encode: (text: string) => number[];
  chat: (messages: PrismMessage[], options: Record<string, unknown>) => AsyncGenerator<PrismEvent>;
  hasVision: boolean;
  dispose: () => void | Promise<void>;
};
let model: PrismModel | null = null;
export const hasPrismBrowserModel = () => model !== null;
export const hasPrismBrowserVision = () => model?.hasVision === true;
export function prismTrainingContext(metadata: Record<string, unknown>): number | undefined {
  const architecture = metadata['general.architecture'];
  const keys = [typeof architecture === 'string' ? `${architecture}.context_length` : '', 'general.context_length'];
  for (const key of keys) {
    const value = metadata[key];
    const numeric = typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string' ? Number(value) : NaN;
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}
export function prismModelMetadata() {
  if (!model) return null;
  const meta = model.gguf.metadata || {};
  return { meta, hparams: { nCtxTrain: prismTrainingContext(meta) } };
}
export async function unloadPrismBrowserModel() {
  const old = model; model = null;
  await waitForSerialGeneration();
  await old?.dispose();
}
export async function loadPrismBrowserModel(folder: FileSystemDirectoryHandle, file: File, contextLength: number, onProgress: (message: string) => void, projector?: File) {
  const module = await loadPrismModule(folder, onProgress);
  let instance: PrismModel;
  try {
    instance = await module.Bonsai.load({
      model: file, ...(projector ? { mmproj: projector } : {}), contextLength,
      onProgress: (progress: { stage: string; loaded?: number; total?: number; message?: string }) => onProgress(
        progress.total ? `${progress.stage} · ${Math.round((progress.loaded || 0) / progress.total * 100)}%` : progress.message || progress.stage,
      ),
    }) as PrismModel;
  } catch (error) {
    if (/token_embd\.weight: unsupported GGML type 42 for a dense weight/i.test(error instanceof Error ? error.message : String(error))) throw new Error(BONSAI_2_Q2_BROWSER_WARNING, { cause: error });
    throw error;
  }
  if (projector && !instance.hasVision) {
    await instance.dispose();
    throw new Error('The PrismML engine did not load the vision projector.');
  }
  model = instance;
}
export async function prismVisionCompletion(image: Blob, prompt: string, maxTokens: number, signal?: AbortSignal): Promise<ChatCompletionResponse> {
  return runSerialGeneration(async () => {
  const currentModel = model;
  if (!currentModel?.hasVision) throw new Error('Load Bonsai 2 with its vision projector first.');
  let answer = '';
  let outputTokens = 0;
  let promptTokens = 0;
  let finishReason: 'stop' | 'length' = 'stop';
  for await (const event of currentModel.chat([{ role: 'user', content: prompt, images: [image] }], { thinking: false, maxNewTokens: maxTokens, signal })) {
    if (event.type === 'done') {
      promptTokens = event.stats.promptTokens;
      outputTokens = event.stats.newTokens;
      finishReason = event.reason === 'length' || event.reason === 'context_full' ? 'length' : 'stop';
    } else if (event.phase === 'answer') {
      answer += event.text;
    }
  }
  return { choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens } } as ChatCompletionResponse;
  }, signal);
}
export async function prismChatCompletion(params: {
  messages: ChatCompletionMessage[]; max_tokens: number; abortSignal?: AbortSignal;
  tools?: ChatCompletionTool[]; chat_template_kwargs?: Record<string, unknown>; temperature?: number; top_p?: number; seed?: number;
}, onProgress?: (progress: ProbeTokenProgress) => void): Promise<ChatCompletionResponse & { thinkingSpillover?: ThinkingSpillover }> {
  return runSerialGeneration(async () => {
  const currentModel = model;
  if (!currentModel) throw new Error('Load Bonsai 2 first.');
  const messages: PrismMessage[] = params.messages.map(message => ({
    role: message.role as PrismMessage['role'], content: typeof message.content === 'string' ? message.content : '',
    ...(message.role === 'assistant' && message.tool_calls?.length ? { toolCalls: message.tool_calls.flatMap(call => {
      try { return [{ name: call.function.name, arguments: JSON.parse(call.function.arguments) as Record<string, unknown> }]; }
      catch { return []; }
    }) } : {}),
  }));
  const thinking = params.chat_template_kwargs?.enable_thinking === true;
  const budget = Number(params.chat_template_kwargs?.thinking_budget) || Math.floor(params.max_tokens * 0.5);
  let answer = '';
  let reasoning = '';
  let outputTokens = 0;
  let thinkTokens = 0;
  let promptTokens = 0;
  let finishReason = 'stop';
  const started = performance.now();
  for await (const event of currentModel.chat(messages, {
    thinking, thinkingBudget: thinking ? budget : 0, maxNewTokens: params.max_tokens,
    signal: params.abortSignal, tools: params.tools,
    sampling: { temperature: params.temperature ?? 0.7, topP: params.top_p ?? 0.95, ...(params.seed !== undefined ? { seed: params.seed } : {}) },
  })) {
    if (event.type === 'done') {
      promptTokens = event.stats.promptTokens;
      outputTokens = event.stats.newTokens;
      thinkTokens = event.stats.thinkTokens ?? thinkTokens;
      finishReason = event.reason === 'length' || event.reason === 'context_full' ? 'length' : 'stop';
    } else {
      outputTokens++;
      if (event.phase === 'think') { reasoning += event.text; thinkTokens++; }
      else answer += event.text;
      onProgress?.({ promptProcessed: 0, promptTotal: 0, outputTokens, reasoningTokens: thinkTokens, responseTokens: outputTokens - thinkTokens, maxOutputTokens: params.max_tokens, outputEstimated: false, outputTokensPerSecond: outputTokens / Math.max(0.001, (performance.now() - started) / 1000), reasoningText: reasoning, responseText: answer, visibleText: answer });
    }
  }
  const calls = parsePrismToolCalls(answer, params.tools);
  const visible = calls.length ? answer.replace(/<tool_call>\s*[\s\S]*?<\/tool_call>/g, '').trim() : answer.trim();
  const thinkingSpillover = thinking ? detectThinkingSpillover({ reasoning, visible, reasoningTokens: thinkTokens, thinkingBudgetTokens: budget, finishReason }) : null;
  return {
    choices: [{ index: 0, finish_reason: calls.length && finishReason === 'stop' ? 'tool_calls' : finishReason as 'stop' | 'length', message: { role: 'assistant', content: visible, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.length ? { tool_calls: calls } : {}) } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens },
    ...(thinkingSpillover ? { thinkingSpillover } : {}),
  } as ChatCompletionResponse & { thinkingSpillover?: ThinkingSpillover };
  }, params.abortSignal);
}
