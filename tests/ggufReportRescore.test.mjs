import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityBadges } from '../src/capabilityLedger.ts';
import { diagnosticReportPath } from '../src/diagnosticReports.ts';
import { rescoreGgufReport, rescoreSavedGgufReports } from '../src/ggufReportRescore.ts';

const report = {
  file: 'models/gemma-3-1b-it-Q4_K_M.gguf', checkedAt: '2026-10-17T06:50:38.680Z', observed: { fileBytes: 123 },
  browserTests: { promptedSteps: {
    result: 'incorrect-answer', detail: 'Followed tags, but the answer was wrong.',
    trace: { output: { message: { content: '<think>A calculation.</think>100 minutes' }, finishReason: 'stop' } },
  } },
};

test('saved GGUF report separates prompted format from answer accuracy', () => {
  const rescored = rescoreGgufReport(report);
  assert.equal(rescored.browserTests.promptedSteps.result, 'passed');
  assert.equal(rescored.browserTests.promptedSteps.answerAccuracy, 'failed');
  assert.equal(rescored.originalScores.promptedSteps.result, 'incorrect-answer');
});

test('saved GGUF results refresh the capability ledger without inference', async () => {
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
        async getFile() { const value = files.get(path); return typeof value === 'string' ? new Blob([value]) : value; },
        async createWritable() { let value; return { async write(blob) { value = await blob.text(); }, async close() { files.set(path, value); } }; },
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
  const path = diagnosticReportPath(report.file, report.checkedAt, 'text');
  files.set(report.file, { size: 123 });
  files.set(path, JSON.stringify(report));
  assert.equal(await rescoreSavedGgufReports(folder, [report.file]), 1);
  const saved = JSON.parse(files.get(path));
  assert.equal(saved.browserTests.promptedSteps.result, 'passed');
  assert.equal(saved.browserTests.promptedSteps.answerAccuracy, 'failed');
  const ledger = JSON.parse(files.get('models/capabilities.json'));
  assert.ok(capabilityBadges(ledger, report.file).some(item => item.icon === '💭'));
  assert.equal(await rescoreSavedGgufReports(folder, [report.file]), 0);
});
