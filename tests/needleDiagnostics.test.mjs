import test from 'node:test';
import assert from 'node:assert/strict';
import { needleToolCalls, scoreNeedleText, scoreNeedleToolCall, scoreNeedleReasoningTask, NEEDLE_TESTS } from '../src/needleDiagnostics.ts';
import { pendingCapabilities, capabilityBadges, DEFAULT_CAPABILITIES } from '../src/capabilityLedger.ts';
import { loadLatestDiagnosticJson } from '../src/diagnosticReports.ts';
import { NEEDLE_MODEL_PATHS } from '../src/needleAssets.ts';
import { rescoreSavedNeedleReports } from '../src/needleReportRescore.ts';

test('Needle reports the applicable model tests', () => {
  const ledger = { schemaVersion: 1, capabilities: DEFAULT_CAPABILITIES, models: {} };
  assert.deepEqual(pendingCapabilities(ledger, NEEDLE_MODEL_PATHS.needle2), [...NEEDLE_TESTS]);
});

test('Needle diagnostics accepts native and OpenAI-style structured calls', () => {
  assert.deepEqual(needleToolCalls('{"function_calls":[{"name":"save_character","arguments":{"name":"Mira"}}]}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('{"tool_calls":[{"function":{"name":"save_character","arguments":"{\\"name\\":\\"Mira\\"}"}}]}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('{"name":"save_character","arguments":{"name":"Mira"}}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('{"function":"save_character","parameters":{"name":"Mira"}}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('{"tool_name":"save_character","args":{"name":"Mira"}}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('<think>Check the schema.</think>\n{"function_calls":[{"name":"save_character","arguments":{"name":"Mira"}}]}'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
  assert.deepEqual(needleToolCalls('<think>Check the schema.</think>\n<tool_call>[{"name":"save_character","arguments":{"name":"Mira"}}]</tool_call>'), [{ name: 'save_character', arguments: { name: 'Mira' } }]);
});

test('Needle scoring distinguishes visible chat, correct calls, and incorrect arguments', () => {
  assert.equal(scoreNeedleText('<think>No tool available.</think><tool_call>[]</tool_call>').result, 'inconclusive');
  assert.equal(scoreNeedleText(' []').result, 'inconclusive');
  assert.equal(scoreNeedleText('ready').result, 'passed');
  assert.equal(scoreNeedleToolCall('<think>Found arguments.</think><tool_call>[{"name":"save_character","arguments":{"name":"Mira","role":"protagonist"}}]</tool_call>').result, 'passed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{"name":"protagonist","role":"Mira"}}').result, 'passed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{"name":"protagonist","role":"Mira"}}').argumentAccuracy, 'failed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{"name":"Mira","role":"main character"}}').result, 'passed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{"name":"Mira"}}').result, 'passed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{"name":"Mira"}}').argumentAccuracy, 'failed');
  assert.equal(scoreNeedleToolCall('{"name":"save_character","arguments":{}}').result, 'passed');
});

test('Needle reasoning requires one correct final tool call', () => {
  assert.equal(scoreNeedleReasoningTask('<think>Compute.</think><tool_call>[{"name":"submit_answer","arguments":{"minutes":5}}]</tool_call>').result, 'passed');
  assert.equal(scoreNeedleReasoningTask('[{"name":"submit_answer","arguments":{"minutes":5}},{"name":"submit_answer","arguments":{"minutes":100}}]').result, 'failed');
  assert.equal(scoreNeedleReasoningTask('<tool_call>[]</tool_call>').result, 'inconclusive');
});

test('old Needle results are due for retesting and no longer display passed badges', () => {
  const path = NEEDLE_MODEL_PATHS.needle2;
  const tests = Object.fromEntries(['text', 'tools', 'reasoningTask', 'thinking'].map(id => [id, { result: 'passed', checkedAt: '', testVersion: id === 'text' ? 1 : 2, detail: '', source: 'browser-test' }]));
  const ledger = { schemaVersion: 1, capabilities: DEFAULT_CAPABILITIES, models: { [path]: { label: 'Needle 2', updatedAt: '', tests } } };
  assert.deepEqual(pendingCapabilities(ledger, path), [...NEEDLE_TESTS]);
  assert.equal(capabilityBadges(ledger, path).length, 0);
});

