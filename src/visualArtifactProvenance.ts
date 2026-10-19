import { writeBlob } from './storage.ts';
import type { VisualModelPackage } from './visualModelProvenance.ts';

export type VisualArtifactDetails = {
  kind: 'depth-map' | 'video' | 'frame-sequence' | 'pose' | 'vector' | 'mesh' | 'mesh-conversion';
  generatedAt: string;
  modelPackage?: VisualModelPackage | null;
  runtimePackage?: VisualModelPackage | null;
  inputImageProvenance?: { modelPackage?: VisualModelPackage | null; runtimePackage?: VisualModelPackage | null } | null;
  modelRequired?: boolean;
  inferenceBackend?: string;
  source?: { name: string; origin: 'uploaded' | 'generated' | 'imported-ply' };
  settings?: unknown;
  sourceReportPath?: string;
};

export function visualArtifactSidecarPath(artifactPath: string): string {
  return `${artifactPath}.meta.json`;
}

/** Use after a writer that already saved the artifact, such as a ZIP stream. */
export async function writeVisualArtifactSidecar(folder: FileSystemDirectoryHandle, artifactPath: string, fileBytes: number, details: VisualArtifactDetails) {
  const sidecarPath = visualArtifactSidecarPath(artifactPath);
  const record = { schemaVersion: 1, ...details, artifactPath, fileBytes };
  await writeBlob(folder, sidecarPath, new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  return { sidecarPath, record };
}

/** Keep different formats with the same stem (for example PLY and GLB) separate. */
export async function saveVisualArtifact(folder: FileSystemDirectoryHandle, artifactPath: string, blob: Blob, details: VisualArtifactDetails) {
  await writeBlob(folder, artifactPath, blob);
  return writeVisualArtifactSidecar(folder, artifactPath, blob.size, details);
}
