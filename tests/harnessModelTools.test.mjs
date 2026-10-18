import test from 'node:test';
import assert from 'node:assert/strict';
import { browserModelCatalogTools, catalogModelChoice, engineDownloadReview, modelDownloadReview, modelDownloadSpeedReview, modelDownloadStatus, searchModelCatalog } from '../src/harnessModelTools.ts';
import { createModelDownloadManager, modelDownloadManager } from '../src/modelDownloadSession.ts';
import { selectHarnessToolDefinitions } from '../src/harnessToolSelection.ts';
import { discoverToolCategory } from '../src/harnessToolDiscovery.ts';
import { toolPermission } from '../src/harnessToolPermissions.ts';
import { authorizeToolCall } from '../src/harnessToolApprovals.ts';
import { isMutatingToolName } from '../src/harnessToolActions.ts';

const scope = { projects: [{ id: 'home' }], defaultProjectId: 'home', workspaceAccess: false };

test('catalog search returns bounded model choices without download URLs', async () => {
  const result = JSON.parse(searchModelCatalog('MiniCPM', 1));
  assert.equal(result.models.length, 1);
  assert.equal(result.more, true);
  assert.equal(result.models[0].id, 'minicpm5-1b');
  assert.equal(Object.hasOwn(result.models[0], 'url'), false);
  assert.match(await browserModelCatalogTools(null, false).execute('search_model_catalog', { query: 'MiniCPM' }), /minicpm5-1b/);
  await assert.rejects(browserModelCatalogTools(null, false).execute('queue_model_download', { id: 'minicpm5-1b' }), /Unknown model tool/);
});

test('download review resolves an exact pinned catalog ID and refuses unsuitable models', () => {
  const choice = catalogModelChoice('minicpm5-1b');
  const review = modelDownloadReview(choice.id);
  assert.equal(review.file, choice.name);
  assert.equal(review.sizeBytes, choice.bytes);
  assert.equal(review.source, choice.source);
  assert.throws(() => catalogModelChoice('not-in-catalog'), /not in the catalog/);
  assert.throws(() => catalogModelChoice('bonsai2-q2-server'), /not available for browser download/);
  assert.throws(() => catalogModelChoice('gemma3-1b'), /accept this model’s terms/);
});

test('model download is discovered for model requests and asks approval by default', async () => {
  const tools = browserModelCatalogTools({}, true).definitions;
  const names = selectHarnessToolDefinitions(tools, 'Download a MiniCPM model', 4096).map(item => item.function.name);
  assert.deepEqual(names, ['search_model_catalog', 'queue_model_download']);
  assert(discoverToolCategory(tools, 'models', 'queue_model_download', 'Download a model', 4096, 512).some(item => item.function.name === 'queue_model_download'));
  assert.equal(isMutatingToolName('queue_model_download'), true);
  assert.equal(toolPermission(scope, 'queue_model_download'), 'ask');
  assert.equal(toolPermission({ ...scope, workspaceReadOnly: true }, 'queue_model_download'), 'deny');
  let reviewed;
  await authorizeToolCall({ scope, name: 'queue_model_download', arguments: modelDownloadReview('minicpm5-1b'), projectId: 'home', sessionKey: 'chat', runGrants: new Set(), approve: async request => { reviewed = request.arguments; return true; } });
  assert.equal(reviewed.model, 'MiniCPM5 1B · Q4_K_M');
  assert.equal(reviewed.license, 'Apache 2.0');
});

test('browser engine download requires an exact engine and its own review', async () => {
  const tools = browserModelCatalogTools({}, true).definitions;
  const names = selectHarnessToolDefinitions(tools, 'Download Wllama engine', 4096).map(item => item.function.name);
  assert(names.includes('queue_browser_engine'));
  assert.equal(isMutatingToolName('queue_browser_engine'), true);
  assert.equal(toolPermission(scope, 'queue_browser_engine'), 'ask');
  assert.equal(toolPermission({ ...scope, workspaceReadOnly: true }, 'queue_browser_engine'), 'deny');
  assert.throws(() => engineDownloadReview('other'), /Wllama or PrismML/);
  const review = engineDownloadReview('wllama');
  assert.equal(review.engine, 'wllama');
  assert.equal(review.licenseFirst, true);
  assert(review.files.includes('wllama-LICENCE.txt'));
  assert.match(review.source, /^https:\/\//);
  assert.match(review.licenseSource, /^https:\/\//);
  let reviewed;
  await authorizeToolCall({ scope, name: 'queue_browser_engine', arguments: review, projectId: 'home', sessionKey: 'chat', runGrants: new Set(), approve: async request => { reviewed = request.arguments; return true; } });
  assert.equal(reviewed.destination, 'engines/Wllama/');
});

test('download status reads the connected workspace queue without a queue from another drive', async () => {
  const model = catalogModelChoice('minicpm5-1b');
  const folder = { getDirectoryHandle: async name => {
    assert.equal(name, 'models');
    return { getFileHandle: async file => {
      assert.equal(file, 'download-queue.json');
      return { getFile: async () => new File([JSON.stringify([{ name: model.name, url: model.url, bytes: model.bytes }])], file) };
    } };
  } };
  const status = JSON.parse(await modelDownloadStatus(folder));
  assert.equal(status.queue[0].modelId, model.id);
  assert.equal(status.paused, true);
  assert.equal(status.active, null);
  const selected = selectHarnessToolDefinitions(browserModelCatalogTools(folder, true).definitions, 'What is the download status?', 1024).map(item => item.function.name);
  assert.equal(selected[0], 'get_model_download_status');
  const other = {};
  const manager = createModelDownloadManager();
  manager.resumeQueue(folder, () => {});
  assert(manager.getWorkspaceSnapshot(folder));
  assert.equal(manager.getWorkspaceSnapshot(other), null);
  await manager.pauseAndDetach();
  assert.equal(manager.getWorkspaceSnapshot(folder), null);
});

test('download speed changes immediately only to supported choices and asks by default', async () => {
  assert.throws(() => modelDownloadSpeedReview(7), /Choose 0/);
  assert.equal(toolPermission(scope, 'set_model_download_speed'), 'ask');
  assert.equal(toolPermission({ ...scope, workspaceReadOnly: true }, 'set_model_download_speed'), 'deny');
  const previous = modelDownloadManager.getSnapshot().speedLimit;
  try {
    const result = JSON.parse(await browserModelCatalogTools({}, true).execute('set_model_download_speed', { speedMiBps: 0.5 }));
    assert.equal(result.speedMiBps, 0.5);
    assert.equal(modelDownloadManager.getSnapshot().speedLimit, 0.5);
    const names = selectHarnessToolDefinitions(browserModelCatalogTools({}, true).definitions, 'Slow down the download speed', 4096).map(item => item.function.name);
    assert(names.includes('set_model_download_speed'));
    const tiny = selectHarnessToolDefinitions(browserModelCatalogTools({}, true).definitions, 'Slow down the download speed', 1024).map(item => item.function.name);
    assert.equal(tiny[0], 'set_model_download_speed');
  } finally { modelDownloadManager.setSpeedLimit(previous); }
});
