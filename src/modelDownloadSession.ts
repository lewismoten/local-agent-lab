import { discardPartialModel, downloadModelToFolder, incompleteModels, listPartialModels, type DownloadProgress, type PartialModel } from './modelDownload.ts';
import { showToast } from './toastStore.ts';
import { ensureWritableFolder } from './storage.ts';
import { ensureModelLicenseFiles } from './modelLicenses.ts';
import { maybeModelFile } from './modelFolders.ts';

export const DEFAULT_DOWNLOAD_SPEED_MIBPS = 0.25;
const SPEED_KEY = 'model-download-speed';
const RECOVERY_KEY = 'model-download-recovery';
const QUEUE_KEY = 'model-download-queue';
const QUEUE_FILE = 'download-queue.json';
export type RecoverableModel = { name: string; url: string; bytes: number; total: number; verified?: boolean };
export type QueuedModel = { name: string; url: string; bytes: number; licenseOnly?: boolean };
const validQueue = (value: unknown): QueuedModel[] => Array.isArray(value) ? value.filter((item): item is QueuedModel =>
  !!item && typeof item.name === 'string' && /^[\w.()-]+\.gguf$/i.test(item.name) &&
  typeof item.url === 'string' && item.url.startsWith('https://') &&
  Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 2_000_000_000) : [];
const readQueue = (): QueuedModel[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]');
    return validQueue(value);
  } catch { return []; }
};
const readRecovery = (): RecoverableModel | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(RECOVERY_KEY) || 'null') as RecoverableModel | null;
    return value && typeof value.name === 'string' && typeof value.url === 'string' && Number.isFinite(value.bytes) && Number.isFinite(value.total) ? value : null;
  } catch { return null; }
};
export const readSavedSpeed = () => {
  if (typeof window === 'undefined') return DEFAULT_DOWNLOAD_SPEED_MIBPS;
  try {
    const legacy = window.sessionStorage.getItem(SPEED_KEY);
    // Older builds wrote "0" on mount even when the user never chose Unlimited.
    const preferred = window.localStorage.getItem(SPEED_KEY);
    const saved = preferred ?? (legacy && legacy !== '0' ? legacy : null);
    const value = saved === null ? DEFAULT_DOWNLOAD_SPEED_MIBPS : Number(saved);
    if (preferred === null && saved !== null && Number.isFinite(value) && value >= 0) window.localStorage.setItem(SPEED_KEY, saved);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DOWNLOAD_SPEED_MIBPS;
  } catch { return DEFAULT_DOWNLOAD_SPEED_MIBPS; }
};

export type ModelDownloadState = {
  status: 'idle' | 'downloading' | 'discarding';
  name: string;
  url: string;
  progress: DownloadProgress | null;
  error: string;
  speedLimit: number;
  recovery: RecoverableModel | null;
  queue: QueuedModel[];
  queuePaused: boolean;
  revision: number;
};

