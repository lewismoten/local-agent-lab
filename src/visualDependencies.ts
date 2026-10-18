import { readBlob } from './storage.ts';
import { onnxImageEngineProvenance, type VisualModelPackage } from './visualModelProvenance.ts';

type Provenance = { modelPackage?: VisualModelPackage | null; runtimePackage?: VisualModelPackage | null };
type SavedVisualReport = Provenance & {
  provenance?: Provenance | null;
  inputImageProvenance?: Provenance | null;
};

export function visualDependencyPaths(report: SavedVisualReport, imageEngine = false): string[] {
  const packages = [report.modelPackage, report.runtimePackage,
    report.provenance?.modelPackage, report.provenance?.runtimePackage,
    report.inputImageProvenance?.modelPackage, report.inputImageProvenance?.runtimePackage,
    imageEngine ? onnxImageEngineProvenance() : null];
  return [...new Set(packages.flatMap(item => item?.files?.map(file => file.path) || []))]
    .filter(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..'));
}

/** A missing file is distinct from a drive whose read permission was revoked. */
export async function missingVisualDependencies(folder: FileSystemDirectoryHandle, report: SavedVisualReport, imageEngine = false): Promise<string[]> {
  const paths = visualDependencyPaths(report, imageEngine);
  const results = await Promise.all(paths.map(async path => {
    try { await readBlob(folder, path); return null; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return path;
      throw error;
    }
  }));
  return results.filter((path): path is string => path !== null);
}
