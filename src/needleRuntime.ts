import { assertNeedleFiles, type NeedleVersion } from './needleAssets.ts';
import { withLocalModelMemory } from './localModelMemory.ts';

type Reply = { id: number; result?: string | null; error?: string };
let worker: Worker | null = null;
let loaded: { folder: FileSystemDirectoryHandle; version: NeedleVersion } | null = null;
const listeners = new Set<() => void>();
export const getNeedleRuntimeStatus = () => loaded;
export const subscribeNeedleRuntime = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publishLoaded = (next: typeof loaded) => { loaded = next; listeners.forEach(listener => listener()); };
let nextId = 0;
const pending = new Map<number, { resolve: (value: string | null) => void; reject: (error: Error) => void }>();
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./needleWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const promise = pending.get(event.data.id);
    if (!promise) return;
    pending.delete(event.data.id);
    if (event.data.error) promise.reject(new Error(event.data.error));
    else promise.resolve(event.data.result ?? null);
  };
  worker.onerror = event => {
    for (const promise of pending.values()) promise.reject(new Error(event.message || 'Needle worker failed.'));
    pending.clear(); worker?.terminate(); worker = null; publishLoaded(null);
  };
  return worker;
}
function send(message: Record<string, unknown>, transfer: Transferable[] = []) {
  const id = ++nextId;
  const target = ensureWorker();
  return new Promise<string | null>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, ...message }, transfer);
  });
}
export function needleLoaded(folder: FileSystemDirectoryHandle, version: NeedleVersion) { return loaded?.folder === folder && loaded.version === version; }
export function loadNeedle(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  return withLocalModelMemory(async () => {
    await (await import('./browserImage.ts')).unloadBrowserImageModel();
    await (await import('./browserModel.ts')).unloadBrowserModel();
    await (await import('./localOllama.ts')).unloadLocalOllama();
    await loadNeedleInternal(folder, version);
  });
}

async function loadNeedleInternal(folder: FileSystemDirectoryHandle, version: NeedleVersion) {
  if (needleLoaded(folder, version)) return;
  const { engineFiles, modelFiles } = await assertNeedleFiles(folder, version);
  publishLoaded(null);
  const scriptUrl = URL.createObjectURL(new Blob([engineFiles[2]], { type: 'text/javascript' }));
  const wasm = await engineFiles[3].arrayBuffer();
  const weights = await modelFiles[1].arrayBuffer();
  const vocab = version === 'needle' ? await modelFiles[2].text() : undefined;
  try {
    await send({ kind: 'load', scriptUrl, wasm, weights, version, vocab }, [wasm, weights]);
    publishLoaded({ folder, version });
  } finally { URL.revokeObjectURL(scriptUrl); }
}
export async function runNeedle(folder: FileSystemDirectoryHandle, version: NeedleVersion, query: string, tools: string) {
  return withLocalModelMemory(async () => {
    if (!needleLoaded(folder, version)) throw new Error('Load Needle first.');
    await assertNeedleFiles(folder, version);
    return await send({ kind: 'run', query, tools }) || '';
  });
}
export async function unloadNeedle() {
  if (worker) await send({ kind: 'unload' }).catch(() => {});
  worker?.terminate(); worker = null; publishLoaded(null);
}
