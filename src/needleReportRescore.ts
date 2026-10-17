import { getCapabilityLedger, loadCapabilityLedger, pendingCapabilities, recordCapabilities } from './capabilityLedger.ts';
import { loadLatestDiagnosticJson, saveDiagnosticJson } from './diagnosticReports.ts';
import { NEEDLE_LABELS, NEEDLE_MODEL_ASSETS, NEEDLE_MODEL_PATHS, readNeedleWeight, type NeedleVersion } from './needleAssets.ts';
import { NEEDLE_SCORING_VERSION, rescoreNeedleReport, type NeedleReport } from './needleDiagnostics.ts';
import { ensureWritableFolder } from './storage.ts';

const inProgress = new WeakMap<FileSystemDirectoryHandle, Promise<number>>();
const scoredKeys = ['text', 'tools', 'reasoningTask', 'thinking'] as const;

export function rescoreSavedNeedleReports(folder: FileSystemDirectoryHandle, requestPermission = false): Promise<number> {
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
    for (const version of Object.keys(NEEDLE_MODEL_PATHS) as NeedleVersion[]) {
      const path = NEEDLE_MODEL_PATHS[version];
      const saved = await loadLatestDiagnosticJson<NeedleReport>(folder, path, 'text');
      if (!saved || !saved.tests || !saved.checkedAt) continue;
      let currentSize: number;
      try { currentSize = (await readNeedleWeight(folder, version)).size; }
      catch { continue; }
      if (currentSize !== NEEDLE_MODEL_ASSETS[version][1].bytes) continue;
      const due = new Set(pendingCapabilities(getCapabilityLedger(), path, undefined, currentSize));
      const updated = rescoreNeedleReport(saved);
      const observations = scoredKeys.flatMap(key => {
        const test = updated.tests[key];
        return due.has(key) && test && typeof test.output === 'string' && !test.error ? [{ id: key, result: test.result, detail: test.detail }] : [];
      });
      if (saved.scoringVersion === NEEDLE_SCORING_VERSION && !observations.length) continue;
      if (saved.scoringVersion !== NEEDLE_SCORING_VERSION) {
        updated.savedPath = await saveDiagnosticJson(folder, path, updated.checkedAt, 'text', updated);
        refreshed++;
      }
      if (observations.length) await recordCapabilities(folder, path, NEEDLE_LABELS[version], observations, currentSize);
    }
    return refreshed;
  })();
  inProgress.set(folder, task);
  void task.finally(() => { if (inProgress.get(folder) === task) inProgress.delete(folder); }).catch(() => {});
  return task;
}
