import type { BrowserTools } from './browserModel.ts';
import type { ChatCompletionTool } from './browserEngineTypes.ts';
import { MODEL_CATALOG, type CatalogModel } from './catalogModels.ts';
import { maybeModelFile } from './modelFolders.ts';
import { hasWritableFolderPermission } from './storage.ts';
import { WLLAMA_ASSETS, getWllamaEngineDownload, wllamaEngineManager } from './wllamaEngine.ts';
import { PRISM_ASSETS, getPrismEngineDownload, prismEngineManager } from './prismEngine.ts';
import { modelDownloadManager, resumeQueuedModels, type QueuedModel } from './modelDownloadSession.ts';

const MAX_BROWSER_MODEL_BYTES = 2_000_000_000;
const specialTerms = new Set(['gemma3-1b', 'qwen25-3b']);
const allowedSpeeds = new Set([0, 0.25, 0.5, 1, 2, 5]);
export function modelDownloadSpeedReview(value: unknown): Record<string, unknown> {
  if (typeof value !== 'number' || !allowedSpeeds.has(value)) throw new Error('Choose 0 (unlimited), 0.25, 0.5, 1, 2, or 5 MiB/s.');
  return { speedMiBps: value, meaning: value === 0 ? 'Unlimited' : `${value} MiB/s`, appliesTo: 'Current and future model and engine downloads in this browser', savedIn: 'Browser download settings' };
}
type BrowserEngineId = 'wllama' | 'prismml';
const engineChoice = (id: unknown): BrowserEngineId => {
  if (id === 'wllama' || id === 'prismml') return id;
  throw new Error('Choose the Wllama or PrismML browser engine.');
};
export function engineDownloadReview(id: unknown): Record<string, unknown> {
  const engine = engineChoice(id);
  const assets = engine === 'wllama' ? WLLAMA_ASSETS : PRISM_ASSETS;
  return { engine, version: engine === 'wllama' ? '3.8.1' : 'pinned PrismML Talk commit', sizeBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), source: assets.at(-1)?.url, licenseSource: assets[0].url, destination: `engines/${engine === 'wllama' ? 'Wllama' : 'PrismML'}/`, licenseFirst: true, files: assets.map(asset => asset.name) };
}

export function catalogModelChoice(id: unknown): CatalogModel {
  if (typeof id !== 'string' || !id.trim() || id.length > 120) throw new Error('Choose a model ID returned by search_model_catalog.');
  const model = MODEL_CATALOG.find(item => item.id === id.trim());
  if (!model) throw new Error('That model ID is not in the catalog. Search the model catalog first.');
  if (model.runtime === 'local-server' || !model.name.toLowerCase().endsWith('.gguf') || model.bytes > MAX_BROWSER_MODEL_BYTES) {
    throw new Error('This model is not available for browser download. Open Catalog to review its runtime and size.');
  }
  if (specialTerms.has(model.id)) throw new Error('Open Catalog to read and accept this model’s terms before downloading it.');
  return model;
}

export function modelDownloadReview(id: unknown): Record<string, unknown> {
  const model = catalogModelChoice(id);
  return { id: model.id, model: model.label, file: model.name, sizeBytes: model.bytes, license: model.license, licenseUrl: model.licenseUrl, source: model.source, engine: model.id.startsWith('bonsai2-') ? 'PrismML' : 'Wllama', destination: `models/${model.name.replace(/\.gguf$/i, '')}/` };
}

export function searchModelCatalog(query: unknown, limit: unknown = 6): string {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!text || text.length > 120) throw new Error('Give a model name, company, feature, or use case to search.');
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(10, Number(limit))) : 6;
  const matches = MODEL_CATALOG.filter(model => [model.label, model.family, model.company, model.reason, model.quantization].some(value => value.toLowerCase().includes(text)));
  return JSON.stringify({ models: matches.slice(0, count).map(model => ({ id: model.id, name: model.label, sizeBytes: model.bytes, reason: model.reason, license: model.license, runtime: model.runtime || 'browser', engine: model.id.startsWith('bonsai2-') ? 'PrismML' : 'Wllama', browserDownload: model.runtime !== 'local-server' && model.bytes <= MAX_BROWSER_MODEL_BYTES && !specialTerms.has(model.id) })), more: matches.length > count });
}

