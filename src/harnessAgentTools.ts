import type { BrowserTools } from './browserModel.ts';
import type { HarnessManifest } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';

/** An agent can inspect only projects it can access; proposals never save or schedule a run. */
export function browserAgentTools(store: Pick<HarnessStore, 'manifest'>, scope: ToolScope, signal?: AbortSignal): BrowserTools {
  const stopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Agent lookup stopped.', 'AbortError'); };
  const allowed = new Set(scope.projects.map(project => project.id));
  const projectFor = (value: unknown): string => {
    const id = typeof value === 'string' && value.trim() ? value.trim() : scope.defaultProjectId;
    if (!allowed.has(id)) throw new Error('This project is outside the agent’s scope.');
    return id;
  };
  return {
    definitions: [
      { type: 'function', function: { name: 'list_agents', description: 'List agents available to the current project, including schedule and paused state. Does not start or change them.', parameters: { type: 'object', properties: { project: { type: 'string', description: 'Allowed project ID; omit for the current project.' } } } } },
      { type: 'function', function: { name: 'propose_agent', description: 'Draft a new coding or research agent for the person to review. The draft is not saved, scheduled, or run.', parameters: { type: 'object', properties: {
        name: { type: 'string', description: 'Short agent name.' }, task: { type: 'string', description: 'The agent’s standing task.' },
        identity: { type: 'string', description: 'Optional working style or persona instructions.' }, project: { type: 'string', description: 'Allowed project ID; omit for the current project.' },
      }, required: ['name', 'task'] } } },
      { type: 'function', function: { name: 'get_project_instructions', description: 'Read the current project name, description, and saved instructions for chat and agents. AGENTS.md is a separate file.', parameters: { type: 'object', properties: {} } } },
      ...(!scope.agentId ? [{ type: 'function' as const, function: { name: 'propose_project_instructions', description: 'Suggest replacement instructions for this project. Opens an editable Project settings draft for the person; does not save the change.', parameters: { type: 'object' as const, properties: {
        instructions: { type: 'string', description: 'Complete replacement for the project instructions, up to 2000 characters.' },
      }, required: ['instructions'] } } }] : []),
      ...(!scope.agentId ? [{ type: 'function' as const, function: { name: 'propose_project', description: 'Draft a new project for the person to review in Project settings. Nothing is created until the person saves the form.', parameters: { type: 'object' as const, properties: {
        name: { type: 'string', description: 'Short project name.' }, description: { type: 'string', description: 'What the project is for.' }, instructions: { type: 'string', description: 'Optional instructions for chat and agents in this project.' },
      }, required: ['name', 'description'] } } }] : []),
    ],
    execute: async (name, args) => {
      stopped();
      const projectId = projectFor(args.project);
      if (name === 'list_agents') {
        const manifest: HarnessManifest = await store.manifest();
        stopped();
        const visible = manifest.agents.filter(agent => agent.allProjects || agent.projectIds.includes(projectId));
        return JSON.stringify({ project: projectId, agents: visible.slice(0, 30).map(agent => ({ id: agent.id, name: agent.name, schedule: agent.schedule, paused: agent.paused, task: agent.prompt.slice(0, 240) })), more: visible.length > 30 });
      }
      if (name === 'propose_agent') {
        const agentName = String(args.name || '').trim();
        const task = String(args.task || '').trim();
        const identity = String(args.identity || '').trim();
        if (!agentName || agentName.length > 80 || !task || task.length > 2000 || identity.length > 2000) throw new Error('Use a name up to 80 characters and task and identity up to 2000 characters.');
        return JSON.stringify({ draft: { name: agentName, task, identity, projectId }, reviewRequired: true });
      }
      if (name === 'get_project_instructions' || name === 'propose_project_instructions' && !scope.agentId) {
        const manifest = await store.manifest();
        stopped();
        const project = manifest.projects.find(item => item.id === scope.defaultProjectId);
        if (!project || !allowed.has(project.id)) throw new Error('The current project is unavailable.');
        if (name === 'get_project_instructions') return JSON.stringify({ projectId: project.id, name: project.name, description: project.description, instructions: project.instructions.slice(0, 2000), truncated: project.instructions.length > 2000, updatedAt: project.updatedAt });
        if (typeof args.instructions !== 'string' || args.instructions.length > 2000) throw new Error('Provide complete project instructions up to 2000 characters. An empty string clears them.');
        return JSON.stringify({ draft: { projectId: project.id, instructions: args.instructions, expectedUpdatedAt: project.updatedAt }, reviewRequired: true, saved: false });
      }
      if (name === 'propose_project' && !scope.agentId) {
        const projectName = String(args.name || '').trim();
        const description = String(args.description || '').trim();
        const instructions = String(args.instructions || '').trim();
        if (!projectName || projectName.length > 80 || !description || description.length > 500 || instructions.length > 2000) throw new Error('Use a name up to 80 characters, a description up to 500, and instructions up to 2000.');
        return JSON.stringify({ draft: { name: projectName, description, instructions, sourceProjectId: projectId }, reviewRequired: true, saved: false });
      }
      throw new Error(`Unknown agent tool: ${name}`);
    },
  };
}
