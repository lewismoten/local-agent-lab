/** Preserve visible browser output without presenting it as a finished answer. */
export function interruptedResponseContent(visibleText: string, stopped: boolean): string | null {
  if (!visibleText.trim()) return null;
  const note = stopped ? 'Stopped response' : 'Failed response';
  return `[${note} — incomplete and unverified]\n\n${visibleText}`;
}
