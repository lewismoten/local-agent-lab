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

test('a model journal-setting call reaches review before it changes the workspace', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const { HarnessStore } = await vite.ssrLoadModule('/src/harnessStore.ts');
    const { createConversation } = await vite.ssrLoadModule('/src/harnessData.ts');
    const { harnessComplete } = await vite.ssrLoadModule('/src/harnessMultimodal.ts');
    const store = new HarnessStore('journal-tool-flow', new MemoryDirectory());
    const manifest = await store.manifest();
    let round = 0;
    const offered = [];
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/chat\/completions$/);
      const request = JSON.parse(init.body);
      offered.push(request.tools?.map(tool => tool.function.name) || []);
      const message = round++ === 0
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'set_journal_enabled', arguments: '{"enabled":true}' } }] }
        : { role: 'assistant', content: 'Journal is on.' };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: round === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 12 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const approvals = [];
    const request = {
      config: { id: 'test', label: 'Test', provider: 'compatible', model: 'mock', endpoint: 'http://mock.local/v1', apiKey: '', effort: 'default', thinkingTokens: 0, maxOutputTokens: 512, contextWindow: 8192 },
      turns: [{ role: 'user', content: 'Turn on the workspace journal recording.' }], system: 'You are a coding assistant.', folder: null,
      scope: { projects: manifest.projects, defaultProjectId: 'home', workspaceAccess: false, workspaceReadOnly: false },
      history: { store, meta: createConversation('home') }, imageConfig: { preset: 'none', provider: 'compatible', endpoint: '', model: '', apiKey: '' },
    };
    const result = await harnessComplete({ ...request, onToolApproval: async approval => { approvals.push(approval); assert.equal((await store.journalIndex()).enabled, false); return true; } });
    assert.equal(result.text, 'Journal is on.');
    assert.ok(offered[0].includes('set_journal_enabled'));
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].arguments.scope, 'Entire workspace');
    assert.equal(approvals[0].arguments.current, false);
    assert.equal(approvals[0].arguments.requested, true);
    assert.equal((await store.journalIndex()).enabled, true);
    assert.match(result.toolEvents.join(' '), /set_journal_enabled:.*"enabled":true/);

    await store.setJournalEnabled(false);
    round = 0;
    const denied = await harnessComplete({ ...request, onToolApproval: async () => false });
    assert.equal((await store.journalIndex()).enabled, false);
    assert.match(denied.toolEvents.join(' '), /set_journal_enabled was not approved/);
  } finally { globalThis.fetch = originalFetch; await vite.close(); }
});
