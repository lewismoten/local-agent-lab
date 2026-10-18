import test from 'node:test';
import assert from 'node:assert/strict';
import { assertToolAllowed, detachToolProfile, effectiveConversationToolPermissions, effectiveToolPermissions, filterPermittedTools, toolPermission } from '../src/harnessToolPermissions.ts';
import { browserFileTools } from '../src/harnessTools.ts';
import { authorizeToolCall, clearSessionToolGrants } from '../src/harnessToolApprovals.ts';

test('project tool policy defaults to allow and can block a specific tool', () => {
  const project = { id: 'home', name: 'Home', toolPermissions: { write_file: 'deny' } };
  const scope = { projects: [project], defaultProjectId: 'home', workspaceAccess: false };
  assert.equal(toolPermission(scope, 'read_file'), 'allow');
  assert.equal(toolPermission(scope, 'write_file'), 'deny');
  assert.throws(() => assertToolAllowed(scope, 'write_file'), /blocked in Project settings/);
});

test('a reusable profile supplies defaults and project choices override them', () => {
  const profile = { id: 'review', name: 'Review', permissions: { write_file: 'deny', read_file: 'once' } };
  const scope = { projects: [{ id: 'home', toolProfileId: 'review', toolPermissions: { write_file: 'ask' } }, { id: 'other', toolProfileId: 'review' }], toolProfiles: [profile], defaultProjectId: 'home', workspaceAccess: false };
  assert.equal(toolPermission(scope, 'write_file'), 'ask');
  assert.equal(toolPermission(scope, 'read_file'), 'once');
  assert.equal(toolPermission(scope, 'write_file', 'other'), 'deny');
  assert.deepEqual(effectiveToolPermissions(scope), { write_file: 'ask', read_file: 'once' });
  assert.equal(toolPermission({ ...scope, toolProfiles: [] }, 'read_file'), 'allow');
  const detached = detachToolProfile(scope.projects[0], [profile], '2026-10-18T00:00:00Z');
  assert.equal(detached.toolProfileId, undefined);
  assert.deepEqual(detached.toolPermissions, { write_file: 'ask', read_file: 'once' });
  assert.equal(toolPermission({ projects: [detached], defaultProjectId: 'home', workspaceAccess: false }, 'read_file'), 'once');
});

test('conversation rules and profiles override available tools but cannot unblock project blocks', () => {
  const profiles = [{ id: 'review', permissions: { read_file: 'ask', search_files: 'deny', write_file: 'allow' } }];
  const scope = { projects: [{ id: 'home', toolPermissions: { write_file: 'deny', read_file: 'once' } }], defaultProjectId: 'home', workspaceAccess: false,
    toolProfiles: profiles, conversationId: 'chat-1', conversationProfileId: 'review', conversationPermissions: { read_file: 'allow' } };
  assert.equal(toolPermission(scope, 'read_file'), 'allow');
  assert.equal(toolPermission(scope, 'search_files'), 'deny');
  assert.equal(toolPermission(scope, 'write_file'), 'deny');
  assert.deepEqual(effectiveConversationToolPermissions(scope), { write_file: 'deny', read_file: 'allow', search_files: 'deny' });
  const definitions = ['read_file', 'search_files', 'write_file'].map(name => ({ type: 'function', function: { name } }));
  assert.deepEqual(filterPermittedTools(scope, definitions).map(tool => tool.function.name), ['read_file']);
  assert.throws(() => assertToolAllowed(scope, 'write_file'), /blocked/);
});

