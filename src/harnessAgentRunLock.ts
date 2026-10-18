import type { HarnessAgent, HarnessManifest } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';

function eventId(agent: HarnessAgent) {
  return agent.pendingEvents?.[0]?.id || (agent.pendingEvent ? 'legacy' : null);
}

function stillDue(live: HarnessAgent, scheduled: HarnessAgent) {
  return !live.paused && !live.runClaim && live.schedule !== 'manual' && !!live.nextRunAt
    && live.nextRunAt === scheduled.nextRunAt && Date.parse(live.nextRunAt) <= Date.now()
    && (live.schedule !== 'event' || !!eventId(live) && eventId(live) === eventId(scheduled));
}

/** Hold an origin-wide agent lock through the entire run, then verify the saved schedule. */
export async function withAgentRunLock<T>(store: Pick<HarnessStore, 'workspaceId' | 'manifest'>, scheduled: HarnessAgent, manual: boolean,
  run: (agent: HarnessAgent, manifest: HarnessManifest) => Promise<T>): Promise<T | null> {
  const start = async () => {
    const manifest = await store.manifest();
    const agent = manifest.agents.find(item => item.id === scheduled.id);
    if (!agent || agent.runClaim || !manual && !stillDue(agent, scheduled)) return null;
    return run(agent, manifest);
  };
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return start();
  return locks.request(`local-agent-lab:agent:${store.workspaceId}:${scheduled.id}`, { ifAvailable: true }, lock => lock ? start() : null);
}

/** Do not clear an interrupted claim while another tab still holds this agent's run lock. */
export async function withIdleAgentLock<T>(workspaceId: string, agentId: string, work: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return work();
  return locks.request(`local-agent-lab:agent:${workspaceId}:${agentId}`, { ifAvailable: true }, lock => lock ? work() : null);
}
