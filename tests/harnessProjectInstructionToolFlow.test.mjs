import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  name = 'test';
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

test('a compatible model can propose revised project instructions without saving them', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const { HarnessStore } = await vite.ssrLoadModule('/src/harnessStore.ts');
    const { createConversation } = await vite.ssrLoadModule('/src/harnessData.ts');
    const { harnessComplete } = await vite.ssrLoadModule('/src/harnessMultimodal.ts');
    const { projectInstructionDraftFromToolEvent } = await vite.ssrLoadModule('/src/harnessProjectInstructionDraft.ts');
    const store = new HarnessStore('project-instruction-tool-flow', new MemoryDirectory());
    const manifest = await store.manifest();
    let round = 0;
    const offered = [];
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/chat\/completions$/);
      const request = JSON.parse(init.body);
      offered.push(request.tools?.map(tool => tool.function.name) || []);
      const message = round++ === 0
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'propose_project_instructions', arguments: '{"instructions":"Check files before editing and run focused tests."}' } }] }
        : { role: 'assistant', content: 'Please review the updated project guidance.' };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: round === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 12 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const response = await harnessComplete({
      config: { id: 'test', label: 'Test', provider: 'compatible', model: 'mock', endpoint: 'http://mock.local/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 512, contextWindow: 8192 },
      turns: [{ role: 'user', content: 'Revise this project instructions for coding.' }], system: 'You are a coding assistant.', folder: null,
      scope: { projects: manifest.projects, defaultProjectId: 'home', workspaceAccess: false, workspaceReadOnly: false },
      history: { store, meta: createConversation('home') }, imageConfig: { preset: 'none', provider: 'compatible', endpoint: '', model: '', apiKey: '' },
    });
    assert(offered[0].includes('get_project_instructions'));
    assert(offered[0].includes('propose_project_instructions'));
    const event = response.toolEvents.find(item => item.startsWith('project_instruction_draft: '));
    assert(event);
    const draft = projectInstructionDraftFromToolEvent(event);
    assert.equal(draft.projectId, 'home');
    assert.equal(draft.instructions, 'Check files before editing and run focused tests.');
    assert.equal((await store.manifest()).projects[0].instructions, '');
    assert.equal((await store.project('home')).instructions, '');
  } finally { globalThis.fetch = originalFetch; await vite.close(); }
});
