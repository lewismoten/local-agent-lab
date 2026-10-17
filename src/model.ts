export type Format = 'Children’s book' | 'Children’s series' | 'Short story' | 'Novel' | 'Trilogy' | 'Series';
export type Stage = 'outline' | 'summary' | 'draft';
export type Entity = { id: string; updatedAt: string };
export type Character = Entity & {
  name: string; role: string; background: string; appearance: string;
  personality: string; arc: string; relationships: { characterId: string; description: string }[];
  imagePaths: string[];
};
export type WorldNote = Entity & { title: string; category: 'Place' | 'Culture' | 'History' | 'Rule' | 'Other'; details: string };
export type ContinuityIssue = { id: string; category: string; severity: 'high' | 'medium' | 'low'; summary: string; evidence: string; paths: string[]; question: string; status: 'open' | 'resolved' | 'dismissed'; resolution: string };
export type ContinuityReport = Entity & { title: string; checkedPaths: string[]; issues: ContinuityIssue[]; summary: string; model: string };
export type Influence = Entity & {
  title: string; medium: string; why: string; factualSummary: string;
  sourceUrl: string; avoid: string;
};
export type Source = Entity & { name: string; path: string; text: string; extracted: boolean; analysisStatus?: 'pending' | 'running' | 'ready' | 'error'; analysisError?: string };
export type ProposalStatus = 'proposed' | 'accepted' | 'dismissed';
export type StoryUnit = { id: string; sourceId: string; kind: 'book' | 'part' | 'story' | 'chapter' | 'outline' | 'theme'; title: string; parentId?: string; ordinal?: number; evidence: string; status: ProposalStatus; stale?: boolean };
export type StoryArc = { id: string; sourceId: string; title: string; unitId?: string; startUnitId?: string; endUnitId?: string; evidence: string; status: ProposalStatus; stale?: boolean };
export type StoryMention = { id: string; sourceId: string; kind: 'character' | 'place'; name: string; entityKey: string; unitId?: string; characterId?: string; age?: string; health?: string; location?: string; timeframe?: string; evidence: string; status: ProposalStatus; stale?: boolean };
export type StoryEvent = { id: string; sourceId: string; title: string; unitId?: string; timeframe?: string; location?: string; characterNames: string[]; evidence: string; status: ProposalStatus; stale?: boolean };
export type StorySuggestion = { id: string; sourceId?: string; title: string; detail: string; category: WorldNote['category']; evidence?: string; status: ProposalStatus };
export type StoryGraph = { units: StoryUnit[]; arcs: StoryArc[]; mentions: StoryMention[]; events: StoryEvent[]; suggestions: StorySuggestion[] };
export const emptyStoryGraph = (): StoryGraph => ({ units: [], arcs: [], mentions: [], events: [], suggestions: [] });
export function acceptSourceFindings(graph: StoryGraph, sourceId: string): StoryGraph {
  const shouldAccept = (item: { sourceId: string; status: ProposalStatus; stale?: boolean }) => item.sourceId === sourceId && item.status === 'proposed' && !item.stale;
  return {
    ...graph,
    units: graph.units.map(item => shouldAccept(item) ? { ...item, status: 'accepted' as const } : item),
    arcs: graph.arcs.map(item => shouldAccept(item) ? { ...item, status: 'accepted' as const } : item),
    mentions: graph.mentions.map(item => shouldAccept(item) ? { ...item, status: 'accepted' as const } : item),
    events: graph.events.map(item => shouldAccept(item) ? { ...item, status: 'accepted' as const } : item),
  };
}
export type Chapter = Entity & {
  number: number; title: string; outline: string; summary: string; draft: string;
  review: Stage[];
};
export type Book = Entity & {
  title: string; position: number; premise: string; referenceBookIds: string[]; sourceIds: string[];
  chapters: Chapter[];
};
export type Project = {
  schemaVersion: 1; id: string; title: string; format: Format; premise: string;
  audience: string; readingLevel: string; genres: string[]; tone: string;
  themes: string; boundaries: string; updatedAt: string;
  characters: Character[]; world: WorldNote[]; influences: Influence[];
  sources: Source[]; books: Book[]; reviews: ContinuityReport[]; storyGraph: StoryGraph;
};
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const makeChapter = (number: number): Chapter => ({
  id: uid(), updatedAt: now(), number, title: `Chapter ${number}`,
  outline: '', summary: '', draft: '', review: [],
});
export const makeBook = (position: number, title = `Book ${position}`): Book => ({
  id: uid(), updatedAt: now(), title, position, premise: '', referenceBookIds: [], sourceIds: [],
  chapters: [makeChapter(1)],
});
export const newProject = (): Project => ({
  schemaVersion: 1, id: uid(), title: 'Rivers of Memory', format: 'Trilogy',
  premise: '', audience: 'Adult', readingLevel: 'General', genres: [],
  tone: '', themes: '', boundaries: '', updatedAt: now(),
  characters: [], world: [], influences: [], sources: [], reviews: [], storyGraph: emptyStoryGraph(),
  books: [makeBook(1), makeBook(2), makeBook(3)],
});
export function markChapters(book: Book, stages: Stage[]): Book {
  return { ...book, chapters: book.chapters.map(ch => ({
    ...ch, review: [...new Set([...ch.review, ...stages])] as Stage[],
  })) };
}
export function markAllBooks(project: Project, stages: Stage[]): Project {
  return { ...project, books: project.books.map(book => markChapters(book, stages)) };
}
const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
const acceptedGraph = (graph?: StoryGraph) => graph ? [graph.units, graph.arcs, graph.mentions, graph.events].map(items => items.filter(x => x.status === 'accepted')) : [];
export function reconcileChanges(previous: Project, next: Project): Project {
  if (previous.id !== next.id) return next;
  const globalChanged = changed(
    [previous.title, previous.format, previous.premise, previous.audience, previous.readingLevel, previous.genres, previous.tone, previous.themes, previous.boundaries, previous.characters, previous.world, previous.influences, previous.sources.map(x => [x.id, x.name, x.path, x.text]), acceptedGraph(previous.storyGraph)],
    [next.title, next.format, next.premise, next.audience, next.readingLevel, next.genres, next.tone, next.themes, next.boundaries, next.characters, next.world, next.influences, next.sources.map(x => [x.id, x.name, x.path, x.text]), acceptedGraph(next.storyGraph)],
  );
  if (globalChanged) next = markAllBooks(next, ['outline', 'summary', 'draft']);
  const changedBooks = new Set<string>();
  next = { ...next, books: next.books.map(book => {
    const old = previous.books.find(b => b.id === book.id);
    if (!old) return book;
    if (changed([old.title, old.position, old.premise, old.referenceBookIds, old.sourceIds], [book.title, book.position, book.premise, book.referenceBookIds, book.sourceIds])) {
      changedBooks.add(book.id);
      return markChapters(book, ['outline', 'summary', 'draft']);
    }
    const chapters = book.chapters.map(ch => {
      const before = old.chapters.find(x => x.id === ch.id);
      if (!before) { changedBooks.add(book.id); return ch; }
      if (changed([before.title, before.outline], [ch.title, ch.outline])) {
        changedBooks.add(book.id);
        return { ...ch, review: [...new Set([...ch.review, 'summary', 'draft'])] as Stage[] };
      }
      if (before.summary !== ch.summary) {
        changedBooks.add(book.id);
        return { ...ch, review: [...new Set([...ch.review, 'draft'])] as Stage[] };
      }
      if (before.draft !== ch.draft) changedBooks.add(book.id);
      return ch;
    });
    if (changed(old.chapters.map(ch => ch.id), book.chapters.map(ch => ch.id))) changedBooks.add(book.id);
    return { ...book, chapters };
  }) };
  if (changedBooks.size) next = { ...next, books: next.books.map(book =>
    book.referenceBookIds.some(id => changedBooks.has(id)) ? markChapters(book, ['outline', 'summary', 'draft']) : book,
  ) };
  return next;
}
export function projectFiles(project: Project): Record<string, string> {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  const files: Record<string, string> = {
    'project.json': json({
      schemaVersion: project.schemaVersion, id: project.id, title: project.title,
      format: project.format, premise: project.premise, audience: project.audience,
      readingLevel: project.readingLevel, genres: project.genres, tone: project.tone,
      themes: project.themes, boundaries: project.boundaries, updatedAt: project.updatedAt,
      bookIds: project.books.map(x => x.id),
    }),
  };
  files['world/story-graph.json'] = json(project.storyGraph || emptyStoryGraph());
  project.characters.forEach(x => files[`world/characters/${x.id}.json`] = json(x));
  project.world.forEach(x => files[`world/notes/${x.id}.json`] = json(x));
  (project.reviews || []).forEach(x => files[`world/reviews/${x.id}.json`] = json(x));
  project.influences.forEach(x => files[`world/influences/${x.id}.json`] = json(x));
  project.sources.forEach(x => files[`sources/${x.id}.json`] = json(x));
  project.books.forEach(book => {
    files[`books/${book.id}/book.json`] = json({
      id: book.id, updatedAt: book.updatedAt, title: book.title,
      position: book.position, premise: book.premise,
      referenceBookIds: book.referenceBookIds, sourceIds: book.sourceIds,
      chapterIds: book.chapters.map(x => x.id),
    });
    book.chapters.forEach(ch => {
      files[`books/${book.id}/chapters/${ch.id}.json`] = json(ch);
    });
  });
  return files;
}
export function parseProjectFiles(files: Record<string, string>): Project {
  const meta = JSON.parse(files['project.json'] || '{}');
  if (meta.schemaVersion !== 1 || typeof meta.title !== 'string') throw new Error('This folder needs a valid version 1 project.json.');
  const values = <T,>(prefix: string): T[] => Object.entries(files)
    .filter(([path]) => path.startsWith(prefix) && path.endsWith('.json'))
    .map(([, value]) => JSON.parse(value) as T);
  const characters = values<Character>('world/characters/');
  const world = values<WorldNote>('world/notes/');
  const reviews = values<ContinuityReport>('world/reviews/');
  const storyGraph = files['world/story-graph.json'] ? JSON.parse(files['world/story-graph.json']) as StoryGraph : emptyStoryGraph();
  const influences = values<Influence>('world/influences/');
  const sources = values<Source>('sources/');
  const books = Object.entries(files).filter(([path]) => /^books\/[^/]+\/book\.json$/.test(path))
    .map(([, value]) => JSON.parse(value) as Book & { chapterIds?: string[] })
    .map(book => ({
      ...book, sourceIds: book.sourceIds || [],
      chapters: (book as Book & { chapterIds?: string[] }).chapterIds?.map(id => {
        const text = files[`books/${book.id}/chapters/${id}.json`];
        if (!text) throw new Error(`Missing chapter ${id} in ${book.title}.`);
        return JSON.parse(text) as Chapter;
      }) || [],
    }));
  return {
    ...meta, genres: meta.genres || [], characters, world, influences,
    sources, reviews, storyGraph, books: books.sort((a, b) => a.position - b.position),
  } as Project;
}