test('conversation ask-once approval stays with that conversation and resets with policy changes', async () => {
  clearSessionToolGrants();
  const scope = { projects: [{ id: 'home', approvedTools: ['read_file'] }], defaultProjectId: 'home', workspaceAccess: false,
    toolProfiles: [{ id: 'chat-profile', permissions: { read_file: 'once', search_files: 'session' } }], conversationId: 'chat-1', conversationProfileId: 'chat-profile', conversationApprovedTools: [] };
  const calls = [];
  const approve = async request => { calls.push(request); return true; };
  const call = (name, sessionKey, runGrants = new Set()) => authorizeToolCall({ scope, name, arguments: {}, projectId: 'home', sessionKey, runGrants, approve });
  await call('read_file', 'chat-1');
  assert.equal(calls[0].conversationId, 'chat-1');
  scope.conversationApprovedTools = ['read_file'];
  await call('read_file', 'chat-1', new Set());
  assert.equal(calls.length, 1);
  await call('search_files', 'chat-1');
  await call('search_files', 'chat-1');
  assert.equal(calls.length, 2);
  clearSessionToolGrants();
  await call('search_files', 'chat-1');
  assert.equal(calls.length, 3);
});

test('blocked tool schemas are removed from a model request', () => {
  const folder = {};
  const base = { projects: [{ id: 'home', name: 'Home' }], defaultProjectId: 'home', workspaceAccess: false };
  const blocked = { ...base, projects: [{ ...base.projects[0], toolPermissions: { write_file: 'deny', replace_in_file: 'deny', apply_patch: 'deny' } }] };
  const catalog = browserFileTools(folder, base).definitions;
  assert.ok(catalog.some(tool => tool.function.name === 'write_file'));
  const selected = filterPermittedTools(blocked, catalog).map(tool => tool.function.name);
  assert.ok(selected.includes('read_file'));
  assert.ok(!selected.includes('write_file') && !selected.includes('replace_in_file') && !selected.includes('apply_patch'));
});

test('ask-every-time requires approval for every call, including after a refusal', async () => {
  const scope = { projects: [{ id: 'home', toolPermissions: { write_file: 'ask' } }], defaultProjectId: 'home', workspaceAccess: false };
  let prompts = 0;
  const base = { scope, name: 'write_file', arguments: { path: 'a.ts' }, projectId: 'home', sessionKey: 'ask-test', runGrants: new Set() };
  await assert.rejects(authorizeToolCall({ ...base, approve: async () => { prompts++; return false; } }), /not approved/);
  await authorizeToolCall({ ...base, approve: async () => { prompts++; return true; } });
  await authorizeToolCall({ ...base, approve: async () => { prompts++; return true; } });
  assert.equal(prompts, 3);
});

test('once and session modes cache only their intended grants', async () => {
  const project = { id: 'home', toolPermissions: { write_file: 'once', read_file: 'session' } };
  const scope = { projects: [project], defaultProjectId: 'home', workspaceAccess: false };
  const runGrants = new Set();
  let prompts = 0;
  const approve = async () => { prompts++; return true; };
  const call = (name, sessionKey, grants = runGrants) => authorizeToolCall({ scope, name, arguments: {}, projectId: 'home', sessionKey, runGrants: grants, approve });
  const key = `session-${crypto.randomUUID()}`;
  await call('write_file', key); await call('write_file', key);
  assert.equal(prompts, 1);
  project.approvedTools = ['write_file'];
  await call('write_file', `${key}-new`, new Set());
  assert.equal(prompts, 1);
  await call('read_file', key); await call('read_file', key, new Set());
  assert.equal(prompts, 2);
  await call('read_file', `${key}-new`);
  assert.equal(prompts, 3);
});

test('blocked and aborted approvals never reach an approval callback', async () => {
  const scope = { projects: [{ id: 'home', toolPermissions: { write_file: 'deny', read_file: 'ask' } }], defaultProjectId: 'home', workspaceAccess: false };
  let prompts = 0;
  const base = { scope, arguments: {}, projectId: 'home', sessionKey: 'blocked-test', runGrants: new Set(), approve: async () => { prompts++; return true; } };
  await assert.rejects(authorizeToolCall({ ...base, name: 'write_file' }), /blocked/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(authorizeToolCall({ ...base, name: 'read_file', signal: controller.signal }), /AbortError/);
  assert.equal(prompts, 0);
});
