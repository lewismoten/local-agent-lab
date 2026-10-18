/** A small, read-only shell vocabulary for models trained to ask for a terminal. */
export type ShellReadCall = { name: 'pwd' | 'ls' | 'cat'; path: string };

export function parseReadOnlyShell(command: string): ShellReadCall {
  const input = command.trim();
  if (!input || input.length > 500 || /[\n\r\0;&|`$<>\\*?{}[\]]/.test(input)) {
    throw new Error('Only one read-only pwd, ls, or cat command is supported.');
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
  throw new Error('Only pwd, ls, and cat are available in this read-only project shell.');
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
  const body = block[1].replace(/(?:\s*<\/(?:ls|cat|pwd)>)+\s*$/gi, '').trim();
  const tag = body.match(/^<(pwd|ls|cat)(?:\s+([^<>]*?))?\s*\/?>$/i);
  if (tag) return `${tag[1].toLowerCase()}${tag[2] ? ` ${tag[2].trim()}` : ''}`;
  if (/^(pwd|ls|cat)(?:\s+[^<>]*)?$/i.test(body)) return body;
  return '';
}
