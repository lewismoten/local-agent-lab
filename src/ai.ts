import { browserComplete, type BrowserTools } from './browserModel';
import type { BrowserThinkingMode } from './browserThinking';
import { hasOllamaModel, listOllamaModels } from './modelAvailability';
import { noteLocalOllamaUse } from './localOllama.ts';
import { withLocalModelMemory } from './localModelMemory.ts';

export type Provider = 'browser' | 'openai' | 'codex' | 'compatible' | 'ollama' | 'anthropic' | 'gemini';
export type AIConfig = {
  id: string; label: string; provider: Provider; model: string; endpoint: string; apiKey: string;
  effort: 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  thinkingTokens: number; maxOutputTokens: number; contextWindow: number;
  browserThinkingMode?: BrowserThinkingMode;
  runtimePreset?: 'bonsai2';
};
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type Completion = { text: string; inputTokens?: number; outputTokens?: number; toolEvents?: string[] };
export const DEFAULT_PROFILES: AIConfig[] = [
  { id: 'browser', label: 'Browser · private GGUF', provider: 'browser', model: '', endpoint: '', apiKey: '', effort: 'default', thinkingTokens: 0, browserThinkingMode: 'none', maxOutputTokens: 512, contextWindow: 4096 },
  { id: 'ollama', label: 'Local Ollama', provider: 'ollama', model: '', endpoint: 'http://localhost:11434', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 2048, contextWindow: 8192 },
  { id: 'openai', label: 'OpenAI', provider: 'openai', model: 'gpt-6.1-sol', endpoint: 'https://api.openai.com/v1', apiKey: '', effort: 'medium', thinkingTokens: 0, maxOutputTokens: 4096, contextWindow: 32768 },
  { id: 'codex', label: 'Codex model · OpenAI API', provider: 'codex', model: 'gpt-6.1-sol', endpoint: 'https://api.openai.com/v1', apiKey: '', effort: 'medium', thinkingTokens: 0, maxOutputTokens: 4096, contextWindow: 32768 },
  { id: 'compatible', label: 'Local OpenAI-compatible', provider: 'compatible', model: '', endpoint: 'http://localhost:1234/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 2048, contextWindow: 8192 },
  { id: 'bonsai2', label: 'Bonsai 2 · local server', provider: 'compatible', model: 'bonsai-2-2b', endpoint: 'http://localhost:8080/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 2048, contextWindow: 8192, runtimePreset: 'bonsai2' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', model: '', endpoint: 'https://api.anthropic.com/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 4096, contextWindow: 32768 },
  { id: 'gemini', label: 'Gemini', provider: 'gemini', model: '', endpoint: 'https://generativelanguage.googleapis.com/v1beta', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 4096, contextWindow: 32768 },
];
const SYSTEM = "You are a careful story-development collaborator. Create original material. Do not imitate any named creator's style or reproduce protected story elements. Treat influence descriptions as high-level preferences only. Maintain consistency with the supplied canon. Return only the requested content, without commentary.";
const trimUrl = (url: string) => url.replace(/\/$/, '');
async function jsonResponse(response: Response) {
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  return response.json();
}
export async function complete(config: AIConfig, turns: ChatTurn[], system = SYSTEM, signal?: AbortSignal, browserTools?: BrowserTools): Promise<Completion> {
  if (config.provider === 'ollama') return withLocalModelMemory(async () => {
    await (await import('./browserImage.ts')).unloadBrowserImageModel();
    await (await import('./browserModel.ts')).unloadBrowserModel();
    await (await import('./needleRuntime.ts')).unloadNeedle();
    return completeInternal(config, turns, system, signal, browserTools);
  });
  return completeInternal(config, turns, system, signal, browserTools);
}
async function completeInternal(config: AIConfig, turns: ChatTurn[], system: string, signal?: AbortSignal, browserTools?: BrowserTools): Promise<Completion> {
  if (config.provider === 'browser') {
    return browserComplete(config, turns, system, signal, browserTools);
  }
  if (!config.model.trim()) throw new Error('Choose a model in Settings & AI.');
  if (['openai', 'codex', 'anthropic', 'gemini'].includes(config.provider) && !config.apiKey) throw new Error('Enter an API key for this provider in Settings & AI.');
  const base = trimUrl(config.endpoint);
  let response: Response;
  if (config.provider === 'openai' || config.provider === 'codex') {
    response = await fetch(base + '/responses', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model, instructions: system,
        input: turns.map(x => ({ role: x.role, content: x.content })),
        max_output_tokens: config.maxOutputTokens, store: false,
        ...(config.effort !== 'default' ? { reasoning: { effort: config.effort } } : {}),
      }),
    });
    const body = await jsonResponse(response);
    const text = body.output?.flatMap((item: { type: string; content?: { type: string; text?: string }[] }) =>
      item.type === 'message' ? (item.content || []).filter(x => x.type === 'output_text').map(x => x.text || '') : []).join('\n').trim();
    if (!text) throw new Error('The model returned no text. Check model access and output token limit.');
    return { text, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens };
  }
  if (config.provider === 'compatible') {
    const bonsai2 = config.runtimePreset === 'bonsai2';
    const thinking = bonsai2 && config.thinkingTokens > 0;
    response = await fetch(base + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model, messages: [{ role: 'system', content: system }, ...turns],
        max_tokens: config.maxOutputTokens,
        ...(bonsai2 ? { chat_template_kwargs: { enable_thinking: thinking }, temperature: thinking ? 1.0 : 0.7, top_p: thinking ? 0.95 : 0.8, top_k: 20, min_p: 0, presence_penalty: thinking ? 1.0 : 1.5, repeat_penalty: 1.0 } : {}),
        ...(config.effort !== 'default' ? { reasoning_effort: config.effort } : {}),
      }),
    });
    const body = await jsonResponse(response);
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The model returned no text.');
    return { text: text.trim(), inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens };
  }
  if (config.provider === 'ollama') {
    let installed: string[];
    try { installed = await listOllamaModels(base, signal); }
    catch (error) { throw new Error(`Could not check Ollama at ${base}. Start Ollama or check browser access and CORS. ${error instanceof Error ? error.message : String(error)}`); }
    if (!hasOllamaModel(installed, config.model)) throw new Error(`Ollama model “${config.model}” is not installed. Choose an installed model in Settings & AI${installed.length ? ` (${installed.join(', ')})` : ', or install one in Ollama'}.`);
    response = await fetch(base + '/api/chat', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model, stream: false,
        messages: [{ role: 'system', content: system }, ...turns],
        options: { num_predict: config.maxOutputTokens, num_ctx: config.contextWindow },
        ...(config.thinkingTokens > 0 ? { think: true } : {}),
      }),
    });
    const body = await jsonResponse(response);
    const text = body.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Ollama returned no text.');
    noteLocalOllamaUse(base, config.model);
    return { text: text.trim(), inputTokens: body.prompt_eval_count, outputTokens: body.eval_count };
  }
  if (config.provider === 'anthropic') {
    response = await fetch(base + '/messages', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: config.model, max_tokens: config.maxOutputTokens, system,
        messages: turns,
        ...(config.thinkingTokens > 0 ? { thinking: { type: 'enabled', budget_tokens: config.thinkingTokens } } : {}),
      }),
    });
    const body = await jsonResponse(response);
    const text = body.content?.filter((x: { type: string }) => x.type === 'text').map((x: { text: string }) => x.text).join('\n');
    if (!text) throw new Error('Anthropic returned no text.');
    return { text, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens };
  }
  response = await fetch(base + '/models/' + encodeURIComponent(config.model) + ':generateContent', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
      generationConfig: {
        maxOutputTokens: config.maxOutputTokens,
        ...(config.thinkingTokens > 0 ? { thinkingConfig: { thinkingBudget: config.thinkingTokens } } : {}),
      },
    }),
  });
  const body = await jsonResponse(response);
  const text = body.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || '').join('\n');
  if (!text) throw new Error('Gemini returned no text.');
  return { text, inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: body.usageMetadata?.candidatesTokenCount };
}
export async function generate(config: AIConfig, prompt: string): Promise<string> {
  return (await complete(config, [{ role: 'user', content: prompt }])).text;
}
export function parseJson<T>(text: string): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean) as T;
}
