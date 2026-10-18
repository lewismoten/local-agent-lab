import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFileTools } from '../src/harnessTools.ts';
import { browserHistoryTools } from '../src/harnessHistory.ts';
import { browserMemoryTools } from '../src/harnessMemoryTools.ts';
import { harnessToolIntent, selectHarnessToolDefinitions, toolSchemaTokens } from '../src/harnessToolSelection.ts';

const definitions = browserFileTools({}, { projects: [{ id: 'home', filesPath: 'repositories/demo' }], defaultProjectId: 'home', workspaceAccess: false }).definitions;
const names = selected => selected.map(item => item.function.name);

test('unmapped projects do not offer Git tools for a Git request', () => {
  const unmapped = browserFileTools({}, { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false }).definitions;
  assert.ok(!names(selectHarnessToolDefinitions(unmapped, 'Show me the Git diff', 4096)).some(name => name.startsWith('git_')));
});

test('small contexts offer relevant coding tools within a bounded schema budget', () => {
  const selected = selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts and update tests', 4096);
  assert.deepEqual(names(selected), ['read_file', 'search_files', 'replace_in_file', 'list_files']);
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 4096 * .2);
  assert.ok(toolSchemaTokens(selected) < toolSchemaTokens(definitions) / 2);
});

test('short-context tool choices follow explicit file and Git requests', () => {
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Check syntax in src/app.ts', 4096)).includes('check_syntax'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Create a new source file', 4096)).includes('write_file'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Build a website', 4096)).includes('write_file'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Delete the obsolete file', 4096)).includes('delete_file'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Show me the Git diff', 4096)).includes('git_diff'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Initialize a Git repository', 4096)).includes('git_init'));
  assert.ok(!names(selectHarnessToolDefinitions(definitions, 'Create a new Git branch', 4096)).includes('git_init'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Show recent Git commits', 4096)).includes('git_history'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Stage the changed file', 4096)).includes('git_stage'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Unstage the file', 4096)).includes('git_unstage'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Commit the staged changes', 4096)).includes('git_commit'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Create a new Git branch', 4096)).includes('git_create_branch'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Apply a patch to this file', 4096)).includes('apply_patch'));
  assert.ok(names(selectHarnessToolDefinitions(definitions, 'Find the PDF in my library', 4096)).includes('search_library'));
  assert.deepEqual(selectHarnessToolDefinitions(definitions, 'Explain closures in JavaScript', 4096), []);
});

test('a tiny context gives the requested Git action priority over related tools', () => {
  const first = request => names(selectHarnessToolDefinitions(definitions, request, 1024))[0];
  assert.equal(first('Show me the Git diff'), 'git_diff');
  assert.equal(first('Commit the staged changes'), 'git_commit');
  assert.equal(first('Show recent Git commits'), 'git_history');
  assert.equal(first('Unstage the file'), 'git_unstage');
});

test('a tiny coding request can carry both read and edit tools', () => {
  const selected = selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts', 1024);
  assert.deepEqual(names(selected), ['read_file', 'replace_in_file']);
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 280);
  assert.equal(selected[0].function.description, definitions.find(tool => tool.function.name === 'read_file').function.description);
  assert.ok(selected[0].function.parameters.properties.path);
  assert.ok(definitions.find(tool => tool.function.name === 'read_file').function.parameters.properties.path.description);
});

test('brief follow-ups retain the recently discussed coding task', () => {
  const intent = harnessToolIntent([
    { role: 'user', content: 'Fix the bug in src/app.ts and update the tests.' },
    { role: 'assistant', content: 'I found the issue. I can patch the file and run a syntax check.' },
    { role: 'user', content: 'Go ahead.' },
  ]);
  const selected = names(selectHarnessToolDefinitions(definitions, intent, 4096));
  assert.ok(selected.includes('read_file'));
  assert.ok(selected.includes('replace_in_file') || selected.includes('apply_patch'));
  assert.ok(selected.includes('check_syntax'));
  assert.equal(harnessToolIntent([{ role: 'user', content: 'Explain closures in JavaScript.' }]), 'Explain closures in JavaScript.');
});

test('brief follow-ups after compaction use only the bounded archived task hint', () => {
  const intent = harnessToolIntent([{ role: 'user', content: 'Continue.' }], '[Recent archived exchange · user]\nFix the bug in src/cache.ts and update tests.\n[Recent archived exchange · assistant]\nI can patch the file and check syntax.');
  const selected = names(selectHarnessToolDefinitions(definitions, intent, 4096));
  assert.ok(selected.includes('read_file'));
  assert.ok(selected.includes('replace_in_file') || selected.includes('apply_patch'));
  assert.ok(selected.includes('check_syntax'));
  assert.equal(harnessToolIntent([{ role: 'user', content: 'Explain closures.' }], 'Delete files.'), 'Explain closures.');
});

