import { MODEL_CATALOG, type CatalogModel } from './catalogModels.ts';
import { readBlob, writeBlob } from './storage.ts';
import { NEEDLE_LEGACY_MODEL_PATHS, NEEDLE_MODEL_PATHS, type NeedleVersion } from './needleAssets.ts';

export const CAPABILITY_FILE = 'models/capabilities.json';
export const DEFAULT_CAPABILITIES = [
  { id: 'text', label: 'Chat', icon: '💬', version: 1, description: 'Returns visible text to a short prompt.' },
  { id: 'tools', label: 'Tools', icon: '🔧', version: 2, description: 'Returns a valid structured tool call.' },
  { id: 'reasoningTask', label: 'Reasoning', icon: '🧩', version: 2, description: 'Answers the current reasoning probe correctly.' },
  { id: 'promptedSteps', label: 'Prompted steps', icon: '💭', version: 2, description: 'Follows a requested <think> format. Answer accuracy is scored separately.' },
  { id: 'thinking', label: 'Thinking stream', icon: '🧠', version: 2, description: 'Returns a separate or marked thinking segment without spilling into the visible answer.' },
  { id: 'thinkingAnswer', label: 'Thinking answer', icon: '', version: 2, description: 'The thinking-mode probe reaches a correct final answer without spillover.' },
  { id: 'fileSize', label: 'File size', icon: '', version: 1, description: 'Measures the selected GGUF file.' },
  { id: 'license', label: 'License files', icon: '', version: 1, description: 'Checks the required license files.' },
  { id: 'metadata', label: 'Model metadata', icon: '', version: 1, description: 'Reads model identity and architecture from the GGUF.' },
  { id: 'context', label: 'Loaded context', icon: '', version: 1, description: 'Checks the context size loaded in this browser.' },
  { id: 'imageGeneration', label: 'Image generation', icon: '🎨', version: 1, description: 'Generates and decodes a test image in this browser.' },
  { id: 'vision.shapes', label: 'Vision: shapes and colors', icon: '🖼️', version: 1, description: 'Identifies colored geometric shapes in a generated image.' },
  { id: 'vision.text', label: 'Vision: text and numbers', icon: '', version: 1, description: 'Reads clear text and digits from an image.' },
  { id: 'vision.imperfect', label: 'Vision: imperfect print', icon: '', version: 1, description: 'Reads partially damaged print.' },
  { id: 'vision.barcode', label: 'Vision: EAN-13', icon: '', version: 2, description: 'Reads an EAN-13 barcode from bars without printed digits.' },
  { id: 'vision.crop', label: 'Vision: perspective crop', icon: '', version: 4, description: 'Selects four corners of a tilted document for straightening.' },
  { id: 'vision.faint', label: 'Vision: faint watermark', icon: '', version: 1, description: 'Exploratory near-zero-contrast text probe.' },
  { id: 'vision.channel', label: 'Vision: single channel', icon: '', version: 1, description: 'Reads text whose contrast is isolated to one color channel.' },
  { id: 'vision.micro', label: 'Vision: text size ladder', icon: '', version: 2, description: 'Reads random words at measured font sizes from 28 to 7 pixels.' },
  { id: 'vision.lsb', label: 'Vision: least significant bit', icon: '', version: 1, description: 'Exploratory red-channel least-significant-bit probe.' },
  { id: 'vision.photo', label: 'Vision: real photo', icon: '', version: 6, description: 'Describes the included reference photo and qualifies uncertain details.' },
] as const;
export type CapabilityId = typeof DEFAULT_CAPABILITIES[number]['id'];
export type CapabilityResult = 'passed' | 'failed' | 'inconclusive';
export type CapabilityObservation = { result: CapabilityResult; checkedAt: string; testVersion: number; detail: string; source: 'browser-test' | 'catalog-seed' };
export type ModelCapabilityRecord = { label: string; fileBytes?: number; updatedAt: string; tests: Record<string, CapabilityObservation> };
export type CapabilityLedger = { schemaVersion: 1; capabilities: { id: string; label: string; icon: string; version: number; description: string }[]; models: Record<string, ModelCapabilityRecord> };
const emptyLedger = (): CapabilityLedger => ({ schemaVersion: 1, capabilities: DEFAULT_CAPABILITIES.map(item => ({ ...item })), models: {} });
let activeFolder: FileSystemDirectoryHandle | null = null;
let snapshot = emptyLedger();
let writeQueue = Promise.resolve();
const listeners = new Set<() => void>();
const publish = (next: CapabilityLedger) => { snapshot = next; listeners.forEach(listener => listener()); };
export const getCapabilityLedger = () => snapshot;
export const subscribeCapabilityLedger = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const revision = (id: string) => DEFAULT_CAPABILITIES.find(item => item.id === id)?.version;
const needleRevision = (path: string, id: string) => Object.values(NEEDLE_MODEL_PATHS).includes(path)
  ? ({ text: 2, tools: 4, reasoningTask: 3, thinking: 3 } as Record<string, number>)[id] || revision(id) || 1
  : revision(id) || 1;

