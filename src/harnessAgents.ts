import type { AIConfig } from './ai.ts';
import { compactConversation, messagesForModel, needsCompaction, promptForConversation, systemPromptCharBudget } from './harnessContext.ts';
import { recallHistory } from './harnessHistory.ts';
import { createConversation, identityInstructions, isoNow, newId, type AgentEvent, type ConversationMeta, type HarnessAgent, type HarnessManifest, type HarnessMessage, type MemoryRecord } from './harnessData.ts';
import { modelStamp } from './harnessModelStamp.ts';
import { acquireModel } from './harnessLease.ts';
import type { HarnessStore } from './harnessStore.ts';
import { HarnessPartialToolError, harnessComplete, harnessToolReserve } from './harnessMultimodal.ts';
import { formatLibraryHits, searchLibrary } from './harnessLibrary.ts';
import type { ImageConfig } from './imageGeneration.ts';
import { readyProfiles } from './harnessPreferences.ts';
import { imageCandidates } from './harnessPreferences.ts';
import { projectWithGuide } from './harnessProjectGuide.ts';
import { ensureBrowserModelReady, isModelConfirmed } from './modelSession.ts';
import type { ToolApprovalRequest } from './harnessToolApprovals.ts';

export function nextAgentRun(agent: HarnessAgent, from = Date.now()): string {
  if (agent.schedule === 'continuous') return new Date(from + 45_000).toISOString();
  if (agent.schedule === 'interval') return new Date(from + Math.max(5, agent.everyMinutes) * 60_000).toISOString();
  return '';
}

export function agentHasPendingRun(agent: HarnessAgent): boolean {
  return !agent.paused && !agent.runClaim && agent.schedule !== 'manual' && !!agent.nextRunAt && (agent.schedule !== 'event' || !!nextAgentEvent(agent));
}

export function nextAgentEvent(agent: HarnessAgent): AgentEvent | null {
  return agent.pendingEvents?.[0] || (agent.pendingEvent ? { id: 'legacy', projectId: agent.pendingProjectId || '', description: agent.pendingEvent, createdAt: '' } : null);
}

export function queueAgentEvent(agent: HarnessAgent, projectId: string, description: string, now = isoNow()): HarnessAgent {
  const legacy = agent.pendingEvent ? [{ id: newId(), projectId: agent.pendingProjectId || projectId, description: agent.pendingEvent, createdAt: now }] : [];
  const waiting = [...legacy, ...(agent.pendingEvents || [])];
  return { ...agent, pendingEvent: '', pendingProjectId: '', pendingEvents: [...waiting, { id: newId(), projectId, description, createdAt: now }], nextRunAt: waiting.length ? agent.nextRunAt || now : now };
}

export function finishAgentRun(agent: HarnessAgent, consumedEventId: string | undefined, from = Date.now()): HarnessAgent {
  const pendingEvents = (agent.pendingEvents || []).filter(event => event.id !== consumedEventId);
  const pendingEvent = consumedEventId === 'legacy' ? '' : agent.pendingEvent;
  return { ...agent, pendingEvents, pendingEvent, pendingProjectId: pendingEvent ? agent.pendingProjectId : '',
    nextRunAt: agent.schedule === 'event' ? (pendingEvents.length || pendingEvent ? new Date(from).toISOString() : '') : nextAgentRun(agent, from) };
}

export function retryAgentRun(agent: HarnessAgent, from = Date.now()): HarnessAgent {
  return { ...agent, nextRunAt: agent.schedule === 'manual' ? '' : new Date(from + Math.max(5, agent.everyMinutes) * 60_000).toISOString() };
}

export function agentDue(agent: HarnessAgent, now = Date.now()): boolean {
  return agentHasPendingRun(agent) && Date.parse(agent.nextRunAt) <= now;
}

export function agentRunProject(agent: HarnessAgent, manifest: HarnessManifest, preferredProjectId?: string) {
  const allowed = agent.allProjects ? manifest.projects : manifest.projects.filter(project => agent.projectIds.includes(project.id));
  if (!allowed.length) throw new Error('Give this agent access to at least one project.');
  const event = nextAgentEvent(agent);
  if (event?.projectId && !allowed.some(project => project.id === event.projectId)) throw new Error('A pending event belongs to a project outside this agent’s scope. Edit the agent to clear or restore access.');
  const requested = event?.projectId || preferredProjectId;
  return { allowed, project: allowed.find(project => project.id === requested) || allowed[0] };
}

