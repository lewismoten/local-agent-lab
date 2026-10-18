import type { AIConfig, ChatTurn, Completion, DeferredToolCall, LiveCompletionProgress } from './ai.ts';
import type { BrowserTools } from './browserModel.ts';
import { hasOllamaModel, listOllamaModels } from './modelAvailability.ts';
import { noteLocalOllamaUse } from './localOllama.ts';
import { createToolResultLimiter, toolResultBudget } from './toolResultBudget.ts';
import { streamOllamaChat } from './ollamaChatStream.ts';
import { assertExecutableToolCalls } from './browserInference.ts';
import { unsupportedToolDiagnostic } from './harnessToolDiagnostics.ts';

type ToolRequest = { id: string; name: string; arguments: unknown };
type ToolResult = { id: string; name: string; content: string };
const MAX_ROUNDS = 6;
const MAX_CALLS = 12;
const MAX_RESULT_CHARS = 12000;
const trimUrl = (url: string) => url.replace(/\/$/, '');

function objectArguments(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value || '{}') : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be an object.');
  return parsed as Record<string, unknown>;
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 350)}`);
  return response.json();
}

export async function remoteToolComplete(config: AIConfig, turns: ChatTurn[], system: string, signal: AbortSignal | undefined, tools: BrowserTools, onTokenProgress?: (progress: LiveCompletionProgress) => void): Promise<Completion> {
  const base = trimUrl(config.endpoint);
  const toolEvents: string[] = [];
  const limitToolResult = createToolResultLimiter(toolResultBudget(config.contextWindow, config.maxOutputTokens, system, turns, tools.definitions));
  let callCount = 0, inputTokens = 0, outputTokens = 0;
  const consume = async (calls: ToolRequest[]): Promise<{ results: ToolResult[]; deferred: DeferredToolCall[] }> => {
    assertExecutableToolCalls(calls.length, undefined, signal);
    if (callCount + calls.length > MAX_CALLS) throw new Error('The model reached the tool-call limit. Ask a narrower question.');
    callCount += calls.length;
    const results: ToolResult[] = [], deferred: DeferredToolCall[] = [];
    for (const call of calls) {
      assertExecutableToolCalls(1, undefined, signal);
      const unsupported = !tools.definitions.some(item => item.function.name === call.name);
      let content: string;
      try {
        if (unsupported) throw new Error(`Unknown tool: ${call.name}`);
        const args = objectArguments(call.arguments);
        if (tools.deferredNames?.includes(call.name)) {
          if (deferred.length >= 2) throw new Error('Request at most two images at once.');
          deferred.push({ name: call.name, arguments: args });
          continue;
        }
        content = await tools.execute(call.name, args);
      } catch (error) {
        if (signal?.aborted) throw error;
        content = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      content = limitToolResult(content);
      toolEvents.push(unsupported ? `${unsupportedToolDiagnostic(call.name, call.arguments)} · ${content}` : `${call.name}: ${content}`);
      results.push({ id: call.id, name: call.name, content });
    }
    return { results, deferred };
  };
  const finished = (text: unknown, deferred: DeferredToolCall[] = []): Completion => {
    const visible = typeof text === 'string' ? text.trim() : '';
    if (!visible && !deferred.length) throw new Error('The model returned no text after using tools.');
    const continuation = deferred.length && toolEvents.length ? `${visible}\n\nCompleted tool results:\n${toolEvents.slice(-3).join('\n').slice(0, MAX_RESULT_CHARS)}`.trim() : visible;
    return { text: continuation, inputTokens, outputTokens, toolEvents, ...(deferred.length ? { deferredToolCalls: deferred } : {}) };
  };

  if (config.provider === 'openai' || config.provider === 'codex') {
    const input: Record<string, unknown>[] = turns.map(turn => ({ role: turn.role, content: turn.content }));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const definitions = tools.definitions.map(item => ({ type: 'function', name: item.function.name, description: item.function.description, parameters: item.function.parameters, strict: false }));
      const body = await post(base + '/responses', { Authorization: `Bearer ${config.apiKey}` }, {
        model: config.model, instructions: system, input, tools: round === MAX_ROUNDS - 1 ? [] : definitions,
        max_output_tokens: config.maxOutputTokens, store: false,
        ...(config.effort !== 'default' ? { reasoning: { effort: config.effort } } : {}),
      }, signal);
      inputTokens += body.usage?.input_tokens || 0; outputTokens += body.usage?.output_tokens || 0;
      const output = Array.isArray(body.output) ? body.output : [];
      const text = output.flatMap((item: any) => item.type === 'message' ? (item.content || []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text || '') : []).join('\n');
      const calls: ToolRequest[] = output.filter((item: any) => item.type === 'function_call').map((item: any) => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
      assertExecutableToolCalls(calls.length, body.status, signal);
      if (!calls.length) return finished(text);
      if (round === MAX_ROUNDS - 1) throw new Error('The model reached the tool-call limit.');
      input.push(...output);
      const { results, deferred } = await consume(calls);
      if (deferred.length) return finished(text, deferred);
      input.push(...results.map(result => ({ type: 'function_call_output', call_id: result.id, output: result.content })));
    }
  }

  if (config.provider === 'compatible' || config.provider === 'ollama') {
    const messages: Record<string, unknown>[] = [{ role: 'system', content: system }, ...turns];
    const ollama = config.provider === 'ollama';
    if (ollama) {
      let installed: string[];
      try { installed = await listOllamaModels(base, signal); }
      catch (error) { throw new Error(`Could not check Ollama at ${base}. Start Ollama or check browser access and CORS. ${error instanceof Error ? error.message : String(error)}`); }
      if (!hasOllamaModel(installed, config.model)) throw new Error(`Ollama model “${config.model}” is not installed. Choose an installed model in Settings & AI.`);
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round > 0 && ollama) onTokenProgress?.({ promptProcessed: 0, promptTotal: 0, outputTokens: 0, maxOutputTokens: config.maxOutputTokens, outputTokensPerSecond: 0, visibleText: '' });
      const useTools = round < MAX_ROUNDS - 1;
      const bonsai2 = config.runtimePreset === 'bonsai2';
      const thinking = bonsai2 && config.thinkingTokens > 0;
      const ollamaBody = ollama ? await streamOllamaChat(base, {
        model: config.model, messages, options: { num_predict: config.maxOutputTokens, num_ctx: config.contextWindow },
        ...(config.thinkingTokens > 0 ? { think: true } : {}), ...(useTools ? { tools: tools.definitions } : {}),
      }, signal, onTokenProgress) : null;
      const compatibleBody = !ollama ? await post(base + '/chat/completions', config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, {
        model: config.model, messages, max_tokens: config.maxOutputTokens,
        ...(bonsai2 ? { chat_template_kwargs: { enable_thinking: thinking }, temperature: thinking ? 1.0 : 0.7, top_p: thinking ? 0.95 : 0.8, top_k: 20, min_p: 0, presence_penalty: thinking ? 1.0 : 1.5, repeat_penalty: 1.0 } : {}),
        ...(config.effort !== 'default' ? { reasoning_effort: config.effort } : {}),
        ...(useTools ? { tools: tools.definitions, tool_choice: 'auto' } : {}),
      }, signal) : null;
      inputTokens += ollamaBody?.prompt_eval_count || compatibleBody?.usage?.prompt_tokens || 0;
      outputTokens += ollamaBody?.eval_count || compatibleBody?.usage?.completion_tokens || 0;
      const message = ollamaBody?.message || compatibleBody?.choices?.[0]?.message;
      const calls: ToolRequest[] = (message?.tool_calls || []).map((item: any, index: number) => ({ id: item.id || `call_${round}_${index}`, name: item.function?.name, arguments: item.function?.arguments }));
      assertExecutableToolCalls(calls.length, ollamaBody?.done_reason || compatibleBody?.choices?.[0]?.finish_reason, signal);
      if (!calls.length) { if (ollama) noteLocalOllamaUse(base, config.model); return finished(message?.content); }
      if (!useTools) throw new Error('The model reached the tool-call limit.');
      messages.push({ ...message, role: 'assistant' });
      const { results, deferred } = await consume(calls);
      if (deferred.length) return finished(message?.content, deferred);
      messages.push(...results.map(result => ollama ? { role: 'tool', tool_name: result.name, content: result.content } : { role: 'tool', tool_call_id: result.id, content: result.content }));
    }
  }

  if (config.provider === 'anthropic') {
    const messages: Record<string, unknown>[] = turns.map(turn => ({ role: turn.role, content: turn.content }));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const definitions = tools.definitions.map(item => ({ name: item.function.name, description: item.function.description, input_schema: item.function.parameters }));
      const body = await post(base + '/messages', { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, {
        model: config.model, max_tokens: config.maxOutputTokens, system, messages,
        ...(config.thinkingTokens > 0 ? { thinking: { type: 'enabled', budget_tokens: config.thinkingTokens } } : {}),
        ...(round < MAX_ROUNDS - 1 ? { tools: definitions } : {}),
      }, signal);
      inputTokens += body.usage?.input_tokens || 0; outputTokens += body.usage?.output_tokens || 0;
      const content = Array.isArray(body.content) ? body.content : [];
      const text = content.filter((item: any) => item.type === 'text').map((item: any) => item.text || '').join('\n');
      const calls: ToolRequest[] = content.filter((item: any) => item.type === 'tool_use').map((item: any) => ({ id: item.id, name: item.name, arguments: item.input }));
      assertExecutableToolCalls(calls.length, body.stop_reason, signal);
      if (!calls.length) return finished(text);
      if (round === MAX_ROUNDS - 1) throw new Error('The model reached the tool-call limit.');
      messages.push({ role: 'assistant', content });
      const { results, deferred } = await consume(calls);
      if (deferred.length) return finished(text, deferred);
      messages.push({ role: 'user', content: results.map(result => ({ type: 'tool_result', tool_use_id: result.id, content: result.content })) });
    }
  }

  if (config.provider === 'gemini') {
    const contents: Record<string, unknown>[] = turns.map(turn => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] }));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const declarations = tools.definitions.map(item => ({ name: item.function.name, description: item.function.description, parameters: item.function.parameters }));
      const body = await post(base + '/models/' + encodeURIComponent(config.model) + ':generateContent', { 'x-goog-api-key': config.apiKey }, {
        systemInstruction: { parts: [{ text: system }] }, contents,
        ...(round < MAX_ROUNDS - 1 ? { tools: [{ functionDeclarations: declarations }] } : {}),
        generationConfig: { maxOutputTokens: config.maxOutputTokens, ...(config.thinkingTokens > 0 ? { thinkingConfig: { thinkingBudget: config.thinkingTokens } } : {}) },
      }, signal);
      inputTokens += body.usageMetadata?.promptTokenCount || 0; outputTokens += body.usageMetadata?.candidatesTokenCount || 0;
      const parts = body.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((item: any) => typeof item.text === 'string').map((item: any) => item.text).join('\n');
      const calls: ToolRequest[] = parts.filter((item: any) => item.functionCall).map((item: any, index: number) => ({ id: `call_${round}_${index}`, name: item.functionCall.name, arguments: item.functionCall.args }));
      assertExecutableToolCalls(calls.length, body.candidates?.[0]?.finishReason, signal);
      if (!calls.length) return finished(text);
      if (round === MAX_ROUNDS - 1) throw new Error('The model reached the tool-call limit.');
      contents.push({ role: 'model', parts });
      const { results, deferred } = await consume(calls);
      if (deferred.length) return finished(text, deferred);
      contents.push({ role: 'user', parts: results.map(result => ({ functionResponse: { name: result.name, response: { result: result.content } } })) });
    }
  }
  throw new Error('The model reached the tool-call limit. Ask a narrower question.');
}