function seedLegacy(): CapabilityLedger {
  const ledger = emptyLedger();
  const checkedAt = '';
  for (const model of MODEL_CATALOG) {
    const tests: Record<string, CapabilityObservation> = {};
    for (const [key, passed] of Object.entries(model.browserChecks || {})) {
      if (!passed) continue;
      const id = key === 'thinkingMode' ? 'thinking' : key;
      tests[id] = { result: 'passed', checkedAt, testVersion: 0, detail: 'Imported from the previous catalog confirmation; rerun to refresh this test.', source: 'catalog-seed' };
    }
    if (Object.keys(tests).length) ledger.models[`models/${model.name}`] = { label: model.label, fileBytes: model.bytes, updatedAt: checkedAt, tests };
  }
  return ledger;
}

function mergeCatalogConfirmations(ledger: CapabilityLedger): { ledger: CapabilityLedger; changed: boolean } {
  const legacy = seedLegacy();
  let changed = false;
  const models = { ...ledger.models };
  for (const [path, seeded] of Object.entries(legacy.models)) {
    const existing = models[path];
    if (!existing) { models[path] = seeded; changed = true; continue; }
    if (existing.fileBytes !== undefined && seeded.fileBytes !== existing.fileBytes) continue;
    const missing = Object.entries(seeded.tests).filter(([id]) => !existing.tests[id]);
    if (!missing.length) continue;
    models[path] = { ...existing, tests: { ...Object.fromEntries(missing), ...existing.tests } };
    changed = true;
  }
  return { ledger: changed ? { ...ledger, models } : ledger, changed };
}

function reconcile(raw: CapabilityLedger): CapabilityLedger {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.capabilities) || !raw.models || typeof raw.models !== 'object') throw new Error(`${CAPABILITY_FILE} is invalid. Repair it before recording more tests.`);
  const existing = new Map(raw.capabilities.map(item => [item.id, item]));
  const capabilities: CapabilityLedger['capabilities'] = DEFAULT_CAPABILITIES.map(item => ({ ...item }));
  for (const [id, item] of existing) if (!DEFAULT_CAPABILITIES.some(definition => definition.id === id)) capabilities.push(item);
  const models = { ...raw.models };
  for (const version of Object.keys(NEEDLE_MODEL_PATHS) as NeedleVersion[]) {
    const legacy = models[NEEDLE_LEGACY_MODEL_PATHS[version]];
    if (legacy && !models[NEEDLE_MODEL_PATHS[version]]) models[NEEDLE_MODEL_PATHS[version]] = legacy;
  }
  return { schemaVersion: 1, capabilities, models };
}

export async function loadCapabilityLedger(folder: FileSystemDirectoryHandle, force = false): Promise<CapabilityLedger> {
  if (activeFolder === folder && !force) return snapshot;
  await writeQueue;
  let next: CapabilityLedger;
  let needsWrite = false;
  try {
    const saved = JSON.parse(await (await readBlob(folder, CAPABILITY_FILE)).text()) as CapabilityLedger;
    const reconciled = reconcile(saved);
    const merged = mergeCatalogConfirmations(reconciled);
    next = merged.ledger;
    needsWrite = merged.changed || JSON.stringify(saved.capabilities) !== JSON.stringify(next.capabilities) || JSON.stringify(saved.models) !== JSON.stringify(next.models);
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    next = seedLegacy();
    needsWrite = true;
  }
  activeFolder = folder;
  publish(next);
  if (needsWrite) {
    writeQueue = writeQueue.catch(() => {}).then(() => writeBlob(folder, CAPABILITY_FILE, new Blob([JSON.stringify(next, null, 2) + '\n'], { type: 'application/json' })));
    await writeQueue;
  }
  return next;
}

