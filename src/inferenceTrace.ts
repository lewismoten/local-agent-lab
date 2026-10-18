/** Snapshot the JSON payload actually sent to an inference runtime before tool rounds mutate it. */
export function snapshotInference<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
