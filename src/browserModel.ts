import type { ChatCompletionMessage, ChatCompletionResponse, ChatCompletionTool, Wllama } from './browserEngineTypes';
import type { AIConfig, ChatTurn, Completion, InferenceRound, LiveCompletionProgress } from './ai';
import { readBlob } from './storage';
import { unsupportedToolDiagnostic } from './harnessToolDiagnostics';
import { incompleteModels } from './modelDownload';
import { assertModelLicenseFiles, assertVisionProjectorLicenseFiles, catalogModelForPath, hasGemmaConsent, hasQwenResearchConsent } from './modelLicenses';
import { assertExecutableToolCalls, completedMachineConclusion, gemmaBrowserMessages, isFiveMinutesAnswer, liveBrowserAnswer, scorePromptedSteps, scoreStructuredToolUse, qwen35ChatOptions, qwen35LoadOptions, visibleBrowserText, visibleReasoningEnvelope } from './browserInference';
import { BONSAI_2_Q2_BROWSER_WARNING, GRANITE_40_WARNING, isBonsai2BrowserUnsupported, isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility';
import { collectProbeStream, splitInlineReasoning, type ProbeTokenProgress } from './probeStream';
import { GRANITE_COUNT_LETTERS_GRAMMAR, GRANITE_TOOL_TEMPERATURE, graniteToolMessages, normalizeGraniteToolResponse } from './graniteTools';
import { browserThinkingBudget, browserThinkingOptions } from './browserThinking';
import { hasPrismBrowserModel, hasPrismBrowserVision, loadPrismBrowserModel, prismChatCompletion, prismModelMetadata, prismVisionCompletion, unloadPrismBrowserModel } from './prismBrowserRuntime';
import { assertPrismEngineFiles } from './prismEngine';
import { assertWllamaEngineFiles, loadWllamaModule } from './wllamaEngine';
import type { PhotoKeywordResult, VisionFixture } from './visionFixtures';
import type { CropCorners } from './visionCrop';
import { detectThinkingSpillover, type ThinkingSpillover } from './thinkingSpillover';
import { browserContextWindow } from './browserContext';
import { notifyResidentModelUnloaded, registerResidentModel, withLocalModelMemory } from './localModelMemory.ts';
import { createToolResultLimiter, toolResultBudget } from './toolResultBudget.ts';
import { snapshotInference } from './inferenceTrace.ts';

export type BrowserTools = {
  definitions: ChatCompletionTool[];
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
  deferredNames?: string[];
};
export type BrowserModelStatus = { state: 'empty' | 'loading' | 'ready' | 'error'; path: string; message: string; contextWindow?: number; thinkingBudgetTokens?: number };
let engine: Wllama | null = null;
let wllamaWasmUrl: string | null = null;
let engineFolder: FileSystemDirectoryHandle | null = null;
let nativeError = '';
let visionProjectorLoaded = false;
let status: BrowserModelStatus = { state: 'empty', path: '', message: 'No model loaded' };
registerResidentModel('text', () => !!engine || hasPrismBrowserModel(), unloadBrowserModel);
const listeners = new Set<() => void>();
const publish = (next: BrowserModelStatus) => { status = next; listeners.forEach(listener => listener()); };
export const getBrowserModelStatus = () => status;
export const isBrowserVisionReady = (path: string) => visionProjectorLoaded && (!!engine || hasPrismBrowserVision()) && status.state === 'ready' && status.path === path;
export type VisionProbeResult = { id: string; title: string; prompt: string; expected: string; answer: string; status: 'passed' | 'failed' | 'inconclusive'; detail: string; outputTokens?: number; sizeResults?: { sizePx: number; words: string[]; matched: string[] }[]; keywordResults?: PhotoKeywordResult[]; cropCorners?: CropCorners };
export function probeBrowserVision(path: string, fixtures: VisionFixture[], maxTokens: number, onResult: (result: VisionProbeResult, index: number) => void, signal?: AbortSignal) {
  return withLocalModelMemory(() => probeBrowserVisionInternal(path, fixtures, maxTokens, onResult, signal));
}
async function probeBrowserVisionInternal(path: string, fixtures: VisionFixture[], maxTokens: number, onResult: (result: VisionProbeResult, index: number) => void, signal?: AbortSignal) {
  if (!isBrowserVisionReady(path) || !engineFolder) throw new Error('Load this model with its vision projector first.');
  await assertModelLicenseFiles(engineFolder, path);
  const catalog = catalogModelForPath(path);
  if (catalog?.visionProjector) await assertVisionProjectorLicenseFiles(engineFolder, catalog);
  const results: VisionProbeResult[] = [];
  for (const [index, fixture] of fixtures.entries()) {
    if (signal?.aborted) throw new DOMException('Vision tests stopped.', 'AbortError');
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'image' as const, data: await fixture.blob.arrayBuffer() }, { type: 'text' as const, text: fixture.prompt }] }], max_tokens: Math.max(128, Math.min(512, maxTokens)), abortSignal: signal };
    let result: VisionProbeResult;
    try {
      const response = hasPrismBrowserVision()
        ? await prismVisionCompletion(fixture.blob, fixture.prompt, input.max_tokens, signal)
        : await createBrowserChatCompletion(input);
      const answer = visibleBrowserText(response.choices[0]?.message.content);
      const finished = response.choices[0]?.finish_reason !== 'length';
      const analysis = fixture.analyze?.(answer);
      const passed = analysis ? analysis.passed : fixture.score(answer);
      result = { id: fixture.id, title: fixture.title, prompt: fixture.prompt, expected: fixture.expected, answer,
        status: !answer || !finished ? 'inconclusive' : passed ? 'passed' : 'failed',
        detail: !answer ? 'No visible answer.' : !finished ? 'Output limit reached before a complete answer.' : analysis ? analysis.detail : passed ? 'Expected details found in the response.' : 'Expected details were not found in the response.',
        outputTokens: response.usage?.completion_tokens, ...(analysis ? { sizeResults: analysis.sizeResults, keywordResults: analysis.keywordResults, cropCorners: analysis.cropCorners } : {}) };
    } catch (error) {
      if (signal?.aborted) throw error;
      result = { id: fixture.id, title: fixture.title, prompt: fixture.prompt, expected: fixture.expected, answer: '', status: 'inconclusive', detail: probeError(error) };
      if (getBrowserModelStatus().state === 'error') { results.push(result); onResult(result, index); break; }
    }
    results.push(result);
    onResult(result, index);
  }
  return results;
}
export const isBrowserModelLoadedFrom = (folder: FileSystemDirectoryHandle, path: string, contextWindow: number, thinkingBudgetTokens = 0) =>
  (engine !== null || hasPrismBrowserModel()) && engineFolder === folder && status.state === 'ready' && status.path === path && status.contextWindow === browserContextWindow(path, contextWindow) && (status.thinkingBudgetTokens ?? 0) === Math.max(0, Math.floor(thinkingBudgetTokens));
