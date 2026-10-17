import { catalogModelForPath } from './modelLicenses.ts';

export const BROWSER_ENGINE_CONTEXT_LIMIT = 32768;
export const MIN_BROWSER_CONTEXT = 1024;

export function browserContextLimit(path: string): number {
  return Math.max(MIN_BROWSER_CONTEXT, Math.min(BROWSER_ENGINE_CONTEXT_LIMIT, catalogModelForPath(path)?.contextTokens ?? BROWSER_ENGINE_CONTEXT_LIMIT));
}

export function browserContextWindow(path: string, requested: number): number {
  const value = Number.isFinite(requested) ? Math.floor(requested) : MIN_BROWSER_CONTEXT;
  return Math.min(browserContextLimit(path), Math.max(MIN_BROWSER_CONTEXT, value));
}