/** Catalog IDs resolve pinned URLs and sizes; model arguments never supply a download URL. */
const searchTool: ChatCompletionTool = { type: 'function', function: { name: 'search_model_catalog', description: 'Find browser AI models by name, company, feature, or use case. Returns IDs and sizes for download choices.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } };
const queueTool: ChatCompletionTool = { type: 'function', function: { name: 'queue_model_download', description: 'Queue one catalog GGUF for download into the workspace. The person reviews the exact model, size, license, and destination before it starts. Never use a custom URL.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact ID returned by search_model_catalog.' } }, required: ['id'] } } };
const engineTool: ChatCompletionTool = { type: 'function', function: { name: 'queue_browser_engine', description: 'Queue the pinned Wllama or PrismML browser engine after review. Wllama runs most GGUF models; PrismML runs Bonsai 2. Downloads continue in the background.', parameters: { type: 'object', properties: { engine: { type: 'string', description: 'wllama or prismml' } }, required: ['engine'] } } };
const statusTool: ChatCompletionTool = { type: 'function', function: { name: 'get_model_download_status', description: 'Read the current workspace GGUF download queue and live progress, if any. Also returns the browser download speed.', parameters: { type: 'object', properties: {} } } };
const speedTool: ChatCompletionTool = { type: 'function', function: { name: 'set_model_download_speed', description: 'Change the browser download speed immediately, including an active model or engine transfer. Requires review. Use 0 for unlimited or 0.25, 0.5, 1, 2, or 5 MiB/s.', parameters: { type: 'object', properties: { speedMiBps: { type: 'number' } }, required: ['speedMiBps'] } } };
const pauseTool: ChatCompletionTool = { type: 'function', function: { name: 'pause_model_queue', description: 'Pause the current workspace GGUF transfer and queue after review. A partial file remains resumable.', parameters: { type: 'object', properties: {} } } };
const resumeTool: ChatCompletionTool = { type: 'function', function: { name: 'resume_model_queue', description: 'Resume the current workspace GGUF download queue after review. Uses the saved browser speed limit.', parameters: { type: 'object', properties: {} } } };
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
async function savedDownloadQueue(folder: FileSystemDirectoryHandle): Promise<QueuedModel[]> {
  try {
    const dir = await folder.getDirectoryHandle('models');
    const data: unknown = JSON.parse(await (await (await dir.getFileHandle('download-queue.json')).getFile()).text());
    if (!Array.isArray(data)) throw new Error('The workspace model download queue is not a list.');
    return data.filter((item): item is QueuedModel => !!item && typeof item.name === 'string' && /^[\w.()-]+\.gguf$/i.test(item.name) && typeof item.url === 'string' && item.url.startsWith('https://')).slice(0, 50);
  } catch (error) { if (missing(error)) return []; throw error; }
}
export async function modelDownloadStatus(folder: FileSystemDirectoryHandle | null): Promise<string> {
  const speedMiBps = modelDownloadManager.getSnapshot().speedLimit;
  if (!folder) return JSON.stringify({ workspace: 'not-connected', speedMiBps });
  const live = modelDownloadManager.getWorkspaceSnapshot(folder);
  const queue = live?.queue || await savedDownloadQueue(folder);
  const active = live?.status === 'downloading' ? { name: live.name, savedBytes: live.progress?.bytes || 0, totalBytes: live.progress?.total || 0, percent: live.progress?.total ? Math.floor(live.progress.bytes / live.progress.total * 100) : null } : null;
  return JSON.stringify({ workspace: 'connected', speedMiBps, active, paused: live?.queuePaused ?? true, queue: queue.map(item => ({ name: item.name, modelId: MODEL_CATALOG.find(model => model.url === item.url)?.id || null, licenseOnly: !!item.licenseOnly })), error: live?.error || '' });
}
export async function modelDownloadQueueReview(folder: FileSystemDirectoryHandle | null, action: 'pause' | 'resume'): Promise<Record<string, unknown>> {
  if (!folder) throw new Error('Connect a project folder before controlling its model downloads.');
  const attached = modelDownloadManager.getAttachedFolder();
  if (attached && attached !== folder) throw new Error('A different workspace owns the current download queue. Open Models in this workspace before changing it.');
  const live = modelDownloadManager.getWorkspaceSnapshot(folder);
  const queue = live?.queue || await savedDownloadQueue(folder);
  const models = queue.map(item => {
    const pinned = MODEL_CATALOG.find(model => model.url === item.url && model.name === item.name && model.bytes === item.bytes);
    if (!pinned) throw new Error(`The saved queue contains an unknown model: ${item.name}. Review it in Models before resuming.`);
    return { name: item.name, id: pinned.id, licenseOnly: !!item.licenseOnly, sizeBytes: item.bytes };
  });
  if (action === 'pause' && (!live || live.queuePaused || live.status !== 'downloading' && !models.length))
    throw new Error('There is no active model download queue to pause in this workspace.');
  if (action === 'resume' && (!models.length || live && !live.queuePaused))
    throw new Error(models.length ? 'The model download queue is already running.' : 'There are no queued models to resume in this workspace.');
  return { action, active: live?.status === 'downloading' ? live.name : null, queue: models, speedMiBps: modelDownloadManager.getSnapshot().speedLimit };
}
export function browserModelCatalogTools(folder: FileSystemDirectoryHandle | null, allowQueue: boolean, signal?: AbortSignal): BrowserTools {
  return {
    definitions: [searchTool, statusTool, ...(folder && allowQueue ? [queueTool, engineTool, speedTool, pauseTool, resumeTool] : [])],
    execute: async (name, args) => {
      if (signal?.aborted) throw signal.reason || new DOMException('Model lookup stopped.', 'AbortError');
      if (name === 'search_model_catalog') return searchModelCatalog(args.query, args.limit);
      if (name === 'get_model_download_status') return modelDownloadStatus(folder);
      if (name === 'set_model_download_speed' && folder && allowQueue) {
        const review = modelDownloadSpeedReview(args.speedMiBps);
        modelDownloadManager.setSpeedLimit(review.speedMiBps as number);
        return JSON.stringify({ status: 'updated', ...review });
      }
      if ((name === 'pause_model_queue' || name === 'resume_model_queue') && folder && allowQueue) {
        const action = name === 'pause_model_queue' ? 'pause' : 'resume';
        const review = await modelDownloadQueueReview(folder, action);
        if (JSON.stringify(review) !== JSON.stringify(args.__reviewedQueue)) throw new Error('The model download queue changed during review. Check its current status and try again.');
        if (action === 'pause') {
          await modelDownloadManager.pause();
          return JSON.stringify({ status: 'paused', queue: review.queue });
        }
        if (!await hasWritableFolderPermission(folder)) throw new Error('Grant write access to the workspace from Models, then try again.');
        if (signal?.aborted) throw signal.reason || new DOMException('Model queue resume stopped.', 'AbortError');
        if (!modelDownloadManager.getAttachedFolder()) await modelDownloadManager.discover(folder);
        if (JSON.stringify(await modelDownloadQueueReview(folder, 'resume')) !== JSON.stringify(review)) throw new Error('The saved model download queue changed during review. Try again.');
        await resumeQueuedModels(folder, () => {});
        return JSON.stringify({ status: 'resuming', queue: review.queue });
      }
      if (name === 'queue_browser_engine' && folder && allowQueue) {
        const engine = engineChoice(args.engine);
        if (!await hasWritableFolderPermission(folder)) throw new Error('Grant write access to the workspace from Models, then try again.');
        if (signal?.aborted) throw signal.reason || new DOMException('Engine download stopped.', 'AbortError');
        if (engine === 'wllama') {
          await wllamaEngineManager.discover(folder);
          if (signal?.aborted) throw signal.reason || new DOMException('Engine download stopped.', 'AbortError');
          if (getWllamaEngineDownload().installed) return JSON.stringify({ engine, status: 'already-downloaded' });
          await wllamaEngineManager.queue(folder, false);
        } else {
          await prismEngineManager.discover(folder);
          if (signal?.aborted) throw signal.reason || new DOMException('Engine download stopped.', 'AbortError');
          if (getPrismEngineDownload().folder === folder && getPrismEngineDownload().installed) return JSON.stringify({ engine, status: 'already-downloaded' });
          await prismEngineManager.queue(folder, false);
        }
        return JSON.stringify({ engine, status: 'queued', note: 'Progress and pause controls are in Models > Engines.' });
      }
      if (name !== 'queue_model_download' || !folder || !allowQueue) throw new Error(`Unknown model tool: ${name}`);
      const model = catalogModelChoice(args.id);
      if (!await hasWritableFolderPermission(folder)) throw new Error('Grant write access to the workspace from Models, then try again.');
      if (signal?.aborted) throw signal.reason || new DOMException('Model download stopped.', 'AbortError');
      const existing = await maybeModelFile(folder, model.name);
      if (existing?.size === model.bytes) {
        const { ensureModelLicenseFiles } = await import('./modelLicenses.ts');
        await ensureModelLicenseFiles(folder, model.url);
        return JSON.stringify({ status: 'already-downloaded', model: model.label, file: model.name, license: 'ready', note: 'Use Models to load or inspect it.' });
      }
      await modelDownloadManager.discover(folder);
      if (signal?.aborted) throw signal.reason || new DOMException('Model download stopped.', 'AbortError');
      modelDownloadManager.enqueue(folder, [{ name: model.name, url: model.url, bytes: model.bytes }], () => {});
      return JSON.stringify({ status: 'queued', model: model.label, file: model.name, sizeBytes: model.bytes, engine: model.id.startsWith('bonsai2-') ? 'PrismML' : 'Wllama', note: 'Progress and engine downloads are in Models > Downloads and Engines.' });
    },
  };
}
