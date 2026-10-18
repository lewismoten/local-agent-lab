import { chunkSearchBits, createSearchTermProbe } from './harnessData.ts';
import { extractText } from './extract.ts';
import { readBlob, writeBlob } from './storage.ts';

type IndexedDocument = { path: string; id: string; bytes: number; modified: number; sha256?: string; chunks: string[]; indexedAt: string };
type LibraryManifest = { version: 1; documents: IndexedDocument[] };
type TextChunk = { offset: number; text: string };
type DocumentBody = { version: 1; path: string; chunks: TextChunk[] };
export type LibraryHit = { path: string; offset: number; text: string; score: number };
export type LibraryProgress = { completed: number; total: number; path: string; paused?: boolean };
export type LibrarySearchPhase = 'index' | 'verify';

const INDEXABLE = /\.(pdf|txt|md|markdown|mdx|rst|json|jsonl|csv|ts|tsx|js|jsx|py|html|css|xml|yaml|yml|toml|sql|log)$/i;
const SKIP = new Set(['.git', '.hg', '.svn', 'node_modules']);
const STOP = new Set('about after again also because before could every from have into more most only other should some that their there these they this those through under where which while with would your'.split(' '));
const manifestPath = (projectId: string) => `harness/projects/${projectId}/library-index/manifest.json`;
const bodyPath = (projectId: string, id: string) => `harness/projects/${projectId}/library-index/${id}.json`;
const sourcePath = (projectId: string, path: string) => `harness/projects/${projectId}/library/${path}`;
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const indexWrites = new WeakMap<FileSystemDirectoryHandle, Map<string, Promise<void>>>();

async function sourceHash(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function withIndexLock<T>(folder: FileSystemDirectoryHandle, projectId: string, task: () => Promise<T>): Promise<T> {
  let writes = indexWrites.get(folder);
  if (!writes) { writes = new Map(); indexWrites.set(folder, writes); }
  const previous = writes.get(projectId) || Promise.resolve();
  const run = previous.then(async () => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? locks.request(`local-agent-lab:library-index:${projectId}`, task) : task();
  });
  const settled = run.then(() => {}, () => {});
  writes.set(projectId, settled);
  void settled.then(() => { if (writes?.get(projectId) === settled) writes.delete(projectId); });
  return run;
}