export async function recordCapability(folder: FileSystemDirectoryHandle, path: string, label: string, id: string, result: CapabilityResult, detail: string, fileBytes?: number) {
  if (activeFolder !== folder) await loadCapabilityLedger(folder);
  const now = new Date().toISOString();
  const previous = snapshot.models[path];
  const sameFile = fileBytes === undefined || previous?.fileBytes === undefined || previous.fileBytes === fileBytes;
  const tests = { ...(sameFile ? previous?.tests || {} : {}), [id]: { result, checkedAt: now, testVersion: needleRevision(path, id), detail, source: 'browser-test' as const } };
  const next: CapabilityLedger = { ...snapshot, models: { ...snapshot.models, [path]: { label, fileBytes: fileBytes ?? previous?.fileBytes, updatedAt: now, tests } } };
  publish(next);
  const data = JSON.stringify(next, null, 2) + '\n';
  writeQueue = writeQueue.catch(() => {}).then(() => writeBlob(folder, CAPABILITY_FILE, new Blob([data], { type: 'application/json' })));
  await writeQueue;
}

export async function recordCapabilities(folder: FileSystemDirectoryHandle, path: string, label: string, observations: { id: string; result: CapabilityResult; detail: string }[], fileBytes?: number) {
  if (!observations.length) return;
  if (activeFolder !== folder) await loadCapabilityLedger(folder);
  const now = new Date().toISOString();
  const previous = snapshot.models[path];
  const sameFile = fileBytes === undefined || previous?.fileBytes === undefined || previous.fileBytes === fileBytes;
  const tests = { ...(sameFile ? previous?.tests || {} : {}) };
  for (const item of observations) tests[item.id] = { result: item.result, checkedAt: now, testVersion: needleRevision(path, item.id), detail: item.detail, source: 'browser-test' };
  const next: CapabilityLedger = { ...snapshot, models: { ...snapshot.models, [path]: { label, fileBytes: fileBytes ?? previous?.fileBytes, updatedAt: now, tests } } };
  publish(next);
  const data = JSON.stringify(next, null, 2) + '\n';
  writeQueue = writeQueue.catch(() => {}).then(() => writeBlob(folder, CAPABILITY_FILE, new Blob([data], { type: 'application/json' })));
  await writeQueue;
}

export function expectedCapabilities(model?: CatalogModel): string[] {
  const basics = ['fileSize', 'license', 'metadata', 'context', 'text', 'tools', 'reasoningTask', ...(model?.thinking === 'documented' ? [] : ['promptedSteps']), 'thinking', 'thinkingAnswer'];
  return model?.visionProjector ? [...basics, ...DEFAULT_CAPABILITIES.filter(item => item.id.startsWith('vision.')).map(item => item.id)] : basics;
}
export function pendingCapabilities(ledger: CapabilityLedger, path: string, model?: CatalogModel, fileBytes?: number): string[] {
  const record = ledger.models[path];
  const expected = Object.values(NEEDLE_MODEL_PATHS).includes(path) ? ['fileSize', 'license', 'text', 'tools', 'reasoningTask', 'thinking'] : expectedCapabilities(model);
  return expected.filter(id => {
    const observed = record?.tests[id];
    return !observed || observed.testVersion < needleRevision(path, id) || fileBytes !== undefined && record.fileBytes !== undefined && fileBytes !== record.fileBytes;
  });
}
export function capabilityBadges(ledger: CapabilityLedger, path: string, fileBytes?: number): { id: string; icon: string; title: string; stale: boolean }[] {
  const tests = ledger.models[path]?.tests || {};
  if (fileBytes !== undefined && ledger.models[path]?.fileBytes !== undefined && ledger.models[path].fileBytes !== fileBytes) return [];
  const isNeedle = Object.values(NEEDLE_MODEL_PATHS).includes(path);
  return DEFAULT_CAPABILITIES.filter(item => !!item.icon && tests[item.id]?.result === 'passed' && (!isNeedle || tests[item.id].testVersion >= needleRevision(path, item.id))).map(item => ({ id: item.id, icon: item.icon, title: item.id.startsWith('vision.') ? 'Vision' : item.label, stale: tests[item.id].testVersion < needleRevision(path, item.id) }));
}
