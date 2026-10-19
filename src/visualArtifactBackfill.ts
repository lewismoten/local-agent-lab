import { readBlob } from './storage.ts';
import { visualArtifactSidecarPath, writeVisualArtifactSidecar, type VisualArtifactDetails } from './visualArtifactProvenance.ts';
import type { VisualModelPackage } from './visualModelProvenance.ts';

type DirectoryEntries = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
type Report = {
  checkedAt?: string;
  modelPackage?: VisualModelPackage | null;
  runtimePackage?: VisualModelPackage | null;
  inputImageProvenance?: VisualArtifactDetails['inputImageProvenance'];
  inferenceBackend?: string;
  input?: { name?: string };
  inputs?: { firstFrame?: string };
  sourceImagePath?: string;
  depthPath?: string;
  videoPath?: string;
  frameSequencePath?: string;
  posePath?: string;
  svgPath?: string;
  plyPath?: string;
  glbPath?: string;
};

export type VisualBackfillCandidate = { artifactPath: string; reportPath: string; fileBytes: number; details: VisualArtifactDetails };

const outputs = [
  ['depthPath', 'depth-map', /^media\/depth\/[\w.-]+\.png$/i],
  ['videoPath', 'video', /^media\/videos\/[\w.-]+\.(?:webm|mp4)$/i],
  ['frameSequencePath', 'frame-sequence', /^media\/frames\/[\w.-]+\.zip$/i],
  ['posePath', 'pose', /^media\/poses\/[\w.-]+\.json$/i],
  ['svgPath', 'vector', /^media\/vectors\/[\w.-]+\.svg$/i],
  ['plyPath', 'mesh', /^media\/meshes\/[\w.-]+\.ply$/i],
  ['glbPath', 'mesh', /^media\/meshes\/[\w.-]+\.glb$/i],
] as const;

const pinned = (pack: VisualModelPackage | null | undefined): boolean => !pack ||
  typeof pack.path === 'string' && /^(?:models|engines)\/[\w./-]+$/.test(pack.path) && !pack.path.split('/').includes('..') &&
  Array.isArray(pack.files) && pack.files.length > 0 && pack.files.every(file =>
    typeof file?.path === 'string' && file.path.startsWith(`${pack.path}/`) && !file.path.split('/').includes('..') && /^[a-f\d]{64}$/i.test(file.sha256));
const hasPackage = (pack: VisualModelPackage | null | undefined): boolean => !!pack && Array.isArray(pack.files) && pack.files.length > 0;
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';

async function diagnostics(root: FileSystemDirectoryHandle): Promise<{ path: string; file: File }[]> {
  const reports: { path: string; file: File }[] = [];
  let models: DirectoryEntries;
  try { models = await root.getDirectoryHandle('models') as DirectoryEntries; }
  catch (error) { if (missing(error)) return reports; throw error; }
  async function addReports(dir: DirectoryEntries, prefix: string) {
    for await (const [name, item] of dir.entries()) {
      if (item.kind !== 'file' || !/-(?:video|pose|vector|mesh)\.json$/i.test(name)) continue;
      reports.push({ path: `${prefix}/${name}`, file: await (item as FileSystemFileHandle).getFile() });
    }
  }
  for await (const [modelName, handle] of models.entries()) {
    if (handle.kind !== 'directory') continue;
    if (modelName === 'diagnostics') { await addReports(handle as DirectoryEntries, 'models/diagnostics'); continue; }
    let dir: DirectoryEntries;
    try { dir = await (handle as FileSystemDirectoryHandle).getDirectoryHandle('diagnostics') as DirectoryEntries; }
    catch (error) { if (missing(error)) continue; throw error; }
    await addReports(dir, `models/${modelName}/diagnostics`);
  }
  return reports;
}

/** Find older outputs whose saved report can establish their model provenance. No writes. */
export async function planVisualArtifactBackfill(root: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<VisualBackfillCandidate[]> {
  const matches = new Map<string, VisualBackfillCandidate[]>();
  for (const { path: reportPath, file } of await diagnostics(root)) {
    if (signal?.aborted) throw signal.reason;
    let report: Report;
    try { report = JSON.parse(await file.text()) as Report; } catch { continue; }
    if (!report || typeof report !== 'object' || !report.checkedAt || !Number.isFinite(Date.parse(report.checkedAt))) continue;
    const input = report.inputImageProvenance;
    if (![report.modelPackage, report.runtimePackage, input?.modelPackage, input?.runtimePackage].every(pinned)) continue;
    if (![report.modelPackage, report.runtimePackage, input?.modelPackage, input?.runtimePackage].some(hasPackage)) continue;
    for (const [key, kind, pattern] of outputs) {
      const artifactPath = report[key];
      if (typeof artifactPath !== 'string' || !pattern.test(artifactPath)) continue;
      try {
        await readBlob(root, visualArtifactSidecarPath(artifactPath));
        continue;
      } catch (error) { if (!missing(error)) throw error; }
      let artifact: File;
      try { artifact = await readBlob(root, artifactPath); }
      catch (error) { if (missing(error)) continue; throw error; }
      if (!artifact.size) continue;
      const sourceName = report.input?.name || report.inputs?.firstFrame || report.sourceImagePath;
      const details: VisualArtifactDetails = {
        kind, generatedAt: report.checkedAt, modelPackage: report.modelPackage, runtimePackage: report.runtimePackage,
        inputImageProvenance: input, modelRequired: true, inferenceBackend: report.inferenceBackend,
        source: sourceName ? { name: sourceName, origin: report.sourceImagePath && sourceName === report.sourceImagePath ? 'generated' : 'uploaded' } : undefined,
        settings: report.input || report.inputs, sourceReportPath: reportPath,
      };
      const prior = matches.get(artifactPath) || [];
      prior.push({ artifactPath, reportPath, fileBytes: artifact.size, details });
      matches.set(artifactPath, prior);
    }
  }
  // Multiple reports for one output cannot establish which run created it.
  return [...matches.values()].filter(items => items.length === 1).map(items => items[0]);
}

/** Add metadata only; recheck each file and never replace an existing sidecar. */
export async function backfillVisualArtifactSidecars(root: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<number> {
  let created = 0;
  for (const candidate of await planVisualArtifactBackfill(root, signal)) {
    if (signal?.aborted) throw signal.reason;
    try { await readBlob(root, visualArtifactSidecarPath(candidate.artifactPath)); continue; }
    catch (error) { if (!missing(error)) throw error; }
    let artifact: File;
    try { artifact = await readBlob(root, candidate.artifactPath); }
    catch (error) { if (missing(error)) continue; throw error; }
    if (artifact.size !== candidate.fileBytes) continue;
    await writeVisualArtifactSidecar(root, candidate.artifactPath, artifact.size, candidate.details);
    created++;
  }
  return created;
}
