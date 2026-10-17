import type { Project } from './model';

export type ChatMessage = {
  id: string; role: 'user' | 'assistant' | 'tool'; content: string;
  createdAt: string; provider?: string; model?: string; imagePath?: string;
  inputTokens?: number; outputTokens?: number;
};
export type ChatMode = 'chat' | 'interview' | 'freewrite' | 'suggest' | 'checker';
export type MemoryShard = { id: string; title: string; text: string; keywords: string[]; archiveId: string };
export type ArchiveMeta = { id: string; createdAt: string; messageCount: number; summary: string };
export type ChatThread = {
  projectId: string; updatedAt: string; messages: ChatMessage[]; activeFrom: number;
  summary: string; memories: MemoryShard[]; archives: ArchiveMeta[]; pinnedIds: string[];
  mode?: ChatMode; interviewQuestion?: string;
};
export type ChatArchive = {
  id: string; projectId: string; createdAt: string; messages: ChatMessage[];
  summaryBefore: string; summaryAfter: string;
};
export const emptyThread = (project: Project): ChatThread => ({
  projectId: project.id, updatedAt: new Date().toISOString(), messages: [],
  activeFrom: 0, summary: '', memories: [], archives: [], pinnedIds: [], mode: 'chat', interviewQuestion: '',
});
const DB = 'rivers-story-chat';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('threads');
      request.result.createObjectStore('archives');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function get<T>(store: string, key: string): Promise<T | null> {
  const db = await database();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function put<T>(store: string, key: string, value: T): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const loadThread = (projectId: string) => get<ChatThread>('threads', projectId);
export const saveThread = (thread: ChatThread) => put('threads', thread.projectId, thread);
export const loadArchive = (id: string) => get<ChatArchive>('archives', id);
export const saveArchive = (archive: ChatArchive) => put('archives', archive.id, archive);

export const estimatedTokens = (text: string) => Math.ceil(text.length / 4);
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) || []))];
export function relevantMemories(shards: MemoryShard[], query: string, limit = 3): MemoryShard[] {
  const words = terms(query);
  return shards.map(shard => {
    const haystack = (shard.title + ' ' + shard.keywords.join(' ') + ' ' + shard.text).toLowerCase();
    return { shard, score: words.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0) };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.shard);
}
export function projectContext(project: Project): string {
  return JSON.stringify({
    title: project.title, format: project.format, premise: project.premise,
    audience: project.audience, readingLevel: project.readingLevel, genres: project.genres,
    tone: project.tone, themes: project.themes, boundaries: project.boundaries,
    characters: project.characters.map(c => ({ name: c.name, role: c.role, background: c.background, appearance: c.appearance, relationships: c.relationships })),
    world: project.world.map(w => ({ title: w.title, details: w.details })),
    books: project.books.map(b => ({ title: b.title, position: b.position, premise: b.premise, chapters: b.chapters.map(ch => ({ title: ch.title, summary: ch.summary || ch.outline })) })),
    storyMap: { units: project.storyGraph?.units.filter(x => x.status === 'accepted').map(x => ({ kind: x.kind, title: x.title, parentId: x.parentId })), arcs: project.storyGraph?.arcs.filter(x => x.status === 'accepted').map(x => ({ title: x.title, startUnitId: x.startUnitId, endUnitId: x.endUnitId })), mentions: project.storyGraph?.mentions.filter(x => x.status === 'accepted').slice(0, 80).map(x => ({ name: x.name, kind: x.kind, unitId: x.unitId, age: x.age, health: x.health, timeframe: x.timeframe, location: x.location })) },
  }).slice(0, 14000);
}
export function searchProject(project: Project, query: string): { title: string; text: string }[] {
  const records = [
    ...project.sources.map(x => ({ title: 'Document: ' + x.name, text: x.text })),
    ...project.characters.map(x => ({ title: 'Character: ' + x.name, text: JSON.stringify(x) })),
    ...project.world.map(x => ({ title: 'World: ' + x.title, text: x.details })),
    ...project.influences.map(x => ({ title: 'Influence: ' + x.title, text: JSON.stringify(x) })),
    ...project.books.flatMap(book => [
      { title: 'Book: ' + book.title, text: book.premise },
      ...book.chapters.map(ch => ({ title: book.title + ' / ' + ch.title, text: [ch.outline, ch.summary, ch.draft].filter(Boolean).join('\n\n') })),
    ]),
  ];
  const words = terms(query);
  return records.map(record => {
    const title = record.title.toLowerCase(), searchableText = record.text.toLowerCase();
    const score = words.reduce((n, word) => n + (title.includes(word) ? 4 : 0) + (searchableText.includes(word) ? 1 : 0), 0);
    return { ...record, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    .map(({ title, text }) => ({ title, text: text.slice(0, 9000) }));
}
