export type ModelLeaseState = { owner: string | null; waiting: number };

type Waiter = {
  owner: string;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  phase: 'queued' | 'locking' | 'granted' | 'done';
  onAbort: () => void;
  lockController?: AbortController;
  preempted?: boolean;
};

const LOCK_NAME = 'local-agent-lab:model';
const listeners = new Set<() => void>();
const waiters: Waiter[] = [];
let active: Waiter | null = null;
let state: ModelLeaseState = { owner: null, waiting: 0 };

function publish() {
  state = { owner: active?.owner || null, waiting: waiters.length };
  for (const listener of listeners) listener();
}

export const getModelLease = () => state;
export const subscribeModelLease = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function finish(waiter: Waiter) {
  if (active !== waiter) return;
  waiter.phase = 'done';
  waiter.signal?.removeEventListener('abort', waiter.onAbort);
  active = null;
  startNext();
}

function startNext() {
  if (active) return;
  const waiter = waiters.shift();
  if (!waiter) { publish(); return; }
  active = waiter;
  waiter.phase = 'locking';
  publish();

  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) {
    waiter.phase = 'granted';
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(() => finish(waiter));
    return;
  }

  let releaseLock: (() => void) | undefined;
  waiter.lockController = new AbortController();
  const lockRequest = locks.request(LOCK_NAME, { mode: 'exclusive', signal: waiter.lockController.signal }, async () => {
    if (active !== waiter || waiter.phase !== 'locking') return;
    await new Promise<void>(resolve => {
      releaseLock = resolve;
      waiter.phase = 'granted';
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        releaseLock?.();
      });
    });
  });
  void lockRequest.then(() => finish(waiter), error => {
    if (waiter.preempted && active === waiter && waiter.phase === 'locking' && !waiter.signal?.aborted) {
      waiter.preempted = false;
      waiter.phase = 'queued';
      active = null;
      const firstBackground = waiters.findIndex(item => !item.owner.startsWith('chat:'));
      waiters.splice(firstBackground < 0 ? waiters.length : firstBackground, 0, waiter);
      startNext();
      return;
    }
    if (waiter.phase === 'locking') waiter.reject(error);
    finish(waiter);
  });
}

export function acquireModel(owner: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      owner, resolve, reject, signal, phase: 'queued',
      onAbort: () => {
        if (waiter.phase === 'granted' || waiter.phase === 'done') return;
        if (waiter.phase === 'queued') {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          waiter.phase = 'done';
          publish();
        } else {
          waiter.phase = 'done';
          waiter.lockController?.abort();
          finish(waiter);
        }
        reject(signal?.reason || new DOMException('Cancelled.', 'AbortError'));
      },
    };
    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    // Chat takes the next slot without reversing the order of other chat requests.
    const firstBackground = owner.startsWith('chat:') ? waiters.findIndex(item => !item.owner.startsWith('chat:')) : -1;
    if (firstBackground >= 0) waiters.splice(firstBackground, 0, waiter);
    else waiters.push(waiter);
    publish();
    if (owner.startsWith('chat:') && active?.phase === 'locking' && !active.owner.startsWith('chat:')) {
      active.preempted = true;
      active.lockController?.abort();
    }
    startNext();
  });
}

export async function withModelLease<T>(owner: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireModel(owner, signal);
  try { return await work(); }
  finally { release(); }
}
