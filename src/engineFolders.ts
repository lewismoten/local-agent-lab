import type { Asset } from './prismEngine.ts';

export type EngineGroup = 'Wllama' | 'PrismML' | 'Needle';
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';

export async function engineRoot(folder: FileSystemDirectoryHandle, create = false) {
  return create ? folder.getDirectoryHandle('engines', { create: true }) : folder.getDirectoryHandle('engines');
}
export async function engineDirectory(folder: FileSystemDirectoryHandle, group: EngineGroup, create = false) {
  const root = await engineRoot(folder, create);
  return create ? root.getDirectoryHandle(group, { create: true }) : root.getDirectoryHandle(group);
}
export async function engineDirectories(folder: FileSystemDirectoryHandle, group: EngineGroup) {
  let root: FileSystemDirectoryHandle;
  try { root = await engineRoot(folder); }
  catch (error) { if (missing(error)) return [] as FileSystemDirectoryHandle[]; throw error; }
  try { return [await root.getDirectoryHandle(group), root]; }
  catch (error) { if (missing(error)) return [root]; throw error; }
}
export async function maybeEngineFile(folder: FileSystemDirectoryHandle, group: EngineGroup, name: string): Promise<File | null> {
  for (const dir of await engineDirectories(folder, group)) {
    try { return await (await dir.getFileHandle(name)).getFile(); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return null;
}
export async function engineAssetFiles(folder: FileSystemDirectoryHandle, group: EngineGroup, assets: readonly Asset[], valid: (dir: FileSystemDirectoryHandle, asset: Asset) => Promise<File | null>) {
  const dirs = await engineDirectories(folder, group);
  return Promise.all(assets.map(async asset => {
    for (const dir of dirs) {
      const file = await valid(dir, asset);
      if (file) return file;
    }
    return null;
  }));
}
export async function engineSavedBytes(folder: FileSystemDirectoryHandle, group: EngineGroup, assets: readonly Asset[]) {
  const dirs = await engineDirectories(folder, group);
  let total = 0;
  for (const asset of assets) {
    let largest = 0;
    for (const dir of dirs) {
      try { largest = Math.max(largest, (await (await dir.getFileHandle(asset.name)).getFile()).size); }
      catch (error) { if (!missing(error)) throw error; }
    }
    total += Math.min(largest, asset.bytes);
  }
  return total;
}
async function digest(file: File) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}
async function copyVerified(source: File, target: FileSystemDirectoryHandle, name: string) {
  const writer = await (await target.getFileHandle(name, { create: true })).createWritable();
  await source.stream().pipeTo(writer);
  const copied = await (await target.getFileHandle(name)).getFile();
  if (copied.size !== source.size) throw new Error(`Could not verify ${name} after moving it.`);
  const [before, after] = await Promise.all([digest(source), digest(copied)]);
  if (before.some((byte, index) => byte !== after[index])) throw new Error(`Could not verify ${name} after moving it.`);
}
export async function legacyEngineFileCount(folder: FileSystemDirectoryHandle, names: readonly string[]) {
  let root: FileSystemDirectoryHandle;
  try { root = await engineRoot(folder); }
  catch (error) { if (missing(error)) return 0; throw error; }
  let count = 0;
  for (const name of names) {
    try { await root.getFileHandle(name); count++; }
    catch (error) { if (!missing(error)) throw error; }
  }
  return count;
}
export async function organizeEngineFiles(folder: FileSystemDirectoryHandle, group: EngineGroup, assets: readonly Asset[], queueFile: string, onProgress?: (name: string) => void) {
  const root = await engineRoot(folder, true);
  const names = [...assets.flatMap(asset => [asset.name, `${asset.name}.download.json`]), queueFile];
  const sourceFiles: { name: string; file: File }[] = [];
  for (const name of names) {
    try { sourceFiles.push({ name, file: await (await root.getFileHandle(name)).getFile() }); }
    catch (error) { if (!missing(error)) throw error; }
  }
  if (!sourceFiles.length) return 0;
  const target = await engineDirectory(folder, group, true);
  for (const { name, file } of sourceFiles) {
    onProgress?.(name);
    const existing = await target.getFileHandle(name).then(handle => handle.getFile()).catch(error => { if (missing(error)) return null; throw error; });
    const asset = assets.find(item => item.name === name);
    // Preserve an already verified asset or the longer of two partial copies.
    if (existing && asset) {
      const pinned = existing.size === asset.bytes && [...await digest(existing)].map(byte => byte.toString(16).padStart(2, '0')).join('') === asset.sha256;
      if (pinned || existing.size > file.size) continue;
    }
    await copyVerified(file, target, name);
  }
  let removed = 0;
  for (const { name } of sourceFiles) {
    try { await root.removeEntry(name); removed++; }
    catch (error) {
      if (missing(error)) continue;
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'NoModificationAllowedError')) continue;
      throw error;
    }
  }
  return removed;
}
