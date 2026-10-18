import { complete, type AIConfig, type ChatTurn, type Completion, type LiveCompletionProgress } from './ai.ts';
import { isBrowserModelLoadedFrom, loadBrowserModel, unloadBrowserModel, type BrowserTools } from './browserModel.ts';
import { browserThinkingBudget } from './browserThinking.ts';
import { browserContextWindow } from './browserContext.ts';
import type { ChatCompletionTool } from './browserEngineTypes.ts';
import { browserFileTools, type ToolScope } from './harnessTools.ts';
import { browserHistoryTools } from './harnessHistory.ts';
import { browserMemoryTools } from './harnessMemoryTools.ts';
import type { ConversationMeta } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import { generateImage, imageConfigured, type ImageConfig } from './imageGeneration.ts';
import { writeBlob } from './storage.ts';
import { harnessToolIntent, selectHarnessToolDefinitions, toolSchemaTokens } from './harnessToolSelection.ts';
import { toolFailureMessage } from './harnessToolFailure.ts';
import { isMutatingToolName } from './harnessToolActions.ts';
import { fitRecentTurns } from './harnessContextFit.ts';
import { pseudoShellCommand } from './harnessShell.ts';
import { unsupportedToolDiagnostic } from './harnessToolDiagnostics.ts';
import { filterPermittedTools } from './harnessToolPermissions.ts';
import { authorizeToolCall, type ToolApprovalRequest } from './harnessToolApprovals.ts';
import { discoverToolCategory, initialDiscoverableTools, requestToolsTool } from './harnessToolDiscovery.ts';

export const imageTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_image', description: 'Generate a new image and save it to the current project library. Use only when an image helps the task.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'A precise original image description.' }, filename: { type: 'string', description: 'Optional short filename stem.' } }, required: ['prompt'] },
  },
};

