import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog.tsx';
import { appendTaskNote, createTask, type TaskRecord, type TaskStatus } from './harnessTasks.ts';
import { isoNow } from './harnessData.ts';
import type { HarnessAgent, HarnessProject } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import './harnessTasks.css';

type Assignment = '' | 'human' | `agent:${string}`;
const choiceFor = (task: TaskRecord): Assignment => task.assignee?.kind === 'agent' ? `agent:${task.assignee.agentId}` : task.assignee?.kind === 'human' ? 'human' : '';
const assignmentFor = (choice: Assignment): TaskRecord['assignee'] => choice === 'human' ? { kind: 'human' } : choice.startsWith('agent:') ? { kind: 'agent', agentId: choice.slice(6) } : null;
const canAccess = (agent: HarnessAgent, task: Pick<TaskRecord, 'scope' | 'projectId'>) => task.scope === 'workspace' ? agent.workspaceAccess && (agent.allProjects || agent.projectIds.length > 0) : agent.allProjects || agent.projectIds.includes(task.projectId || '');

export default function HarnessTasks({ store, project, agents, onQueueAgent, onWrite }: {
  store: HarnessStore;
  project: HarnessProject;
  agents: HarnessAgent[];
  onQueueAgent: (task: TaskRecord, agent: HarnessAgent) => Promise<void>;
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
}) {
  const confirm = useConfirmDialog();
  const [items, setItems] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  const [scope, setScope] = useState<TaskRecord['scope']>('project');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [humanOnly, setHumanOnly] = useState(false);
  const [assignment, setAssignment] = useState<Assignment>('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const visible = useMemo(() => items.filter(task => (task.scope === 'workspace' || task.projectId === project.id) && (showDone || task.status !== 'done'))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.updatedAt.localeCompare(a.updatedAt)), [items, project.id, showDone]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void store.tasks().then(tasks => { if (active) setItems(tasks); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (active) setLoading(false); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store, project.id]);

  const reset = () => { setEditing(null); setScope('project'); setTitle(''); setDescription(''); setHumanOnly(false); setAssignment(''); };
  const edit = (task: TaskRecord) => { setEditing(task); setScope(task.scope); setTitle(task.title); setDescription(task.description); setHumanOnly(task.humanOnly); setAssignment(choiceFor(task)); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  async function run(change: (tasks: TaskRecord[]) => TaskRecord[]): Promise<boolean> {
    setBusy(true); setError('');
    try { setItems(await onWrite(() => store.updateTasks(change))); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    if (!title.trim()) return;
    const saved = await run(tasks => {
      const assignee = humanOnly ? assignment === 'human' ? { kind: 'human' } as const : null : assignmentFor(assignment);
      if (!editing) {
        const task = createTask(scope, scope === 'project' ? project.id : undefined, title, description, humanOnly);
        return [task.assignee === assignee ? task : { ...task, assignee }, ...tasks];
      }
      const current = tasks.find(task => task.id === editing.id);
      if (!current || current.updatedAt !== editing.updatedAt) throw new Error('This task changed in another tab. Refresh before editing it.');
      const updated: TaskRecord = { ...current, title: title.trim().slice(0, 160), description: description.trim().slice(0, 12_000),
        humanOnly, assignee, updatedAt: isoNow() };
      return tasks.map(task => task.id === updated.id ? updated : task);
    });
    // A failed update leaves its draft visible for correction.
    if (saved) reset();
  }
  async function setStatus(task: TaskRecord, status: TaskStatus) {
    await run(tasks => tasks.map(current => {
      if (current.id !== task.id) return current;
      if (current.updatedAt !== task.updatedAt) throw new Error('This task changed in another tab. Refresh before updating it.');
      return { ...current, status, updatedAt: isoNow() };
    }));
  }
  async function addNote(task: TaskRecord) {
    const text = noteDrafts[task.id] || '';
    if (await run(tasks => tasks.map(current => current.id === task.id ? appendTaskNote(current, text, 'human') : current))) setNoteDrafts(current => ({ ...current, [task.id]: '' }));
  }
  async function remove(task: TaskRecord) {
    if (!await confirm(`Remove task “${task.title}” and its notes?`, { title: 'Remove task', confirmLabel: 'Remove', destructive: true })) return;
    const removed = await run(tasks => {
      const current = tasks.find(item => item.id === task.id);
      if (current?.updatedAt !== task.updatedAt) throw new Error('This task changed in another tab. Refresh before removing it.');
      return tasks.filter(item => item.id !== task.id);
    });
    if (removed && editing?.id === task.id) reset();
  }
  const availableAgents = agents.filter(agent => canAccess(agent, { scope, projectId: scope === 'project' ? project.id : undefined }));
  return <section className="harness-page harness-tasks-page">
    <div className="harness-heading"><div><span className="harness-overline">SHARED WORK</span><h1>Tasks</h1><p>Track work for yourself and your agents.</p></div><button className="harness-secondary" onClick={() => { setLoading(true); void store.tasks().then(setItems).catch(cause => setError(String(cause))).finally(() => setLoading(false)); }} aria-label="Refresh tasks"><RefreshCw size={15}/> Refresh</button></div>
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    <div className="harness-task-layout">
      <form className="harness-card harness-task-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>{editing ? 'Edit task' : 'New task'}</h2>
        <label>Where<select value={scope} disabled={busy || !!editing} onChange={event => { setScope(event.target.value as TaskRecord['scope']); setAssignment(''); }}><option value="project">{project.name}</option><option value="workspace">Entire workspace</option></select></label>
        <label>Title<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" required/></label>
        <label>Details<textarea value={description} maxLength={12000} rows={5} onChange={event => setDescription(event.target.value)} placeholder="Context, acceptance criteria, links…"/></label>
        <label>Assigned to<select value={assignment} onChange={event => setAssignment(event.target.value as Assignment)}><option value="">Unassigned</option><option value="human">Me</option>{!humanOnly && availableAgents.map(agent => <option key={agent.id} value={`agent:${agent.id}`}>{agent.name}</option>)}</select></label>
        <label className="harness-task-check"><input type="checkbox" checked={humanOnly} onChange={event => { setHumanOnly(event.target.checked); if (event.target.checked && assignment.startsWith('agent:')) setAssignment(''); }}/><span>Human only · agents cannot claim or change this task</span></label>
        <div className="harness-task-actions"><button className="harness-primary" disabled={busy || !title.trim()}><Plus size={14}/>{editing ? 'Save changes' : 'Add task'}</button>{editing && <button type="button" className="harness-secondary" onClick={reset}>Cancel</button>}</div>
      </form>
      <div className="harness-task-list"><div className="harness-task-list-head"><strong>{loading ? 'Loading…' : `${visible.length} task${visible.length === 1 ? '' : 's'}`}</strong><label><input type="checkbox" checked={showDone} onChange={event => setShowDone(event.target.checked)}/> Show completed</label></div>
        {!loading && !visible.length && <div className="harness-card harness-task-empty"><ClipboardList size={28}/><p>No {showDone ? '' : 'open '}tasks here yet.</p></div>}
        {visible.map(task => {
          const assignedAgentId = task.assignee?.kind === 'agent' ? task.assignee.agentId : '';
          const assignedAgent = assignedAgentId ? agents.find(agent => agent.id === assignedAgentId) : undefined;
          return <article className="harness-card harness-task-card" key={task.id}>
            <div className="harness-task-card-head"><div><small>{task.scope === 'workspace' ? 'WORKSPACE' : project.name.toUpperCase()} · {task.humanOnly ? 'HUMAN ONLY' : assignedAgentId ? `AGENT: ${assignedAgent?.name || assignedAgentId}` : task.assignee?.kind === 'human' ? 'ASSIGNED TO YOU' : 'UNASSIGNED'}</small><h2>{task.title}</h2></div><select aria-label={`Status for ${task.title}`} value={task.status} disabled={busy} onChange={event => void setStatus(task, event.target.value as TaskStatus)}><option value="open">Open</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select></div>
            {task.description && <p className="harness-task-description">{task.description}</p>}
            {task.notes.length > 0 && <details><summary>{task.notes.length} note{task.notes.length === 1 ? '' : 's'}</summary><ol>{task.notes.map(note => <li key={note.id}><small>{new Date(note.createdAt).toLocaleString()} · {note.author === 'human' ? 'You' : agents.find(agent => agent.id === note.agentId)?.name || 'Agent'}</small><p>{note.text}</p></li>)}</ol></details>}
            <form className="harness-task-note" onSubmit={event => { event.preventDefault(); void addNote(task); }}><input aria-label={`Note for ${task.title}`} placeholder="Add progress or a question…" maxLength={4000} value={noteDrafts[task.id] || ''} onChange={event => setNoteDrafts(drafts => ({ ...drafts, [task.id]: event.target.value }))}/><button className="harness-secondary" disabled={busy || !noteDrafts[task.id]?.trim()}>Add note</button></form>
            <div className="harness-task-actions"><button className="harness-secondary" onClick={() => edit(task)} disabled={busy}>Edit</button>{assignedAgent && !assignedAgent.paused && assignedAgent.schedule !== 'manual' && task.status !== 'done' && <button className="harness-secondary" onClick={() => void onQueueAgent(task, assignedAgent).catch(cause => setError(String(cause)))}>Queue for agent</button>}<button className="harness-danger" onClick={() => void remove(task)} disabled={busy}>Remove</button><span>{new Date(task.updatedAt).toLocaleDateString()}</span></div>
          </article>;
        })}
      </div>
    </div>
  </section>;
}
