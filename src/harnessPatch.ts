type Hunk = { oldStart: number; before: string[]; after: string[] };

/** Apply a single-file unified diff. File paths are supplied separately by the caller. */
export function applyUnifiedPatch(original: string, patch: string): string {
  if (!patch || patch.length > 120_000) throw new Error('Provide a unified patch under 120 KB.');
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hunks: Hunk[] = [];
  let index = 0;
  if (lines[index]?.startsWith('--- ')) {
    if (!lines[index + 1]?.startsWith('+++ ')) throw new Error('The unified patch needs both file header lines.');
    index += 2;
  }
  while (index < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[index]);
    if (!header) throw new Error(`Invalid patch hunk at line ${index + 1}. Use a single-file unified diff.`);
    if (hunks.length >= 16) throw new Error('A patch may contain at most 16 hunks.');
    const oldStart = Number(header[1]);
    const oldCount = Number(header[2] ?? 1);
    const newCount = Number(header[4] ?? 1);
    if (!Number.isSafeInteger(oldStart) || !Number.isSafeInteger(oldCount) || !Number.isSafeInteger(newCount) || oldCount > 20_000 || newCount > 20_000) throw new Error('Invalid patch line counts.');
    index++;
    const before: string[] = [], after: string[] = [];
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++];
      if (line.startsWith('\\ No newline')) throw new Error('No-newline markers are not supported in this patch.');
      const prefix = line[0], value = line.slice(1);
      if (prefix === ' ' || prefix === '-') before.push(value);
      if (prefix === ' ' || prefix === '+') after.push(value);
      if (prefix !== ' ' && prefix !== '-' && prefix !== '+') throw new Error(`Invalid patch line ${index}.`);
    }
    if (before.length !== oldCount || after.length !== newCount) throw new Error('Patch hunk line counts do not match its header.');
    if (!before.length) throw new Error('Patch insertions need an unchanged context line so their location is clear.');
    if (before.join('\n') === after.join('\n')) throw new Error('Patch hunk has no change.');
    hunks.push({ oldStart, before, after });
  }
  if (!hunks.length) throw new Error('The patch contains no hunks.');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const source = original.split(/\r?\n/);
  const result: string[] = [];
  let cursor = 0;
  const matchesAt = (at: number, before: string[]) => at >= cursor && at + before.length <= source.length && before.every((line, offset) => source[at + offset] === line);
  for (const hunk of hunks) {
    const expected = hunk.oldStart - 1;
    let at = matchesAt(expected, hunk.before) ? expected : -1;
    if (at < 0) {
      const matches: number[] = [];
      for (let candidate = cursor; candidate <= source.length - hunk.before.length; candidate++) {
        if (matchesAt(candidate, hunk.before)) matches.push(candidate);
        if (matches.length > 1) break;
      }
      if (matches.length !== 1) throw new Error(matches.length ? 'Patch context occurs more than once. Add more unchanged lines.' : 'Patch context no longer matches the file. Read it again.');
      at = matches[0];
    }
    result.push(...source.slice(cursor, at), ...hunk.after);
    cursor = at + hunk.before.length;
  }
  result.push(...source.slice(cursor));
  return result.join(newline);
}
