import { sha256 } from '@noble/hashes/sha2.js';

export type LibraryImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/gif';
export type GeneratedImageFile = { path: string; bytes: number; mimeType: LibraryImageMimeType; modifiedAt: string; prompt?: string; model?: string; generatedAt?: string };

const generatedPath = /^harness\/projects\/[a-zA-Z0-9-]{1,80}\/library\/generated\/[^/\\\x00-\x1f]+\.(?:png|jpe?g|webp|avif|gif)$/i;
const inspectorPath = /^outputs\/images\/[^/\\\x00-\x1f]+\.png$/i;
const motionSourcePath = /^sources\/generated\/motion-first-frame-[^/\\\x00-\x1f]+\.png$/i;
const legacyChatPath = /^assets\/chat\/[a-zA-Z0-9-]{1,80}\.png$/i;
const legacyCharacterPath = /^assets\/characters\/[a-zA-Z0-9-]{1,80}\/[a-zA-Z0-9-]{1,80}-generated\.png$/i;
export const validGeneratedImagePath = (path: string): boolean =>
  [generatedPath, inspectorPath, motionSourcePath, legacyChatPath, legacyCharacterPath].some(pattern => pattern.test(path))
  && !path.split('/').some(part => part === '.' || part === '..');
const originalPath = /^harness\/images\/originals\/[a-zA-Z0-9-]{1,80}\.(?:png|jpe?g|webp|avif|gif)$/i;
export const validLibraryImagePath = (path: string): boolean => validGeneratedImagePath(path) || originalPath.test(path);
export const imageExtensionForMime = (type: LibraryImageMimeType): string => type === 'image/jpeg' ? 'jpg' : type.slice(6);

/** Hash one MiB at a time so exact comparisons do not materialize whole images. */
export async function imageFingerprint(image: Blob, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  const step = 1024 * 1024;
  for (let offset = 0; offset < image.size; offset += step) {
    if (signal?.aborted) throw signal.reason || new DOMException('Image comparison stopped.', 'AbortError');
    hash.update(new Uint8Array(await image.slice(offset, Math.min(image.size, offset + step)).arrayBuffer()));
  }
  return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
}

function typeFromHeader(bytes: Uint8Array): LibraryImageMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp' && ['avif', 'avis'].includes(String.fromCharCode(...bytes.subarray(8, 12)))) return 'image/avif';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return 'image/gif';
  return null;
}

export async function originalImageMimeType(image: Blob): Promise<LibraryImageMimeType | null> {
  if (!image.size) return null;
  return typeFromHeader(new Uint8Array(await image.slice(0, 12).arrayBuffer()));
}

export async function inspectedGeneratedImage(file: File, path: string): Promise<GeneratedImageFile | null> {
  if (!validGeneratedImagePath(path) || !file.size) return null;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mimeType = typeFromHeader(bytes);
  const suffix = path.split('.').at(-1)?.toLowerCase();
  if (!mimeType || (mimeType === 'image/png' && suffix !== 'png') || (mimeType === 'image/jpeg' && !['jpg', 'jpeg'].includes(suffix || ''))
    || (mimeType === 'image/webp' && suffix !== 'webp') || (mimeType === 'image/avif' && suffix !== 'avif') || (mimeType === 'image/gif' && suffix !== 'gif')) return null;
  return { path, bytes: file.size, mimeType, modifiedAt: Number.isFinite(file.lastModified) && file.lastModified > 0 && file.lastModified <= 8.64e15 ? new Date(file.lastModified).toISOString() : new Date().toISOString() };
}

async function maybeDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    let current = root;
    for (const part of path.split('/')) current = await current.getDirectoryHandle(part);
    return current;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

/** Only reads file handles and 12-byte signatures; image bodies stay on the drive. */
export async function scanGeneratedImageFiles(root: FileSystemDirectoryHandle, knownPaths: Set<string>, signal?: AbortSignal,
  onProgress?: (scanned: number, found: number) => void): Promise<GeneratedImageFile[]> {
  const found: GeneratedImageFile[] = [];
  let scanned = 0;
  const entries = (directory: FileSystemDirectoryHandle) => (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
  const inspectDirectory = async (directory: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of entries(directory)) {
      if (signal?.aborted) throw signal.reason || new DOMException('Image scan stopped.', 'AbortError');
      const path = `${prefix}/${name}`;
      if (handle.kind !== 'file' || !validGeneratedImagePath(path) || knownPaths.has(path)) continue;
      const inspected = await inspectedGeneratedImage(await (handle as FileSystemFileHandle).getFile(), path);
      scanned++;
      if (inspected) {
        if (prefix === 'outputs/images' || prefix === 'sources/generated' || prefix.includes('/library/generated')) {
          try {
            const sidecar = await directory.getFileHandle(name.replace(/\.[^.]+$/, '.json'));
            const file = await sidecar.getFile();
            if (file.size > 0 && file.size <= 64_000) {
              const data = JSON.parse(await file.text()) as { imagePath?: unknown; prompt?: unknown; imageModel?: unknown; generatedAt?: unknown };
              if (data.imagePath === path) {
                if (typeof data.prompt === 'string') inspected.prompt = data.prompt.slice(0, 1200);
                if (typeof data.imageModel === 'string') inspected.model = data.imageModel.slice(0, 80);
                if (typeof data.generatedAt === 'string' && Number.isFinite(Date.parse(data.generatedAt))) inspected.generatedAt = new Date(data.generatedAt).toISOString();
              }
            }
          } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) console.warn(`Could not read image details for ${path}:`, error); }
        }
        found.push(inspected);
      }
      if (scanned % 32 === 0) { onProgress?.(scanned, found.length); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  };
  const projects = await maybeDirectory(root, 'harness/projects');
  if (projects) for await (const [projectId, projectHandle] of entries(projects)) {
    if (signal?.aborted) throw signal.reason || new DOMException('Image scan stopped.', 'AbortError');
    if (projectHandle.kind !== 'directory' || !/^[a-zA-Z0-9-]{1,80}$/.test(projectId)) continue;
    const directory = await maybeDirectory(projectHandle as FileSystemDirectoryHandle, 'library/generated');
    if (directory) await inspectDirectory(directory, `harness/projects/${projectId}/library/generated`);
  }
  for (const prefix of ['outputs/images', 'sources/generated', 'assets/chat']) {
    const directory = await maybeDirectory(root, prefix);
    if (directory) await inspectDirectory(directory, prefix);
  }
  const characters = await maybeDirectory(root, 'assets/characters');
  if (characters) for await (const [characterId, handle] of entries(characters)) {
    if (signal?.aborted) throw signal.reason || new DOMException('Image scan stopped.', 'AbortError');
    if (handle.kind === 'directory' && /^[a-zA-Z0-9-]{1,80}$/.test(characterId))
      await inspectDirectory(handle as FileSystemDirectoryHandle, `assets/characters/${characterId}`);
  }
  onProgress?.(scanned, found.length);
  return found;
}

