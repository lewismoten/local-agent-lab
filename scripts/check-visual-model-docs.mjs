import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  browserImageModelLabel,
  browserImageTotal,
  BROWSER_IMAGE_GROUPS,
  BROWSER_IMAGE_MODEL_PATHS,
} from '../src/browserImageAssets.ts';
import { MOTION_MODEL_IDS, MOTION_MODELS, motionPackageBytes, motionTotal } from '../src/motionAssets.ts';

const inventory = readFileSync(new URL('../docs/image-video-inventory.md', import.meta.url), 'utf8');
const status = readFileSync(new URL('../docs/visual-model-status.md', import.meta.url), 'utf8');
const rows = (text) => text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---'));
const cells = (row) =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
const inventoryRows = rows(inventory)
  .map(cells)
  .filter((row) => /^`[^`]+`$/.test(row[1] || ''));
const statusRows = rows(status)
  .map(cells)
  .filter((row) => row[3]?.startsWith('**'));
const modelRows = [
  ...BROWSER_IMAGE_GROUPS.map((group) => ({
    label: browserImageModelLabel(group),
    folder: BROWSER_IMAGE_MODEL_PATHS[group].slice('models/'.length),
    bytes: browserImageTotal(group),
    total: browserImageTotal(group) + browserImageTotal('engine'),
  })),
  ...MOTION_MODEL_IDS.map((id) => ({
    label: MOTION_MODELS[id].label,
    folder: MOTION_MODELS[id].path.slice('models/'.length),
    bytes: motionTotal(id),
    total: motionPackageBytes(id),
  })),
];
const compact = (bytes) =>
  bytes < 1_000_000
    ? '<1 MB'
    : bytes < 1_000_000_000
      ? `${Math.round(bytes / 1_000_000)} MB`
      : `${(bytes / 1_000_000_000).toFixed(2)} GB`;
const digits = (value) => Number(value.replace(/\D/g, ''));

assert.equal(inventoryRows.length, modelRows.length, 'Inventory must cover every visual model exactly once.');
const inventoryByFolder = new Map(inventoryRows.map((row) => [row[1].slice(1, -1), row]));
const statusByLabel = new Map(statusRows.map((row) => [row[0], row]));
assert.equal(
  statusRows.length,
  modelRows.length - 1,
  'Status page must cover each model; the two Tiny-SD variants may share one row.',
);
for (const model of modelRows) {
  const row = inventoryByFolder.get(model.folder);
  assert.ok(row, `Inventory is missing ${model.folder}.`);
  assert.ok(row[0].startsWith(model.label), `Inventory label drifted for ${model.folder}.`);
  assert.equal(digits(row[2]), model.bytes, `${model.label} model byte count drifted.`);
  assert.equal(digits(row[3]), model.total, `${model.label} package byte count drifted.`);
  const statusLabel = model.label.startsWith('Tiny-SD ') ? 'Tiny-SD Q4 / FP16' : model.label;
  const statusRow = statusByLabel.get(statusLabel);
  assert.ok(statusRow, `Status page is missing ${model.label}.`);
  const expectedSize =
    statusLabel === 'Tiny-SD Q4 / FP16'
      ? `${compact(modelRows.find((item) => item.label === 'Tiny-SD Q4').total)} / ${compact(modelRows.find((item) => item.label === 'Tiny-SD FP16').total)}`
      : compact(model.total);
  assert.equal(statusRow[2], expectedSize, `${model.label} public package size drifted.`);
}
assert.equal(inventoryByFolder.size, modelRows.length, 'Inventory contains duplicate model folders.');
assert.equal(statusByLabel.size, statusRows.length, 'Status page contains duplicate model rows.');
console.log(
  `Visual documentation matches ${modelRows.length} pinned model packages and ${statusRows.length} public status rows.`,
);
