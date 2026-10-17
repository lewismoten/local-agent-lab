import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_FILE, DEFAULT_CAPABILITIES, capabilityBadges, loadCapabilityLedger, pendingCapabilities, recordCapability } from '../src/capabilityLedger.ts';
import { MODEL_CATALOG } from '../src/catalogModels.ts';

function folder() {
  const files = new Map();
  const missing = () => new DOMException('Missing', 'NotFoundError');
  const directory = prefix => ({
    async getDirectoryHandle(name, options) { if (!options?.create && ![...files.keys()].some(key => key.startsWith(`${prefix}${name}/`))) throw missing(); return directory(`${prefix}${name}/`); },
    async getFileHandle(name, options) {
      const path = `${prefix}${name}`;
      if (!options?.create && !files.has(path)) throw missing();
      return {
        async getFile() { if (!files.has(path)) throw missing(); return new Blob([files.get(path)]); },
        async createWritable() { let value; return { async write(blob) { value = await blob.text(); }, async close() { files.set(path, value); } }; },
      };
    },
  });
  return { handle: directory(''), files };
}

test('workspace ledger records results independently of the catalog and marks new tests due', async () => {
  const workspace = folder();
  const initial = await loadCapabilityLedger(workspace.handle);
  assert.equal(initial.capabilities.length, DEFAULT_CAPABILITIES.length);
  assert.ok(workspace.files.has(CAPABILITY_FILE));
  const path = 'models/custom.gguf';
  await Promise.all([
    recordCapability(workspace.handle, path, 'Custom', 'text', 'passed', 'Visible text', 123),
    recordCapability(workspace.handle, path, 'Custom', 'vision.shapes', 'passed', 'Red circle', 123),
  ]);
  const saved = JSON.parse(workspace.files.get(CAPABILITY_FILE));
  assert.equal(saved.models[path].tests.text.result, 'passed');
  assert.equal(saved.models[path].tests['vision.shapes'].result, 'passed');
  assert.ok(capabilityBadges(saved, path).some(item => item.icon === '🖼️'));
  assert.ok(pendingCapabilities(saved, path).includes('tools'));
  assert.ok(pendingCapabilities(saved, path, undefined, 124).includes('text'));
  await recordCapability(workspace.handle, path, 'Custom', 'fileSize', 'passed', '124 bytes', 124);
  const replaced = JSON.parse(workspace.files.get(CAPABILITY_FILE));
  assert.equal(replaced.models[path].tests.text, undefined);
  assert.equal(capabilityBadges(replaced, path).length, 0);
  assert.ok(pendingCapabilities(replaced, path).includes('text'));
});

test('existing catalog confirmations are imported but remain due for current diagnostics', async () => {
  const workspace = folder();
  const ledger = await loadCapabilityLedger(workspace.handle);
  const [path] = Object.keys(ledger.models);
  assert.ok(path);
  const [id] = Object.keys(ledger.models[path].tests);
  assert.ok(pendingCapabilities(ledger, path).includes(id));
});

test('saved workspace ledger regains missing catalog confirmations without replacing observed failures', async () => {
  const workspace = folder();
  const model = MODEL_CATALOG.find(item => item.browserChecks?.text);
  assert.ok(model);
  const path = `models/${model.name}`;
  workspace.files.set(CAPABILITY_FILE, JSON.stringify({ schemaVersion: 1, capabilities: [], models: { [path]: { label: model.label, fileBytes: model.bytes, updatedAt: '', tests: { tools: { result: 'failed', checkedAt: '2026-01-01', testVersion: 1, detail: 'Observed failure', source: 'browser-test' } } } } }));
  const ledger = await loadCapabilityLedger(workspace.handle, true);
  assert.equal(ledger.models[path].tests.text.result, 'passed');
  assert.equal(ledger.models[path].tests.tools.result, 'failed');
  assert.ok(capabilityBadges(ledger, path, model.bytes).some(item => item.icon === '💬'));
  assert.equal(JSON.parse(workspace.files.get(CAPABILITY_FILE)).models[path].tests.text.result, 'passed');
});