test('a short image approval retains the earlier image request', () => {
  const intent = harnessToolIntent([
    { role: 'user', content: 'Draw a logo for this project.' },
    { role: 'assistant', content: 'I can generate an original neon mark.' },
    { role: 'user', content: 'Yes, please.' },
  ]);
  const image = { type: 'function', function: { name: 'generate_image', description: 'Create an image.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } };
  assert.ok(names(selectHarnessToolDefinitions([...definitions, image], intent, 4096)).includes('generate_image'));
});

test('short-context recovery requests expose backup tools without the full catalog', () => {
  const selected = names(selectHarnessToolDefinitions(definitions, 'Restore the previous version of src/app.ts', 4096));
  assert.deepEqual(selected, ['list_backups', 'inspect_backup', 'file_info', 'restore_backup']);
  assert.ok(toolSchemaTokens(selectHarnessToolDefinitions(definitions, 'Restore the previous version of src/app.ts', 4096)) < toolSchemaTokens(definitions) / 2);
});

test('image requests expose the generator without the unrelated file catalog', () => {
  const image = { type: 'function', function: { name: 'generate_image', description: 'Create an image.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } };
  assert.deepEqual(names(selectHarnessToolDefinitions([...definitions, image], 'Draw a logo for this project', 4096)), ['generate_image', 'read_file', 'search_files', 'list_files', 'shell_readonly']);
});

test('a shell-style file request offers the bounded read-only bridge', () => {
  const selected = names(selectHarnessToolDefinitions(definitions, 'Run ls -la /workspace/', 4096));
  assert.ok(selected.includes('shell_readonly'));
  assert.ok(!selected.includes('delete_file'));
});

test('tool selection grows smoothly through the old 8K cutoff', () => {
  const small = selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts and update tests', 8192);
  const next = selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts and update tests', 8193);
  assert.ok(names(next).includes('read_file'));
  assert.ok(names(next).includes('replace_in_file'));
  assert.ok(toolSchemaTokens(next) + next.length * 16 <= Math.floor(8193 * .2));
  assert.ok(next.length >= small.length);
  assert.ok(next.length < definitions.length);
  assert.ok(toolSchemaTokens(selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts', 16384)) + selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts', 16384).length * 16 <= Math.floor(16384 * .2));
  assert.deepEqual(selectHarnessToolDefinitions(definitions, 'Explain closures in JavaScript', 32768), []);
});

test('a large output reserve leaves room for the system prompt and user request', () => {
  const selected = selectHarnessToolDefinitions(definitions, 'Fix the bug in src/app.ts and update tests', 8193, [], 6000);
  assert.ok(names(selected).includes('read_file'));
  assert.ok(selected.length < definitions.length);
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= Math.floor((8193 - 6000 - 384) * .35));
});

test('a small model can inspect both saved memories and archived chat decisions', () => {
  const scope = { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false };
  const meta = { id: 'chat', projectId: 'home', activeFrom: 24 };
  const store = { memory: async () => [] };
  const available = [
    ...definitions,
    ...browserHistoryTools(store, meta).definitions,
    ...browserMemoryTools(store, meta, scope).definitions,
  ];
  const selected = selectHarnessToolDefinitions(available, 'What did we decide about the search index?', 4096);
  assert.ok(names(selected).includes('search_history'));
  assert.ok(names(selected).includes('read_history'));
  assert.ok(names(selected).includes('search_memory'));
  assert.ok(names(selected).includes('read_memory'));
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 4096 * .2);
});

test('a trimmed fallback retains both search and read access to omitted turns', () => {
  const scope = { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false };
  const meta = { id: 'chat', projectId: 'home', activeFrom: 8, messageCount: 16, segments: [] };
  const store = { memory: async () => [] };
  const available = [
    ...definitions,
    ...browserHistoryTools(store, meta, undefined, true).definitions,
    ...browserMemoryTools(store, meta, scope).definitions,
  ];
  const selected = selectHarnessToolDefinitions(available, 'What did we decide about this file? previous history', 2048, ['search_history', 'read_history']);
  assert.ok(names(selected).includes('search_history'));
  assert.ok(names(selected).includes('read_history'));
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 2048 * .2);
});
