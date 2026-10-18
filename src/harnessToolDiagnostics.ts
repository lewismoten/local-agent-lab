const MAX_ARGUMENTS = 1600;
const PRIVATE_FIELD = /(?:api[_-]?key|secret|password|token|authorization|credential)/i;

function preview(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested value]';
  if (typeof value === 'string') return value.length > MAX_ARGUMENTS ? `${value.slice(0, MAX_ARGUMENTS)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => preview(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, PRIVATE_FIELD.test(key) ? '[redacted]' : preview(item, depth + 1)]));
  }
  return value;
}

/** Saved beside the answer so malformed calls can be diagnosed after a session. */
export function unsupportedToolDiagnostic(name: unknown, argumentsValue: unknown): string {
  let args: unknown = argumentsValue;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { /* Keep malformed arguments as a bounded string. */ }
  }
  let serialized: string;
  try { serialized = JSON.stringify(preview(args)) ?? String(args); }
  catch { serialized = '[unserializable arguments]'; }
  const tool = String(name || '(missing name)').replace(/[\x00-\x1f]/g, ' ').slice(0, 100);
  return `Unsupported tool request: ${tool} · arguments ${serialized.length > MAX_ARGUMENTS ? `${serialized.slice(0, MAX_ARGUMENTS)}…` : serialized}`;
}