test('the latest saved Needle report can be reopened after a page refresh', async () => {
  const oldName = 'needle2.cact-2026-10-16T12-00-00-000Z-text.json';
  const latestName = 'needle2.cact-2026-10-17T12-00-00-000Z-text.json';
  const reports = new Map([[oldName, { checkedAt: 'old' }], [latestName, { checkedAt: 'latest' }]]);
  const diagnostics = {
    async *entries() { for (const name of reports.keys()) yield [name, { kind: 'file' }]; },
    async getFileHandle(name) { return { async getFile() { return { async text() { return JSON.stringify(reports.get(name)); } }; } }; },
  };
  const models = { async getDirectoryHandle(name) { if (name === 'diagnostics') return diagnostics; throw new DOMException('Missing', 'NotFoundError'); } };
  const folder = { async getDirectoryHandle(name) { return name === 'models' ? models : diagnostics; } };
  assert.deepEqual(await loadLatestDiagnosticJson(folder, NEEDLE_MODEL_PATHS.needle2, 'text'), { checkedAt: 'latest' });
});

test('saved Needle outputs are rescored and recorded without model inference', async () => {
  const files = new Map();
  const missing = () => new DOMException('Missing', 'NotFoundError');
  const dir = prefix => ({
    async getDirectoryHandle(name, options) {
      const next = `${prefix}${name}/`;
      if (!options?.create && ![...files.keys()].some(path => path.startsWith(next))) throw missing();
      return dir(next);
    },
    async getFileHandle(name, options) {
      const path = `${prefix}${name}`;
      if (!options?.create && !files.has(path)) throw missing();
      return {
        async getFile() {
          if (!files.has(path)) throw missing();
          const value = files.get(path);
          return typeof value === 'string' ? new Blob([value]) : value;
        },
        async createWritable() {
          let value;
          return { async write(blob) { value = await blob.text(); }, async close() { files.set(path, value); } };
        },
      };
    },
    async *entries() {
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest && !rest.includes('/')) yield [rest, { kind: 'file' }];
      }
    },
  });
  const folder = dir('');
  const modelPath = NEEDLE_MODEL_PATHS.needle2;
  const stamp = '2026-10-17T08-13-19-252Z';
  const reportPath = `models/Needle-2/diagnostics/needle2.cact-${stamp}-text.json`;
  files.set(modelPath, { size: 13737807 });
  const firstPath = NEEDLE_MODEL_PATHS.needle;
  const firstReportPath = 'models/Needle-1/diagnostics/needle.safetensors-2026-10-17T08-25-40-975Z-text.json';
  files.set(firstPath, { size: 22259039 });
  files.set(firstReportPath, JSON.stringify({
    file: firstPath, checkedAt: '2026-10-17T08:25:40.975Z', runtime: 'Needle browser engine', scoringVersion: 2,
    tests: { tools: { result: 'failed', detail: 'Incorrect arguments.', output: ' [{"name":"save_character","arguments":{"role":"Mira","name":"protagonist"}}]' } },
  }));
  files.set(reportPath, JSON.stringify({
    file: modelPath, checkedAt: '2026-10-17T08:13:19.252Z', runtime: 'Needle browser engine',
    tests: {
      text: { result: 'passed', detail: 'Visible text returned.', output: '<think>No tool available.</think><tool_call>[]</tool_call>' },
      tools: { result: 'inconclusive', detail: 'No structured save_character call returned.', output: '<think>Got Mira.</think><tool_call>[{"name":"save_character","arguments":{"name":"Mira","role":"protagonist"}}]</tool_call>' },
      reasoningTask: { result: 'inconclusive', detail: 'No call.', output: '<tool_call>[]</tool_call>' },
      thinking: { result: 'passed', detail: 'A separate reasoning segment was returned.', output: '<think>Reasoned.</think><tool_call>[]</tool_call>' },
    },
  }));
  assert.equal(await rescoreSavedNeedleReports(folder), 2);
  const saved = JSON.parse(files.get(reportPath));
  assert.equal(saved.tests.text.result, 'inconclusive');
  assert.equal(saved.tests.tools.result, 'passed');
  assert.equal(saved.originalScores.text.result, 'passed');
  const ledger = JSON.parse(files.get('models/capabilities.json'));
  assert.equal(ledger.models[modelPath].tests.tools.result, 'passed');
  assert.ok(capabilityBadges(ledger, modelPath).some(item => item.id === 'tools'));
  const first = JSON.parse(files.get(firstReportPath));
  assert.equal(first.tests.tools.result, 'passed');
  assert.equal(first.tests.tools.argumentAccuracy, 'failed');
  assert.equal(first.originalScores.tools.result, 'failed');
  assert.ok(capabilityBadges(ledger, firstPath).some(item => item.id === 'tools'));
  assert.equal(await rescoreSavedNeedleReports(folder), 0);
});