export function getLoadedBrowserMetadata() {
  if (hasPrismBrowserModel() && status.state === 'ready') return prismModelMetadata() as ReturnType<Wllama['getModelMetadata']>;
  if (!engine || status.state !== 'ready') return null;
  return engine.getModelMetadata();
}
export const subscribeBrowserModel = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

type ProbeTrace = { input: Record<string, unknown>; output?: unknown; error?: string; tokenUsage?: Pick<ProbeTokenProgress, 'outputTokens' | 'reasoningTokens' | 'responseTokens' | 'maxOutputTokens' | 'outputEstimated'> };
const probeOutput = (response: { choices: { message: unknown; finish_reason: unknown }[]; usage?: unknown; rawContent?: string; thinkingSpillover?: ThinkingSpillover }) => ({
  message: response.choices[0]?.message ?? null,
  ...(response.rawContent !== undefined ? { rawContent: response.rawContent } : {}),
  finishReason: response.choices[0]?.finish_reason ?? null,
  usage: response.usage ?? null,
  ...(response.thinkingSpillover ? { thinkingSpillover: response.thinkingSpillover } : {}),
});
const probeError = (error: unknown) => error instanceof Error ? error.message : String(error);
const generationBusy = (error: unknown) => /generation is already running/i.test(probeError(error));
const rethrowIfUnloaded = (error: unknown, signal?: AbortSignal) => { if (signal?.aborted || getBrowserModelStatus().state === 'error' || generationBusy(error)) throw error; };

