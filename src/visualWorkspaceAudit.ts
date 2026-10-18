import { missingVisualDependencies, visualDependencyPaths } from './visualDependencies.ts';

type DirectoryWithEntries = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
type VisualRecord = {
  artifactPath?: string;
  imagePath?: string;
  outputPath?: string;
  videoPath?: string;
  depthPath?: string;
  frameSequencePath?: string;
  svgPath?: string;
  posePath?: string;
  plyPath?: string;
  glbPath?: string;
  sourceImagePath?: string;
  provenance?: VisualRecord;
  inputImageProvenance?: VisualRecord;
  modelPackage?: { path: string; files: { path: string; sha256: string }[] } | null;
  runtimePackage?: { path: string; files: { path: string; sha256: string }[] } | null;
  imageProvider?: string;
  runtime?: string;
  modelRequired?: boolean;
};

export type VisualWorkspaceIssue = { artifactPath: string; missingPaths: string[] };
export type VisualWorkspaceAudit = { checkedRecords: number; withoutProvenance: number; issues: VisualWorkspaceIssue[] };

const outputKeys = ['artifactPath', 'imagePath', 'outputPath', 'videoPath', 'depthPath', 'frameSequencePath',
  'svgPath', 'posePath', 'plyPath', 'glbPath', 'sourceImagePath'] as const;

export function visualArtifactPaths(record: VisualRecord): string[] {
  const values = [record, record.provenance, record.inputImageProvenance].filter((item): item is VisualRecord => !!item);
  return [...new Set(values.flatMap(item => outputKeys.map(key => item[key]).filter((path): path is string => typeof path === 'string' && path.length > 0)))];
}

async function directoryAt(root: FileSystemDirectoryHandle, parts: string[]): Promise<DirectoryWithEntries | null> {
  try {
    let current = root;
    for (const part of parts) current = await current.getDirectoryHandle(part);
    return current as DirectoryWithEntries;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function jsonFiles(dir: DirectoryWithEntries, prefix: string, visualReportsOnly = false, sidecarsOnly = false): Promise<{ path: string; file: File }[]> {
  const files: { path: string; file: File }[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.json') || visualReportsOnly && !/-(?:image|video|pose|vector|mesh)\.json$/i.test(name) || sidecarsOnly && !name.endsWith('.meta.json')) continue;
    files.push({ path: `${prefix}/${name}`, file: await (handle as FileSystemFileHandle).getFile() });
  }
  return files;
}

/** Scan saved visual metadata without opening model weights or changing the workspace. */
export async function auditVisualWorkspace(root: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<VisualWorkspaceAudit> {
  const candidates: { path: string; file: File }[] = [];
  const models = await directoryAt(root, ['models']);
  if (models) {
    for await (const [name, handle] of models.entries()) {
      if (signal?.aborted) throw signal.reason;
      if (handle.kind !== 'directory') continue;
      const diagnostics = await directoryAt(handle as FileSystemDirectoryHandle, ['diagnostics']);
      if (diagnostics) candidates.push(...await jsonFiles(diagnostics, `models/${name}/diagnostics`, true));
    }
    const oldDiagnostics = await directoryAt(models, ['diagnostics']);
    if (oldDiagnostics) candidates.push(...await jsonFiles(oldDiagnostics, 'models/diagnostics', true));
  }
  for (const parts of [['outputs', 'images'], ['sources', 'generated']]) {
    const dir = await directoryAt(root, parts);
    if (dir) candidates.push(...await jsonFiles(dir, parts.join('/')));
  }
  for (const name of ['depth', 'videos', 'frames', 'meshes', 'vectors', 'poses']) {
    const dir = await directoryAt(root, ['media', name]);
    if (dir) candidates.push(...await jsonFiles(dir, `media/${name}`, false, name !== 'poses'));
  }

  const issues = new Map<string, Set<string>>();
  let checkedRecords = 0, withoutProvenance = 0;
  for (const candidate of candidates) {
    if (signal?.aborted) throw signal.reason;
    let record: VisualRecord;
    try { record = JSON.parse(await candidate.file.text()) as VisualRecord; }
    catch { withoutProvenance++; continue; }
    if (!record || typeof record !== 'object') { withoutProvenance++; continue; }
    const imageEngine = record.imageProvider === 'browser' || record.provenance?.imageProvider === 'browser' || record.inputImageProvenance?.imageProvider === 'browser' || record.runtime === 'ONNX image engine' && candidate.path.endsWith('-image.json');
    const paths = visualDependencyPaths(record, imageEngine);
    if (!paths.length && record.modelRequired !== false) { withoutProvenance++; continue; }
    checkedRecords++;
    const missing = await missingVisualDependencies(root, record, imageEngine);
    if (!missing.length) continue;
    for (const artifactPath of [candidate.path, ...visualArtifactPaths(record)]) {
      const prior = issues.get(artifactPath) || new Set<string>();
      missing.forEach(path => prior.add(path));
      issues.set(artifactPath, prior);
    }
  }
  return { checkedRecords, withoutProvenance,
    issues: [...issues].map(([artifactPath, paths]) => ({ artifactPath, missingPaths: [...paths] }))
      .sort((a, b) => a.artifactPath.localeCompare(b.artifactPath)) };
}
