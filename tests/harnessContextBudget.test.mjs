import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('small-model system prompts stay within their character allowance and retain project guidance', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { promptForConversation } = await vite.ssrLoadModule('/src/harnessContext.ts');
    const project = { id: 'project', name: 'Portable coding workspace', description: 'D'.repeat(500), instructions: 'Keep the tests for changed code. '.repeat(120) };
    const meta = { id: 'session', projectId: 'project', activeFrom: 10, contextSummary: 'Prior decision. '.repeat(130), segments: [] };
    const source = 'A long retrieved document. '.repeat(180);
    for (const limit of [320, 500, 800, 1000, 1399, 1400, 2000]) {
      const prompt = promptForConversation(project, meta, [], 'tests', source, source, true, source, limit);
      assert.ok(prompt.length <= limit, `${limit} character allowance was exceeded by ${prompt.length - limit}`);
      assert.match(prompt, /PROJECT INSTRUCTIONS:/, `project guidance was omitted at ${limit} characters`);
    }
  } finally {
    await vite.close();
  }
});

test('a narrow model prompt keeps the oldest durable note and latest update', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { promptForConversation } = await vite.ssrLoadModule('/src/harnessContext.ts');
    const project = { id: 'project', name: 'Portable app', description: '', instructions: '' };
    const meta = { id: 'session', projectId: 'project', activeFrom: 10, contextSummary: `Keep the project index on the USB drive. ${'x'.repeat(900)} Latest part: repair src/cache.ts.`, segments: [] };
    const prompt = promptForConversation(project, meta, [], 'continue', '', '', true, '', 900);
    assert.ok(prompt.length <= 900);
    assert.match(prompt, /USB drive/);
    assert.match(prompt, /src\/cache\.ts/);
  } finally { await vite.close(); }
});

test('small prompts reserve room for both project settings and AGENTS.md guidance', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { promptForConversation } = await vite.ssrLoadModule('/src/harnessContext.ts');
    const project = { id: 'project', name: 'Demo', description: '', instructions: 'Use TypeScript. '.repeat(100), guide: 'Run parser tests. '.repeat(100) };
    const meta = { id: 'session', projectId: 'project', activeFrom: 0, contextSummary: '', segments: [] };
    const prompt = promptForConversation(project, meta, [], 'repair parser', '', '', false, '', 900);
    assert.ok(prompt.length <= 900);
    assert.match(prompt, /PROJECT INSTRUCTIONS:[\s\S]*Use TypeScript/);
    assert.match(prompt, /PROJECT GUIDE \(AGENTS\.md[\s\S]*Run parser tests/);
  } finally { await vite.close(); }
});

test('the configured compaction percentage changes when an active exchange is archived', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { needsCompaction } = await vite.ssrLoadModule('/src/harnessContext.ts');
    const config = { provider: 'ollama', model: 'local', contextWindow: 2048, maxOutputTokens: 512 };
    const active = [{ role: 'user', content: 'a'.repeat(3200) }];
    assert.equal(needsCompaction({}, active, '', config, '', 0, 60), true);
    assert.equal(needsCompaction({}, active, '', config, '', 0, 95), false);
  } finally { await vite.close(); }
});