export async function executeHarnessAgent(args: {
  agent: HarnessAgent;
  manifest: HarnessManifest;
  store: HarnessStore;
  folder: FileSystemDirectoryHandle | null;
  profiles: AIConfig[];
  apiKeys: Record<string, string>;
  memories: MemoryRecord[];
  imageConfig: ImageConfig;
  compactionAt?: number;
  preferredProjectId?: string;
  signal?: AbortSignal;
  onModelWait?: () => void;
  onModelAcquired?: () => void;
  onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
}): Promise<{ session: ConversationMeta; result: string }> {
  const { agent, manifest, store, folder, profiles, apiKeys, memories, signal } = args;
  const base = profiles.find(profile => profile.id === agent.profileId);
  if (!base) throw new Error('The agent’s model profile is missing.');
  const selected = { ...base, apiKey: apiKeys[base.id] || '' };
  let preflightError = '';
  if (selected.provider === 'browser' && selected.model.trim() && folder && !isModelConfirmed(selected)) {
    args.onModelWait?.();
    const releaseSetup = await acquireModel(`agent-setup:${agent.id}`, signal);
    try { await ensureBrowserModelReady(selected, folder); }
    catch (cause) {
      if (signal?.aborted) throw cause;
      preflightError = cause instanceof Error ? cause.message : String(cause);
    } finally { releaseSetup(); }
  }
  const candidates = readyProfiles(agent.profileId, 'code', manifest.modelPreferences, profiles, apiKeys, !!folder);
  const config = candidates[0];
  if (!config) throw new Error(preflightError ? `${base.label} could not load: ${preflightError}` : `Load and test ${base.label} or a coding fallback before this agent can run.`);
  const { allowed, project } = agentRunProject(agent, manifest, args.preferredProjectId);
  const event = nextAgentEvent(agent);
  const task = [agent.prompt.trim(), event && `Event in ${project.name}: ${event.description}`].filter(Boolean).join('\n\n');
  let libraryContext = '';
  if (folder) {
    try {
      const budget = Math.max(300, Math.min(3000, Math.floor(systemPromptCharBudget(config) * .35)));
      libraryContext = formatLibraryHits(await searchLibrary(folder, project.id, task, budget, signal));
    } catch (error) { if (signal?.aborted) throw error; /* The agent can still use file tools when an index is unavailable. */ }
  }
  args.onModelWait?.();
  const release = await acquireModel(`agent:${agent.id}`, signal);
  try {
    if (signal?.aborted) throw signal.reason || new DOMException('Agent stopped.', 'AbortError');
    args.onModelAcquired?.();
    const sessions = await store.sessions(project.id);
    const existingSession = sessions.find(item => item.agentId === agent.id);
    let session = existingSession || { ...createConversation(project.id, agent.id), title: `${agent.name} · run log`, autoTitled: true };
    const saveSession = async () => {
      const updated = await store.updateSessions(project.id, current => {
        const existing = current.find(item => item.id === session.id);
        const record = existing ? { ...session, title: existing.title, pinned: existing.pinned, autoTitled: existing.autoTitled } : session;
        return [record, ...current.filter(item => item.id !== session.id)];
      });
      session = updated.find(item => item.id === session.id) || session;
    };
    const append = async (message: Omit<HarnessMessage, 'seq'>) => {
      session = (await store.appendConversationMessage(session, message)).meta;
    };
    const identity = identityInstructions(manifest, agent.identityId, agent.identity);
    const guidedProject = await projectWithGuide(folder, project);
    let historyContext = '';
    if (session.activeFrom > 0) {
      try { historyContext = await recallHistory(store, session, task, Math.floor(systemPromptCharBudget(config) * .35), signal); }
      catch (error) { if (signal?.aborted) throw error; /* The agent can still use explicit history tools. */ }
    }
    let system = promptForConversation(guidedProject, session, memories, task, identity, libraryContext, true, historyContext, systemPromptCharBudget(config));
    const active = await store.messages(session, session.activeFrom);
    const scope = { projects: allowed, workspaceAccess: agent.workspaceAccess, defaultProjectId: project.id, workspaceProjects: manifest.projects, toolProfiles: manifest.toolProfiles || [] };
    const imagePriority = imageCandidates(args.imageConfig, manifest.modelPreferences.image);
    const toolReserve = harnessToolReserve({ folder, scope, history: { store, meta: session }, imageConfig: args.imageConfig, imagePriority, signal }, config, task);
    if (needsCompaction(session, active, task, config, system, toolReserve, args.compactionAt)) {
      session = await compactConversation(session, active, config, signal);
      await saveSession();
      try { historyContext = await recallHistory(store, session, task, Math.floor(systemPromptCharBudget(config) * .35), signal); }
      catch (error) { if (signal?.aborted) throw error; /* The compacted summary remains available. */ }
      system = promptForConversation(guidedProject, session, memories, task, identity, libraryContext, true, historyContext, systemPromptCharBudget(config));
    }
    if (signal?.aborted) throw signal.reason || new DOMException('Agent stopped.', 'AbortError');
    if (!existingSession) await saveSession();
    if (signal?.aborted) throw signal.reason || new DOMException('Agent stopped.', 'AbortError');
    await append({ id: newId(), role: 'user', content: task || 'Review this project and report useful next work.', createdAt: isoNow() });
    const recent = await store.messages(session, session.activeFrom);
    let completion;
    try {
      completion = await harnessComplete({ config, fallbacks: candidates.slice(1), turns: messagesForModel(recent), system, systemForConfig: candidate => promptForConversation(guidedProject, session, memories, task, identity, libraryContext, true, historyContext, systemPromptCharBudget(candidate)), signal, folder, history: { store, meta: session }, imageConfig: args.imageConfig, imagePriority, scope, approvalSessionKey: `${store.workspaceId}:${session.id}`, onToolApproval: args.onToolApproval });
    } catch (error) {
      if (error instanceof HarnessPartialToolError) {
        try { await append({ id: newId(), role: 'tool', content: `Interrupted tool run: ${error.message}`, createdAt: isoNow(), model: modelStamp(error.usedConfig), toolEvents: error.completedChanges }); }
        catch (saveError) { throw new Error(`${error.message} The agent run log could not be saved: ${saveError instanceof Error ? saveError.message : String(saveError)}`, { cause: error }); }
      }
      throw error;
    }
    await append({ id: newId(), role: 'assistant', content: completion.text, createdAt: isoNow(), model: modelStamp(completion.usedConfig), inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, toolEvents: preflightError ? [`Selected model preflight failed: ${base.label}: ${preflightError}`, ...(completion.toolEvents || [])] : completion.toolEvents });
    return { session, result: completion.text };
  } finally { release(); }
}
