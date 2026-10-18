export type VisualRuntimeFailure = 'gpu-lost' | 'out-of-memory' | null;

function failureText(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;
  if (cause && typeof cause === 'object') {
    const value = cause as { name?: unknown; message?: unknown };
    return `${typeof value.name === 'string' ? value.name : ''}: ${typeof value.message === 'string' ? value.message : ''}`;
  }
  return String(cause);
}

export function visualRuntimeFailure(cause: unknown): VisualRuntimeFailure {
  const message = failureText(cause);
  if (/GPUOutOfMemoryError|\b(?:out of memory|memory allocation failed|failed to allocate|std::bad_alloc)\b/i.test(message)) return 'out-of-memory';
  if (/GPUDeviceLost|\b(?:gpu|device|context)\b.{0,24}\b(?:lost|removed|reset)\b/i.test(message)) return 'gpu-lost';
  if (cause instanceof Error && cause.cause && cause.cause !== cause) return visualRuntimeFailure(cause.cause);
  return null;
}

export function visualRuntimeFailureMessage(cause: unknown): string {
  switch (visualRuntimeFailure(cause)) {
    case 'gpu-lost': return 'The browser lost its GPU device. Retry, or restart this tab if it persists.';
    case 'out-of-memory': return 'The browser ran out of memory. Close other tabs or try a smaller model.';
    default: return cause instanceof Error ? cause.message : failureText(cause);
  }
}
