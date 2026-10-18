import type { HarnessAgent, HarnessProject } from './harnessData.ts';

export default function HarnessAgentEvents({ agent, projects, disabled, onDismiss }: {
  agent: HarnessAgent;
  projects: HarnessProject[];
  disabled: boolean;
  onDismiss: (eventId: string, description: string) => void;
}) {
  const events = [
    ...(agent.pendingEvents || []),
    ...(agent.pendingEvent ? [{ id: 'legacy', projectId: agent.pendingProjectId || '', description: agent.pendingEvent, createdAt: '' }] : []),
  ];
  if (!events.length) return null;
  const names = new Map(projects.map(project => [project.id, project.name]));
  return <details className="harness-agent-events">
    <summary>{events.length} pending event{events.length === 1 ? '' : 's'}</summary>
    <div className="harness-agent-event-list">{events.slice(0, 20).map(event => <div className="harness-agent-event" key={event.id}>
      <div><strong>{event.description}</strong><small>{names.get(event.projectId) || 'Project'}{event.createdAt ? ` · ${new Date(event.createdAt).toLocaleString()}` : ''}</small></div>
      <button type="button" className="harness-danger" disabled={disabled} onClick={() => onDismiss(event.id, event.description)} aria-label={`Dismiss event: ${event.description}`}>Dismiss</button>
    </div>)}{events.length > 20 && <p>{events.length - 20} more events will appear as earlier ones are handled.</p>}</div>
  </details>;
}
