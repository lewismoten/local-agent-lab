import { MODEL_CATALOG } from './catalogModels.ts';
import { workspaceFileName } from './workspacePath.ts';

const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
export const modelFolderName = (name: string) => {
  workspaceFileName(name);
  const owner = MODEL_CATALOG.find(model => model.visionProjector?.name === name);
  return workspaceFileName((owner?.name || name).replace(/\.gguf$/i, ''));
};
export const modelLogicalPath = (name: string) => `models/${name}`;
export const modelNestedPath = (name: string) => `models/${modelFolderName(name)}/${name}`;
export async function modelStorageDirectory(folder: FileSystemDirectoryHandle, name: string, create = false) {
  const models = await folder.getDirectoryHandle('models', { create });
  return models.getDirectoryHandle(modelFolderName(name), { create });
}
export async function maybeModelFile(folder: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await (await modelStorageDirectory(folder, name)).getFileHandle(name)).getFile(); }
  catch (error) { if (!missing(error)) throw error; }
  try { return await (await (await folder.getDirectoryHandle('models')).getFileHandle(name)).getFile(); }
  catch (error) { if (missing(error)) return null; throw error; }
}
export async function modelDownloadDirectory(folder: FileSystemDirectoryHandle, name: string) {
  workspaceFileName(name);
  const models = await folder.getDirectoryHandle('models', { create: true });
  // Continue a flat download in place. The organizer moves it once complete.
  for (const legacyName of [name, `${name}.LICENSE.txt`, `${name}.LICENSE.html`]) {
    try { await models.getFileHandle(legacyName); return models; }
    catch (error) { if (!missing(error)) throw error; }
  }
  return models.getDirectoryHandle(modelFolderName(name), { create: true });
}
async function copyFile(file: File, target: FileSystemDirectoryHandle, name: string) {
  const writer = await (await target.getFileHandle(name, { create: true })).createWritable();
  await file.stream().pipeTo(writer);
  if ((await (await target.getFileHandle(name)).getFile()).size !== file.size) throw new Error(`Could not verify ${name} after copying.`);
}
export async function organizeFlatGgufModels(folder: FileSystemDirectoryHandle, onProgress?: (name: string) => void) {
  const models = await folder.getDirectoryHandle('models', { create: true });
  let moved = 0;
  for await (const [name, handle] of (models as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.gguf')) continue;
    workspaceFileName(name);
    try { await models.getFileHandle(`${name}.download.json`); continue; }
    catch (error) { if (!missing(error)) throw error; }
    onProgress?.(name);
    const file = await (handle as FileSystemFileHandle).getFile();
    const target = await modelStorageDirectory(folder, name, true);
    await copyFile(file, target, name);
    const suffixes = ['.LICENSE.txt', '.LICENSE.html', '.PROHIBITED-USE.html', '.NOTICE.txt', '.SOURCE.txt'];
    for (const suffix of suffixes) {
      let sidecar: File;
      try { sidecar = await (await models.getFileHandle(`${name}${suffix}`)).getFile(); }
      catch (error) { if (missing(error)) continue; throw error; }
      const destination = `${MODEL_CATALOG.some(model => model.visionProjector?.name === name) ? 'PROJECTOR-' : ''}${suffix.slice(1)}`;
      await copyFile(sidecar, target, destination);
    }
    // Delete only after every copied file has been checked.
    await models.removeEntry(name);
    for (const suffix of suffixes) {
      try { await models.removeEntry(`${name}${suffix}`); }
      catch (error) { if (!missing(error)) throw error; }
    }
    moved++;
  }
  return moved;
}