function validProject(projectId: string) { if (!/^[a-zA-Z0-9-]{1,80}$/.test(projectId)) throw new Error('Invalid project ID.'); }
function validPath(path: string) {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || SKIP.has(part.toLowerCase()) || /[\x00-\x1f]/.test(part))) throw new Error('Use a relative library path.');
}
export function indexableLibraryPath(path: string): boolean { return INDEXABLE.test(path); }
async function documentId(path: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return [...new Uint8Array(hash)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readManifest(folder: FileSystemDirectoryHandle, projectId: string): Promise<LibraryManifest> {
  validProject(projectId);
  try {
    const parsed = JSON.parse(await (await readBlob(folder, manifestPath(projectId))).text()) as LibraryManifest;
    if (parsed.version === 1 && Array.isArray(parsed.documents)) return { version: 1, documents: parsed.documents.filter(item => {
      try { validPath(item.path); return /^[a-f0-9]{32}$/.test(item.id) && Number.isFinite(item.bytes) && Number.isFinite(item.modified) && (item.sha256 === undefined || /^[a-f0-9]{64}$/.test(item.sha256)) && Array.isArray(item.chunks) && item.chunks.every((bits: unknown) => typeof bits === 'string'); }
      catch { return false; }
    }) };
  } catch (error) { if (!missing(error)) throw error; }
  return { version: 1, documents: [] };
}
async function saveManifest(folder: FileSystemDirectoryHandle, projectId: string, manifest: LibraryManifest): Promise<void> {
  await writeBlob(folder, manifestPath(projectId), new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
}
function splitText(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  const width = 2300, overlap = 180;
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + width);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('. ', end));
      if (boundary > start + width * .65) end = boundary + (text.slice(boundary, boundary + 2) === '. ' ? 1 : 2);
    }
    chunks.push({ offset: start, text: text.slice(start, end) });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
async function indexOne(folder: FileSystemDirectoryHandle, projectId: string, path: string, manifest: LibraryManifest, persistManifest = true, force = false): Promise<boolean> {
  validProject(projectId); validPath(path);
  if (!indexableLibraryPath(path)) return false;
  const file = await readBlob(folder, sourcePath(projectId, path));
  const limit = path.toLowerCase().endsWith('.pdf') ? 20_000_000 : 5_000_000;
  if (file.size > limit) throw new Error(`${path} is too large to index in this browser (${Math.round(limit / 1_000_000)} MB limit).`);
  const previous = manifest.documents.find(item => item.path === path);
  let sha256: string | undefined;
  if (!force && previous?.bytes === file.size && previous.modified === file.lastModified && previous.sha256) {
    sha256 = await sourceHash(file);
    if (sha256 === previous.sha256) return false;
  }
  const text = path.toLowerCase().endsWith('.pdf') ? await extractText(file) : await file.text();
  if (text.length > 10_000_000) throw new Error(`${path} extracts to more than 10 million characters; split it into smaller documents.`);
  const chunks = splitText(text);
  const id = await documentId(path);
  const body: DocumentBody = { version: 1, path, chunks };
  await writeBlob(folder, bodyPath(projectId, id), new Blob([JSON.stringify(body)], { type: 'application/json' }));
  const next: IndexedDocument = { path, id, bytes: file.size, modified: file.lastModified, sha256: sha256 || await sourceHash(file), chunks: chunks.map(chunk => chunkSearchBits([{ content: chunk.text }])), indexedAt: new Date().toISOString() };
  manifest.documents = [...manifest.documents.filter(item => item.path !== path), next].sort((a, b) => a.path.localeCompare(b.path));
  if (persistManifest) await saveManifest(folder, projectId, manifest);
  return true;
}
export async function indexLibraryFile(folder: FileSystemDirectoryHandle, projectId: string, path: string): Promise<boolean> {
  // This is called after an app edit or upload. Filesystem timestamps can have
  // coarse resolution, so an explicit update must inspect the new contents.
  return withIndexLock(folder, projectId, async () => indexOne(folder, projectId, path, await readManifest(folder, projectId), true, true));
}
export async function removeIndexedLibraryFile(folder: FileSystemDirectoryHandle, projectId: string, path: string): Promise<boolean> {
  return withIndexLock(folder, projectId, () => removeIndexedLibraryFileUnlocked(folder, projectId, path));
}
async function removeIndexedLibraryFileUnlocked(folder: FileSystemDirectoryHandle, projectId: string, path: string): Promise<boolean> {
  validProject(projectId); validPath(path);
  const manifest = await readManifest(folder, projectId);
  const previous = manifest.documents.find(item => item.path === path);
  if (!previous) return false;
  manifest.documents = manifest.documents.filter(item => item.path !== path);
  await saveManifest(folder, projectId, manifest);
  try {
    const parts = bodyPath(projectId, previous.id).split('/');
    const name = parts.pop()!;
    let dir = folder;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry(name);
  } catch (error) { if (!missing(error)) throw error; }
  return true;
}
export async function libraryIndexCount(folder: FileSystemDirectoryHandle, projectId: string): Promise<number> {
  return (await readManifest(folder, projectId)).documents.length;
}
export async function indexLibraryProject(folder: FileSystemDirectoryHandle, projectId: string, onProgress?: (progress: LibraryProgress) => void, signal?: AbortSignal, shouldPause?: () => boolean): Promise<{ indexed: number; total: number; skipped: string[] }> {
  validProject(projectId);
  const throwIfStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Indexing stopped.', 'AbortError'); };
  throwIfStopped();
  async function waitWhileBusy(completed: number, total: number, path: string) {
    if (shouldPause?.()) onProgress?.({ completed, total, path, paused: true });
    while (shouldPause?.()) {
      if (signal?.aborted) throw signal.reason || new DOMException('Indexing stopped.', 'AbortError');
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
  }
  const root = await (async () => {
    let dir = folder;
    try { for (const part of sourcePath(projectId, 'placeholder').split('/').slice(0, -1)) dir = await dir.getDirectoryHandle(part); }
    catch (error) { if (missing(error)) return null; throw error; }
    return dir;
  })();
  if (!root) {
    throwIfStopped();
    // A portable workspace can have its entire library directory removed or
    // replaced between sessions. Do not leave its former files searchable.
    await withIndexLock(folder, projectId, async () => {
      const manifest = await readManifest(folder, projectId);
      if (manifest.documents.length) { throwIfStopped(); await saveManifest(folder, projectId, { version: 1, documents: [] }); }
    });
    return { indexed: 0, total: 0, skipped: [] };
  }
  const pending: { dir: FileSystemDirectoryHandle; prefix: string }[] = [{ dir: root, prefix: '' }];
  const files: string[] = [];
  let truncated = false;
  while (pending.length && files.length < 3000) {
    if (signal?.aborted) throw signal.reason || new DOMException('Indexing stopped.', 'AbortError');
    await waitWhileBusy(files.length, 0, '');
    const next = pending.shift()!;
    for await (const [name, handle] of (next.dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (files.length % 50 === 0 && shouldPause?.()) await waitWhileBusy(files.length, 0, '');
      if (SKIP.has(name.toLowerCase())) continue;
      const path = next.prefix + name;
      if (handle.kind === 'directory') { if (pending.length < 1000) pending.push({ dir: handle as FileSystemDirectoryHandle, prefix: `${path}/` }); else truncated = true; }
      else if (indexableLibraryPath(path)) files.push(path);
      if (files.length >= 3000) { truncated = true; break; }
    }
  }
  const manifest = await withIndexLock(folder, projectId, async () => {
    const current = await readManifest(folder, projectId);
    const present = new Set(files);
    if (!truncated) {
      const retained: IndexedDocument[] = [];
      for (const document of current.documents) {
        if (present.has(document.path)) { retained.push(document); continue; }
        // A new file may have arrived after directory enumeration. Keep its
        // index entry if the source still exists; remove only confirmed orphans.
        try { await readBlob(folder, sourcePath(projectId, document.path)); retained.push(document); }
        catch (error) { if (!missing(error)) throw error; }
      }
      current.documents = retained;
    }
    throwIfStopped();
    await saveManifest(folder, projectId, current);
    return current;
  });
  let indexed = 0;
  const pendingChanges = new Map<string, IndexedDocument>();
  async function flushPending() {
    if (!pendingChanges.size) return;
    await withIndexLock(folder, projectId, async () => {
      const live = await readManifest(folder, projectId);
      const merged = new Map(live.documents.map(item => [item.path, item]));
      for (const document of pendingChanges.values()) {
        // An edit or removal can happen while the background scan is yielding.
        // Keep the newer index entry, or leave a changed source for the next scan.
        let source: File;
        try { source = await readBlob(folder, sourcePath(projectId, document.path)); }
        catch { continue; }
        if (source.size !== document.bytes || source.lastModified !== document.modified || document.sha256 && await sourceHash(source) !== document.sha256) continue;
        const current = merged.get(document.path);
        if (!current || current.sha256 !== document.sha256 || typeof current.indexedAt !== 'string' || current.indexedAt < document.indexedAt) merged.set(document.path, document);
      }
      live.documents = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
      await saveManifest(folder, projectId, live);
      manifest.documents = live.documents;
      pendingChanges.clear();
    });
  }
  const skipped: string[] = truncated ? ['The library scan reached its folder or 3,000-file limit; existing index entries were kept.'] : [];
  try {
    for (let index = 0; index < files.length; index++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Indexing stopped.', 'AbortError');
      const path = files[index];
      await waitWhileBusy(index, files.length, path);
      onProgress?.({ completed: index, total: files.length, path });
      if (signal?.aborted) throw signal.reason || new DOMException('Indexing stopped.', 'AbortError');
      try {
        if (await withIndexLock(folder, projectId, () => indexOne(folder, projectId, path, manifest, false))) {
          indexed++;
          const document = manifest.documents.find(item => item.path === path);
          if (document) pendingChanges.set(path, document);
        }
      } catch (error) { skipped.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
      if (pendingChanges.size >= 16) await flushPending();
      if (index % 5 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    // A graceful Stop keeps every finished file searchable. An interrupted
    // browser session may redo at most one batch on the next index update.
    await flushPending();
  }
  onProgress?.({ completed: files.length, total: files.length, path: '' });
  return { indexed, total: files.length, skipped };
}

function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [];
  const informative = [...new Set(words.filter(word => word.length >= 3 && !STOP.has(word)))];
  return informative.length ? informative.slice(0, 10) : [...new Set(words)].slice(0, 6);
}
function referencedLibraryPaths(query: string): Set<string> {
  const paths = new Set<string>();
  for (const match of query.matchAll(/(?:^|[\s,])library\/([^,\n]+)/gi)) {
    const path = match[1]?.trim().replace(/[`"'\s.;:!?]+$/g, '');
    if (path) paths.add(path.toLowerCase());
  }
  return paths;
}
function scoreText(text: string, path: string, terms: string[], query: string): number {
  const lower = text.toLowerCase(), file = path.toLowerCase();
  let score = lower.includes(query.toLowerCase()) ? 12 : 0;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0) score += 2 + Math.min(3, lower.split(term).length - 2);
    if (file.includes(term)) score += 3;
  }
  return score;
}
export async function searchLibrary(folder: FileSystemDirectoryHandle, projectId: string, query: string, maxChars = 2400, signal?: AbortSignal, onProgress?: (checked: number, total: number, phase: LibrarySearchPhase) => void): Promise<LibraryHit[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const possibleTerms = createSearchTermProbe(terms);
  const referencedPaths = referencedLibraryPaths(query);
  const phrase = query.trim().toLowerCase();
  const manifest = await readManifest(folder, projectId);
  const candidates: { document: IndexedDocument; weight: number; pathMatched: boolean; explicitlyReferenced: boolean }[] = [];
  onProgress?.(0, manifest.documents.length, 'index');
  let lastYield = performance.now();
  for (const [index, document] of manifest.documents.entries()) {
    if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError');
    const pathMatches = terms.filter(term => document.path.toLowerCase().includes(term)).length;
    const explicitlyReferenced = referencedPaths.has(document.path.toLowerCase());
    const weight = document.chunks.reduce((best, bits) => Math.max(best, possibleTerms(bits)), 0) + pathMatches * 2 + (explicitlyReferenced ? 50 : 0);
    if (weight > 0) candidates.push({ document, weight, pathMatched: pathMatches > 0, explicitlyReferenced });
    if (performance.now() - lastYield > 16) {
      onProgress?.(index + 1, manifest.documents.length, 'index');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError');
  onProgress?.(manifest.documents.length, manifest.documents.length, 'index');
  candidates.sort((a, b) => b.weight - a.weight);
  const bestByDocument = new Map<string, LibraryHit[]>();
  const exactPhraseDocuments = new Set<string>();
  const verified = new Map<string, boolean>();
  async function verifySource(document: IndexedDocument): Promise<boolean> {
    if (!document.sha256) return true; // Legacy entries gain a hash on the next index update.
    let valid = verified.get(document.path);
    if (valid !== undefined) return valid;
    try {
      const source = await readBlob(folder, sourcePath(projectId, document.path));
      valid = source.size === document.bytes && source.lastModified === document.modified && await sourceHash(source) === document.sha256;
    } catch { valid = false; }
    verified.set(document.path, valid);
    return valid;
  }
  let checked = 0;
  onProgress?.(0, candidates.length, 'verify');
  for (const [candidateIndex, { document, pathMatched, explicitlyReferenced }] of candidates.entries()) {
    if (candidateIndex > 0 && candidateIndex % 60 === 0 && exactPhraseDocuments.size >= 4) break;
    if (candidateIndex > 0 && candidateIndex % 20 === 0) {
      onProgress?.(candidateIndex, candidates.length, 'verify');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError');
    checked = candidateIndex + 1;
    try {
      const source = await readBlob(folder, sourcePath(projectId, document.path));
      if (source.size !== document.bytes || source.lastModified !== document.modified) continue;
    } catch { continue; }
    let body: DocumentBody;
    try { body = JSON.parse(await (await readBlob(folder, bodyPath(projectId, document.id))).text()) as DocumentBody; }
    catch { continue; }
    if (body.version !== 1 || body.path !== document.path || !Array.isArray(body.chunks)) continue;
    for (let index = 0; index < body.chunks.length; index++) {
      if (!document.chunks[index] || (!possibleTerms(document.chunks[index]) && !((pathMatched || explicitlyReferenced) && index === 0))) continue;
      const chunk = body.chunks[index];
      if (typeof chunk?.text !== 'string' || !Number.isFinite(chunk.offset)) continue;
      const score = scoreText(chunk.text, document.path, terms, query) + (explicitlyReferenced ? 24 : 0);
      if (score > 0) {
        const ranked = bestByDocument.get(document.path) || [];
        const nearby = ranked.findIndex(hit => Math.abs(hit.offset - chunk.offset) < 2000);
        if (nearby < 0 || score > ranked[nearby].score) {
          if (nearby >= 0) ranked.splice(nearby, 1);
          ranked.push({ path: document.path, offset: chunk.offset, text: chunk.text, score });
          ranked.sort((a, b) => b.score - a.score || a.offset - b.offset);
          ranked.length = Math.min(ranked.length, 3);
          bestByDocument.set(document.path, ranked);
        }
        if (chunk.text.toLowerCase().includes(phrase) && await verifySource(document)) exactPhraseDocuments.add(document.path);
      }
    }
    // A fixed first-page cutoff could hide the only exact match in a large
    // library. Check later candidate pages until enough verified phrase hits
    // are available; broad searches still stay bounded after that point.
  }
  onProgress?.(checked, candidates.length, 'verify');
  const hits = [...bestByDocument.values()].flat().sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.offset - b.offset);
  const selected: LibraryHit[] = [];
  const byPath = new Map(manifest.documents.map(document => [document.path, document]));
  let remaining = Math.max(200, Math.min(8000, maxChars));
  for (const hit of hits) {
    if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError');
    if (selected.length >= 4 || remaining < 180) break;
    if (selected.some(item => item.path === hit.path && Math.abs(item.offset - hit.offset) < 2000)) continue;
    const document = byPath.get(hit.path);
    if (!document || !await verifySource(document)) continue;
    const text = hit.text.slice(0, Math.min(remaining - 100, 1000));
    selected.push({ ...hit, text }); remaining -= text.length + hit.path.length + 50;
  }
  return selected;
}
export function formatLibraryHits(hits: LibraryHit[]): string {
  return hits.map(hit => `[library/${hit.path} at character ${hit.offset}]\n${hit.text}`).join('\n\n');
}
