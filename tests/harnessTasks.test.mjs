import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { appendTaskNote, claimTask, createTask } from '../src/harnessTasks.ts';
import { browserTaskTools } from '../src/harnessTaskTools.ts';
import { isMutatingToolName } from '../src/harnessToolActions.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
}
const project = id => ({ id, name: id, instructions: '', description: '', createdAt: '', updatedAt: '' });
const scope = { projects: [project('alpha')], defaultProjectId: 'alpha', workspaceAccess: false, agentId: 'agent-1' };

test('workspace and project tasks persist through a reopened store and serialize concurrent edits', async () => {
  const folder = new MemoryDirectory();
  const first = new HarnessStore('task-store', folder);
  const one = createTask('project', 'alpha', 'Fix the build');
  const two = createTask('workspace', undefined, 'Review the roadmap');
  await Promise.all([first.updateTasks(tasks => [...tasks, one]), first.updateTasks(tasks => [...tasks, two])]);
  const reopened = new HarnessStore('task-store', folder);
  assert.deepEqual((await reopened.tasks()).map(task => task.title).sort(), ['Fix the build', 'Review the roadmap']);
  await assert.rejects(first.updateTasks(tasks => [...tasks, { ...one, id: 'bad/id' }]), /task limits/);
  assert.equal((await reopened.tasks()).length, 2);
});

test('agent task tools enforce scope, human-only restrictions, ownership, and progress notes', async () => {
  const store = new HarnessStore('task-tools', new MemoryDirectory());
  const open = createTask('project', 'alpha', 'Implement parser');
  const human = createTask('project', 'alpha', 'Review privacy', '', true);
  const other = createTask('project', 'beta', 'Secret project');
  const workspace = createTask('workspace', undefined, 'Global work');
  await store.updateTasks(() => [open, human, other, workspace]);
  const tools = browserTaskTools(store, scope);
  assert.deepEqual(tools.definitions.map(item => item.function.name), ['list_tasks', 'read_task', 'claim_task', 'add_task_note', 'set_task_status']);
  assert.match(await tools.execute('list_tasks', {}), /Implement parser/);
  await assert.rejects(tools.execute('read_task', { task_id: other.id }), /outside|not found/i);
  await assert.rejects(tools.execute('claim_task', { task_id: human.id, project: 'alpha' }), /reserved/);
  await assert.rejects(tools.execute('claim_task', { task_id: other.id, project: 'beta' }), /outside/);
  await assert.rejects(tools.execute('claim_task', { task_id: workspace.id, project: 'workspace' }), /outside/);
  await assert.rejects(tools.execute('add_task_note', { task_id: open.id, project: 'alpha', text: 'Started' }), /Claim/);
  assert.match(await tools.execute('claim_task', { task_id: open.id, project: 'alpha' }), /in-progress/);
  assert.match(await tools.execute('add_task_note', { task_id: open.id, project: 'alpha', text: 'Need the input format.' }), /Implement parser/);
  await assert.rejects(tools.execute('set_task_status', { task_id: open.id, project: 'alpha', status: 'blocked' }), /note/);
  await tools.execute('set_task_status', { task_id: open.id, project: 'alpha', status: 'blocked', note: 'Please clarify the input format.' });
  const saved = (await store.tasks()).find(task => task.id === open.id);
  assert.equal(saved.status, 'blocked');
  assert.deepEqual(saved.notes.map(note => note.text), ['Need the input format.', 'Please clarify the input format.']);
  assert.equal(saved.notes[1].agentId, 'agent-1');
  assert.equal(isMutatingToolName('set_task_status'), true);
});

test('chat can read tasks but cannot claim them; project read-only mode blocks agent mutations', async () => {
  const store = new HarnessStore('task-permissions', new MemoryDirectory());
  const task = createTask('project', 'alpha', 'Write tests');
  await store.updateTasks(() => [task]);
  const chat = browserTaskTools(store, { ...scope, agentId: undefined });
  assert.deepEqual(chat.definitions.map(item => item.function.name), ['list_tasks', 'read_task']);
  await assert.rejects(chat.execute('claim_task', { task_id: task.id, project: 'alpha' }), /Unknown/);
  const locked = browserTaskTools(store, { ...scope, projects: [{ ...project('alpha'), toolAccess: 'read-only' }] });
  assert.deepEqual(locked.definitions.map(item => item.function.name), ['list_tasks', 'read_task']);
  await assert.rejects(locked.execute('claim_task', { task_id: task.id, project: 'alpha' }), /Unknown/);
  const denied = browserTaskTools(store, { ...scope, projects: [{ ...project('alpha'), toolPermissions: { claim_task: 'deny' } }] });
  await assert.rejects(denied.execute('claim_task', { task_id: task.id, project: 'alpha' }), /blocked/);
});

test('one agent cannot alter another agent’s task', () => {
  const assigned = claimTask(createTask('project', 'alpha', 'Compile notes'), 'agent-1');
  assert.throws(() => claimTask(assigned, 'agent-2'), /assigned to someone else/);
  assert.throws(() => appendTaskNote(assigned, 'Updated.', 'agent', 'agent-2'), /cannot update/);
});
