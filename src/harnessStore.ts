import { hasWritableFolderPermission, readBlob, removeBlob, writeBlob } from './storage.ts';
import { createAvatarAsset, validAvatarLibrary, type AvatarAsset, type AvatarAssetInput } from './harnessAvatarLibrary.ts';
import { emptySurfaceArtwork, validSurfaceArtwork, validSurfaceArtworkKey, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import { searchableMessageText } from './harnessCompaction.ts';
import { cleanWorkspaceSettings, workspaceSettings, type WorkspaceSettings } from './harnessSettings.ts';
import type { ResponseDiagnostic } from './harnessResponseDiagnostics.ts';
import { validateTasks, type TaskRecord } from './harnessTasks.ts';
import { emptyAchievementLedger, incrementAchievementLedger, mergeAchievementLedger, type AchievementCounts, type AchievementLedger } from './harnessAchievements.ts';
import { journalDate, journalFact, validJournalDay, validJournalIndex, type JournalDay, type JournalIndex } from './harnessJournal.ts';
import { defaultJournalStyleSettings, journalFactRevision, validJournalRenderings, validJournalStyleSettings, type JournalRendering, type JournalRenderings, type JournalStyleSettings } from './harnessJournalStyles.ts';
import {
  MESSAGE_CHUNK_SIZE, addSearchBits, chunkSearchBits, chunkSearchIndexNeedsUpgrade, cleanTags, createManifest, createSearchTermProbe, defaultIdentities, identityAvatarPath, isoNow, newId,
  type ConversationMeta, type HarnessManifest, type HarnessMessage, type HarnessProject, type MemoryRecord, type ModelStamp,
} from './harnessData.ts';

const DB_NAME = 'local-agent-lab';
const ROOT = 'harness';
const manifestPath = `${ROOT}/workspace.json`;
const projectPath = (projectId: string) => `${ROOT}/projects/${projectId}/project.json`;
const sessionsPath = (projectId: string) => `${ROOT}/projects/${projectId}/sessions.json`;
const draftPath = (projectId: string, sessionId: string) => `${ROOT}/projects/${projectId}/drafts/${sessionId}.json`;
const editorDraftPath = (projectId: string, area: 'files' | 'library') => `${ROOT}/projects/${projectId}/editor-drafts/${area}.json`;
export type FileEditorDraft = { path: string; text: string; basePath: string; baseText: string };
export const emptyFileEditorDraft = (): FileEditorDraft => ({ path: '', text: '', basePath: '', baseText: '' });
const chunkPath = (projectId: string, sessionId: string, chunk: number) => `${ROOT}/projects/${projectId}/sessions/${sessionId}/chunks/${String(chunk).padStart(6, '0')}.json`;
const PACK_CHUNKS = 16;
const packPath = (projectId: string, sessionId: string, group: number) => `${ROOT}/projects/${projectId}/sessions/${sessionId}/packs/${String(group).padStart(6, '0')}.json`;
type ChunkPack = { version: 1; firstChunk: number; chunks: HarnessMessage[][] };
const diagnosticPath = (projectId: string, sessionId: string, messageId: string) => `${ROOT}/projects/${projectId}/sessions/${sessionId}/diagnostics/${messageId}.json`;
const INDEX_GROUP_SIZE = 64;
const chunkIndexPath = (projectId: string, sessionId: string, group: number) => `${ROOT}/projects/${projectId}/sessions/${sessionId}/search/${String(group).padStart(6, '0')}.json`;
type ChunkIndex = { version: 1; chunks: string[] };
const memoryPath = `${ROOT}/memory.json`;
const avatarLibraryPath = `${ROOT}/avatars/library.json`;
const avatarAssetPath = (id: string) => `${ROOT}/avatars/library/${id}.png`;
const surfaceArtworkPath = `${ROOT}/artwork.json`;
const tasksPath = `${ROOT}/tasks.json`;
const achievementsPath = `${ROOT}/achievements.json`;
const journalIndexPath = `${ROOT}/journal/index.json`;
const journalDayPath = (date: string) => `${ROOT}/journal/days/${date}.json`;
const journalStylePath = `${ROOT}/journal/styles.json`;
const journalRenderingPath = (date: string) => `${ROOT}/journal/renderings/${date}.json`;
const settingsPath = `${ROOT}/settings.json`;
const cacheKey = (workspaceId: string, path: string) => `${workspaceId}:${path}`;

let databasePromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  let blocked = false;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      // Release the connection for an upgrade in another tab. The next read
      // opens the new version after this one has closed.
      db.onversionchange = () => { db.close(); if (databasePromise === opening) databasePromise = null; };
      db.onclose = () => { if (databasePromise === opening) databasePromise = null; };
      resolve(db);
    };
    request.onerror = () => { if (databasePromise === opening) databasePromise = null; reject(request.error); };
    request.onblocked = () => { blocked = true; if (databasePromise === opening) databasePromise = null; reject(new Error('Browser workspace storage is blocked by another tab. Close that tab and retry.')); };
  });
  databasePromise = opening;
  return opening;
}
async function cacheRead<T>(key: string): Promise<T | null> {
  const db = await database();
  return new Promise<T | null>((resolve, reject) => {
    const request = db.transaction('records', 'readonly').objectStore('records').get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function cacheWrite<T>(key: string, value: T): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite');
    transaction.objectStore('records').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
async function cacheDeletePrefix(prefix: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const request = store.openKeyCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
let portableCacheCleanup: Promise<void> | null = null;
function removeOldPortableCopies(): Promise<void> {
  if (portableCacheCleanup) return portableCacheCleanup;
  portableCacheCleanup = (async () => {
    const db = await database();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db.transaction('records', 'readonly').objectStore('records').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const portable = keys.filter(key => typeof key === 'string' && !key.startsWith('browser-home:'));
    for (let start = 0; start < portable.length; start += 100) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('records', 'readwrite');
        const store = transaction.objectStore('records');
        for (const key of portable.slice(start, start + 100)) store.delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      // Keep a large legacy cleanup from monopolizing browser storage.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  })().catch(error => { portableCacheCleanup = null; throw error; });
  return portableCacheCleanup;
}
function schedulePortableCacheCleanup() {
  if (typeof indexedDB === 'undefined') return;
  // Legacy builds mirrored USB data into IndexedDB. Reclaim it without delaying startup.
  void removeOldPortableCopies().catch(error => console.warn('Could not clear old portable workspace cache:', error));
}
function isMissing(error: unknown) { return error instanceof DOMException && error.name === 'NotFoundError'; }
function validId(id: string) { if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid workspace record identifier.'); }
function supportedManifest(value: unknown): value is HarnessManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<HarnessManifest>;
  return manifest.version === 1 && typeof manifest.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(manifest.id)
    && typeof manifest.name === 'string' && Array.isArray(manifest.projects) && manifest.projects.length > 0
    && manifest.projects.every(project => project && typeof project.name === 'string' && typeof project.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(project.id));
}
function shortTermNeedsUpgrade(bits: string | undefined, query: string): boolean {
  return !!bits?.startsWith('v3:') && /^[\p{L}\p{N}_]{2}$/u.test(query);
}

function achievementModels(previous: AchievementLedger, modelKeys: string[], typeKeys: string[]): AchievementLedger {
  const modelsSeen = [...new Set([...(previous.modelsSeen || []), ...modelKeys.filter(Boolean).map(value => value.slice(0, 200))])].slice(0, 1000);
  const modelTypesSeen = [...new Set([...(previous.modelTypesSeen || []), ...typeKeys.filter(Boolean).map(value => value.slice(0, 100))])].slice(0, 100);
  return { ...previous, modelsSeen, modelTypesSeen };
}

export class HarnessStore {
  readonly folder: FileSystemDirectoryHandle | null;
  readonly workspaceId: string;
  private readonly sessionWrites = new Map<string, Promise<void>>();
  private readonly packCache = new Map<string, ChunkPack>();
  private readonly packWrites = new Map<string, Promise<number>>();
  private manifestWrites: Promise<void> = Promise.resolve();
  private memoryWrites: Promise<void> = Promise.resolve();
  private avatarWrites: Promise<void> = Promise.resolve();
  private surfaceArtworkWrites: Promise<void> = Promise.resolve();
  private tasksWrites: Promise<void> = Promise.resolve();
  private achievementWrites: Promise<void> = Promise.resolve();
  private journalWrites: Promise<void> = Promise.resolve();
  constructor(workspaceId: string, folder: FileSystemDirectoryHandle | null) {
    validId(workspaceId);
    this.workspaceId = workspaceId;
    this.folder = folder;
  }
  private async read<T>(path: string): Promise<T | null> {
    if (this.folder) {
      try {
        return JSON.parse(await (await readBlob(this.folder, path)).text()) as T;
      } catch (error) {
        if (isMissing(error)) return null; // A connected folder is authoritative; never revive removed USB files from another machine's cache.
        throw error;
      }
    }
    return cacheRead<T>(cacheKey(this.workspaceId, path));
  }
  private async write<T>(path: string, value: T): Promise<void> {
    if (this.folder) { await writeBlob(this.folder, path, new Blob([JSON.stringify(value)], { type: 'application/json' })); return; }
    await cacheWrite(cacheKey(this.workspaceId, path), value);
  }
  async identityAvatar(id: string): Promise<Blob | null> {
    validId(id);
    const path = identityAvatarPath(id);
    if (!this.folder) return cacheRead<Blob>(cacheKey(this.workspaceId, path));
    try { return await readBlob(this.folder, path); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }
  async saveIdentityAvatar(id: string, image: Blob): Promise<string> {
    validId(id);
    if (image.type !== 'image/png' || !image.size || image.size > 512_000) throw new Error('Avatar must be a PNG no larger than 500 KB.');
    const path = identityAvatarPath(id);
    if (this.folder) await writeBlob(this.folder, path, image);
    else await cacheWrite(cacheKey(this.workspaceId, path), image);
    return path;
  }
  async avatarLibrary(): Promise<AvatarAsset[]> {
    const saved = await this.read<unknown>(avatarLibraryPath);
    if (saved === null) return [];
    if (!validAvatarLibrary(saved)) throw new Error('Avatar library uses an unsupported format. Its files were left untouched.');
    return saved.assets;
  }
  async avatarAsset(id: string): Promise<Blob | null> {
    validId(id);
    const path = avatarAssetPath(id);
    if (!this.folder) return cacheRead<Blob>(cacheKey(this.workspaceId, path));
    try { return await readBlob(this.folder, path); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }
  private async updateAvatarLibrary(change: (current: AvatarAsset[]) => AvatarAsset[]): Promise<AvatarAsset[]> {
    const persist = async () => {
      const next = change(await this.avatarLibrary());
      await this.write(avatarLibraryPath, { version: 1, assets: next });
      return next;
    };
    const task: Promise<AvatarAsset[]> = this.avatarWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? await locks.request(`local-agent-lab:avatars:${this.workspaceId}`, persist) : persist();
    });
    this.avatarWrites = task.then(() => {}, () => {});
    return task;
  }
  async saveAvatarAsset(image: Blob, input: AvatarAssetInput): Promise<AvatarAsset> {
    if (image.type !== 'image/png' || !image.size || image.size > 512_000) throw new Error('Avatar library images must be PNGs no larger than 500 KB.');
    if (input.originIdentityId) validId(input.originIdentityId);
    const asset = createAvatarAsset(input);
    const path = avatarAssetPath(asset.id);
    if (this.folder) await writeBlob(this.folder, path, image);
    else await cacheWrite(cacheKey(this.workspaceId, path), image);
    await this.updateAvatarLibrary(current => [asset, ...current]);
    return asset;
  }
  async updateAvatarAsset(id: string, title: string, tags: string[]): Promise<AvatarAsset> {
    validId(id);
    let updated: AvatarAsset | undefined;
    await this.updateAvatarLibrary(current => {
      if (!current.some(asset => asset.id === id)) throw new Error('Avatar image is no longer in the library.');
      return current.map(asset => {
      if (asset.id !== id) return asset;
      updated = { ...asset, title: title.trim().slice(0, 80) || asset.title, tags: cleanTags(tags, 12) };
      return updated;
      });
    });
    return updated!;
  }
  async surfaceArtwork(): Promise<SurfaceArtworkMap> {
    const saved = await this.read<unknown>(surfaceArtworkPath);
    if (saved === null) return emptySurfaceArtwork();
    if (!validSurfaceArtwork(saved)) throw new Error('Saved artwork uses an unsupported format. Its file was left untouched.');
    return saved;
  }
  async saveSurfaceArtwork(key: string, assetId: string | null, prompt: string): Promise<SurfaceArtworkMap> {
    if (!validSurfaceArtworkKey(key)) throw new Error('Invalid artwork target.');
    if (prompt.length > 1200) throw new Error('Artwork prompt is too long.');
    const persist = async () => {
      if (assetId) {
        validId(assetId);
        if (!(await this.avatarLibrary()).some(asset => asset.id === assetId) || !(await this.avatarAsset(assetId)))
          throw new Error('The selected artwork is no longer in the image library.');
      }
      const current = await this.surfaceArtwork();
      const items = { ...current.items };
      if (assetId) items[key] = { assetId, prompt: prompt.trim() };
      else delete items[key];
      const next: SurfaceArtworkMap = { version: 1, items };
      await this.write(surfaceArtworkPath, next);
      return next;
    };
    const task = this.surfaceArtworkWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:artwork:${this.workspaceId}`, persist) : persist();
    });
    this.surfaceArtworkWrites = task.then(() => {}, () => {});
    return task;
  }
  async manifest(): Promise<HarnessManifest> {
    const saved = await this.read<HarnessManifest>(manifestPath);
    if (supportedManifest(saved)) return {
      ...saved,
      agents: Array.isArray(saved.agents) ? saved.agents : [],
      identities: Array.isArray(saved.identities) ? saved.identities : defaultIdentities(saved.createdAt),
      chatIdentityId: typeof saved.chatIdentityId === 'string' ? saved.chatIdentityId : '',
      userProfile: {
        name: typeof saved.userProfile?.name === 'string' ? saved.userProfile.name.trim().slice(0, 80) || 'You' : 'You',
        ...(typeof saved.userProfile?.avatarAssetId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(saved.userProfile.avatarAssetId)
          ? { avatarAssetId: saved.userProfile.avatarAssetId } : {}),
      },
      workspaceToolAccess: saved.workspaceToolAccess === 'read-only' ? 'read-only' : 'full',
      modelPreferences: {
        chat: Array.isArray(saved.modelPreferences?.chat) ? saved.modelPreferences.chat : [],
        code: Array.isArray(saved.modelPreferences?.code) ? saved.modelPreferences.code : [],
        image: Array.isArray(saved.modelPreferences?.image) ? saved.modelPreferences.image : [],
        speech: Array.isArray(saved.modelPreferences?.speech) ? saved.modelPreferences.speech : [],
        transcription: Array.isArray(saved.modelPreferences?.transcription) ? saved.modelPreferences.transcription : [],
      },
    };
    if (saved !== null) throw new Error('This workspace manifest has an unsupported format. The existing file was left untouched.');
    const fresh = createManifest(this.workspaceId, this.folder?.name || 'My workspace');
    await this.write(manifestPath, fresh);
    await this.saveProject(fresh.projects[0]);
    return fresh;
  }
  async saveManifest(manifest: HarnessManifest): Promise<void> {
    await this.write(manifestPath, { ...manifest, updatedAt: isoNow() });
    void this.observeAchievementMetrics({ projects: manifest.projects.length })
      .catch(error => console.warn('Workspace saved; achievement progress will update when Achievements opens:', error));
  }
  async updateManifest(change: (current: HarnessManifest) => HarnessManifest): Promise<HarnessManifest> {
    const persist = async () => {
      const next = { ...change(await this.manifest()), updatedAt: isoNow() };
      await this.saveManifest(next);
      return next;
    };
    const task = this.manifestWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:manifest:${this.workspaceId}`, persist) : persist();
    });
    this.manifestWrites = task.then(() => {}, () => {});
    return task;
  }
  async settings(): Promise<WorkspaceSettings | null> {
    const saved = await this.read<unknown>(settingsPath);
    if (saved === null) return null;
    const cleaned = cleanWorkspaceSettings(saved);
    if (!cleaned) throw new Error('Workspace settings use an unsupported format. The existing file was left untouched.');
    return cleaned;
  }
  async saveSettings(settings: WorkspaceSettings): Promise<void> {
    const cleaned = cleanWorkspaceSettings(settings);
    if (!cleaned) throw new Error('Invalid workspace settings.');
    await this.write(settingsPath, workspaceSettings(cleaned.profiles, cleaned.selectedProfileId, cleaned.imageConfig, cleaned.compactionAt));
  }
  async project(projectId: string): Promise<HarnessProject | null> {
    validId(projectId);
    return this.read(projectPath(projectId));
  }
  async draft(projectId: string, sessionId: string): Promise<string> {
    validId(projectId); validId(sessionId);
    const saved = await this.read<{ version: number; text: string }>(draftPath(projectId, sessionId));
    if (saved === null) return '';
    if (saved.version !== 1 || typeof saved.text !== 'string') throw new Error('This draft uses an unsupported format. The existing file was left untouched.');
    return saved.text;
  }
  async saveDraft(projectId: string, sessionId: string, text: string): Promise<void> {
    validId(projectId); validId(sessionId);
    if (typeof text !== 'string' || new Blob([text]).size > 10_000_000) throw new Error('A draft must be text smaller than 10 MB. Import larger files into the project library.');
    await this.write(draftPath(projectId, sessionId), { version: 1, text, updatedAt: isoNow() });
  }
  async fileEditorDraft(projectId: string, area: 'files' | 'library'): Promise<FileEditorDraft> {
    validId(projectId);
    const saved = await this.read<Partial<FileEditorDraft> & { version?: number }>(editorDraftPath(projectId, area));
    if (saved === null) return emptyFileEditorDraft();
    if (saved.version !== 1 || typeof saved.path !== 'string' || typeof saved.text !== 'string' || typeof saved.basePath !== 'string' || typeof saved.baseText !== 'string') {
      throw new Error('This file editor draft uses an unsupported format. The existing file was left untouched.');
    }
    return { path: saved.path, text: saved.text, basePath: saved.basePath, baseText: saved.baseText };
  }
  async saveFileEditorDraft(projectId: string, area: 'files' | 'library', draft: FileEditorDraft): Promise<void> {
    validId(projectId);
    if (!['files', 'library'].includes(area) || !draft || typeof draft.path !== 'string' || typeof draft.text !== 'string' || typeof draft.basePath !== 'string' || typeof draft.baseText !== 'string' || new Blob([draft.path, draft.text, draft.basePath, draft.baseText]).size > 1_000_000) {
      throw new Error('A file editor draft must be text smaller than 1 MB.');
    }
    await this.write(editorDraftPath(projectId, area), { version: 1, ...draft, updatedAt: isoNow() });
  }
  async saveProject(project: HarnessProject): Promise<void> {
    validId(project.id);
    await this.write(projectPath(project.id), project);
  }
  async sessions(projectId: string): Promise<ConversationMeta[]> {
    validId(projectId);
    return (await this.read<ConversationMeta[]>(sessionsPath(projectId))) || [];
  }
  async updateSessions(projectId: string, change: (current: ConversationMeta[]) => ConversationMeta[] | Promise<ConversationMeta[]>): Promise<ConversationMeta[]> {
    validId(projectId);
    const previous = this.sessionWrites.get(projectId) || Promise.resolve();
    const persist = async () => {
      const next = await change(await this.sessions(projectId));
      await this.write(sessionsPath(projectId), next);
      return next;
    };
    const task = previous.catch(() => {}).then(async () => {
      // A second tab can have its own HarnessStore for the same USB workspace.
      // Read under the origin-wide lock so its changes are included too.
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? await locks.request(`local-agent-lab:sessions:${this.workspaceId}:${projectId}`, async () => await persist()) : await persist();
    });
    const settled = task.then(() => {}, () => {});
    this.sessionWrites.set(projectId, settled);
    try { return await task; }
    finally { if (this.sessionWrites.get(projectId) === settled) this.sessionWrites.delete(projectId); }
  }
  async chunk(projectId: string, sessionId: string, number: number): Promise<HarnessMessage[]> {
    validId(projectId); validId(sessionId);
    if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('Invalid conversation chunk number.');
    const path = packPath(projectId, sessionId, Math.floor(number / PACK_CHUNKS));
    const cached = this.packCache.get(path);
    if (cached) return cached.chunks[number - cached.firstChunk] || [];
    const direct = await this.read<HarnessMessage[]>(chunkPath(projectId, sessionId, number));
    if (direct !== null) return direct;
    const pack = await this.readPack(path, Math.floor(number / PACK_CHUNKS) * PACK_CHUNKS);
    return pack?.chunks[number - pack.firstChunk] || [];
  }
  private async readPack(path: string, firstChunk: number): Promise<ChunkPack | null> {
    const cached = this.packCache.get(path);
    if (cached) return cached;
    const pack = await this.read<ChunkPack>(path);
    if (pack === null) return null;
    if (pack.version !== 1 || pack.firstChunk !== firstChunk || !Array.isArray(pack.chunks) || pack.chunks.length !== PACK_CHUNKS
      || pack.chunks.some((chunk, offset) => !Array.isArray(chunk) || chunk.length !== MESSAGE_CHUNK_SIZE
        || chunk.some((message, index) => message?.seq !== (firstChunk + offset) * MESSAGE_CHUNK_SIZE + index))) {
      throw new Error('A packed conversation history file is invalid. Restore the pack or its original chunks before continuing.');
    }
    this.packCache.set(path, pack);
    if (this.packCache.size > 4) this.packCache.delete(this.packCache.keys().next().value!);
    return pack;
  }
  private async packGroup(projectId: string, sessionId: string, group: number): Promise<number> {
    if (!this.folder) return 0; // IndexedDB does not create files on a USB drive.
    const path = packPath(projectId, sessionId, group);
    const existing = this.packWrites.get(path);
    if (existing) { await existing; return 0; }
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    const task: Promise<number> = (async () => locks
      ? await locks.request(`local-agent-lab:pack:${this.workspaceId}:${projectId}:${sessionId}:${group}`, () => this.packGroupUnlocked(projectId, sessionId, group))
      : await this.packGroupUnlocked(projectId, sessionId, group))();
    this.packWrites.set(path, task);
    try { return await task; }
    finally { if (this.packWrites.get(path) === task) this.packWrites.delete(path); }
  }
  private async packGroupUnlocked(projectId: string, sessionId: string, group: number): Promise<number> {
    if (!this.folder) return 0;
    const firstChunk = group * PACK_CHUNKS;
    const path = packPath(projectId, sessionId, group);
    let pack = await this.readPack(path, firstChunk);
    const resumingPack = !!pack;
    if (!pack) {
      const chunks: HarnessMessage[][] = [];
      for (let offset = 0; offset < PACK_CHUNKS; offset++) {
        const chunk = await this.read<HarnessMessage[]>(chunkPath(projectId, sessionId, firstChunk + offset));
        if (!Array.isArray(chunk) || chunk.length !== MESSAGE_CHUNK_SIZE
          || chunk.some((message, index) => message?.seq !== (firstChunk + offset) * MESSAGE_CHUNK_SIZE + index)) {
          throw new Error(`Cannot pack incomplete conversation chunk #${firstChunk + offset}.`);
        }
        chunks.push(chunk);
      }
      pack = { version: 1, firstChunk, chunks };
      await this.write(path, pack);
      // Read back from the drive before removing any original chunk.
      const saved = await this.read<ChunkPack>(path);
      if (!saved || JSON.stringify(saved) !== JSON.stringify(pack)) throw new Error('Packed conversation verification failed; original chunks were kept.');
      this.packCache.set(path, pack);
      if (this.packCache.size > 4) this.packCache.delete(this.packCache.keys().next().value!);
    }
    let removed = 0;
    for (let offset = 0; offset < PACK_CHUNKS; offset++) {
      if (resumingPack) {
        const original = await this.read<HarnessMessage[]>(chunkPath(projectId, sessionId, firstChunk + offset));
        if (original === null) continue;
        if (JSON.stringify(original) !== JSON.stringify(pack.chunks[offset])) {
          throw new Error(`Loose conversation chunk #${firstChunk + offset} differs from its pack. Both copies were kept for review.`);
        }
      }
      try { await removeBlob(this.folder, chunkPath(projectId, sessionId, firstChunk + offset)); removed++; }
      catch (error) { if (!isMissing(error)) throw error; }
    }
    return removed;
  }
  async packCompletedChunks(meta: ConversationMeta, onProgress?: (completed: number, total: number) => void | Promise<void>, signal?: AbortSignal): Promise<{ groups: number; removed: number }> {
    validId(meta.projectId); validId(meta.id);
    const total = Math.floor(meta.messageCount / (MESSAGE_CHUNK_SIZE * PACK_CHUNKS));
    let removed = 0;
    for (let group = 0; group < total; group++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Packing stopped.', 'AbortError');
      removed += await this.packGroup(meta.projectId, meta.id, group);
      await onProgress?.(group + 1, total);
    }
    return { groups: total, removed };
  }
  private async chunkIndex(projectId: string, sessionId: string, group: number): Promise<ChunkIndex> {
    try {
      const saved = await this.read<ChunkIndex>(chunkIndexPath(projectId, sessionId, group));
      if (saved?.version === 1 && Array.isArray(saved.chunks)) return saved;
    } catch { /* Search indexes are optional. Message chunks remain authoritative. */ }
    return { version: 1, chunks: [] };
  }
  private async saveChunkIndex(projectId: string, sessionId: string, group: number, index: ChunkIndex): Promise<void> {
    try { await this.write(chunkIndexPath(projectId, sessionId, group), index); }
    catch { /* A missing index only makes later searches slower. */ }
  }
  async appendMessage(meta: ConversationMeta, message: Omit<HarnessMessage, 'seq'>): Promise<ConversationMeta> {
    const seq = meta.messageCount;
    const chunkNumber = Math.floor(seq / MESSAGE_CHUNK_SIZE);
    const chunk = await this.chunk(meta.projectId, meta.id, chunkNumber);
    if (chunk.some(item => item.seq === seq)) throw new Error('A message with this sequence number already exists.');
    const nextMessage = { ...message, seq };
    const nextChunk = [...chunk, nextMessage];
    await this.write(chunkPath(meta.projectId, meta.id, chunkNumber), nextChunk);
    if (nextChunk.length === MESSAGE_CHUNK_SIZE) {
      const group = Math.floor(chunkNumber / INDEX_GROUP_SIZE);
      const index = await this.chunkIndex(meta.projectId, meta.id, group);
      index.chunks[chunkNumber % INDEX_GROUP_SIZE] = chunkSearchBits(nextChunk);
      await this.saveChunkIndex(meta.projectId, meta.id, group, index);
    }
    const updated: ConversationMeta = {
      ...meta, messageCount: seq + 1, updatedAt: isoNow(),
      preview: message.content.replace(/\s+/g, ' ').slice(0, 180),
      searchBits: addSearchBits(meta.searchBits, searchableMessageText(message)),
    };
    return updated;
  }
  async appendConversationMessage(meta: ConversationMeta, message: Omit<HarnessMessage, 'seq'>): Promise<{ meta: ConversationMeta; sessions: ConversationMeta[]; journalWarning?: string }> {
    let appended: ConversationMeta | null = null;
    const sessions = await this.updateSessions(meta.projectId, async current => {
      const latest = current.find(item => item.id === meta.id);
      if (!latest) throw new Error('This conversation is no longer in the project. Refresh the conversation list before sending.');
      const recovered = await this.recoverConversation(latest);
      if (recovered.messageCount !== meta.messageCount || recovered.activeFrom !== meta.activeFrom || recovered.contextSummary !== meta.contextSummary || JSON.stringify(recovered.segments) !== JSON.stringify(meta.segments) || JSON.stringify(recovered.toolPermissions) !== JSON.stringify(meta.toolPermissions) || recovered.toolProfileId !== meta.toolProfileId || JSON.stringify(recovered.approvedTools) !== JSON.stringify(meta.approvedTools)) {
        throw new Error('This conversation changed in another tab. Review its latest messages before sending again.');
      }
      appended = await this.appendMessage(recovered, message);
      return [appended, ...current.filter(item => item.id !== meta.id)];
    });
    let journalWarning: string | undefined;
    try { await this.recordJournalMessage(appended!, { ...message, seq: appended!.messageCount - 1 }); }
    catch (error) { journalWarning = `The message was saved, but its journal update failed: ${error instanceof Error ? error.message : String(error)}`; }
    if (message.role === 'user') void this.recordAchievementMetrics({ messagesSent: 1 })
      .catch(error => console.warn('The message was saved, but achievement progress could not be updated:', error));
    if (message.role === 'assistant') void this.recordAchievementMetrics({
        messagesReceived: 1,
        inputTokens: Number.isFinite(message.inputTokens) ? Math.max(0, message.inputTokens || 0) : 0,
        outputTokens: Number.isFinite(message.outputTokens) ? Math.max(0, message.outputTokens || 0) : 0,
        toolCalls: message.toolEvents?.length || 0,
      }, message.model).catch(error => console.warn('The message was saved, but achievement progress could not be updated:', error));
    if (this.folder && appended!.messageCount % (MESSAGE_CHUNK_SIZE * PACK_CHUNKS) === 0) {
      await this.packGroup(appended!.projectId, appended!.id, Math.floor(appended!.messageCount / (MESSAGE_CHUNK_SIZE * PACK_CHUNKS)) - 1)
        .catch(error => console.warn('The message was saved, but completed history chunks could not be packed:', error));
    }
    return { meta: appended!, sessions, journalWarning };
  }
  async recoverConversation(meta: ConversationMeta): Promise<ConversationMeta> {
    validId(meta.projectId); validId(meta.id);
    let expected = meta.messageCount;
    const recovered: HarnessMessage[] = [];
    // A completed chunk write can outlive a refresh before sessions.json is
    // updated. Inspect only the current tail and one following chunk; normal
    // opens stay cheap even when the conversation has months of history.
    for (let checked = 0; checked < 2 && recovered.length < MESSAGE_CHUNK_SIZE; checked++) {
      const number = Math.floor(expected / MESSAGE_CHUNK_SIZE);
      const chunk = await this.chunk(meta.projectId, meta.id, number);
      const tail = chunk.filter(item => item.seq >= expected).sort((a, b) => a.seq - b.seq);
      if (!tail.length) break;
      for (const message of tail) {
        if (message.seq !== expected || !message.id || !['user', 'assistant', 'tool'].includes(message.role)) break;
        recovered.push(message);
        expected++;
      }
      if (expected % MESSAGE_CHUNK_SIZE || recovered.length === MESSAGE_CHUNK_SIZE) break;
    }
    if (!recovered.length) return meta;
    const last = recovered.at(-1)!;
    return {
      ...meta,
      messageCount: expected,
      updatedAt: last.createdAt,
      preview: last.content.replace(/\s+/g, ' ').slice(0, 180),
      searchBits: recovered.reduce((bits, message) => addSearchBits(bits, searchableMessageText(message)), meta.searchBits),
    };
  }
  async messages(meta: ConversationMeta, from = 0, to = meta.messageCount): Promise<HarnessMessage[]> {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > meta.messageCount) throw new RangeError('Invalid conversation message range.');
    if (to <= from) return [];
    const result: HarnessMessage[] = [];
    for (let chunk = Math.floor(from / MESSAGE_CHUNK_SIZE); chunk <= Math.floor((to - 1) / MESSAGE_CHUNK_SIZE); chunk++) {
      const start = Math.max(from, chunk * MESSAGE_CHUNK_SIZE);
      const end = Math.min(to, (chunk + 1) * MESSAGE_CHUNK_SIZE);
      const items = (await this.chunk(meta.projectId, meta.id, chunk)).filter(message => message.seq >= start && message.seq < end);
      if (items.length !== end - start || items.some((message, index) => message.seq !== start + index)) {
        throw new Error(`Conversation history is incomplete at message #${start}. Restore the missing chunk before continuing.`);
      }
      result.push(...items);
    }
    return result;
  }
  async recentMessages(meta: ConversationMeta, limit = 40): Promise<HarnessMessage[]> {
    return this.messages(meta, Math.max(0, meta.messageCount - limit));
  }
  async findMessage(meta: ConversationMeta, query: string): Promise<HarnessMessage | null> {
    const needle = query.toLowerCase();
    const mayContain = createSearchTermProbe([needle]);
    const totalChunks = Math.ceil(meta.messageCount / MESSAGE_CHUNK_SIZE);
    for (let group = 0; group * INDEX_GROUP_SIZE < totalChunks; group++) {
      const index = await this.chunkIndex(meta.projectId, meta.id, group);
      let changed = false;
      const end = Math.min(totalChunks, (group + 1) * INDEX_GROUP_SIZE);
      for (let number = group * INDEX_GROUP_SIZE; number < end; number++) {
        const full = (number + 1) * MESSAGE_CHUNK_SIZE <= meta.messageCount;
        const slot = number % INDEX_GROUP_SIZE;
        if (full && index.chunks[slot] && !mayContain(index.chunks[slot])) continue;
        const messages = await this.chunk(meta.projectId, meta.id, number);
        if (full && (!index.chunks[slot] || shortTermNeedsUpgrade(index.chunks[slot], needle) || chunkSearchIndexNeedsUpgrade(index.chunks[slot], messages))) { index.chunks[slot] = chunkSearchBits(messages); changed = true; }
        const hit = messages.find(message => searchableMessageText(message).toLowerCase().includes(needle));
        if (hit) {
          if (changed) await this.saveChunkIndex(meta.projectId, meta.id, group, index);
          return hit;
        }
      }
      if (changed) await this.saveChunkIndex(meta.projectId, meta.id, group, index);
    }
    return null;
  }
  async searchMessages(meta: ConversationMeta, query: string, limit = 8, beforeSeq = meta.messageCount, fromSeq = 0, signal?: AbortSignal): Promise<HarnessMessage[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2 || needle.length > 200) throw new Error('Search history with 2 to 200 characters.');
    const mayContain = createSearchTermProbe([needle]);
    const max = Math.max(1, Math.min(12, Math.floor(limit)));
    const upper = Math.max(0, Math.min(meta.messageCount, Math.floor(beforeSeq)));
    const lower = Math.max(0, Math.min(upper, Math.floor(fromSeq)));
    if (upper <= lower) return [];
    const totalChunks = Math.ceil(upper / MESSAGE_CHUNK_SIZE);
    const matches: HarnessMessage[] = [];
    const checkCancelled = () => { if (signal?.aborted) throw signal.reason || new DOMException('Search stopped.', 'AbortError'); };
    // Read each index group once. Reopening the same USB file for every chunk
    // made long conversations pay up to 64 directory lookups per group.
    for (let group = Math.floor((totalChunks - 1) / INDEX_GROUP_SIZE); group >= Math.floor(lower / MESSAGE_CHUNK_SIZE / INDEX_GROUP_SIZE) && matches.length < max; group--) {
      checkCancelled();
      const index = await this.chunkIndex(meta.projectId, meta.id, group);
      let changed = false;
      const first = group * INDEX_GROUP_SIZE;
      const last = Math.min(totalChunks, first + INDEX_GROUP_SIZE);
      for (let number = last - 1; number >= Math.max(first, Math.floor(lower / MESSAGE_CHUNK_SIZE)) && matches.length < max; number--) {
        checkCancelled();
        const full = (number + 1) * MESSAGE_CHUNK_SIZE <= meta.messageCount;
        const slot = number - first;
        const bits = index.chunks[slot];
        if (full && bits && !mayContain(bits)) continue;
        const messages = await this.chunk(meta.projectId, meta.id, number);
        checkCancelled();
        const start = number * MESSAGE_CHUNK_SIZE;
        const end = Math.min(meta.messageCount, start + MESSAGE_CHUNK_SIZE);
        if (messages.length < end - start || messages.slice(0, end - start).some((message, index) => message.seq !== start + index)) {
          throw new Error(`Conversation history is incomplete at message #${start}. Restore the missing chunk before searching it.`);
        }
        if (full && (!bits || shortTermNeedsUpgrade(bits, needle) || chunkSearchIndexNeedsUpgrade(bits, messages))) { index.chunks[slot] = chunkSearchBits(messages); changed = true; }
        for (let i = messages.length - 1; i >= 0 && matches.length < max; i--) if (messages[i].seq >= lower && messages[i].seq < upper && searchableMessageText(messages[i]).toLowerCase().includes(needle)) matches.push(messages[i]);
      }
      checkCancelled();
      if (changed) await this.saveChunkIndex(meta.projectId, meta.id, group, index);
    }
    return matches;
  }
  async memory(): Promise<MemoryRecord[]> { return (await this.read<MemoryRecord[]>(memoryPath)) || []; }
  async updateMemory(change: (current: MemoryRecord[]) => MemoryRecord[] | Promise<MemoryRecord[]>): Promise<MemoryRecord[]> {
    const persist = async () => {
      const current = await this.memory();
      const next = await change(current);
      if (next !== current) await this.write(memoryPath, next);
      return next;
    };
    const task = this.memoryWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:memory:${this.workspaceId}`, persist) : persist();
    });
    this.memoryWrites = task.then(() => {}, () => {});
    return task;
  }
  async saveMemory(records: MemoryRecord[]): Promise<void> { await this.updateMemory(() => records); }
  async journalIndex(): Promise<JournalIndex> {
    const saved = await this.read<unknown>(journalIndexPath);
    if (saved === null) return { version: 1, enabled: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', dates: [] };
    if (!validJournalIndex(saved)) throw new Error('Journal settings use an unsupported format. The existing file was left untouched.');
    return saved;
  }
  async journalDay(date: string): Promise<JournalDay | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid journal date.');
    const saved = await this.read<unknown>(journalDayPath(date));
    if (saved === null) return null;
    if (!validJournalDay(saved) || saved.date !== date) throw new Error(`Journal entry for ${date} uses an unsupported format.`);
    return saved;
  }
  async journalStyleSettings(): Promise<JournalStyleSettings> {
    const saved = await this.read<unknown>(journalStylePath);
    if (saved === null) return defaultJournalStyleSettings();
    if (!validJournalStyleSettings(saved)) throw new Error('Journal styles use an unsupported format. The existing file was left untouched.');
    return saved;
  }
  async updateJournalStyleSettings(change: (current: JournalStyleSettings) => JournalStyleSettings): Promise<JournalStyleSettings> {
    return this.updateJournal(async () => {
      const next = change(await this.journalStyleSettings());
      if (!validJournalStyleSettings(next)) throw new Error('Invalid journal style settings.');
      await this.write(journalStylePath, next);
      return next;
    });
  }
  async journalRenderings(date: string): Promise<JournalRenderings> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid journal date.');
    const saved = await this.read<unknown>(journalRenderingPath(date));
    if (saved === null) return { version: 1, date, entries: {} };
    if (!validJournalRenderings(saved) || saved.date !== date) throw new Error(`Journal renderings for ${date} use an unsupported format.`);
    return saved;
  }
  async saveJournalRendering(date: string, rendering: JournalRendering): Promise<JournalRenderings> {
    return this.updateJournal(async () => {
      const day = await this.journalDay(date);
      if (!day || journalFactRevision(day) !== rendering.factRevision) throw new Error('This journal day changed while generating. Review the new facts and regenerate.');
      const current = await this.journalRenderings(date);
      const next: JournalRenderings = { ...current, entries: { ...current.entries, [rendering.styleId]: rendering } };
      if (!validJournalRenderings(next)) throw new Error('Invalid generated journal entry.');
      await this.write(journalRenderingPath(date), next);
      return next;
    });
  }
  async saveJournalArtwork(date: string, assetId: string | null, prompt: string): Promise<JournalRenderings> {
    return this.updateJournal(async () => {
      if (assetId) {
        validId(assetId);
        if (!(await this.avatarLibrary()).some(asset => asset.id === assetId) || !(await this.avatarAsset(assetId)))
          throw new Error('The selected artwork is no longer in the image library.');
      }
      const current = await this.journalRenderings(date);
      const next: JournalRenderings = {
        ...current,
        ...(assetId ? { artworkAssetId: assetId } : { artworkAssetId: undefined }),
        artworkPrompt: prompt.trim().slice(0, 1200),
      };
      if (!validJournalRenderings(next)) throw new Error('Invalid journal artwork.');
      await this.write(journalRenderingPath(date), next);
      return next;
    });
  }
  private async updateJournal<T>(change: () => Promise<T>): Promise<T> {
    const task = this.journalWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:journal:${this.workspaceId}`, change) : change();
    });
    this.journalWrites = task.then(() => {}, () => {});
    return task;
  }
  async setJournalEnabled(enabled: boolean, expectedCurrent?: boolean): Promise<JournalIndex> {
    return this.updateJournal(async () => {
      const current = await this.journalIndex();
      if (expectedCurrent !== undefined && current.enabled !== expectedCurrent) throw new Error('Journal setting changed during review. Read it again before changing it.');
      const next = { ...current, enabled };
      await this.write(journalIndexPath, next);
      return next;
    });
  }
  async remapJournalConversation(source: Pick<ConversationMeta, 'projectId' | 'id'>, destination: Pick<ConversationMeta, 'projectId' | 'id'>): Promise<void> {
    validId(source.projectId); validId(source.id); validId(destination.projectId); validId(destination.id);
    await this.updateJournal(async () => {
      const index = await this.journalIndex();
      if (!index.dates.length) return;
      const from = `${source.projectId}:${source.id}`;
      const target = { projectId: destination.projectId, sessionId: destination.id };
      const redirects = { ...index.redirects };
      for (const [key, value] of Object.entries(redirects)) if (`${value.projectId}:${value.sessionId}` === from) redirects[key] = target;
      redirects[from] = target;
      const next = { ...index, redirects };
      if (!validJournalIndex(next)) throw new Error('The journal has reached its conversation move limit.');
      await this.write(journalIndexPath, next);
    });
  }
  async recordJournalMessage(meta: ConversationMeta, message: HarnessMessage): Promise<void> {
    await this.updateJournal(async () => {
      const index = await this.journalIndex();
      if (!index.enabled) return;
      const date = journalDate(message.createdAt, index.timeZone);
      const existing = await this.journalDay(date);
      const day: JournalDay = existing || { version: 1, date, updatedAt: message.createdAt, facts: [] };
      if (!day.facts.some(fact => fact.id === message.id)) {
        const next: JournalDay = { ...day, updatedAt: isoNow(), facts: [...day.facts, journalFact(meta, message)] };
        if (!validJournalDay(next)) throw new Error('This journal day reached its record limit.');
        await this.write(journalDayPath(date), next);
      }
      if (!index.dates.includes(date)) await this.write(journalIndexPath, { ...index, dates: [...index.dates, date].sort().reverse() });
    });
  }
  async tasks(): Promise<TaskRecord[]> {
    const saved = await this.read<{ version: number; tasks: unknown }>(tasksPath);
    if (saved === null) return [];
    if (saved.version !== 1 || !validateTasks(saved.tasks)) throw new Error('Workspace tasks use an unsupported format. The existing file was left untouched.');
    return saved.tasks;
  }
  async updateTasks(change: (current: TaskRecord[]) => TaskRecord[] | Promise<TaskRecord[]>): Promise<TaskRecord[]> {
    const persist = async () => {
      const next = await change(await this.tasks());
      if (!validateTasks(next)) throw new Error('A task exceeds the workspace task limits.');
      await this.write(tasksPath, { version: 1, tasks: next });
      return next;
    };
    const task = this.tasksWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:tasks:${this.workspaceId}`, persist) : persist();
    });
    this.tasksWrites = task.then(() => {}, () => {});
    return task;
  }
  async achievementLedger(): Promise<AchievementLedger> {
    const saved = await this.read<AchievementLedger>(achievementsPath);
    if (!saved) return emptyAchievementLedger();
    if (saved.version !== 1 || !saved.counts || typeof saved.counts !== 'object' || !saved.unlockedAt || typeof saved.unlockedAt !== 'object') throw new Error('Achievement record is damaged. Restore it from a backup before continuing.');
    return saved;
  }
  async updateAchievementLedger(observed: AchievementCounts, modelKeys: string[] = [], typeKeys: string[] = []): Promise<AchievementLedger> {
    const persist = async () => {
      const current = await this.achievementLedger();
      const seen = achievementModels(current, modelKeys, typeKeys);
      const next = mergeAchievementLedger(seen, { ...observed, models: Math.max(observed.models, seen.modelsSeen!.length), modelTypes: Math.max(observed.modelTypes, seen.modelTypesSeen!.length) });
      if (JSON.stringify(next) !== JSON.stringify(current)) await this.write(achievementsPath, next);
      return next;
    };
    const task = this.achievementWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:achievements:${this.workspaceId}`, persist) : persist();
    });
    this.achievementWrites = task.then(() => {}, () => {});
    return task;
  }
  async recordAchievementMetrics(delta: Partial<AchievementCounts>, model?: ModelStamp): Promise<{ ledger: AchievementLedger; unlocked: string[] }> {
    const persist = async () => {
      const current = await this.achievementLedger();
      const seen = achievementModels(current, model?.model ? [`${model.provider}:${model.model}`] : [], model ? [model.engine || model.provider] : []);
      const incremented = incrementAchievementLedger(seen, delta);
      const ledger = mergeAchievementLedger(incremented, { ...incremented.counts, models: seen.modelsSeen!.length, modelTypes: seen.modelTypesSeen!.length });
      const unlocked = Object.keys(ledger.unlockedAt).filter(id => !current.unlockedAt[id]);
      const changed = JSON.stringify(ledger) !== JSON.stringify(current);
      if (changed) await this.write(achievementsPath, ledger);
      return { ledger, unlocked, changed };
    };
    const task = this.achievementWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:achievements:${this.workspaceId}`, persist) : persist();
    });
    this.achievementWrites = task.then(() => {}, () => {});
    const result = await task;
    if (result.changed && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('harness:achievements-changed', { detail: { workspaceId: this.workspaceId } }));
      if (result.unlocked.length) window.dispatchEvent(new CustomEvent('harness:achievements-unlocked', { detail: { workspaceId: this.workspaceId, ids: result.unlocked } }));
    }
    return result;
  }
  async observeAchievementMetrics(observed: Partial<AchievementCounts>): Promise<AchievementLedger> {
    const persist = async () => {
      const current = await this.achievementLedger();
      const ledger = mergeAchievementLedger(current, { ...current.counts, ...observed });
      const unlocked = Object.keys(ledger.unlockedAt).filter(id => !current.unlockedAt[id]);
      const changed = JSON.stringify(ledger) !== JSON.stringify(current);
      if (changed) await this.write(achievementsPath, ledger);
      return { ledger, unlocked, changed };
    };
    const task = this.achievementWrites.catch(() => {}).then(async () => {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? locks.request(`local-agent-lab:achievements:${this.workspaceId}`, persist) : persist();
    });
    this.achievementWrites = task.then(() => {}, () => {});
    const result = await task;
    if (result.changed && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('harness:achievements-changed', { detail: { workspaceId: this.workspaceId } }));
      if (result.unlocked.length) window.dispatchEvent(new CustomEvent('harness:achievements-unlocked', { detail: { workspaceId: this.workspaceId, ids: result.unlocked } }));
    }
    return result.ledger;
  }
  async saveResponseDiagnostic(projectId: string, sessionId: string, messageId: string, report: ResponseDiagnostic): Promise<void> {
    validId(projectId); validId(sessionId); validId(messageId);
    if ((report.version !== 1 && report.version !== 2) || new Blob([JSON.stringify(report)]).size > 16_000_000) throw new Error('Response diagnostic exceeds the 16 MB limit.');
    const path = diagnosticPath(projectId, sessionId, messageId);
    const previous = await this.read<ResponseDiagnostic>(path);
    await this.write(path, report);
    if (!previous && Number.isFinite(report.usage?.elapsedMs) && report.usage.elapsedMs > 0) {
      void this.recordAchievementMetrics({ responseSeconds: report.usage.elapsedMs / 1000 })
        .catch(error => console.warn('The response diagnostic was saved, but achievement progress could not be updated:', error));
    }
  }
  async responseDiagnostic(projectId: string, sessionId: string, messageId: string): Promise<ResponseDiagnostic | null> {
    validId(projectId); validId(sessionId); validId(messageId);
    const report = await this.read<ResponseDiagnostic>(diagnosticPath(projectId, sessionId, messageId));
    if (report && report.version !== 1 && report.version !== 2) throw new Error('This response diagnostic uses an unsupported format.');
    return report;
  }
  private async removeIncompleteCopy(projectId: string, sessionId: string): Promise<void> {
    const artworkKey = `conversation:${sessionId}`;
    const root = `${ROOT}/projects/${projectId}`;
    if (this.folder) {
      try {
        let directory = this.folder;
        for (const part of `${root}/sessions`.split('/')) directory = await directory.getDirectoryHandle(part);
        await directory.removeEntry(sessionId, { recursive: true });
      } catch (error) { if (!isMissing(error)) throw error; }
      try {
        let directory = this.folder;
        for (const part of `${root}/drafts`.split('/')) directory = await directory.getDirectoryHandle(part);
        await directory.removeEntry(`${sessionId}.json`);
      } catch (error) { if (!isMissing(error)) throw error; }
      await this.removeConversationMemory(sessionId);
      if ((await this.surfaceArtwork()).items[artworkKey]) await this.saveSurfaceArtwork(artworkKey, null, '');
      return;
    }
    await cacheDeletePrefix(cacheKey(this.workspaceId, `${root}/sessions/${sessionId}/`));
    await cacheDeletePrefix(cacheKey(this.workspaceId, `${root}/drafts/${sessionId}.json`));
    await this.removeConversationMemory(sessionId);
    if ((await this.surfaceArtwork()).items[artworkKey]) await this.saveSurfaceArtwork(artworkKey, null, '');
  }
  async copyConversation(source: ConversationMeta, destinationProjectId: string, onProgress?: (completed: number, total: number) => void | Promise<void>, signal?: AbortSignal): Promise<ConversationMeta> {
    validId(destinationProjectId);
    const copied: ConversationMeta = { ...source, id: newId(), projectId: destinationProjectId, pinned: false, approvedTools: [], updatedAt: isoNow() };
    const total = Math.ceil(source.messageCount / MESSAGE_CHUNK_SIZE);
    let copiedPackedGroup: ChunkPack | null = null;
    let loosePackChunks: HarnessMessage[][] | null = null;
    const checkStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Copy stopped.', 'AbortError'); };
    try {
      checkStopped();
      await onProgress?.(0, total);
      for (let number = 0; number < total; number++) {
        checkStopped();
        if (this.folder && number % PACK_CHUNKS === 0 && number + PACK_CHUNKS <= total) {
          const firstChunk = number;
          const sourcePackPath = packPath(source.projectId, source.id, Math.floor(number / PACK_CHUNKS));
          copiedPackedGroup = await this.readPack(sourcePackPath, firstChunk);
          loosePackChunks = copiedPackedGroup ? null : [];
          if (copiedPackedGroup) {
            const destinationPackPath = packPath(destinationProjectId, copied.id, Math.floor(number / PACK_CHUNKS));
            await writeBlob(this.folder, destinationPackPath, await readBlob(this.folder, sourcePackPath));
            await this.readPack(destinationPackPath, firstChunk);
          }
        }
        const newPath = chunkPath(destinationProjectId, copied.id, number);
        const messages = copiedPackedGroup?.chunks[number - copiedPackedGroup.firstChunk] || await this.chunk(source.projectId, source.id, number);
        if (messages.length !== Math.min(MESSAGE_CHUNK_SIZE, source.messageCount - number * MESSAGE_CHUNK_SIZE)) {
          throw new Error(`Conversation history is incomplete at chunk #${number}.`);
        }
        if (loosePackChunks) loosePackChunks.push(messages);
        else if (!copiedPackedGroup) await this.write(newPath, messages);
        for (const message of messages) {
          if (!message.hasDiagnostics) continue;
          const oldDiagnostic = diagnosticPath(source.projectId, source.id, message.id);
          const newDiagnostic = diagnosticPath(destinationProjectId, copied.id, message.id);
          if (this.folder) await writeBlob(this.folder, newDiagnostic, await readBlob(this.folder, oldDiagnostic));
          else {
            const report = await this.read<ResponseDiagnostic>(oldDiagnostic);
            if (!report) throw new Error(`Response diagnostic for ${message.id} is missing.`);
            await this.write(newDiagnostic, report);
          }
        }
        if (this.folder && (number + 1) % PACK_CHUNKS === 0) {
          if (loosePackChunks) {
            const destinationPackPath = packPath(destinationProjectId, copied.id, Math.floor(number / PACK_CHUNKS));
            const pack: ChunkPack = { version: 1, firstChunk: number + 1 - PACK_CHUNKS, chunks: loosePackChunks };
            await this.write(destinationPackPath, pack);
            const verified = await this.readPack(destinationPackPath, pack.firstChunk);
            if (JSON.stringify(verified) !== JSON.stringify(pack)) throw new Error('Copied conversation pack could not be verified. The incomplete copy was removed.');
          }
          copiedPackedGroup = null;
          loosePackChunks = null;
        }
        await onProgress?.(number + 1, total);
      }
      for (let group = 0; group * INDEX_GROUP_SIZE < total; group++) {
        checkStopped();
        const oldPath = chunkIndexPath(source.projectId, source.id, group);
        const newPath = chunkIndexPath(destinationProjectId, copied.id, group);
        if (this.folder) {
          try { await writeBlob(this.folder, newPath, await readBlob(this.folder, oldPath)); }
          catch (error) { if (!isMissing(error)) throw error; }
        } else {
          const index = await this.read<ChunkIndex>(oldPath);
          if (index) await this.write(newPath, index);
        }
      }
      checkStopped();
      const draft = await this.draft(source.projectId, source.id);
      if (draft) await this.saveDraft(destinationProjectId, copied.id, draft);
      checkStopped();
      await this.updateMemory(records => {
        const related = records.filter(record => record.scope === 'session' && record.ownerId === source.id);
        return related.length ? [...records, ...related.map(record => ({ ...record, id: newId(), ownerId: copied.id, updatedAt: isoNow() }))] : records;
      });
      const artwork = (await this.surfaceArtwork()).items[`conversation:${source.id}`];
      if (artwork && await this.avatarAsset(artwork.assetId))
        await this.saveSurfaceArtwork(`conversation:${copied.id}`, artwork.assetId, artwork.prompt);
      checkStopped();
      return copied;
    } catch (error) {
      try { await this.removeIncompleteCopy(destinationProjectId, copied.id); }
      catch (cleanup) { throw new Error(`Copy stopped, but incomplete destination files could not be removed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`, { cause: error }); }
      throw error;
    }
  }
  /** Clean up a copied snapshot only if it was never published in the destination index. */
  async discardUnlistedCopy(copied: ConversationMeta): Promise<boolean> {
    validId(copied.projectId); validId(copied.id);
    if ((await this.sessions(copied.projectId)).some(item => item.id === copied.id)) return false;
    await this.removeIncompleteCopy(copied.projectId, copied.id);
    return true;
  }
  async removeMovedSource(snapshot: ConversationMeta, destination: ConversationMeta): Promise<string | null> {
    await this.updateSessions(snapshot.projectId, async sessions => {
      const current = sessions.find(item => item.id === snapshot.id);
      if (!current) throw new Error('The source conversation was removed during transfer. The copied snapshot remains in the destination.');
      const recovered = await this.recoverConversation(current);
      if (JSON.stringify(recovered) !== JSON.stringify(snapshot)) {
        throw new Error('The source conversation changed during transfer. The copied snapshot remains in the destination; the source was kept.');
      }
      const listedDestination = (await this.sessions(destination.projectId)).find(item => item.id === destination.id);
      if (!listedDestination || JSON.stringify(listedDestination) !== JSON.stringify(destination)
        || JSON.stringify(await this.recoverConversation(listedDestination)) !== JSON.stringify(destination)) {
        throw new Error('The destination conversation changed during transfer. The source was kept.');
      }
      return sessions.filter(item => item.id !== snapshot.id);
    });
    try {
      await this.removeIncompleteCopy(snapshot.projectId, snapshot.id);
      return null;
    } catch (error) {
      // The destination is already published. Report cleanup without treating the move as undone.
      return error instanceof Error ? error.message : String(error);
    }
  }
  async removeConversationMemory(sessionId: string): Promise<void> {
    validId(sessionId);
    await this.updateMemory(records => {
      const kept = records.filter(record => record.scope !== 'session' || record.ownerId !== sessionId);
      return kept.length === records.length ? records : kept;
    });
  }
  async deleteConversation(meta: ConversationMeta): Promise<void> {
    // Keep chunks on disk as recoverable history. Removing the index hides the conversation.
    await this.updateSessions(meta.projectId, sessions => sessions.filter(item => item.id !== meta.id));
  }
}

