import { parseProjectFiles, projectFiles, type Project } from './model.ts';

const DB = 'rivers-of-memory';
const STORE = 'handles';
export function saveCache(project: Project): boolean {
  try { localStorage.setItem('story-project', JSON.stringify(project)); return true; }
  catch { return false; }
}
export function loadCache(): Project | null {
  try {
    const text = localStorage.getItem('story-project');
    return text ? JSON.parse(text) as Project : null;
  } catch { return null; }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveHandle(handle: FileSystemDirectoryHandle) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, 'project');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await database();
  const value = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('project');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}
export async function clearHandle(): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('project');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function hasWritableFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const access = handle as FileSystemDirectoryHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (!access.queryPermission) return true;
  try { return await access.queryPermission({ mode: 'readwrite' }) === 'granted'; }
  catch { return false; }
}
export async function ensureWritableFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const access = handle as FileSystemDirectoryHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (!access.queryPermission) return true;
  if (await access.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await access.requestPermission?.({ mode: 'readwrite' }) === 'granted';
}
export async function browserFiles(): Promise<FileSystemDirectoryHandle | null> {
  if (!navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('local-agent-lab', { create: true });
    // OPFS APIs vary across browsers. A real write and removal verifies the
    // operations used by model downloads before offering browser file storage.
    const probe = `.write-check-${crypto.randomUUID()}`;
    const handle = await folder.getFileHandle(probe, { create: true });
    const writer = await handle.createWritable();
    await writer.write('ready');
    await writer.close();
    await folder.removeEntry(probe);
    return folder;
  } catch { return null; }
}
declare global {
  interface Window { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> }
}
async function readTree(dir: FileSystemDirectoryHandle, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    const path = prefix + name;
    if (handle.kind === 'directory') Object.assign(files, await readTree(handle as FileSystemDirectoryHandle, path + '/'));
    else if (path.endsWith('.json')) files[path] = await (await (handle as FileSystemFileHandle).getFile()).text();
  }
  return files;
}
const directoryHandles = new WeakMap<FileSystemDirectoryHandle, Map<string, Promise<FileSystemDirectoryHandle>>>();
const MAX_DIRECTORY_HANDLES = 256;
async function directoryAt(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let handles = directoryHandles.get(root);
  if (!handles) { handles = new Map(); directoryHandles.set(root, handles); }
  let current = root;
  let path = '';
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    let next = handles.get(path);
    if (!next) {
      next = current.getDirectoryHandle(part, { create });
      handles.set(path, next);
      if (handles.size > MAX_DIRECTORY_HANDLES) handles.delete(handles.keys().next().value!);
    } else {
      handles.delete(path);
      handles.set(path, next);
    }
    try { current = await next; }
    catch (error) { if (handles.get(path) === next) handles.delete(path); throw error; }
  }
  return current;
}
function missingEntry(error: unknown): boolean { return error instanceof DOMException && error.name === 'NotFoundError'; }
export async function writeBlob(root: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const parts = path.split('/');
  const name = parts.pop()!;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const dir = await directoryAt(root, parts, true);
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(blob);
      await writer.close();
      return;
    } catch (error) {
      if (attempt || !missingEntry(error)) throw error;
      directoryHandles.delete(root); // A folder may have been replaced outside this tab.
    }
  }
}
export async function writeProject(root: FileSystemDirectoryHandle, project: Project) {
  const files = projectFiles(project);
  const old = await readTree(root);
  for (const path of Object.keys(old)) {
    if (path in files) continue;
    if (!/^(world\/(characters|notes|influences|reviews)\/|books\/|sources\/)/.test(path)) continue;
    const parts = path.split('/');
    const name = parts.pop()!;
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry(name);
  }
  for (const [path, text] of Object.entries(files)) await writeBlob(root, path, new Blob([text], { type: 'application/json' }));
}
export async function readProject(root: FileSystemDirectoryHandle): Promise<Project> {
  return parseProjectFiles(await readTree(root));
}
export async function readBlob(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  const parts = path.split('/');
  const name = parts.pop()!;
  const read = async () => (await (await directoryAt(root, parts, false)).getFileHandle(name)).getFile();
  try { return await read(); }
  catch (error) {
    if (missingEntry(error) && directoryHandles.has(root)) {
      directoryHandles.delete(root);
      try { return await read(); }
      catch (retryError) { error = retryError; }
    }
    if (path.startsWith('models/') && parts.length === 1 && name.toLowerCase().endsWith('.gguf') && error instanceof DOMException && error.name === 'NotFoundError') {
      const { modelStorageDirectory } = await import('./modelFolders.ts');
      return (await (await modelStorageDirectory(root, name)).getFileHandle(name)).getFile();
    }
    throw error;
  }
}
export function downloadProject(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'story-project.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
