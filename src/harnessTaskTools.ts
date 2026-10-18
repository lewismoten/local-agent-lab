import type { BrowserTools } from './browserModel.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';
import { assertToolAllowed } from './harnessToolPermissions.ts';
import { appendTaskNote, claimTask, taskVisibleToAgent, type TaskRecord, type TaskStatus } from './harnessTasks.ts';
import { isoNow } from './harnessData.ts';

const identify = (value: unknown) => {
  const id = String(value || '');
  if (!/^[\w-]{1,80}$/.test(id)) throw new Error('Choose a task ID from list_tasks.');
  return id;
};

export function browserTaskTools(store: HarnessStore, scope: ToolScope, signal?: AbortSignal): BrowserTools {
  const write = !!scope.agentId && (scope.workspaceAccess || scope.projects.some(project => project.toolAccess !== 'read-only'));
  const definitions: BrowserTools['definitions'] = [
    { type: 'function', function: { name: 'list_tasks', description: 'List open workspace or project tasks, including assignment and human-only restrictions. Use read_task for details.', parameters: { type: 'object', properties: { project: { type: 'string', description: 'Project ID, or workspace when authorized. Defaults to the current project.' }, offset: { type: 'number', description: 'Skip this many matching tasks.' } } } } },
    { type: 'function', function: { name: 'read_task', description: 'Read a task and its notes by task ID.', parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } } },
  ];
  if (write) definitions.push(
    { type: 'function', function: { name: 'claim_task', description: 'Assign an available task to this agent before working on it. Human-only tasks cannot be claimed.', parameters: { type: 'object', properties: { task_id: { type: 'string' }, project: { type: 'string', description: 'Task project ID or workspace.' } }, required: ['task_id', 'project'] } } },
    { type: 'function', function: { name: 'add_task_note', description: 'Leave a progress note or question on a task assigned to this agent.', parameters: { type: 'object', properties: { task_id: { type: 'string' }, project: { type: 'string' }, text: { type: 'string' } }, required: ['task_id', 'project', 'text'] } } },
    { type: 'function', function: { name: 'set_task_status', description: 'Set an assigned task to in-progress, blocked, or done. Include a note when blocked to ask the person for clarification.', parameters: { type: 'object', properties: { task_id: { type: 'string' }, project: { type: 'string' }, status: { type: 'string', description: 'in-progress, blocked, or done' }, note: { type: 'string' } }, required: ['task_id', 'project', 'status'] } } },
  );
  const checkStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Task action stopped.', 'AbortError'); };
  const target = (task: TaskRecord, provided: unknown) => {
    const project = task.scope === 'workspace' ? 'workspace' : task.projectId!;
    if (provided !== project) throw new Error('The task project does not match the requested project.');
    if (!taskVisibleToAgent(task, scope.projects.map(item => item.id), scope.workspaceAccess)) throw new Error('This task is outside the agent’s scope.');
    if (project !== 'workspace' && scope.projects.find(item => item.id === project)?.toolAccess === 'read-only') throw new Error('This project is read-only for model tools.');
    return project;
  };
  const render = (task: TaskRecord) => `${task.id} · ${task.scope === 'workspace' ? 'Workspace' : task.projectId} · ${task.status} · ${task.title}${task.humanOnly ? ' · Human only' : ''}${task.assignee ? ` · Assigned to ${task.assignee.kind === 'human' ? 'person' : `agent ${task.assignee.agentId}`}` : ''}`;
  return { definitions, execute: async (name, args) => {
    checkStopped();
    if (name === 'list_tasks') {
      const project = String(args.project || scope.defaultProjectId);
      if (project === 'workspace' ? !scope.workspaceAccess : !scope.projects.some(item => item.id === project)) throw new Error('This project is outside the agent’s scope.');
      const offset = Math.max(0, Math.min(5000, Math.floor(Number(args.offset) || 0)));
      const tasks = (await store.tasks()).filter(task => task.scope === 'workspace' ? project === 'workspace' : task.projectId === project).filter(task => task.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return tasks.length ? `${tasks.slice(offset, offset + 12).map(render).join('\n')}${offset + 12 < tasks.length ? `\nMore tasks: offset ${offset + 12}.` : ''}` : 'No open tasks in this scope.';
    }
    if (name === 'read_task') {
      const task = (await store.tasks()).find(item => item.id === identify(args.task_id));
      if (!task || !taskVisibleToAgent(task, scope.projects.map(item => item.id), scope.workspaceAccess)) throw new Error('Task not found in this agent’s scope.');
      return `${render(task)}\n${task.description.slice(0, 4000)}\n${task.notes.slice(-10).map(note => `${note.createdAt} · ${note.author}${note.agentId ? ` ${note.agentId}` : ''}: ${note.text}`).join('\n').slice(0, 5000)}`.trim();
    }
    if (!write || !['claim_task', 'add_task_note', 'set_task_status'].includes(name)) throw new Error(`Unknown task tool: ${name}`);
    const id = identify(args.task_id);
    let summary = '';
    await store.updateTasks(tasks => {
      checkStopped();
      const index = tasks.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Task not found.');
      const task = tasks[index];
      const project = target(task, args.project);
      assertToolAllowed(scope, name, project === 'workspace' ? scope.defaultProjectId : project);
      if (task.humanOnly) throw new Error('This task is reserved for the person.');
      let updated: TaskRecord;
      if (name === 'claim_task') updated = claimTask(task, scope.agentId!);
      else {
        if (task.assignee?.kind !== 'agent' || task.assignee.agentId !== scope.agentId) throw new Error('Claim this task before updating it.');
        if (name === 'add_task_note') updated = appendTaskNote(task, String(args.text || ''), 'agent', scope.agentId);
        else {
          const status = String(args.status || '') as TaskStatus;
          if (!['in-progress', 'blocked', 'done'].includes(status)) throw new Error('Choose in-progress, blocked, or done.');
          const note = String(args.note || '').trim();
          if (status === 'blocked' && !note) throw new Error('Add a note explaining what you need from the person.');
          updated = note ? appendTaskNote(task, note, 'agent', scope.agentId) : task;
          updated = { ...updated, status, updatedAt: isoNow() };
        }
      }
      summary = render(updated);
      return tasks.map((item, position) => position === index ? updated : item);
    });
    return summary;
  } };
}
