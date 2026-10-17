// Model switches share one queue so two large browser runtimes cannot load at once.
// An image generation holds its turn until inference finishes, preventing another
// model load from disposing its pipeline mid-generation.
let tail: Promise<void> = Promise.resolve();

export function withLocalModelMemory<T>(work: () => Promise<T>): Promise<T> {
  const current = tail.then(work);
  tail = current.then(() => {}, () => {});
  return current;
}