export function createModelDownloadManager(initialSpeedLimit = DEFAULT_DOWNLOAD_SPEED_MIBPS, initialRecovery = readRecovery()) {
  let state: ModelDownloadState = { status: 'idle', name: '', url: '', progress: null, error: '', speedLimit: initialSpeedLimit, recovery: initialRecovery, queue: readQueue(), queuePaused: true, revision: 0 };
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let task: Promise<void> | null = null;
  let activeFolder: FileSystemDirectoryHandle | null = null;
  let queueFolder: FileSystemDirectoryHandle | null = null;
  let queueOnComplete: ((path: string) => void) | null = null;
  let pumping = false;
  let pumpTask: Promise<void> | null = null;
  let licenseTask: Promise<void> | null = null;
  let queueWrite: Promise<void> = Promise.resolve();
  let workspaceEpoch = 0;
  const publish = (patch: Partial<ModelDownloadState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const remember = (recovery: RecoverableModel | null) => {
    publish({ recovery });
    if (typeof window === 'undefined') return;
    try {
      if (recovery) window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
      else window.sessionStorage.removeItem(RECOVERY_KEY);
    } catch { /* The sidecar in models/ remains the durable recovery record. */ }
  };
  const setQueue = (queue: QueuedModel[]) => {
    publish({ queue });
    try { if (typeof window !== 'undefined') window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* Keep the active queue in memory. */ }
    if (queueFolder) {
      const target = queueFolder;
      queueWrite = queueWrite.then(async () => {
        const dir = await target.getDirectoryHandle('models', { create: true });
        const writer = await (await dir.getFileHandle(QUEUE_FILE, { create: true })).createWritable();
        await writer.write(JSON.stringify(queue, null, 2) + '\n');
        await writer.close();
      }).catch(() => { showToast('The download queue stayed in this browser, but could not be saved to the project folder.', 'error'); });
    }
  };
  const alreadyDownloaded = async (folder: FileSystemDirectoryHandle, item: QueuedModel) => {
    try {
      if ((await incompleteModels(folder)).has(item.name)) return false;
      const file = await maybeModelFile(folder, item.name);
      return !!file && (item.licenseOnly ? file.size > 0 : file.size === item.bytes);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false;
      throw error;
    }
  };
  const pumpQueue = (): Promise<void> | null => {
    if (pumping || licenseTask || task || state.status !== 'idle' || state.queuePaused || !queueFolder || !queueOnComplete) return pumpTask;
    pumping = true;
    pumpTask = (async () => { try {
      while (state.queue.length && !task && state.status === 'idle' && !state.queuePaused) {
        const next = state.queue[0];
        const installed = await alreadyDownloaded(queueFolder, next);
        if (state.queuePaused) break;
        if (state.queue[0]?.url !== next.url) continue;
        if (installed) { await ensureModelLicenseFiles(queueFolder, next.url); setQueue(state.queue.slice(1)); publish({ revision: state.revision + 1 }); showToast(`${next.name} license files are ready.`); continue; }
        if (next.licenseOnly) throw new Error(`${next.name} is missing or incomplete. Its license cannot be repaired until the GGUF is present.`);
        if (task || state.status !== 'idle' || state.queuePaused) break;
        manager.start(queueFolder, next.url, queueOnComplete);
        break;
      }
    } catch (error) {
      publish({ queuePaused: true, error: error instanceof Error ? error.message : String(error) });
      showToast(`Model queue paused: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally { pumping = false; pumpTask = null; } })();
    return pumpTask;
  };
  const processPriorityLicenses = () => {
    if (licenseTask || !queueFolder) return;
    const folder = queueFolder;
    licenseTask = (async () => {
      try {
        while (true) {
          const next = state.queue.find(item => item.licenseOnly && !(state.status === 'downloading' && state.url === item.url));
          if (!next) break;
          if (!await alreadyDownloaded(folder, next)) throw new Error(`${next.name} is missing or incomplete. Its license cannot be repaired until the GGUF is present.`);
          if (!state.queue.some(item => item.url === next.url)) continue;
          await ensureModelLicenseFiles(folder, next.url);
          setQueue(state.queue.filter(item => item.url !== next.url));
          publish({ revision: state.revision + 1 });
          showToast(`${next.name} license files are ready.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish({ queuePaused: true, error: message });
        showToast(`Model license repair failed: ${message}`, 'error');
      } finally {
        licenseTask = null;
        if (!task) void pumpQueue();
      }
    })();
  };
  const recordPartials = (partials: PartialModel[]) => {
    const match = partials.find(item => item.name === state.recovery?.name && item.url === state.recovery.url) || partials[0];
    if (match && state.status === 'idle') remember({ name: match.name, url: match.url, bytes: match.bytes, total: match.total, verified: true });
  };
  const restorePartial = async (folder: FileSystemDirectoryHandle, preferredUrl?: string) => {
    const partials = await listPartialModels(folder);
    const match = partials.find(item => item.url === preferredUrl) || partials[0];
    remember(match ? { name: match.name, url: match.url, bytes: match.bytes, total: match.total, verified: true } : null);
  };
  const manager = {
    getSnapshot: () => state,
    /** A live queue belongs only to the folder that started or resumed it. */
    getWorkspaceSnapshot: (folder: FileSystemDirectoryHandle) => queueFolder === folder || activeFolder === folder ? state : null,
    getAttachedFolder: () => queueFolder || activeFolder,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSpeedLimit(value: number) {
      const speedLimit = Number.isFinite(value) && value >= 0 ? value : 0;
      publish({ speedLimit });
      try { if (typeof window !== 'undefined') window.localStorage.setItem(SPEED_KEY, String(speedLimit)); } catch { /* Keep the in-memory choice. */ }
    },
    recordPartials,
    enqueue(folder: FileSystemDirectoryHandle, items: QueuedModel[], onComplete: (path: string) => void) {
      queueFolder = folder;
      queueOnComplete = onComplete;
      const existing = new Set(state.queue.map(item => item.url));
      const next = [...state.queue];
      for (const item of items) {
        if (existing.has(item.url) || (state.status === 'downloading' && state.url === item.url)) continue;
        existing.add(item.url);
        next.push(item);
      }
      setQueue(next);
      publish({ queuePaused: false });
      if (items.some(item => item.licenseOnly) && (task || state.status === 'downloading')) processPriorityLicenses();
      else void pumpQueue();
    },
    prioritize(folder: FileSystemDirectoryHandle, item: QueuedModel, onComplete: (path: string) => void) {
      queueFolder = folder;
      queueOnComplete = onComplete;
      const activeIndex = state.status === 'downloading' && state.queue[0]?.url === state.url ? 1 : 0;
      const next = state.queue.filter(queued => queued.url !== item.url);
      next.splice(activeIndex, 0, item);
      setQueue(next);
      publish({ queuePaused: false });
      if (item.licenseOnly && (task || state.status === 'downloading')) processPriorityLicenses();
      else void pumpQueue();
    },
    moveQueued(url: string, direction: -1 | 1) {
      const index = state.queue.findIndex(item => item.url === url);
      const firstPending = state.status === 'downloading' && state.queue[0]?.url === state.url ? 1 : 0;
      const target = index + direction;
      if (index < firstPending || target < firstPending || target >= state.queue.length) return false;
      const next = [...state.queue];
      [next[index], next[target]] = [next[target], next[index]];
      setQueue(next);
      if (next[target].licenseOnly && task && queueFolder) processPriorityLicenses();
      return true;
    },
    resumeQueue(folder: FileSystemDirectoryHandle, onComplete: (path: string) => void) {
      queueFolder = folder;
      queueOnComplete = onComplete;
      publish({ queuePaused: false });
      if (task && state.queue.some(item => item.licenseOnly)) processPriorityLicenses();
      else void pumpQueue();
      return state.queue.length > 0;
    },
    removeQueued(url: string) {
      if (state.status === 'downloading' && state.url === url) return false;
      setQueue(state.queue.filter(item => item.url !== url));
      return true;
    },
    markLicenseReady(url: string) {
      const next = state.queue.filter(item => !(item.url === url && item.licenseOnly));
      if (next.length !== state.queue.length) setQueue(next);
      publish({ revision: state.revision + 1 });
      if (!task && !state.queuePaused) void pumpQueue();
    },
    async discover(folder: FileSystemDirectoryHandle) {
      const epoch = workspaceEpoch;
      if (!queueFolder && state.status === 'idle') {
        try {
          const dir = await folder.getDirectoryHandle('models');
          const file = await (await dir.getFileHandle(QUEUE_FILE)).getFile();
          const saved = validQueue(JSON.parse(await file.text()));
          if (epoch === workspaceEpoch && !queueFolder && state.status === 'idle') setQueue(saved);
        } catch { /* A queue file is optional; the browser copy remains available. */ }
      }
      try { const partials = await listPartialModels(folder); if (epoch === workspaceEpoch) recordPartials(partials); } catch { /* Folder access can require a new user gesture after refresh. */ }
    },
    start(folder: FileSystemDirectoryHandle, url: string, onComplete: (path: string) => void) {
      if (task || state.status !== 'idle') return false;
      let name = '';
      try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* The downloader will report the invalid URL. */ }
      controller = new AbortController();
      activeFolder = folder;
      const signal = controller.signal;
      publish({ status: 'downloading', name, url, progress: null, error: '' });
      if (name) remember({ name, url, bytes: 0, total: 0 });
      task = (async () => {
        let completed = false;
        try {
          const path = await downloadModelToFolder(folder, url, () => state.speedLimit, progress => {
            publish({ progress });
            remember({ name, url, bytes: progress.bytes, total: progress.total, verified: false });
          }, signal);
          onComplete(path);
          if (state.queue.some(item => item.url === url)) setQueue(state.queue.filter(item => item.url !== url));
          await restorePartial(folder).catch(() => remember(null));
          completed = true;
          showToast(`${name} finished downloading.`);
        } catch (error) {
          const message = signal.aborted ? 'Download paused. Run Download again to continue from the last saved bytes.' : error instanceof Error ? error.message : String(error);
          publish({ error: message });
          try { await restorePartial(folder, url); }
          catch { /* Keep the last known recovery details until folder access returns. */ }
          if (!signal.aborted) showToast(`Model download failed: ${message}`, 'error');
          if (state.queue.some(item => item.url === url)) publish({ queuePaused: true });
        } finally {
          controller = null;
          task = null;
          activeFolder = null;
          publish({ status: state.status === 'discarding' ? 'discarding' : 'idle', revision: state.revision + 1 });
          if (completed) void pumpQueue();
        }
      })();
      if (queueFolder === folder && state.queue.some(item => item.licenseOnly && item.url !== url)) processPriorityLicenses();
      return true;
    },
    pause() { publish({ queuePaused: true }); controller?.abort(); return task || Promise.resolve(); },
    async pauseAndDetach() {
      this.pause();
      workspaceEpoch++;
      await Promise.all([task, licenseTask, pumpTask]);
      await queueWrite;
      // The old folder keeps its own queue file. Do not carry that queue or its
      // partial-download hint into the next workspace on this browser.
      queueFolder = null;
      queueOnComplete = null;
      publish({ queue: [], progress: null, recovery: null, error: '' });
      try { window.localStorage.removeItem(QUEUE_KEY); window.sessionStorage.removeItem(RECOVERY_KEY); } catch { /* Storage may be disabled. */ }
    },
    async discard(folder: FileSystemDirectoryHandle, name: string) {
      if (state.status === 'discarding') return;
      const active = state.status === 'downloading' && state.name === name && task;
      if (task && !active) return;
      const targetFolder = active && activeFolder ? activeFolder : folder;
      publish({ status: 'discarding', error: '' });
      if (active) {
        controller?.abort();
        await active;
      }
      try {
        await discardPartialModel(targetFolder, name);
        publish({ progress: null, error: '', revision: state.revision + 1 });
        await restorePartial(targetFolder);
        if (state.queue.some(item => item.name === name)) setQueue(state.queue.filter(item => item.name !== name));
        showToast(`Discarded ${name}.`);
      } catch (error) {
        publish({ error: error instanceof Error ? error.message : String(error) });
      } finally { publish({ status: 'idle' }); }
    },
  };
  return manager;
}

export const modelDownloadManager = createModelDownloadManager(readSavedSpeed());
export const subscribeModelDownload = modelDownloadManager.subscribe;
export const getModelDownload = modelDownloadManager.getSnapshot;

export async function verifyRecoverableModelFolder(folder: FileSystemDirectoryHandle) {
  const recovery = modelDownloadManager.getSnapshot().recovery;
  if (!recovery) throw new Error('There is no saved model download to resume.');
  if (!await ensureWritableFolder(folder)) throw new Error('Allow read and edit access to the project folder to resume the download.');
  const partials = await listPartialModels(folder);
  const recorded = partials.some(item => item.name === recovery.name && item.url === recovery.url);
  let savedBytes = 0;
  try {
    const modelsDir = await folder.getDirectoryHandle('models');
    const fileHandle = await modelsDir.getFileHandle(recovery.name);
    savedBytes = (await fileHandle.getFile()).size;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
  if (!recorded && !savedBytes) throw new Error('This folder has no saved bytes for that GGUF. Choose the original project folder to resume.');
  return recovery;
}

export async function resumeRecoverableModel(folder: FileSystemDirectoryHandle, onComplete: (path: string) => void) {
  const saved = modelDownloadManager.getSnapshot().recovery;
  // A license repair ahead of a partial GGUF should run without resuming that transfer.
  if (modelDownloadManager.getSnapshot().queue[0]?.licenseOnly) return resumeQueuedModels(folder, onComplete);
  if (saved && saved.bytes === 0 && modelDownloadManager.getSnapshot().queue[0]?.url === saved.url) return resumeQueuedModels(folder, onComplete);
  const recovery = await verifyRecoverableModelFolder(folder);
  if (modelDownloadManager.getSnapshot().queue[0]?.url === recovery.url) return modelDownloadManager.resumeQueue(folder, onComplete);
  return modelDownloadManager.start(folder, recovery.url, onComplete);
}

export async function resumeQueuedModels(folder: FileSystemDirectoryHandle, onComplete: (path: string) => void) {
  if (!await ensureWritableFolder(folder)) throw new Error('Allow read and edit access to the project folder to resume the queue.');
  return modelDownloadManager.resumeQueue(folder, onComplete);
}
