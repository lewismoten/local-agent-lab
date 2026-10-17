export type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' };

let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const notify = () => listeners.forEach(listener => listener());
function scheduleVisibleToasts() {
  for (const toast of toasts.slice(0, 4)) {
    if (timers.has(toast.id)) continue;
    const timer = setTimeout(() => dismissToast(toast.id), 6500) as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
    timers.set(toast.id, timer);
  }
}

export const getToasts = () => toasts;
export const subscribeToasts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter(toast => toast.id !== id);
  notify();
  scheduleVisibleToasts();
}
export function showToast(message: string, kind: Toast['kind'] = 'success') {
  const toast = { id: ++nextId, message, kind };
  toasts = [...toasts, toast];
  notify();
  scheduleVisibleToasts();
  return toast.id;
}
export function showCompletionToast(message: string, startedAt: number, minimumMs = 2000) {
  if (performance.now() - startedAt >= minimumMs) showToast(message);
}
