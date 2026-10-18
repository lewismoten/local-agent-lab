// App-facing shape of the optional Wllama runtime. No engine package is needed
// during npm install; the browser downloads the pinned runtime on demand.
export type ChatCompletionToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatCompletionTool = { type: 'function'; function: { name: string; description?: string; parameters?: { type: 'object'; properties: Record<string, { type: string; description?: string }>; required?: string[] } } };
export type ChatCompletionMessage =
  | { role: 'system' | 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image'; data: ArrayBuffer })[] }
  | { role: 'assistant'; content?: string | null; tool_calls?: ChatCompletionToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };
export type ChatCompletionUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
export type ChatCompletionResponse = {
  id: string; object: 'chat.completion'; created: number; model: string;
  choices: { index: number; message: { role: 'assistant'; content?: string | null; reasoning_content?: string | null; tool_calls?: ChatCompletionToolCall[] }; finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null; logprobs: null }[];
  usage: ChatCompletionUsage;
};
export type ChatCompletionChunk = {
  id: string; created: number; model: string;
  choices: { delta: { content?: string | null; reasoning_content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason: ChatCompletionResponse['choices'][number]['finish_reason'] }[];
  usage?: ChatCompletionUsage | null;
  prompt_progress?: { total: number; cache: number; processed: number };
};
export type BrowserChatOptions = {
  messages: ChatCompletionMessage[]; max_tokens: number; abortSignal?: AbortSignal;
  stream?: boolean; return_progress?: boolean; cache_prompt?: boolean; tools?: ChatCompletionTool[]; tool_choice?: 'auto' | 'required';
  chat_template_kwargs?: Record<string, unknown>; temperature?: number; top_p?: number; min_p?: number; seed?: number; grammar?: string;
};
export type BrowserModelMetadata = { meta: Record<string, string>; hparams: { nCtxTrain: number; [key: string]: unknown } };
export interface Wllama {
  setCompat(compat: null): void;
  loadModel(files: Blob[], options: Record<string, unknown>): Promise<void>;
  createChatCompletion(options: BrowserChatOptions & { stream: true }): Promise<AsyncIterable<ChatCompletionChunk>>;
  createChatCompletion(options: BrowserChatOptions & { stream?: false }): Promise<ChatCompletionResponse>;
  getModelMetadata(): BrowserModelMetadata;
  exit(): Promise<void>;
}
export type WllamaConstructor = new (paths: { default: string }, config?: { suppressNativeLog?: boolean; logger?: { debug: (...args: unknown[]) => void; log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } }) => Wllama;
