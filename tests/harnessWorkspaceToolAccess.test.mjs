import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentWorkspaceToolAccess } from '../src/harnessWorkspaceToolAccess.ts';

const scope = { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: true };

test('a workspace lock set by another tab stops a pending model write', async () => {
  let access = 'full';
  const store = { manifest: async () => ({ workspaceToolAccess: access }) };
  await assertCurrentWorkspaceToolAccess('write_file', scope, store);
  access = 'read-only';
  await assert.rejects(assertCurrentWorkspaceToolAccess('write_file', scope, store), /read-only/);
  await assert.rejects(assertCurrentWorkspaceToolAccess('generate_image', scope, store), /read-only/);
  await assertCurrentWorkspaceToolAccess('read_file', scope, store);
});

test('the current run also honors the lock it started with', async () => {
  await assert.rejects(assertCurrentWorkspaceToolAccess('git_commit', { ...scope, workspaceReadOnly: true }, { manifest: async () => ({ workspaceToolAccess: 'full' }) }), /read-only/);
});