type HarnessCompletion = Completion & { usedConfig: AIConfig; fallbackNotice?: string };
/** A model failed after a tool may have changed workspace files. Never replay automatically. */
export class HarnessPartialToolError extends Error {
  constructor(message: string, readonly usedConfig: AIConfig, readonly completedChanges: string[]) {
    super(message);
    this.name = 'HarnessPartialToolError';
  }
}
type HarnessCompletionArgs = {
  config: AIConfig;
  fallbacks?: AIConfig[];
  turns: ChatTurn[];
  system: string;
  systemForConfig?: (config: AIConfig) => string;
  folder: FileSystemDirectoryHandle | null;
  scope: ToolScope;
  history?: { store: HarnessStore; meta: ConversationMeta };
  toolIntentHint?: string;
  imageConfig: ImageConfig;
  imagePriority?: ImageConfig[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onTokenProgress?: (progress: LiveCompletionProgress) => void;
  onCandidate?: (config: AIConfig) => void;
  approvalSessionKey?: string;
  onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
};
type ToolInputs = Pick<HarnessCompletionArgs, 'folder' | 'scope' | 'history' | 'imageConfig' | 'imagePriority' | 'signal'>;
type ToolPlan = { fileTools?: BrowserTools; historyTools?: BrowserTools; memoryTools?: BrowserTools; imageOptions: ImageConfig[]; definitions: ChatCompletionTool[]; available: ChatCompletionTool[]; request: string; capacity: number };
function planTools(args: ToolInputs, config: AIConfig, request: string, includeActiveHistory = false): ToolPlan {
  const fileTools = browserFileTools(args.folder, args.scope, args.signal);
  const historyTools = args.history ? browserHistoryTools(args.history.store, args.history.meta, args.signal, includeActiveHistory) : undefined;
  const memoryTools = args.history ? browserMemoryTools(args.history.store, args.history.meta, args.scope, args.signal) : undefined;
  const imageOptions = (args.imagePriority || [args.imageConfig]).filter((option, index, all) => imageConfigured(option) && all.findIndex(item => item.preset === option.preset) === index);
  const readOnly = args.scope.projects.find(project => project.id === args.scope.defaultProjectId)?.toolAccess === 'read-only';
  const available = filterPermittedTools(args.scope, [...(fileTools?.definitions || []), ...(historyTools?.definitions || []), ...(memoryTools?.definitions || []), ...(args.folder && imageOptions.length && !readOnly ? [imageTool] : [])]);
  const capacity = config.provider === 'browser' ? browserContextWindow(config.model, config.contextWindow) : config.contextWindow;
  const selectionRequest = includeActiveHistory ? `${request} previous history` : request;
  const required = includeActiveHistory ? ['search_history', 'read_history'] : [];
  const contextual = selectHarnessToolDefinitions(available, selectionRequest, capacity, required, config.maxOutputTokens);
  const definitions = !contextual.length && available.some(item => item.function.name === 'propose_memory')
    ? selectHarnessToolDefinitions(available, selectionRequest, capacity, ['propose_memory'], config.maxOutputTokens)
    : initialDiscoverableTools(available, selectionRequest, capacity, config.maxOutputTokens, required,
      filterPermittedTools(args.scope, [requestToolsTool]).length > 0);
  return { fileTools, historyTools, memoryTools, imageOptions, definitions, available, request: selectionRequest, capacity };
}
export function harnessToolReserve(args: ToolInputs, config: AIConfig, request: string | ChatTurn[], archivedHint = ''): number {
  const definitions = planTools(args, config, typeof request === 'string' ? request : harnessToolIntent(request, archivedHint)).definitions;
  return definitions.length ? toolSchemaTokens(definitions) + definitions.length * 16 : 0;
}

export async function harnessComplete(args: HarnessCompletionArgs): Promise<HarnessCompletion> {
  const candidates = [args.config, ...(args.fallbacks || [])].filter((candidate, index, all) => all.findIndex(item => item.id === candidate.id) === index);
  const failures: string[] = [];
  for (const [index, config] of candidates.entries()) {
    if (args.signal?.aborted) throw args.signal.reason || new DOMException('Cancelled.', 'AbortError');
    const system = args.systemForConfig?.(config) || args.system;
    const capacity = config.provider === 'browser' ? browserContextWindow(config.model, config.contextWindow) : config.contextWindow;
    const request = harnessToolIntent(args.turns, args.toolIntentHint);
    let toolPlan = planTools(args, config, request);
    let toolTokens = toolPlan.definitions.length ? toolSchemaTokens(toolPlan.definitions) + toolPlan.definitions.length * 16 : 0;
    let fitted = fitRecentTurns(args.turns, system, capacity, config.maxOutputTokens, toolTokens, false);
    if (!fitted && index > 0 && args.history) {
      toolPlan = planTools(args, config, request, true);
      toolTokens = toolPlan.definitions.length ? toolSchemaTokens(toolPlan.definitions) + toolPlan.definitions.length * 16 : 0;
      const canRecall = ['search_history', 'read_history'].every(name => toolPlan.definitions.some(item => item.function.name === name));
      fitted = fitRecentTurns(args.turns, system, capacity, config.maxOutputTokens, toolTokens, canRecall);
    }
    if (!fitted) {
      failures.push(`${config.label}: context too small for this request; increase the context window or lower maximum output tokens`);
      continue;
    }
    args.onCandidate?.(config);
    if (index > 0) {
      args.onProgress?.(fitted.omitted ? `Trying ${config.label} with recent turns; older turns remain searchable…` : `Trying ${config.label}…`);
      args.onTokenProgress?.({ promptProcessed: 0, promptTotal: 0, outputTokens: 0, maxOutputTokens: config.maxOutputTokens, outputTokensPerSecond: 0, visibleText: '' });
    }
    try {
      if (config.provider === 'browser') {
        if (!args.folder) throw new Error('Connect the model folder to load this browser profile.');
        if (!isBrowserModelLoadedFrom(args.folder, config.model, config.contextWindow, browserThinkingBudget(config))) {
          await loadBrowserModel(args.folder, config.model, config.contextWindow, browserThinkingBudget(config));
        }
      }
      if (args.signal?.aborted) throw args.signal.reason || new DOMException('Cancelled.', 'AbortError');
      const result = await runHarnessCompletion({ ...args, config, system: fitted.system, turns: fitted.turns }, toolPlan);
      const fallbackNotice = failures.length ? `Used ${config.label} after ${candidates.slice(0, index).map(item => item.label).join(', ')} could not answer.` : undefined;
      return { ...result, usedConfig: config, ...(fallbackNotice ? { fallbackNotice, toolEvents: [...(result.toolEvents || []), `Model fallback: ${failures.join(' | ')}`] } : {}) };
    } catch (error) {
      if (args.signal?.aborted) throw error;
      failures.push(`${config.label}: ${error instanceof Error ? error.message : String(error)}`);
      // A model may have already changed files through tools. Do not replay the task on a fallback.
      if (error instanceof HarnessPartialToolError) throw error;
      // A failed browser runtime may still own a large Wasm/WebGPU allocation.
      // Free it before trying the next ready profile, including a remote fallback.
      if (config.provider === 'browser') await unloadBrowserModel();
    }
  }
  throw new Error(`No configured model completed the request. ${failures.join(' | ')}`);
}

async function runHarnessCompletion(args: HarnessCompletionArgs, plan: ToolPlan): Promise<Completion> {
  const { config, system, folder, scope, signal, onProgress } = args;
  const { fileTools, historyTools, memoryTools, imageOptions } = plan;
  let toolExecutionStarted = false;
  const completedChanges: string[] = [];
  const memoryDrafts: string[] = [];
  let memoryDraftCount = 0;
  const runGrants = new Set<string>();
  const offered = new Set(plan.definitions.map(item => item.function.name));
  const tools: BrowserTools | undefined = plan.definitions.length ? {
    definitions: plan.definitions,
    deferredNames: plan.definitions.some(item => item.function.name === 'generate_image') ? ['generate_image'] : [],
    execute: async (name, toolArgs) => {
      if (!offered.has(name)) throw new Error(`Tool ${name} was not offered for this request.`);
      const approvalProject = toolArgs.area === 'workspace' && !name.startsWith('git_') ? scope.defaultProjectId : String(toolArgs.project || scope.defaultProjectId);
      await authorizeToolCall({ scope, name, arguments: toolArgs, projectId: approvalProject, sessionKey: args.approvalSessionKey || '', runGrants, approve: args.onToolApproval, signal });
      if (name === 'request_tools') {
        const category = String(toolArgs.category || '').trim().toLowerCase();
        const requested = String(toolArgs.tool || '').trim();
        const expanded = discoverToolCategory(plan.available, category, requested, plan.request, plan.capacity, config.maxOutputTokens);
        tools!.definitions = expanded;
        tools!.deferredNames = expanded.some(item => item.function.name === 'generate_image') ? ['generate_image'] : [];
        offered.clear();
        for (const item of expanded) offered.add(item.function.name);
        const enabled = expanded.map(item => item.function.name).filter(toolName => toolName !== 'request_tools');
        return `Enabled ${category} tools: ${enabled.join(', ')}. Use a listed tool to continue the task.`;
      }
      if (isMutatingToolName(name)) toolExecutionStarted = true;
      const action = name.replaceAll('_', ' ');
      onProgress?.(`Using ${action}…`);
      try {
        if (name === 'list_history_topics' || name === 'search_history' || name === 'read_history') {
          if (!historyTools) throw new Error('No archived history is available.');
          return await historyTools.execute(name, toolArgs);
        }
        if (name === 'search_memory' || name === 'read_memory') {
          if (!memoryTools) throw new Error('No saved memory is available.');
          return await memoryTools.execute(name, toolArgs);
        }
        if (name === 'propose_memory') {
          if (!memoryTools) throw new Error('No conversation is available for a memory draft.');
          if (memoryDraftCount >= 1) throw new Error('Only one memory draft can be proposed per response.');
          const draft = await memoryTools.execute(name, toolArgs);
          memoryDraftCount++;
          memoryDrafts.push(`memory_draft: ${draft}`);
          return 'Memory draft queued for the person to review. It has not been saved.';
        }
        if (!fileTools) throw new Error(`Unknown tool: ${name}`);
        const result = await fileTools.execute(name, toolArgs);
        if (isMutatingToolName(name)) completedChanges.push(`${name}: ${result.slice(0, 500)}`);
        return result;
      } finally { onProgress?.(`Continuing after ${action}…`); }
    },
  } : undefined;
  const turns = [...args.turns];
  const toolEvents: string[] = [];
  let inputTokens = 0, outputTokens = 0;
  try {
    for (let round = 0; round < 3; round++) {
      const result = await complete(config, turns, system, signal, tools, args.onTokenProgress);
      inputTokens += result.inputTokens || 0; outputTokens += result.outputTokens || 0;
      toolEvents.push(...(result.toolEvents || []));
      toolEvents.push(...memoryDrafts.splice(0));
      const pseudo = pseudoShellCommand(result.text);
      if (pseudo !== null) {
        if (!pseudo || !tools || !offered.has('shell_readonly')) {
          toolEvents.push(unsupportedToolDiagnostic('shell_readonly', { output: result.text }));
          return { ...result, text: 'The model requested a shell command that this project cannot run. Ask for a project file listing or a specific file instead.', inputTokens, outputTokens, toolEvents };
        }
        const shellResult = await tools.execute('shell_readonly', { command: pseudo }).catch(error => `Tool error: ${error instanceof Error ? error.message : String(error)}`);
        toolEvents.push(`shell_readonly: ${shellResult}`);
        if (round === 2) return { ...result, text: shellResult, inputTokens, outputTokens, toolEvents };
        turns.push({ role: 'assistant', content: `Requested read-only project shell command: ${pseudo}` });
        turns.push({ role: 'user', content: `Tool result:\n${shellResult}\nContinue the original task. Do not repeat the command unless more data is needed.` });
        continue;
      }
      const calls = result.deferredToolCalls || [];
      if (!calls.length) return { ...result, inputTokens, outputTokens, toolEvents };
      if (!folder || !offered.has('generate_image') || round === 2) throw new Error('The image tool limit was reached. Try one image at a time.');
      for (const call of calls) {
        if (call.name !== 'generate_image') throw new Error(`Unsupported deferred tool: ${call.name}`);
        await authorizeToolCall({ scope, name: call.name, arguments: call.arguments, projectId: scope.defaultProjectId, sessionKey: args.approvalSessionKey || '', runGrants, approve: args.onToolApproval, signal });
        const prompt = String(call.arguments.prompt || '').trim();
        if (!prompt || prompt.length > 2000) throw new Error('Image prompt must be between 1 and 2000 characters.');
        const stem = String(call.arguments.filename || 'generated-image').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'generated-image';
        const id = crypto.randomUUID();
        const path = `harness/projects/${scope.defaultProjectId}/library/generated/${stem}-${id.slice(0, 8)}.png`;
        onProgress?.('Generating image…');
        let generated: Blob | null = null;
        let used: ImageConfig | null = null;
        const failures: string[] = [];
        try {
          for (const option of imageOptions) {
            try { generated = await generateImage(option, prompt, signal, message => onProgress?.(message), undefined, folder); used = option; break; }
            catch (error) { if (signal?.aborted) throw error; failures.push(`${option.model}: ${error instanceof Error ? error.message : String(error)}`); }
          }
        }
        finally {
          if (generated && !signal?.aborted && config.provider === 'browser' && !isBrowserModelLoadedFrom(folder, config.model, config.contextWindow, browserThinkingBudget(config))) {
            onProgress?.('Resuming text model…');
            await loadBrowserModel(folder, config.model, config.contextWindow, browserThinkingBudget(config));
          }
        }
        if (signal?.aborted) throw signal.reason || new DOMException('Stopped.', 'AbortError');
        if (!generated || !used) throw new Error(`Image generation failed with every configured option. ${failures.join(' | ')}`);
        toolExecutionStarted = true;
        await writeBlob(folder, path, generated);
        const message = `Image saved to ${path} (${generated.size.toLocaleString()} bytes).`;
        completedChanges.push(`generate_image: ${message}`);
        await writeBlob(folder, path.replace(/\.png$/, '.json'), new Blob([JSON.stringify({ prompt, generatedAt: new Date().toISOString(), imageModel: used.model, imageProvider: used.provider, imagePreset: used.preset }, null, 2)], { type: 'application/json' }));
        toolEvents.push(`generate_image: ${message}`);
        turns.push({ role: 'assistant', content: result.text || `Requested the generate_image tool for: ${prompt}` });
        turns.push({ role: 'user', content: `Tool result: ${message} Continue the original task. Mention the saved path.` });
        onProgress?.('Continuing with the text model…');
      }
    }
    throw new Error('The model requested too many image generations in one turn.');
  } catch (error) {
    if (toolExecutionStarted && !(error instanceof HarnessPartialToolError)) {
      throw new HarnessPartialToolError(toolFailureMessage(error, completedChanges), config, [...completedChanges]);
    }
    throw error;
  }
}
