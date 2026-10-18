import { isoNow, newId } from './harnessData.ts';

export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done';
export type TaskNote = { id: string; createdAt: string; author: 'human' | 'agent'; agentId?: string; text: string };
export type TaskRecord = {
  id: string;
  scope: 'workspace' | 'project';
  projectId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  humanOnly: boolean;
  assignee: { kind: 'human' } | { kind: 'agent'; agentId: string } | null;
  notes: TaskNote[];
  createdAt: string;
  updatedAt: string;
};

export function validateTasks(value: unknown): value is TaskRecord[] {
  return Array.isArray(value) && value.length <= 5000 && value.every(task => task && typeof task === 'object'
    && /^[\w-]{1,80}$/.test(task.id) && ['workspace', 'project'].includes(task.scope)
    && (task.scope === 'workspace' ? !task.projectId : typeof task.projectId === 'string' && /^[\w-]{1,80}$/.test(task.projectId))
    && typeof task.title === 'string' && task.title.length > 0 && task.title.length <= 160
    && typeof task.description === 'string' && task.description.length <= 12_000
    && ['open', 'in-progress', 'blocked', 'done'].includes(task.status)
    && typeof task.humanOnly === 'boolean' && (!task.assignee || task.assignee.kind === 'human' || task.assignee.kind === 'agent' && typeof task.assignee.agentId === 'string')
    && Array.isArray(task.notes) && task.notes.length <= 300 && task.notes.every((note: TaskNote) => note && typeof note.id === 'string' && typeof note.createdAt === 'string' && ['human', 'agent'].includes(note.author) && typeof note.text === 'string' && note.text.length <= 4000)
    && typeof task.createdAt === 'string' && typeof task.updatedAt === 'string');
}

export function createTask(scope: TaskRecord['scope'], projectId: string | undefined, title: string, description = '', humanOnly = false): TaskRecord {
  const now = isoNow();
  const record: TaskRecord = { id: newId(), scope, ...(scope === 'project' ? { projectId } : {}), title: title.trim().slice(0, 160),
    description: description.trim().slice(0, 12_000), status: 'open', humanOnly, assignee: null, notes: [], createdAt: now, updatedAt: now };
  if (!validateTasks([record])) throw new Error('Enter a task title and valid project.');
  return record;
}

export function appendTaskNote(task: TaskRecord, text: string, author: TaskNote['author'], agentId?: string): TaskRecord {
  const note = text.trim();
  if (!note || note.length > 4000) throw new Error('Task notes must contain 1 to 4000 characters.');
  if (author === 'agent' && (task.humanOnly || !agentId || task.assignee?.kind !== 'agent' || task.assignee.agentId !== agentId)) throw new Error('This agent cannot update the task.');
  const now = isoNow();
  return { ...task, status: author === 'agent' && task.status === 'open' ? 'in-progress' : task.status,
    notes: [...task.notes, { id: newId(), createdAt: now, author, ...(agentId ? { agentId } : {}), text: note }], updatedAt: now };
}

export function taskVisibleToAgent(task: TaskRecord, allowedProjectIds: string[], workspaceAccess: boolean): boolean {
  return task.scope === 'workspace' ? workspaceAccess : !!task.projectId && allowedProjectIds.includes(task.projectId);
}

export function claimTask(task: TaskRecord, agentId: string): TaskRecord {
  if (task.humanOnly) throw new Error('This task is reserved for the person.');
  if (task.status === 'done') throw new Error('This task is already complete.');
  if (task.assignee && (task.assignee.kind !== 'agent' || task.assignee.agentId !== agentId)) throw new Error('This task is assigned to someone else.');
  return { ...task, assignee: { kind: 'agent', agentId }, status: 'in-progress', updatedAt: isoNow() };
}
