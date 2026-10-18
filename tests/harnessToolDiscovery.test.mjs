import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFileTools } from '../src/harnessTools.ts';
import { discoverToolCategory, initialDiscoverableTools } from '../src/harnessToolDiscovery.ts';
import { toolSchemaTokens } from '../src/harnessToolSelection.ts';

const scope = { projects: [{ id: 'home', filesPath: 'repositories/demo' }], defaultProjectId: 'home', workspaceAccess: false };
const available = browserFileTools({}, scope).definitions;
const names = tools => tools.map(tool => tool.function.name);

test('small coding prompts offer a category request without loading every tool', () => {
  const selected = initialDiscoverableTools(available, 'Fix src/app.ts', 4096, 1024);
  assert.ok(names(selected).includes('request_tools'));
  assert.ok(names(selected).includes('read_file'));
  assert.ok(selected.length < available.length);
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 4096 * .2);
  assert.deepEqual(initialDiscoverableTools(available, 'Explain closures in JavaScript', 4096, 1024), []);
});

test('requested category replaces the offered schema with bounded, useful tools', () => {
  const selected = discoverToolCategory(available, 'git', '', 'Fix src/app.ts', 4096, 1024);
  assert.ok(names(selected).includes('git_status'));
  assert.ok(names(selected).includes('git_diff'));
  assert.ok(!names(selected).includes('delete_file'));
  assert.ok(toolSchemaTokens(selected) + selected.length * 16 <= 4096 * .2);
});

test('named tool request cannot expose blocked or unrelated tools', () => {
  const withoutDelete = available.filter(tool => tool.function.name !== 'delete_file');
  assert.throws(() => discoverToolCategory(withoutDelete, 'edit', 'delete_file', 'Fix src/app.ts', 4096, 1024), /not an available edit tool/);
  assert.throws(() => discoverToolCategory(available, 'git', 'delete_file', 'Fix src/app.ts', 4096, 1024), /not an available git tool/);
  assert.throws(() => discoverToolCategory(available, 'unknown', '', 'Fix src/app.ts', 4096, 1024), /Unknown category/);
  assert.ok(!names(initialDiscoverableTools(available, 'Fix src/app.ts', 4096, 1024, [], false)).includes('request_tools'));
});

test('required history tools remain available when discovery would crowd them out', () => {
  const history = ['search_history', 'read_history'].map(name => ({ type: 'function', function: { name, description: `Read ${name}.`, parameters: { type: 'object', properties: { query: { type: 'string' } } } } }));
  const selected = initialDiscoverableTools([...available, ...history], 'Review previous history', 2048, 256, ['search_history', 'read_history']);
  assert.ok(names(selected).includes('search_history'));
  assert.ok(names(selected).includes('read_history'));
});

test('unmapped projects cannot discover Git tools', () => {
  const unmapped = browserFileTools({}, { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false }).definitions;
  assert.throws(() => discoverToolCategory(unmapped, 'git', '', 'Check repository', 4096, 1024), /No git tools/);
});