type BrowserChatParams = { messages: ChatCompletionMessage[]; max_tokens: number; abortSignal?: AbortSignal; tools?: ChatCompletionTool[]; tool_choice?: 'auto' | 'required'; chat_template_kwargs?: Record<string, unknown>; temperature?: number; top_p?: number; min_p?: number; seed?: number; grammar?: string };
type BrowserChatResponse = ChatCompletionResponse & { rawContent?: string; thinkingSpillover?: ThinkingSpillover };
export type BrowserProbeProgress = ProbeTokenProgress & { step: string; testIndex: number; testCount: number; finishedTests: number; input: BrowserChatParams };
export type BrowserProbeResult = { key: 'text' | 'tools' | 'reasoningTask' | 'promptedSteps' | 'thinking' | 'thinkingAnswer'; status: 'passed' | 'failed' | 'inconclusive'; detail: string; trace?: ProbeTrace; warning?: 'thinking-spillover'; answerAccuracy?: 'passed' | 'failed'; argumentAccuracy?: 'passed' | 'failed' };
function graniteTransportParams(params: BrowserChatParams): BrowserChatParams {
  const { tools = [], tool_choice, ...rest } = params;
  return { ...rest, temperature: params.temperature ?? GRANITE_TOOL_TEMPERATURE, messages: graniteToolMessages(params.messages, tools, tool_choice) };
}
function isFatalRuntimeError(error: unknown) {
  const message = probeError(error);
  return /invalid typed array length|wllama has crashed|runtimeerror: unreachable|out of memory|std::bad_function_call|\(?abort\)?/i.test(message);
}
async function handleInferenceError(error: unknown): Promise<never> {
  if (!isFatalRuntimeError(error)) throw error;
  const path = status.path;
  const cause = nativeError || probeError(error);
  const granite4 = isKnownIncompatibleGranite(path);
  const detail = granite4
    ? GRANITE_40_WARNING
    : `Browser inference failed: ${cause}`;
  const failedEngine = engine;
  engine = null;
  visionProjectorLoaded = false;
  engineFolder = null;
  publish({ state: 'error', path, message: detail });
  await failedEngine?.exit().catch(() => {});
  if (wllamaWasmUrl) URL.revokeObjectURL(wllamaWasmUrl);
  wllamaWasmUrl = null;
  await unloadPrismBrowserModel().catch(() => {});
  throw new Error(`${detail} The model was unloaded.`);
}
async function createBrowserChatCompletion(params: BrowserChatParams, onProgress?: (progress: ProbeTokenProgress) => void): Promise<BrowserChatResponse> {
  if (!engine && !hasPrismBrowserModel()) throw new Error('Load a browser model first.');
  nativeError = '';
  try {
    const graniteTools = catalogModelForPath(status.path)?.id === 'granite41-3b' && !!params.tools?.length;
    const effective = graniteTools ? graniteTransportParams(params) : params;
    // Wllama can reuse the matching token prefix while this model remains
    // loaded. Multimodal inputs use their own runtime path and stay uncached.
    const wllamaOptions = { ...effective, cache_prompt: !effective.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image')) };
    const response = hasPrismBrowserModel()
      ? await prismChatCompletion({ ...effective, chat_template_kwargs: { ...effective.chat_template_kwargs, thinking_budget: status.thinkingBudgetTokens || 0 } }, onProgress)
      : onProgress
        ? await collectProbeStream(await engine!.createChatCompletion({ ...wllamaOptions, stream: true, return_progress: true }), params.max_tokens, onProgress)
        : await engine!.createChatCompletion(wllamaOptions);
    if (!graniteTools) return response;
    const rawContent = response.choices[0]?.message.content || '';
    return { ...normalizeGraniteToolResponse(response, params.tools || []), rawContent };
  } catch (error) {
    if (params.abortSignal?.aborted) throw error;
    return handleInferenceError(error);
  }
}

export function probeBrowserFeatures(path: string, onProgress: (progress: BrowserProbeProgress) => void, maxTestTokens = 1024, onResult?: (result: BrowserProbeResult) => void, signal?: AbortSignal) {
  return withLocalModelMemory(() => probeBrowserFeaturesInternal(path, onProgress, maxTestTokens, onResult, signal));
}
async function probeBrowserFeaturesInternal(path: string, onProgress: (progress: BrowserProbeProgress) => void, maxTestTokens: number, onResult?: (result: BrowserProbeResult) => void, signal?: AbortSignal) {
  if ((!engine && !hasPrismBrowserModel()) || status.state !== 'ready' || status.path !== path || !engineFolder) throw new Error('Load this model before testing its features.');
  await assertModelLicenseFiles(engineFolder, path);
  const options = catalogModelForPath(path)?.id === 'qwen35-2b' ? qwen35ChatOptions : {};
  const isQwen3 = catalogModelForPath(path)?.id === 'qwen3-17b';
  const isBonsai8b = catalogModelForPath(path)?.id === 'bonsai-8b';
  const probeSampling = { seed: 42 };
  const outputLimit = Math.max(128, Math.round(maxTestTokens) || 1024);
  let latestTokenUsage: ProbeTrace['tokenUsage'];
  const emitResult = (result: BrowserProbeResult) => {
    // A concurrent runtime request says nothing about the model's capabilities.
    if (result.trace?.error && generationBusy(result.trace.error)) result.status = 'inconclusive';
    if (result.trace && latestTokenUsage) result.trace.tokenUsage = latestTokenUsage;
    if (!signal?.aborted) onResult?.(result);
  };
  const testCount = catalogModelForPath(path)?.thinking === 'documented' ? 4 : 5;
  let finishedTests = 0;
  const runProbe = async (input: BrowserChatParams, step: string) => {
    if (signal?.aborted) throw new DOMException('Tests stopped.', 'AbortError');
    const testIndex = finishedTests + 1;
    let tokens: ProbeTokenProgress = { promptProcessed: 0, promptTotal: 0, outputTokens: 0, reasoningTokens: 0, responseTokens: 0, maxOutputTokens: input.max_tokens, outputEstimated: true, outputTokensPerSecond: 0 };
    const emit = () => onProgress({ step, testIndex, testCount, finishedTests, input: catalogModelForPath(path)?.id === 'granite41-3b' && input.tools?.length ? graniteTransportParams(input) : input, ...tokens });
    emit();
    try {
      return await createBrowserChatCompletion({ ...input, abortSignal: signal }, progress => { tokens = progress; emit(); });
    } finally {
      latestTokenUsage = { outputTokens: tokens.outputTokens, reasoningTokens: tokens.reasoningTokens, responseTokens: tokens.responseTokens, maxOutputTokens: tokens.maxOutputTokens, outputEstimated: tokens.outputEstimated };
      finishedTests++;
      emit();
    }
  };
  let textResult: 'confirmed' | 'inconclusive' = 'inconclusive';
  let textDetail = '';
  const textInput = { messages: [{ role: 'user' as const, content: 'Reply with one word: ready.' }], max_tokens: outputLimit, ...probeSampling, ...options };
  const textTrace: ProbeTrace = { input: textInput };
  try {
    const response = await runProbe(textInput, 'Testing a short text response…');
    textTrace.output = probeOutput(response);
    const choice = response.choices[0];
    textResult = visibleBrowserText(choice?.message.content) ? 'confirmed' : 'inconclusive';
    textDetail = textResult === 'confirmed' ? 'Visible text returned.' : `No visible text; finish reason: ${choice?.finish_reason || 'unknown'}; generated tokens: ${response.usage?.completion_tokens ?? 'unknown'}.`;
  } catch (error) {
    textDetail = probeError(error); textTrace.error = textDetail;
    rethrowIfUnloaded(error, signal);
  } finally {
    emitResult({ key: 'text', status: textResult === 'confirmed' ? 'passed' : textTrace.error ? 'failed' : 'inconclusive', detail: textDetail, trace: textTrace });
  }
  let toolsResult: 'confirmed' | 'text-only' | 'inconclusive' = 'inconclusive';
  let toolsDetail = '';
  let toolsArgumentAccuracy: 'passed' | 'failed' | undefined;
  const toolsInput = {
    messages: [{ role: 'user' as const, content: 'Use the provided count_letters function for the word apple. Return a structured function invocation, not a text answer.' }],
    tools: [{ type: 'function' as const, function: { name: 'count_letters', description: 'Count the letters in a supplied word.', parameters: { type: 'object' as const, properties: { word: { type: 'string' } }, required: ['word'] } } }],
    tool_choice: 'required' as const, max_tokens: outputLimit, ...probeSampling, ...options,
    ...(catalogModelForPath(path)?.id === 'granite41-3b' ? { grammar: GRANITE_COUNT_LETTERS_GRAMMAR } : {}),
  };
  const toolsTrace: ProbeTrace = { input: catalogModelForPath(path)?.id === 'granite41-3b' ? graniteTransportParams(toolsInput) : toolsInput };
  try {
    const response = await runProbe(toolsInput, 'Testing a structured tool call…');
    toolsTrace.output = probeOutput(response);
    const scoredCall = scoreStructuredToolUse(response.choices[0]?.message.tool_calls, 'count_letters', { word: 'apple' });
    if (scoredCall.observed) { toolsResult = 'confirmed'; toolsArgumentAccuracy = scoredCall.argumentAccuracy; }
    if (toolsResult !== 'confirmed' && /"name"\s*:\s*"count_letters"/.test(response.choices[0]?.message.content || '') && /"word"\s*:\s*"apple"/.test(response.choices[0]?.message.content || '')) toolsResult = 'text-only';
    toolsDetail = toolsResult === 'confirmed' ? toolsArgumentAccuracy === 'passed' ? catalogModelForPath(path)?.id === 'granite41-3b' ? 'Returned an executable tagged tool call with correct arguments under a GBNF format constraint.' : 'Returned an executable structured tool call with correct arguments.' : 'Returned an executable structured tool call, but its arguments did not match the request.'
      : toolsResult === 'text-only' ? 'Wrote a tool invocation as text; no executable tool call was returned.' : 'No valid structured tool call returned.';
  } catch (error) {
    toolsDetail = probeError(error); toolsTrace.error = toolsDetail;
    rethrowIfUnloaded(error, signal);
  } finally {
    emitResult({ key: 'tools', status: toolsResult === 'confirmed' ? 'passed' : toolsResult === 'text-only' || toolsTrace.error ? 'failed' : 'inconclusive', detail: toolsDetail, argumentAccuracy: toolsArgumentAccuracy, trace: toolsTrace });
  }
  let reasoningResult: 'passed' | 'not-passed' | 'inconclusive' = 'inconclusive';
  let reasoningDetail = '';
  const reasoningInput = {
    messages: [{ role: 'user' as const, content: 'If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets? Reply with only the number of minutes.' }],
    max_tokens: outputLimit, ...probeSampling, ...options,
    ...(isQwen3 ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  const reasoningTrace: ProbeTrace = { input: reasoningInput };
  try {
    const response = await runProbe(reasoningInput, 'Testing a reasoning task…');
    reasoningTrace.output = probeOutput(response);
    const answer = visibleBrowserText(response.choices[0]?.message.content);
    const conclusion = completedMachineConclusion(answer, response.choices[0]?.finish_reason);
    reasoningResult = response.choices[0]?.finish_reason === 'length' || !answer ? 'inconclusive' : conclusion && isFiveMinutesAnswer(conclusion.answer) ? 'passed' : 'not-passed';
    reasoningDetail = reasoningResult === 'passed' ? 'Answered one multistep task correctly. This does not establish a dedicated thinking mode.'
      : reasoningResult === 'not-passed' ? `This single task was not scored as correct; ${conclusion ? `final answer read as ${conclusion.answer}` : `response: ${answer.slice(0, 160)}`}.` : response.choices[0]?.finish_reason === 'length' ? 'Output limit reached before a final answer; this task was not scored.' : 'No visible answer to score.';
  } catch (error) {
    reasoningDetail = probeError(error); reasoningTrace.error = reasoningDetail;
    rethrowIfUnloaded(error, signal);
  } finally {
    emitResult({ key: 'reasoningTask', status: reasoningResult === 'passed' ? 'passed' : reasoningResult === 'not-passed' || reasoningTrace.error ? 'failed' : 'inconclusive', detail: reasoningDetail, trace: reasoningTrace });
  }
  let thinkingResult: 'observed' | 'spillover' | 'inconclusive' = 'inconclusive';
  let thinkingDetail = '';
  let thinkingSpillover: ThinkingSpillover | null = null;
  let thinkingConclusion: { result: 'correct' | 'incorrect' | 'unscored'; answer?: string; detail: string } = { result: 'unscored', detail: 'No final numeric answer found.' };
  let thinkingTraceForReport: ProbeTrace | undefined;
  let promptedSteps: { result: 'passed' | 'answer-correct-no-tags' | 'incorrect-answer' | 'inconclusive'; detail: string; answerAccuracy?: 'passed' | 'failed'; trace: ProbeTrace } | undefined;
  if (catalogModelForPath(path)?.thinking !== 'documented') {
    const promptedInput = {
      messages: [{ role: 'user' as const, content: 'For this one test, show a brief explanation inside <think> and </think> tags, then put only the final answer after the closing tag. If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?' }],
      max_tokens: outputLimit, ...probeSampling,
    };
    const promptedTrace: ProbeTrace = { input: promptedInput };
    try {
      const response = await runProbe(promptedInput, 'Testing prompted step-by-step output…');
      promptedTrace.output = probeOutput(response);
      promptedSteps = { ...scorePromptedSteps(response.choices[0]?.message.content, response.choices[0]?.finish_reason), trace: promptedTrace };
    } catch (error) {
      promptedTrace.error = probeError(error); promptedSteps = { result: 'inconclusive', detail: promptedTrace.error, trace: promptedTrace };
      rethrowIfUnloaded(error, signal);
    } finally {
      emitResult({ key: 'promptedSteps', status: promptedSteps?.result === 'passed' ? 'passed' : promptedSteps?.result === 'incorrect-answer' || promptedSteps?.result === 'answer-correct-no-tags' || promptedTrace.error ? 'failed' : 'inconclusive', detail: promptedSteps?.detail || 'No result returned.', answerAccuracy: promptedSteps?.answerAccuracy, trace: promptedTrace });
    }
  }
  const thinkingInput = {
    messages: [{ role: 'user' as const, content: `${isBonsai8b ? '/think\n' : ''}If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets? Give the final answer.` }],
    max_tokens: outputLimit, ...probeSampling, ...(isBonsai8b ? { temperature: 0.7, top_p: 0.95, min_p: 0.05 } : {}), chat_template_kwargs: { enable_thinking: true },
  };
  const thinkingTrace: ProbeTrace = { input: thinkingInput };
  try {
    const response = await runProbe(thinkingInput, isBonsai8b ? 'Trying Bonsai’s Qwen3-style /think request…' : 'Trying the thinking-mode switch…');
    thinkingTrace.output = probeOutput(response);
    const choice = response.choices[0];
    const reasoning = (choice?.message as typeof choice.message & { reasoning_content?: string | null } | undefined)?.reasoning_content;
    const raw = choice?.message.content || '';
    const conclusion = completedMachineConclusion(raw, choice?.finish_reason);
    if (conclusion) thinkingConclusion = {
      result: isFiveMinutesAnswer(conclusion.answer) ? 'correct' : 'incorrect',
      answer: conclusion.answer,
      detail: `Final answer read as ${conclusion.answer} (${conclusion.source}); expected 5 minutes.`,
    };
    else if (choice?.finish_reason === 'length') thinkingConclusion = { result: 'unscored', detail: 'Output limit reached before a final answer; increase max output tokens or reduce the thinking budget.' };
    const separateReasoning = !!reasoning?.trim();
    const inlineReasoning = visibleReasoningEnvelope(raw);
    thinkingSpillover = response.thinkingSpillover || detectThinkingSpillover({
      reasoning, visible: raw, reasoningTokens: latestTokenUsage?.reasoningTokens || 0,
      thinkingBudgetTokens: status.thinkingBudgetTokens || 0, finishReason: choice?.finish_reason,
    });
    thinkingResult = thinkingSpillover ? 'spillover' : separateReasoning || inlineReasoning ? 'observed' : 'inconclusive';
    if (thinkingSpillover) thinkingConclusion = { result: 'unscored', detail: 'Reasoning spilled into visible output; no final answer was scored.' };
    thinkingDetail = thinkingSpillover ? `⚠️ ${thinkingSpillover.detail} Finish reason: ${choice?.finish_reason || 'unknown'}.`
      : separateReasoning ? `A separate reasoning segment was returned. Finish reason: ${choice?.finish_reason || 'unknown'}.`
      : inlineReasoning ? `A complete ${inlineReasoning === 'think-tags' ? '<think>' : 'thought/text channel'} segment appeared in the response text. Finish reason: ${choice?.finish_reason || 'unknown'}.`
      : choice?.finish_reason === 'length' ? `The ${thinkingInput.max_tokens}-token output limit was reached; no separate reasoning segment was visible. Review the raw output for a final answer.`
        : `The model stopped with ${choice?.finish_reason || 'an unknown reason'}; no separate reasoning segment was visible. Review the raw output for its conclusion.`;
  } catch (error) {
    thinkingDetail = probeError(error); thinkingTrace.error = thinkingDetail;
    rethrowIfUnloaded(error, signal);
  } finally {
    if (isBonsai8b) thinkingDetail += ' This experimental probe uses /think and a Qwen3-style reasoning parser; Bonsai 8B support is unconfirmed.';
    else if (catalogModelForPath(path)?.thinking !== 'documented') thinkingDetail += ' This switch is experimental for a model without a documented thinking mode.';
    emitResult({ key: 'thinking', status: thinkingResult === 'observed' ? 'passed' : thinkingTrace.error ? 'failed' : 'inconclusive', detail: thinkingDetail, trace: thinkingTrace, ...(thinkingSpillover ? { warning: 'thinking-spillover' as const } : {}) });
    emitResult({ key: 'thinkingAnswer', status: thinkingConclusion.result === 'correct' ? 'passed' : thinkingConclusion.result === 'incorrect' || thinkingTrace.error ? 'failed' : 'inconclusive', detail: thinkingConclusion.detail, trace: thinkingTrace, ...(thinkingSpillover ? { warning: 'thinking-spillover' as const } : {}) });
  }
  thinkingTraceForReport = thinkingTrace;
  return { text: { result: textResult, detail: textDetail, trace: textTrace }, tools: { result: toolsResult, detail: toolsDetail, argumentAccuracy: toolsArgumentAccuracy, trace: toolsTrace }, reasoningTask: { result: reasoningResult, detail: reasoningDetail, trace: reasoningTrace }, promptedSteps, thinking: { result: thinkingResult, detail: thinkingDetail, conclusion: thinkingConclusion, ...(thinkingSpillover ? { spillover: thinkingSpillover } : {}), trace: thinkingTraceForReport } };
}

export async function unloadBrowserModel() {
  const oldEngine = engine;
  engine = null;
  visionProjectorLoaded = false;
  engineFolder = null;
  nativeError = '';
  publish({ state: 'empty', path: '', message: 'No model loaded' });
  try {
    await oldEngine?.exit().catch(() => {});
    if (wllamaWasmUrl) URL.revokeObjectURL(wllamaWasmUrl);
    wllamaWasmUrl = null;
    await unloadPrismBrowserModel().catch(() => {});
  } finally { notifyResidentModelUnloaded(); }
}

export function loadBrowserModel(folder: FileSystemDirectoryHandle, path: string, contextWindow: number, thinkingBudgetTokens = 0, withVision = false) {
  return withLocalModelMemory(async () => {
    await (await import('./browserImage.ts')).unloadBrowserImageModel();
    await (await import('./browserSpeech.ts')).unloadBrowserSpeech();
    await (await import('./browserTranscription.ts')).unloadBrowserTranscription();
    await (await import('./needleRuntime.ts')).unloadNeedle();
    await (await import('./localOllama.ts')).unloadLocalOllama();
    await loadBrowserModelInternal(folder, path, contextWindow, thinkingBudgetTokens, withVision);
  });
}

async function loadBrowserModelInternal(folder: FileSystemDirectoryHandle, path: string, contextWindow: number, thinkingBudgetTokens: number, withVision: boolean) {
  if (!/^models\/[^/]+\.gguf$/i.test(path)) throw new Error('Choose a GGUF file inside the models folder.');
  if (isKnownIncompatibleGranite(path)) throw new Error(GRANITE_40_WARNING);
  if (isBonsai2Q2BrowserUnsupported(path)) throw new Error(BONSAI_2_Q2_BROWSER_WARNING);
  if (status.state === 'loading') throw new Error('A model is already loading.');
  await unloadBrowserModel();
  publish({ state: 'loading', path, message: 'Step 1 of 3 · Checking the model file…' });
  let instance: Wllama | null = null;
  try {
    if ((await incompleteModels(folder)).has(path.slice('models/'.length))) throw new Error('This GGUF download is incomplete. Resume it in Settings & AI before loading.');
    await assertModelLicenseFiles(folder, path);
    if (catalogModelForPath(path)?.id === 'gemma3-1b' && !hasGemmaConsent()) throw new Error('Review and accept the Gemma Terms in AI profiles before loading this model.');
    if (catalogModelForPath(path)?.id === 'qwen25-3b' && !hasQwenResearchConsent()) throw new Error('Acknowledge the Qwen Research License in AI profiles before loading this model.');
    const file = await readBlob(folder, path);
    if (file.size > 2_000_000_000) throw new Error('This GGUF is over the 2 GB browser limit. Choose a smaller file.');
    const catalog = catalogModelForPath(path);
    let projector: File | null = null;
    if (withVision) {
      if (!catalog?.visionProjector) throw new Error('No vision projector is configured for this model.');
      await assertVisionProjectorLicenseFiles(folder, catalog);
      projector = await readBlob(folder, `models/${catalog.visionProjector.name}`);
      if (projector.size !== catalog.visionProjector.bytes) throw new Error('The vision projector file size does not match the catalog.');
    }
    publish({ state: 'loading', path, message: 'Step 2 of 3 · Loading model into browser memory…' });
    const loadedContextWindow = browserContextWindow(path, contextWindow);
    const loadedThinkingBudget = Math.max(0, Math.floor(thinkingBudgetTokens));
    const modelId = catalogModelForPath(path)?.id;
    if (isBonsai2BrowserUnsupported(path)) {
      publish({ state: 'loading', path, message: 'Step 2 of 3 · Loading Bonsai 2 on WebGPU…' });
      await loadPrismBrowserModel(folder, file, loadedContextWindow, message => publish({ state: 'loading', path, message: `Loading Bonsai 2 · ${message}` }), projector || undefined);
      visionProjectorLoaded = !!projector;
      engineFolder = folder;
      publish({ state: 'ready', path, contextWindow: loadedContextWindow, thinkingBudgetTokens: loadedThinkingBudget, message: `${file.name} is ready on this device` });
      return;
    }
    const runtime = await loadWllamaModule(folder);
    const { Wllama, wasmUrl } = runtime;
    wllamaWasmUrl = wasmUrl;
    nativeError = '';
    instance = new Wllama({ default: wasmUrl }, {
      suppressNativeLog: false,
      logger: {
        debug: () => {}, log: () => {}, warn: () => {},
        error: (...args: unknown[]) => { if (!nativeError) nativeError = args.map(String).join(' ').trim().slice(0, 500); },
      },
    });
    instance.setCompat(null); // Never fetch a compatibility runtime from a CDN.
    const qwen35 = modelId === 'qwen35-2b';
    await instance.loadModel(projector ? [file, projector] : [file], {
      n_ctx: loadedContextWindow, jinja: true,
      reasoning_budget_tokens: loadedThinkingBudget || -1,
      ...(modelId === 'qwen3-17b' || modelId === 'bonsai-8b' && loadedThinkingBudget > 0 ? { reasoning_format: 'deepseek' as const } : {}),
      ...(qwen35 ? qwen35LoadOptions(loadedThinkingBudget > 0) : {}),
    });
    engine = instance;
    visionProjectorLoaded = !!projector;
    engineFolder = folder;
    publish({ state: 'ready', path, contextWindow: loadedContextWindow, thinkingBudgetTokens: loadedThinkingBudget, message: `${file.name} is ready on this device` });
  } catch (error) {
    if (instance) await instance.exit().catch(() => {});
    if (wllamaWasmUrl) URL.revokeObjectURL(wllamaWasmUrl);
    wllamaWasmUrl = null;
    publish({ state: 'error', path, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Loading only checks that the GGUF can be initialized. Keep the separate
// readiness check small, regardless of the profile's writing output limit.
export function quickBrowserModelCheck(config: AIConfig): Promise<Completion> {
  return withLocalModelMemory(() => quickBrowserModelCheckInternal(config));
}
async function quickBrowserModelCheckInternal(config: AIConfig): Promise<Completion> {
  if ((!engine && !hasPrismBrowserModel()) || !engineFolder || !isBrowserModelLoadedFrom(engineFolder, config.model, config.contextWindow, browserThinkingBudget(config))) {
    throw new Error('Load the selected GGUF with these settings before checking it.');
  }
  await assertModelLicenseFiles(engineFolder, config.model);
  if (hasPrismBrowserModel()) await assertPrismEngineFiles(engineFolder);
  else await assertWllamaEngineFiles(engineFolder);
  const response = await createBrowserChatCompletion({
    messages: [{ role: 'user', content: 'Reply with one word: ready.' }],
    max_tokens: 32,
    ...browserThinkingOptions({ ...config, browserThinkingMode: 'none' }),
  });
  const answer = visibleBrowserText(response.choices[0]?.message.content);
  if (!answer) throw new Error('The quick check returned no visible text. Try another model.');
  return { text: answer, inputTokens: response.usage?.prompt_tokens, outputTokens: response.usage?.completion_tokens };
}

export function browserComplete(config: AIConfig, turns: ChatTurn[], system: string, signal?: AbortSignal, tools?: BrowserTools, onTokenProgress?: (progress: LiveCompletionProgress) => void, request?: { maxOutputTokens: number; disableThinking: boolean }): Promise<Completion> {
  return withLocalModelMemory(() => browserCompleteInternal(config, turns, system, signal, tools, onTokenProgress, request));
}
async function browserCompleteInternal(config: AIConfig, turns: ChatTurn[], system: string, signal?: AbortSignal, tools?: BrowserTools, onTokenProgress?: (progress: LiveCompletionProgress) => void, request?: { maxOutputTokens: number; disableThinking: boolean }): Promise<Completion> {
  if ((!engine && !hasPrismBrowserModel()) || status.state !== 'ready' || status.path !== config.model) throw new Error('Load the selected GGUF model in Settings & AI before chatting.');
  if (!engineFolder) throw new Error('Reconnect the model folder before using this GGUF.');
  try {
    await assertModelLicenseFiles(engineFolder, status.path);
    if (hasPrismBrowserModel()) await assertPrismEngineFiles(engineFolder);
    else await assertWllamaEngineFiles(engineFolder);
    if (catalogModelForPath(status.path)?.id === 'gemma3-1b' && !hasGemmaConsent()) throw new Error('Review and accept the Gemma Terms before using this model.');
    if (catalogModelForPath(status.path)?.id === 'qwen25-3b' && !hasQwenResearchConsent()) throw new Error('Acknowledge the Qwen Research License before using this model.');
  } catch (error) {
    await unloadBrowserModel();
    throw error;
  }
  if (status.contextWindow !== browserContextWindow(config.model, config.contextWindow)) throw new Error('The context window changed. Reload the browser model in Settings & AI.');
  const thinkingBudget = browserThinkingBudget(config);
  if ((status.thinkingBudgetTokens ?? 0) !== thinkingBudget) throw new Error('The thinking setting changed. Reload the browser model in Settings & AI.');
  const outputLimit = request ? Math.max(32, Math.min(config.maxOutputTokens, Math.floor(request.maxOutputTokens))) : config.maxOutputTokens;
  const thinkingOptions = request?.disableThinking ? browserThinkingOptions({ ...config, browserThinkingMode: 'none' }) : browserThinkingOptions(config);
  // Gemma 3's chat format has user/model turns, with instructions in the first user turn.
  const messages: ChatCompletionMessage[] = catalogModelForPath(status.path)?.id === 'gemma3-1b'
    ? gemmaBrowserMessages(system, turns)
    : [{ role: 'system', content: system }, ...turns];
  const toolEvents: string[] = [];
  const rounds: InferenceRound[] = [];
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const thinkingSegments: string[] = [];
  const limitToolResult = createToolResultLimiter(tools ? toolResultBudget(status.contextWindow || browserContextWindow(config.model, config.contextWindow), outputLimit, system, turns, tools.definitions) : 0);
  for (let round = 0; round < 4; round++) {
    onTokenProgress?.({ promptProcessed: 0, promptTotal: 0, outputTokens: 0, maxOutputTokens: outputLimit, outputTokensPerSecond: 0, visibleText: '' });
    const parameters = {
      messages, max_tokens: outputLimit, abortSignal: signal,
      ...(catalogModelForPath(status.path)?.id === 'qwen35-2b' ? qwen35ChatOptions : {}),
      ...thinkingOptions,
      ...(tools && round < 3 ? { tools: tools.definitions, tool_choice: 'auto' as const } : {}),
    };
    const { abortSignal: _abortSignal, ...requestBody } = parameters;
    const requestSnapshot = snapshotInference(requestBody) as Record<string, unknown>;
    const response = await createBrowserChatCompletion(parameters, onTokenProgress ? progress => onTokenProgress({
      promptProcessed: progress.promptProcessed,
      promptTotal: progress.promptTotal,
      promptCachedTokens: progress.promptCachedTokens,
      outputTokens: progress.outputTokens,
      maxOutputTokens: progress.maxOutputTokens,
      outputTokensPerSecond: progress.outputTokensPerSecond,
      visibleText: liveBrowserAnswer(progress.visibleText || ''),
      reasoningText: progress.reasoningText,
    }) : undefined);
    if (response.usage?.prompt_tokens !== undefined) inputTokens = (inputTokens || 0) + response.usage.prompt_tokens;
    if (response.usage?.completion_tokens !== undefined) outputTokens = (outputTokens || 0) + response.usage.completion_tokens;
    const choice = response.choices[0];
    if (!choice) throw new Error('The browser model returned no response.');
    const reasoning = (choice.message as typeof choice.message & { reasoning_content?: string | null }).reasoning_content;
    const inlineReasoning = splitInlineReasoning(choice.message.content || '').reasoning;
    if ((reasoning || inlineReasoning).trim()) thinkingSegments.push((reasoning || inlineReasoning).trim());
    const traceRound: InferenceRound = { request: requestSnapshot, response: {
      text: visibleBrowserText(choice.message.content), thinking: (reasoning || inlineReasoning).trim(),
      toolCalls: snapshotInference(choice.message.tool_calls || []), finishReason: choice.finish_reason || undefined,
      inputTokens: response.usage?.prompt_tokens, outputTokens: response.usage?.completion_tokens,
    } };
    rounds.push(traceRound);
    if (response.thinkingSpillover) throw new Error('The model continued its reasoning in the visible answer after reaching the thinking cap. Try Light or None, or another model.');
    const calls = choice.message.tool_calls || [];
    assertExecutableToolCalls(calls.length, choice.finish_reason, signal);
    if (calls.length && tools && round < 3) {
      const deferred = calls.filter(call => tools.deferredNames?.includes(call.function.name));
      if (deferred.length) {
        const deferredToolCalls = deferred.slice(0, 2).map(call => {
          const parsed = JSON.parse(call.function.arguments || '{}') as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be an object.');
          return { name: call.function.name, arguments: parsed as Record<string, unknown> };
        });
        return { text: visibleBrowserText(choice.message.content), inputTokens, outputTokens, thinkingText: thinkingSegments.join('\n\n'), toolEvents, deferredToolCalls, rounds };
      }
      messages.push(choice.message);
      for (const call of calls.slice(0, 3)) {
        const unsupported = !tools.definitions.some(item => item.function.name === call.function.name);
        let result: string;
        try {
          const parsed = JSON.parse(call.function.arguments || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be an object.');
          result = await tools.execute(call.function.name, parsed);
        } catch (error) {
          if (signal?.aborted) throw error;
          result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        }
        result = limitToolResult(result);
        toolEvents.push(unsupported ? `${unsupportedToolDiagnostic(call.function.name, call.function.arguments)} · ${result}` : `${call.function.name}: ${result}`);
        (traceRound.toolResults ||= []).push({ name: call.function.name, content: result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      continue;
    }
    const answer = visibleBrowserText(choice.message.content);
    if (!answer) {
      const tokens = response.usage?.completion_tokens;
      const detail = choice.finish_reason === 'length' ? 'The output limit was reached before an answer.'
        : reasoning?.trim() ? 'The model produced reasoning but no visible answer.'
          : `The model stopped with ${choice.finish_reason || 'no finish reason'} and no visible answer.`;
      throw new Error(`${detail}${tokens ? ` ${tokens} tokens were generated.` : ''} Try loading the model again; if this persists, choose another browser model.`);
    }
    return { text: answer, inputTokens, outputTokens, thinkingText: thinkingSegments.join('\n\n'), toolEvents, rounds };
  }
  throw new Error('The browser model reached the tool-call limit. Ask a narrower question.');
}
