import type { AIConfig } from './ai';
import { getBrowserModelStatus, getLoadedBrowserMetadata, loadBrowserModel, probeBrowserFeatures, probeBrowserVision, unloadBrowserModel, type BrowserProbeResult, type VisionProbeResult } from './browserModel';
import { browserThinkingBudget } from './browserThinking';
import { recordCapabilities, type CapabilityResult } from './capabilityLedger';
import { saveDiagnosticJson } from './diagnosticReports';
import { isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility';
import { assertModelLicenseFiles, assertVisionProjectorLicenseFiles, catalogModelForPath } from './modelLicenses';
import { ensureWritableFolder, readBlob } from './storage';
import { showToast } from './toastStore';
import { createReferencePhotoFixture, createVisionFixtures, PUBLIC_REFERENCE_PHOTO_NAME, type VisionFixture } from './visionFixtures';
import { NEEDLE_MODEL_PATHS, type NeedleVersion } from './needleAssets';
import { runNeedleDiagnostics } from './needleDiagnostics';
import { unloadNeedle } from './needleRuntime';

export type BatchItem = { path: string; state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped'; step: string; textReport?: string; visionReport?: string; visionSkipped?: string; error?: string };
export type BatchSnapshot = { running: boolean; items: BatchItem[]; current: number; completed: number; step: string; error?: string };
let snapshot: BatchSnapshot = { running: false, items: [], current: -1, completed: 0, step: '' };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const publish = (next: BatchSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
const patch = (changes: Partial<BatchSnapshot>) => publish({ ...snapshot, ...changes });
const patchItem = (index: number, changes: Partial<BatchItem>) => {
  const items = [...snapshot.items];
  items[index] = { ...items[index], ...changes };
  patch({ items });
};
export const getBatchDiagnostics = () => snapshot;
export const subscribeBatchDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function stopBatchDiagnostics() { controller?.abort(); if (snapshot.running) patch({ step: 'Stopping after the current operation…' }); }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isStopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Batch stopped.', 'AbortError'); };

async function visionFixtures(): Promise<VisionFixture[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}${PUBLIC_REFERENCE_PHOTO_NAME}`);
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('The included reference photo could not be loaded.');
  return [createReferencePhotoFixture(await response.blob()), ...await createVisionFixtures()];
}

export async function startBatchDiagnostics(folder: FileSystemDirectoryHandle, paths: string[], config: AIConfig) {
  if (snapshot.running || !paths.length) return;
  const runController = new AbortController();
  controller = runController;
  const signal = runController.signal;
  publish({ running: true, items: paths.map(path => ({ path, state: 'waiting', step: 'Waiting' })), current: -1, completed: 0, step: 'Checking workspace…' });
  let fixtures: VisionFixture[] | null = null;
  let modelLoadedByBatch = false;
  let needleLoadedByBatch = false;
  try {
    if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
    for (const [index, path] of paths.entries()) {
      isStopped(signal);
      patch({ current: index, step: `Loading ${path.split('/').pop()}…` });
      patchItem(index, { state: 'running', step: 'Checking files' });
      const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, modelPath]) => modelPath === path)?.[0];
      if (needle) {
        needleLoadedByBatch = true;
        try {
          const result = await runNeedleDiagnostics(folder, needle, (finished, total, key) => patchItem(index, { step: `${finished}/${total} · ${key}` }), signal);
          patchItem(index, { state: result.error ? 'failed' : 'done', step: result.error ? 'Failed' : 'Done', textReport: result.savedPath, error: result.error, visionSkipped: 'Tool routing model; no image input' });
        } catch (error) {
          patchItem(index, { state: signal.aborted ? 'stopped' : 'failed', step: signal.aborted ? 'Stopped' : 'Failed', error: errorText(error) });
        }
        patch({ completed: index + 1 });
        if (signal.aborted) break;
        continue;
      }
      const catalog = catalogModelForPath(path);
      const checkedAt = new Date().toISOString();
      const report: Record<string, unknown> = {
        file: path, checkedAt,
        catalog: catalog ? { model: catalog.family, company: catalog.company, country: catalog.country, companyUrl: catalog.companyUrl, version: catalog.version, parametersB: catalog.parameters, quantization: catalog.quantization, fileBytes: catalog.bytes, publishedContextTokens: catalog.contextTokens, tools: catalog.toolUse, thinking: catalog.thinking, license: catalog.license, source: catalog.source, licenseUrl: catalog.licenseUrl } : null,
        observed: {},
      };
      const observed = report.observed as Record<string, unknown>;
      const partialText: BrowserProbeResult[] = [];
      const partialVision: VisionProbeResult[] = [];
      const observations: { id: string; result: CapabilityResult; detail: string }[] = [];
      const record = (id: string, result: CapabilityResult, detail: string) => { observations.push({ id, result, detail }); };
      const saveCapabilities = () => recordCapabilities(folder, path, catalog?.label || path, observations, observed.fileBytes as number | undefined);
      try {
        if (isKnownIncompatibleGranite(path) || isBonsai2Q2BrowserUnsupported(path)) throw new Error('This GGUF is not supported by the browser engine.');
        const file = await readBlob(folder, path);
        observed.fileBytes = file.size;
        if (file.size > 2_000_000_000) throw new Error('This GGUF exceeds the 2 GB browser limit.');
        record('fileSize', catalog && file.size !== catalog.bytes ? 'failed' : 'passed', `${file.size} bytes measured${catalog ? `; ${catalog.bytes} bytes listed` : ''}`);
        await assertModelLicenseFiles(folder, path);
        observed.licenseFiles = 'Present and matched';
        record('license', 'passed', 'Present and matched');
        let withVision = false;
        if (catalog?.visionProjector) {
          try {
            const projector = await readBlob(folder, `models/${catalog.visionProjector.name}`);
            if (projector.size !== catalog.visionProjector.bytes) throw new Error('Projector is incomplete.');
            await assertVisionProjectorLicenseFiles(folder, catalog);
            withVision = true;
          } catch { patchItem(index, { visionSkipped: 'Vision projector missing or incomplete' }); }
        } else patchItem(index, { visionSkipped: 'No vision projector configured' });
        isStopped(signal);
        patchItem(index, { step: 'Loading model' });
        await loadBrowserModel(folder, path, config.contextWindow, browserThinkingBudget({ ...config, model: path }), withVision);
        modelLoadedByBatch = true;
        isStopped(signal);
        const loaded = getBrowserModelStatus();
        const metadata = getLoadedBrowserMetadata();
        Object.assign(observed, {
          loadedContextTokens: loaded.contextWindow, loadedThinkingBudgetTokens: loaded.thinkingBudgetTokens,
          trainingContextTokens: metadata?.hparams.nCtxTrain, metadataName: metadata?.meta['general.name'],
          metadataArchitecture: metadata?.meta['general.architecture'], metadataParameterCount: metadata?.meta['general.parameter_count'],
          metadataSizeLabel: metadata?.meta['general.size_label'],
        });
        record('metadata', metadata?.meta['general.architecture'] ? 'passed' : 'inconclusive', `${observed.metadataName || 'Name unavailable'} · ${observed.metadataArchitecture || 'Architecture unavailable'}`);
        record('context', loaded.contextWindow ? 'passed' : 'inconclusive', `${loaded.contextWindow || 0} tokens loaded; ${metadata?.hparams.nCtxTrain || 0} training tokens`);
        patchItem(index, { step: 'Text tests' });
        report.browserTests = await probeBrowserFeatures(path, progress => {
          patchItem(index, { step: `Text ${progress.finishedTests}/${progress.testCount} · ${progress.step}` });
        }, config.maxOutputTokens, result => { partialText.push(result); record(result.key, result.status, result.detail); }, signal);
        const textReport = await saveDiagnosticJson(folder, path, checkedAt, 'text', report);
        patchItem(index, { textReport });
        if (withVision) {
          isStopped(signal);
          patchItem(index, { step: 'Preparing vision tests' });
          fixtures ||= await visionFixtures();
          patchItem(index, { step: 'Vision tests' });
          const visionResults = await probeBrowserVision(path, fixtures, config.maxOutputTokens, (result, fixtureIndex) => {
            patchItem(index, { step: `Vision ${fixtureIndex + 1}/${fixtures!.length}` });
            partialVision.push(result);
            record(`vision.${result.id}`, result.status, `${result.detail} Answer: ${result.answer}`);
          }, signal);
          const visionReport = await saveDiagnosticJson(folder, path, checkedAt, 'vision', {
            file: path, checkedAt, projector: catalog?.visionProjector?.name,
            tests: visionResults.map(result => ({ ...result, exploratory: ['faint', 'micro', 'lsb', 'photo'].includes(result.id) })),
          });
          patchItem(index, { visionReport });
        }
        await saveCapabilities();
        patchItem(index, { state: 'done', step: 'Done' });
      } catch (error) {
        const stopped = signal.aborted;
        report.error = stopped ? 'Batch stopped.' : errorText(error);
        if (partialText.length && !report.browserTests) report.partialBrowserTests = partialText;
        try { if (!snapshot.items[index].textReport) patchItem(index, { textReport: await saveDiagnosticJson(folder, path, checkedAt, 'text', report) }); }
        catch (saveError) { report.error = `${report.error} Report save failed: ${errorText(saveError)}`; }
        if (partialVision.length && !snapshot.items[index].visionReport) {
          try {
            patchItem(index, { visionReport: await saveDiagnosticJson(folder, path, checkedAt, 'vision', {
              file: path, checkedAt, projector: catalog?.visionProjector?.name, error: report.error, tests: partialVision,
            }) });
          } catch (saveError) { report.error = `${report.error} Vision save failed: ${errorText(saveError)}`; }
        }
        try { await saveCapabilities(); } catch (ledgerError) { report.error = `${report.error} Capability save failed: ${errorText(ledgerError)}`; }
        patchItem(index, { state: stopped ? 'stopped' : 'failed', step: stopped ? 'Stopped' : 'Failed', error: report.error as string });
      }
      patch({ completed: index + 1 });
      if (signal.aborted) break;
    }
    const done = snapshot.items.filter(item => item.state === 'done').length;
    const failed = snapshot.items.filter(item => item.state === 'failed').length;
    showToast(signal.aborted ? `Model diagnostics stopped · ${done} finished.` : `Model diagnostics finished · ${done} finished${failed ? `, ${failed} failed` : ''}.`, failed ? 'error' : 'success');
  } catch (error) {
    const message = signal.aborted ? 'Batch stopped.' : errorText(error);
    patch({ error: message });
    showToast(message, 'error');
  } finally {
    fixtures?.forEach(item => URL.revokeObjectURL(item.url));
    if (modelLoadedByBatch) await unloadBrowserModel().catch(() => {});
    if (needleLoadedByBatch) await unloadNeedle().catch(() => {});
    controller = null;
    patch({ running: false, step: signal.aborted ? 'Stopped' : 'Finished' });
  }
}
