import test from 'node:test';
import assert from 'node:assert/strict';
import { browserModelPreferenceTools, modelPreferenceReview } from '../src/harnessPreferenceTools.ts';
import { authorizeToolCall } from '../src/harnessToolApprovals.ts';
import { isMutatingToolName } from '../src/harnessToolActions.ts';
import { toolPermission } from '../src/harnessToolPermissions.ts';
import { selectHarnessToolDefinitions } from '../src/harnessToolSelection.ts';
import { projectProfileDraftFromToolEvent } from '../src/harnessProjectProfileDraft.ts';

function fixture() {
  let manifest = { workspaceToolAccess: 'full', projects: [{ id: 'home', name: 'Home', defaultProfileId: 'browser', toolAccess: 'full' }], modelPreferences: { chat: ['browser'], code: [], image: [], speech: [], transcription: [] } };
  const store = {
    workspaceId: 'test-workspace',
    manifest: async () => manifest,
    settings: async () => ({ profiles: [
      { id: 'browser', label: 'Browser', model: 'models/local.gguf' },
      { id: 'compatible', label: 'Local server', model: 'code-model' },
      { id: 'empty', label: 'Not configured', model: '' },
    ] }),
    updateManifest: async change => { manifest = change(manifest); return manifest; },
  };
  return { store, current: () => manifest, change: update => { manifest = update(manifest); } };
}

test('model preferences expose saved IDs without credentials and select the relevant tool', async () => {
  const { store } = fixture();
  const tools = browserModelPreferenceTools(store, 'home', true);
  const status = JSON.parse(await tools.execute('get_model_preferences', {}));
  assert.deepEqual(status.order.chat, ['browser']);
  assert(status.available.chat.some(item => item.id === 'compatible' && item.configured));
  assert.equal(JSON.stringify(status).includes('apiKey'), false);
  const names = selectHarnessToolDefinitions(tools.definitions, 'Change the fallback model priority for chat', 4096).map(item => item.function.name);
  assert(names.includes('get_model_preferences'));
  assert(names.includes('set_model_preferences'));
});

test('project chat profile proposals remain drafts until the project editor saves them', async () => {
  const { store, current } = fixture();
  const tools = browserModelPreferenceTools(store, 'home', false);
  const info = JSON.parse(await tools.execute('get_project_chat_profile', {}));
  assert.equal(info.selectedId, 'browser');
  assert.equal(info.available.find(item => item.id === 'empty').modelSelected, false);
  const names = selectHarnessToolDefinitions(tools.definitions, 'Switch this project chat profile to my local server', 4096).map(item => item.function.name);
  assert(names.includes('get_project_chat_profile'));
  assert(names.includes('propose_project_chat_profile'));
  await assert.rejects(tools.execute('propose_project_chat_profile', { profile_id: 'empty' }), /Choose a model/);
  await assert.rejects(tools.execute('propose_project_chat_profile', { profile_id: 'missing' }), /no longer saved/);
  const response = await tools.execute('propose_project_chat_profile', { profile_id: 'compatible' });
  assert.deepEqual(projectProfileDraftFromToolEvent(`project_profile_draft: ${response}`), { projectId: 'home', profileId: 'compatible', profileLabel: 'Local server' });
  assert.equal(current().projects[0].defaultProfileId, 'browser');
  assert.equal(JSON.parse(await tools.execute('propose_project_chat_profile', { profile_id: 'browser' })).status, 'already-selected');
  assert.equal(projectProfileDraftFromToolEvent('project_profile_draft: {"draft":{"projectId":"../bad","profileId":"compatible","profileLabel":"Local server"},"reviewRequired":true,"saved":false}'), null);
});

test('fallback changes require review and reject unknown or duplicated IDs', async () => {
  const { store, current, change } = fixture();
  const tools = browserModelPreferenceTools(store, 'home', true);
  const scope = { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false };
  assert.equal(isMutatingToolName('set_model_preferences'), true);
  assert.equal(toolPermission(scope, 'set_model_preferences'), 'ask');
  assert.equal(toolPermission({ ...scope, workspaceReadOnly: true }, 'set_model_preferences'), 'deny');
  assert.equal(browserModelPreferenceTools(store, 'home', false).definitions.some(item => item.function.name === 'set_model_preferences'), false);
  await assert.rejects(modelPreferenceReview(store, 'chat', ['missing']), /not a saved/);
  await assert.rejects(modelPreferenceReview(store, 'chat', ['browser', 'browser']), /only once/);
  await assert.rejects(tools.execute('set_model_preferences', { purpose: 'chat', ids: ['compatible'] }), /Review the current/);
  const review = await modelPreferenceReview(store, 'chat', ['compatible', 'browser']);
  let approved;
  await authorizeToolCall({ scope, name: 'set_model_preferences', arguments: review, projectId: 'home', sessionKey: 'chat', runGrants: new Set(), approve: async request => { approved = request.arguments; return true; } });
  assert.equal(approved.scope, 'Entire workspace');
  assert.deepEqual(approved.current.map(item => item.id), ['browser']);
  await tools.execute('set_model_preferences', { purpose: 'chat', ids: ['compatible', 'browser'], __reviewedCurrent: approved.current.map(item => item.id) });
  assert.deepEqual(current().modelPreferences.chat, ['compatible', 'browser']);
  change(manifest => ({ ...manifest, modelPreferences: { ...manifest.modelPreferences, code: ['browser'] } }));
  await assert.rejects(tools.execute('set_model_preferences', { purpose: 'code', ids: ['compatible'], __reviewedCurrent: [] }), /changed during review/);
  change(manifest => ({ ...manifest, workspaceToolAccess: 'read-only' }));
  await assert.rejects(tools.execute('set_model_preferences', { purpose: 'image', ids: ['browser-tiny-fp16'], __reviewedCurrent: [] }), /read-only/);
  change(manifest => ({ ...manifest, workspaceToolAccess: 'full', projects: [{ id: 'home', toolAccess: 'read-only' }] }));
  await assert.rejects(tools.execute('set_model_preferences', { purpose: 'image', ids: ['browser-tiny-fp16'], __reviewedCurrent: [] }), /Project model tools are read-only/);
});
