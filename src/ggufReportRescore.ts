import { getCapabilityLedger, loadCapabilityLedger, pendingCapabilities, recordCapabilities } from './capabilityLedger.ts';
import { scorePromptedSteps } from './browserInference.ts';
import { loadLatestDiagnosticJson, saveDiagnosticJson } from './diagnosticReports.ts';
import { catalogModelForPath } from './modelLicenses.ts';
import { ensureWritableFolder, readBlob } from './storage.ts';

export const GGUF_SCORING_VERSION = 2;
type PromptedResult = ReturnType<typeof scorePromptedSteps> & { trace?: { output?: { message?: { content?: string | null }; finishReason?: string | null }; error?: string } };
export type SavedGgufReport = { file: string; checkedAt: string; observed?: { fileBytes?: number }; browserTests?: { promptedSteps?: PromptedResult }; scoringVersion?: number; rescoredAt?: string; originalScores?: { promptedSteps?: { result: string; detail: string } } };

export function rescoreGgufReport(report: SavedGgufReport): SavedGgufReport {
  if (report.scoringVersion === GGUF_SCORING_VERSION) return report;
  const previous = report.browserTests?.promptedSteps;
  const output = previous?.trace?.output;
  if (!previous || previous.trace?.error || typeof output?.message?.content !== 'string') return report;
  const scored = scorePromptedSteps(output.message.content, output.finishReason);
  const changed = scored.result !== previous.result || scored.detail !== previous.detail || scored.answerAccuracy !== previous.answerAccuracy;
  return { ...report, scoringVersion: GGUF_SCORING_VERSION, ...(changed ? { rescoredAt: new Date().toISOString(), originalScores: { ...report.originalScores, promptedSteps: { result: previous.result, detail: previous.detail } } } : {}), browserTests: { ...report.browserTests, promptedSteps: { ...previous, ...scored } } };
}

const inProgress = new WeakMap<FileSystemDirectoryHandle, Promise<number>>();
export function rescoreSavedGgufReports(folder: FileSystemDirectoryHandle, paths: string[], requestPermission = false): Promise<number> {
  const running = inProgress.get(folder);
  if (running) return running;
  const task = (async () => {
    if (requestPermission) {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow workspace access to update saved reports.');
    } else {
      const access = folder as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState> };
      if (access.queryPermission && await access.queryPermission({ mode: 'readwrite' }) !== 'granted') return 0;
    }
    await loadCapabilityLedger(folder);
    let refreshed = 0;
    for (const path of paths.filter(item => item.toLowerCase().endsWith('.gguf'))) {
      const saved = await loadLatestDiagnosticJson<SavedGgufReport>(folder, path, 'text');
      if (!saved || saved.file !== path || !saved.checkedAt) continue;
      let currentSize: number;
      try { currentSize = (await readBlob(folder, path)).size; } catch { continue; }
      if (saved.observed?.fileBytes !== undefined && currentSize !== saved.observed.fileBytes) continue;
      const updated = rescoreGgufReport(saved);
      const test = updated.browserTests?.promptedSteps;
      const due = pendingCapabilities(getCapabilityLedger(), path, catalogModelForPath(path), currentSize).includes('promptedSteps');
      if (updated === saved && !due) continue;
      if (updated !== saved) {
        await saveDiagnosticJson(folder, path, saved.checkedAt, 'text', updated);
        refreshed++;
      }
      if (due && test && typeof test.trace?.output?.message?.content === 'string' && !test.trace.error) {
        await recordCapabilities(folder, path, catalogModelForPath(path)?.label || path, [{ id: 'promptedSteps', result: test.result === 'passed' ? 'passed' : test.result === 'inconclusive' ? 'inconclusive' : 'failed', detail: test.detail }], currentSize);
      }
    }
    return refreshed;
  })();
  inProgress.set(folder, task);
  void task.finally(() => { if (inProgress.get(folder) === task) inProgress.delete(folder); }).catch(() => {});
  return task;
}
