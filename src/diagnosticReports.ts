import { writeBlob } from './storage.ts';
import { modelFolderName } from './modelFolders.ts';

type DiagnosticKind = 'text' | 'vision' | 'image' | 'speech' | 'video' | 'pose' | 'vector' | 'mesh';
let reportRevision = 0;
const reportListeners = new Set<() => void>();
export const getDiagnosticReportRevision = () => reportRevision;
export const subscribeDiagnosticReports = (listener: () => void) => { reportListeners.add(listener); return () => { reportListeners.delete(listener); }; };
export function diagnosticReportPath(modelPath: string, checkedAt: string, kind: DiagnosticKind) {
  const name = modelPath.split('/').pop()?.replace(/\.gguf$/i, '').replace(/[^\w.-]/g, '_') || 'model';
  const stamp = checkedAt.replace(/[:.]/g, '-');
  const parts = modelPath.split('/');
  const parent = parts.length > 2 ? parts.slice(0, -1).join('/') : modelPath.toLowerCase().endsWith('.gguf') ? `models/${modelFolderName(parts.at(-1)!)}` : modelPath.startsWith('models/') ? modelPath : 'models';
  return `${parent}/diagnostics/${name}-${stamp}-${kind}.json`;
}

export async function saveDiagnosticJson(folder: FileSystemDirectoryHandle, modelPath: string, checkedAt: string, kind: DiagnosticKind, report: unknown) {
  const path = diagnosticReportPath(modelPath, checkedAt, kind);
  await writeBlob(folder, path, new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  reportRevision++;
  reportListeners.forEach(listener => listener());
  return path;
}

export async function loadLatestDiagnosticJson<T>(folder: FileSystemDirectoryHandle, modelPath: string, kind: DiagnosticKind, accept?: (report: T) => boolean): Promise<T | null> {
  const paths = [diagnosticReportPath(modelPath, '', kind)];
  if (modelPath.split('/').length > 2 || modelPath.toLowerCase().endsWith('.gguf')) paths.push(`models/diagnostics/${modelPath.split('/').pop()?.replace(/\.gguf$/i, '').replace(/[^\w.-]/g, '_') || 'model'}--${kind}.json`);
  for (const path of paths) {
  try {
    const parts = path.split('/');
    let dir = folder;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const prefix = parts.at(-1)!.replace(/--(?:text|vision|image|speech|video|pose|vector|mesh)\.json$/, '-');
    const matches: string[] = [];
    for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith(`-${kind}.json`)) matches.push(name);
    }
    for (const name of matches.sort().reverse()) {
      const report = JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()) as T;
      if (!accept || accept(report)) return report;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') continue;
    throw error;
  }
  }
  return null;
}
