import type { HarnessAgent } from './harnessData.ts';

/** Remove one unclaimed event without disturbing other queued work or a user delay. */
export function dismissAgentEvent(agent: HarnessAgent, eventId: string): HarnessAgent {
  if (agent.runClaim) throw new Error('This agent is running. Stop it before changing its event queue.');
  const pendingEvents = (agent.pendingEvents || []).filter(event => event.id !== eventId);
  const removed = pendingEvents.length !== (agent.pendingEvents || []).length || eventId === 'legacy' && !!agent.pendingEvent;
  if (!removed) throw new Error('This event was already handled or removed. Refresh the agent list.');
  const pendingEvent = eventId === 'legacy' ? '' : agent.pendingEvent;
  return { ...agent, pendingEvents, pendingEvent, pendingProjectId: pendingEvent ? agent.pendingProjectId : '',
    nextRunAt: pendingEvents.length || pendingEvent ? agent.nextRunAt || new Date().toISOString() : '' };
}
