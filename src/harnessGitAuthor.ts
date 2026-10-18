import { readBlob, writeBlob } from './storage.ts';

const AUTHOR_PATH = 'harness/git-author.json';

export type GitAuthor = { name: string; email: string };

/** Author defaults belong to the active workspace, so a USB drive carries them. */
export async function readGitAuthor(folder: FileSystemDirectoryHandle): Promise<GitAuthor | null> {
  let file: Blob;
  try { file = await readBlob(folder, AUTHOR_PATH); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
  const saved = JSON.parse(await file.text()) as Record<string, unknown>;
  if (saved?.version !== 1 || typeof saved.name !== 'string' || typeof saved.email !== 'string') return null;
  return { name: saved.name.slice(0, 160), email: saved.email.slice(0, 254) };
}

export async function saveGitAuthor(folder: FileSystemDirectoryHandle, author: GitAuthor): Promise<void> {
  const name = author.name.trim(), email = author.email.trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter an author name and email.');
  await writeBlob(folder, AUTHOR_PATH, new Blob([JSON.stringify({ version: 1, name, email })], { type: 'application/json' }));
}
