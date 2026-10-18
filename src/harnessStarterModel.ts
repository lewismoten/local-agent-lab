import { MODEL_CATALOG } from './catalogModels.ts';
import { isBonsai2BrowserUnsupported, isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility.ts';
import { assertModelLicenseFiles, hasGemmaConsent, hasQwenResearchConsent, isCatalogVisionProjector } from './modelLicenses.ts';
import { assertPrismEngineFiles } from './prismEngine.ts';
import { assertWllamaEngineFiles } from './wllamaEngine.ts';
import { modelFolderName } from './modelFolders.ts';

const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
type DirectoryEntries = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };

/** Read file metadata only; never fetch weights or create directories during startup. */
export async function soleInstalledChatModel(folder: FileSystemDirectoryHandle): Promise<string | null> {
  let models: FileSystemDirectoryHandle;
  try { models = await folder.getDirectoryHandle('models'); }
  catch (error) { if (missing(error)) return null; throw error; }
  const found = new Map<string, number>();
  const partial = new Set<string>();
  const scan = async (dir: FileSystemDirectoryHandle, directoryName = '') => {
    for await (const [name, handle] of (dir as DirectoryEntries).entries()) {
      if (handle.kind !== 'file') continue;
      if (name.endsWith('.download.json')) partial.add(name.slice(0, -'.download.json'.length));
      if (name.toLowerCase().endsWith('.gguf') && !isCatalogVisionProjector(name) && (!directoryName || directoryName === modelFolderName(name))) found.set(name, (await (handle as FileSystemFileHandle).getFile()).size);
    }
  };
  await scan(models);
  for await (const [name, handle] of (models as DirectoryEntries).entries()) if (handle.kind === 'directory') await scan(handle as FileSystemDirectoryHandle, name);
  const candidates = [...found].filter(([name, bytes]) => {
    if (partial.has(name) || !bytes || bytes > 2_000_000_000 || isKnownIncompatibleGranite(name) || isBonsai2Q2BrowserUnsupported(name)) return false;
    const catalog = MODEL_CATALOG.find(item => item.name === name);
    return !catalog || catalog.runtime !== 'local-server' && catalog.bytes === bytes;
  });
  return candidates.length === 1 ? `models/${candidates[0][0]}` : null;
}

/** A saved model is usable only with its required notices, consent, and browser engine. */
export async function readySoleInstalledChatModel(folder: FileSystemDirectoryHandle): Promise<string | null> {
  const path = await soleInstalledChatModel(folder);
  if (!path) return null;
  const name = path.slice('models/'.length);
  const catalog = MODEL_CATALOG.find(item => item.name === name);
  if (catalog?.id === 'gemma3-1b' && !hasGemmaConsent()) return null;
  if (catalog?.id === 'qwen25-3b' && !hasQwenResearchConsent()) return null;
  try {
    await assertModelLicenseFiles(folder, path);
    if (isBonsai2BrowserUnsupported(path)) await assertPrismEngineFiles(folder);
    else await assertWllamaEngineFiles(folder);
  } catch (error) {
    if (error instanceof DOMException && !missing(error)) throw error;
    return null;
  }
  return path;
}
