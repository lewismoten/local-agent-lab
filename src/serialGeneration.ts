// A browser engine instance can run only one generation at a time. Keep the
// reservation until its async iterator has fully closed, including on errors.
let tail: Promise<void> = Promise.resolve();

export function runSerialGeneration<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const turn = tail.then(async () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Generation stopped.', 'AbortError');
    return work();
  });
  tail = turn.then(() => {}, () => {});
  return turn;
}

export function waitForSerialGeneration(): Promise<void> { return tail; }
