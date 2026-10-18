// Model switches and inference share one queue. A second Web Lock stays held
// while a model remains resident so another tab can ask it to free memory.
type ResidentModel = { loaded: () => boolean; unload: () => Promise<void> };
const residents = new Map<string, ResidentModel>();
const tabId = crypto.randomUUID();
const residentLockName = 'local-agent-lab:resident-model';
const runtimeLockName = 'local-agent-lab:runtime';
const residentWaitMs = 15_000;
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('local-agent-lab:model-residency') : null;
let tail: Promise<void> = Promise.resolve();
let residentRelease: (() => void) | null = null;
let residentPending: Promise<void> | null = null;
let activeOperations = 0;

export function registerResidentModel(id: string, loaded: () => boolean, unload: () => Promise<void>) {
  residents.set(id, { loaded, unload });
}

function releaseIfIdle() {
  if (activeOperations) return;
  if ([...residents.values()].some(model => model.loaded())) return;
  const release = residentRelease;
  residentRelease = null;
  release?.();
}

// Explicit unloads can happen outside the runtime queue (for example, from
// the model settings button). Release residency once their cleanup finishes.
export function notifyResidentModelUnloaded() { releaseIfIdle(); }

async function claimResidentLock() {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || residentRelease) return;
  if (residentPending) return residentPending;
  residentPending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Another tab still holds a browser model. Close or resume that tab, then try again.')), residentWaitMs);
    let granted!: () => void;
    let failed!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { granted = resolve; failed = reject; });
    channel?.postMessage({ type: 'release', from: tabId });
    try {
      void locks.request(residentLockName, { mode: 'exclusive', signal: controller.signal }, async () => {
        await new Promise<void>(resolve => { residentRelease = resolve; granted(); });
      }).catch(failed);
      await ready;
    } finally { clearTimeout(timeout); }
  })().finally(() => { residentPending = null; });
  return residentPending;
}

channel?.addEventListener('message', event => {
  const message = event.data as { type?: string; from?: string };
  if (message?.type !== 'release' || message.from === tabId || !residentRelease) return;
  // Queue behind local inference. The requesting tab waits for our resident
  // lock, so no new model can start there until these unloads finish.
  void withLocalModelMemory(async () => {
    for (const model of residents.values()) if (model.loaded()) await model.unload();
  }, { claimResident: false }).catch(error => console.warn('Could not release the browser model for another tab:', error));
});

export function withLocalModelMemory<T>(work: () => Promise<T>, options: { claimResident?: boolean } = {}): Promise<T> {
  const current: Promise<T> = tail.then(async () => {
    activeOperations++;
    try {
      if (options.claimResident !== false) await claimResidentLock();
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks ? await locks.request(runtimeLockName, async () => await work()) : await work();
    } finally {
      activeOperations--;
      releaseIfIdle();
    }
  });
  tail = current.then(() => {}, () => {});
  return current;
}
