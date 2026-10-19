/** File paths stored inside a workspace are relative to its selected root. */
export function workspacePathParts(path: string): string[] {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path))
    throw new TypeError('Workspace file paths must be relative to the selected folder.');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f]/.test(part)))
    throw new TypeError('Workspace file paths cannot contain empty, current, or parent directory segments.');
  return parts;
}

/** Names passed to a single File System Access handle cannot be paths. */
export function workspaceFileName(name: string): string {
  if (workspacePathParts(name).length !== 1)
    throw new TypeError('Workspace filenames cannot contain directory separators.');
  return name;
}