export async function openBrowserWorkspace(): Promise<{ store: HarnessStore; manifest: HarnessManifest }> {
  schedulePortableCacheCleanup();
  const store = new HarnessStore('browser-home', null);
  return { store, manifest: await store.manifest() };
}

export async function openFolderWorkspace(folder: FileSystemDirectoryHandle): Promise<{ store: HarnessStore; manifest: HarnessManifest }> {
  schedulePortableCacheCleanup();
  let manifest: HarnessManifest | null = null;
  let found = false;
  try {
    const raw = await (await readBlob(folder, manifestPath)).text();
    found = true;
    manifest = JSON.parse(raw) as HarnessManifest;
  }
  catch (error) { if (!isMissing(error)) throw error; }
  if (found && !supportedManifest(manifest)) {
    throw new Error('This workspace manifest has an unsupported format. The existing file was left untouched.');
  }
  if (!manifest || await hasWritableFolderPermission(folder)) {
    // Reconnects can fill in older workspace layouts when write permission is
    // already granted. A permission prompt is never needed just to open one.
    for (const name of ['models', 'sources', 'outputs', 'presets', 'exports']) {
      try { await folder.getDirectoryHandle(name); continue; }
      catch (error) { if (!isMissing(error)) throw error; }
      try { await folder.getDirectoryHandle(name, { create: true }); }
      catch (error) {
        // Some handles have no queryPermission method. Let a read-only older
        // workspace open even when create:true is rejected by that provider.
        if (manifest && error instanceof DOMException
          && ['NotAllowedError', 'NoModificationAllowedError', 'SecurityError'].includes(error.name)) break;
        throw error;
      }
    }
  }
  const id = manifest ? manifest.id : newId();
  const store = new HarnessStore(id, folder);
  return { store, manifest: await store.manifest() };
}
