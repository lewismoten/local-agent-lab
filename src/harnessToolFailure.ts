export function toolFailureMessage(error: unknown, completedChanges: string[]): string {
  const detail = error instanceof Error ? error.message : String(error);
  const changes = completedChanges.length ? ` Completed changes: ${completedChanges.slice(-4).join(' | ')}` : '';
  return `A tool may have changed project files before the model failed: ${detail}.${changes}`;
}
