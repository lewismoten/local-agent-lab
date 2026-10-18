import type { HarnessProject } from './harnessData.ts';
import { toolFilePath, type ToolScope } from './harnessTools.ts';
import { readBlob } from './storage.ts';

const MAX_GUIDE_BYTES = 16 * 1024;

/** Read fresh guidance before a model run so edits outside the app take effect. */
export async function projectWithGuide(folder: FileSystemDirectoryHandle | null, project: HarnessProject): Promise<HarnessProject & { guide?: string }> {
  if (!folder) return project;
  const scope: ToolScope = { projects: [project], defaultProjectId: project.id, workspaceAccess: false };
  const path = toolFilePath(scope, project.id, 'files', 'AGENTS.md');
  let file: File;
  try { file = await readBlob(folder, path); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'NotFoundError') return project;
    throw cause;
  }
  if (file.size > MAX_GUIDE_BYTES) throw new Error(`Project guide ${path} is larger than 16 KB. Shorten it before using this project.`);
  const guide = (await file.text()).trim();
  if (!guide) return project;
  return { ...project, guide };
}
