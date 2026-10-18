/** A small, read-only shell vocabulary for models trained to ask for a terminal. */
export type ShellReadCall = { name: 'pwd' | 'ls' | 'cat'; path: string } | { name: 'rg'; path: string; query: string };
export const SHELL_READ_COMMANDS = [
  { name: 'shell_pwd', label: 'pwd', description: 'Show the project Files root as /workspace.' },
  { name: 'shell_ls', label: 'ls', description: 'List one project folder, up to 200 entries.' },
  { name: 'shell_cat', label: 'cat', description: 'Read up to 12 KB from one text file.' },
  { name: 'shell_rg', label: 'rg', description: 'Search project text files for a literal phrase, within file and result limits.' },
] as const;
export function shellCommandPermission(name: ShellReadCall['name']): string { return `shell_${name}`; }

export function parseReadOnlyShell(command: string): ShellReadCall {
  const input = command.trim();
  if (!input || input.length > 500 || /[\n\r\0;&|`$<>\\*?{}[\]]/.test(input)) {
    throw new Error('Only one read-only pwd, ls, cat, or rg command is supported.');
  }
  const words = input.split(/\s+/);
  const name = words.shift();
  if (name === 'pwd') {
    if (words.length) throw new Error('pwd takes no arguments.');
    return { name, path: '' };
  }
  if (name === 'ls') {
    const paths = words.filter(word => !word.startsWith('-'));
    if (words.some(word => word.startsWith('-') && !/^-[al]+$/.test(word)) || paths.length > 1) throw new Error('ls supports only -a, -l, and one folder.');
    return { name, path: scopedPath(paths[0] || '/workspace') };
  }
  if (name === 'cat') {
    if (words.length !== 1) throw new Error('cat requires one text file.');
    const path = scopedPath(words[0]);
    if (!path) throw new Error('cat requires a file path.');
    return { name, path };
  }
  if (name === 'rg') {
    const match = input.match(/^rg\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?:\s+(\S+))?$/);
    const query = match?.[1] || match?.[2] || match?.[3] || '';
    if (!match || query.startsWith('-') || query.length < 2 || query.length > 200) throw new Error('rg needs one literal phrase of 2–200 characters and an optional folder.');
    return { name, query, path: scopedPath(match[4] || '/workspace') };
  }
  throw new Error('Only pwd, ls, cat, and rg are available in this read-only project shell.');
}

function scopedPath(value: string): string {
  const normalized = value.replace(/\/$/, '');
  if (normalized === '/workspace' || normalized === '') return '';
  const relative = normalized.startsWith('/workspace/') ? normalized.slice('/workspace/'.length) : normalized;
  if (relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Shell paths must stay inside /workspace.');
  }
  return relative;
}

/** Recognize only an explicit tool-call block, never commands in ordinary prose. */
export function pseudoShellCommand(text: string): string | null {
  const trimmed = text.trim();
  const block = trimmed.match(/^<tool_calls>\s*([\s\S]*?)\s*(?:<\/tool_calls>)?$/i);
  if (!block) return null;
  const body = block[1].replace(/(?:\s*<\/(?:ls|cat|pwd|rg)>)+\s*$/gi, '').trim();
  const tag = body.match(/^<(pwd|ls|cat|rg)(?:\s+([^<>]*?))?\s*\/?>$/i);
  if (tag) return `${tag[1].toLowerCase()}${tag[2] ? ` ${tag[2].trim()}` : ''}`;
  if (/^(pwd|ls|cat|rg)(?:\s+[^<>]*)?$/i.test(body)) return body;
  return '';
}
