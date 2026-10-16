import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, CircleHelp, CloudUpload, Download, FileText, FolderOpen, Globe2, Layers3, LibraryBig, Plus, RefreshCw, Settings2, Sparkles, Trash2, Users, WandSparkles, X } from 'lucide-react';
import { generate, generateImage, parseJson, type AIConfig } from './ai';
import { extractText } from './extract';
import { makeBook, makeChapter, markAllBooks, markChapters, newProject, now, reconcileChanges, uid, type Book, type Chapter, type Character, type Format, type Influence, type Project, type Source, type Stage, type WorldNote } from './model';
import { downloadProject, loadCache, loadHandle, readBlob, readProject, saveCache, saveHandle, writeBlob, writeProject } from './storage';

type View = 'overview' | 'books' | 'characters' | 'world' | 'sources' | 'influences' | 'settings';
const formats: Format[] = ['Children’s book', 'Children’s series', 'Short story', 'Novel', 'Trilogy', 'Series'];
const stages: { id: Stage; label: string; help: string }[] = [
  { id: 'outline', label: 'Outline', help: 'The chapter’s beats and turning points' },
  { id: 'summary', label: 'Summary', help: 'A scene-by-scene account of what happens' },
  { id: 'draft', label: 'Full text', help: 'The prose of the chapter' },
];
const icons = { overview: Layers3, books: BookOpen, characters: Users, world: Globe2, sources: FileText, influences: LibraryBig, settings: Settings2 };
const labels = { overview: 'Overview', books: 'Books & chapters', characters: 'Characters', world: 'World bible', sources: 'Source documents', influences: 'Influences', settings: 'Settings & AI' };
const blankCharacter = (): Character => ({ id: uid(), updatedAt: now(), name: 'New character', role: '', background: '', appearance: '', personality: '', arc: '', relationships: [], imagePaths: [] });
const blankWorld = (): WorldNote => ({ id: uid(), updatedAt: now(), title: 'New world note', category: 'Place', details: '' });
const blankInfluence = (): Influence => ({ id: uid(), updatedAt: now(), title: 'New influence', medium: 'Book', why: '', factualSummary: '', sourceUrl: '', avoid: '' });
const excerpt = (text: string, n = 150) => text.length > n ? text.slice(0, n).trim() + '…' : text;

function Field({ label, value, onChange, multiline = false, placeholder = '', rows = 4 }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; rows?: number }) {
  return <label className="field"><span>{label}</span>{multiline
    ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
    : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}</label>;
}
function Empty({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon"><BookOpen size={25} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => loadCache() || newProject());
  const [view, setView] = useState<View>('overview');
  const [selectedBook, setSelectedBook] = useState('');
  const [selectedChapter, setSelectedChapter] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [selectedWorld, setSelectedWorld] = useState('');
  const [selectedInfluence, setSelectedInfluence] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<AIConfig>(() => ({
    provider: (localStorage.getItem('ai-provider') as AIConfig['provider']) || 'ollama',
    model: localStorage.getItem('ai-model') || 'llama3.2',
    endpoint: localStorage.getItem('ai-endpoint') || 'http://localhost:11434',
    apiKey: '',
  }));
  const [showHelp, setShowHelp] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => { saveCache(project); }, [project]);
  useEffect(() => {
    loadHandle().then(handle => {
      if (handle) { setFolder(handle); setFolderName(handle.name); }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem('ai-provider', config.provider);
    localStorage.setItem('ai-model', config.model);
    localStorage.setItem('ai-endpoint', config.endpoint);
  }, [config.provider, config.model, config.endpoint]);
  useEffect(() => {
    if (!folder) return;
    const paths = project.characters.flatMap(x => x.imagePaths);
    let active = true;
    Promise.all(paths.map(async path => {
      try { return [path, URL.createObjectURL(await readBlob(folder, path))] as const; }
      catch { return null; }
    })).then(entries => {
      if (!active) return;
      const next: Record<string, string> = {};
      entries.forEach(item => { if (item) next[item[0]] = item[1]; });
      setImageUrls(previous => { Object.values(previous).forEach(URL.revokeObjectURL); return next; });
    });
    return () => { active = false; };
  }, [folder, project.characters]);

  const update = (fn: (p: Project) => Project) => {
    setProject(previous => ({ ...reconcileChanges(previous, fn(previous)), updatedAt: now() }));
    setDirty(true);
  };
  const flash = (message: string) => { setNotice(message); setTimeout(() => setNotice(''), 5000); };
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (error) { flash(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };
  const askAI = (name: string, prompt: string, apply: (text: string) => void) => act(name, async () => {
    const text = await generate(config, prompt);
    apply(text);
    flash('AI suggestion added. Review and edit it before continuing.');
  });
  const canon = (book?: Book) => JSON.stringify({
    project: { title: project.title, format: project.format, premise: project.premise, audience: project.audience, readingLevel: project.readingLevel, genres: project.genres, tone: project.tone, themes: project.themes, boundaries: project.boundaries },
    characters: project.characters.map(({ name, role, background, appearance, personality, arc, relationships }) => ({ name, role, background, appearance, personality, arc, relationships })),
    world: project.world.map(({ title, category, details }) => ({ title, category, details })),
    influences: project.influences.map(({ title, why, factualSummary, avoid }) => ({ title, why, factualSummary, avoid })),
    sources: project.sources.map(({ id, name, text }) => ({
      name, excerpt: text.slice(0, book?.sourceIds?.includes(id) ? 25000 : 1200),
    })),
    referenceBooks: book?.referenceBookIds.map(id => project.books.find(x => x.id === id)).filter(Boolean).map(x => ({ title: x!.title, premise: x!.premise, chapters: x!.chapters.map(ch => ({ title: ch.title, summary: ch.summary || ch.outline })) })),
    currentBook: book && { title: book.title, position: book.position, premise: book.premise, chapters: book.chapters.map(ch => ({ number: ch.number, title: ch.title, outline: ch.outline, summary: ch.summary })) },
  }).slice(0, 40000);
  const patchBook = (id: string, fn: (b: Book) => Book) => update(p => ({ ...p, books: p.books.map(b => b.id === id ? { ...fn(b), updatedAt: now() } : b) }));
  const patchChapter = (bookId: string, chapterId: string, fn: (ch: Chapter) => Chapter) => patchBook(bookId, b => ({ ...b, chapters: b.chapters.map(ch => ch.id === chapterId ? { ...fn(ch), updatedAt: now() } : ch) }));
  const connected = !!folder;
  const currentBook = project.books.find(x => x.id === selectedBook) || project.books[0];
  const currentChapter = currentBook?.chapters.find(x => x.id === selectedChapter) || currentBook?.chapters[0];
  const currentCharacter = project.characters.find(x => x.id === selectedCharacter) || project.characters[0];
  const currentWorld = project.world.find(x => x.id === selectedWorld) || project.world[0];
  const currentInfluence = project.influences.find(x => x.id === selectedInfluence) || project.influences[0];
  const currentSource = project.sources.find(x => x.id === selectedSource) || project.sources[0];
  const totalChapters = project.books.reduce((n, b) => n + b.chapters.length, 0);
  const reviewCount = project.books.reduce((n, b) => n + b.chapters.filter(ch => ch.review.length).length, 0);

  async function connectFolder() {
    if (!window.showDirectoryPicker) throw new Error('Folder access needs a current Chromium browser on HTTPS or localhost.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    let loaded: Project | null = null;
    let exists = true;
    try { await handle.getFileHandle('project.json'); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') exists = false; else throw error; }
    if (exists) loaded = await readProject(handle);
    if (loaded) { const revised = reconcileChanges(projectRef.current, loaded); setProject(revised); setDirty(JSON.stringify(revised) !== JSON.stringify(loaded)); flash('Existing story project loaded from folder.'); }
    else { await writeProject(handle, projectRef.current); setDirty(false); flash('Story files created in the selected folder.'); }
    await saveHandle(handle);
    setFolder(handle); setFolderName(handle.name);
  }
  async function syncFolder() {
    if (!folder) return;
    await writeProject(folder, projectRef.current);
    setDirty(false); flash('All story JSON files saved to the folder.');
  }
  async function reloadFolder() {
    if (!folder) return;
    if (dirty && !window.confirm('Reload from the folder and discard unsaved browser edits?')) return;
    const loaded = await readProject(folder);
    const revised = reconcileChanges(projectRef.current, loaded);
    setProject(revised); setDirty(JSON.stringify(revised) !== JSON.stringify(loaded));
    flash('Reloaded changes from the folder. Downstream work is flagged if source files changed.');
  }
  async function importSnapshot(file: File) {
    const value = JSON.parse(await file.text()) as Project;
    if (value.schemaVersion !== 1 || !Array.isArray(value.books)) throw new Error('Choose a valid story-project.json export.');
    setProject(value); setDirty(true); flash('Project snapshot imported. Sync it to save separate files.');
  }
  async function uploadSources(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const text = await extractText(file);
      const id = uid();
      const path = `sources/originals/${id}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`;
      if (folder) await writeBlob(folder, path, file);
      const source: Source = { id, updatedAt: now(), name: file.name, path: folder ? path : '', text, extracted: false };
      update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), sources: [...p.sources, source] }));
      setSelectedSource(id);
    }
    flash(folder ? 'Documents imported; originals saved to the folder.' : 'Text imported. Connect a folder to preserve original files.');
  }
  async function uploadImages(files: FileList | null) {
    if (!files?.length || !currentCharacter) return;
    if (!folder) throw new Error('Connect a project folder before uploading reference images.');
    const paths: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) throw new Error('Choose image files.');
      const path = `assets/characters/${currentCharacter.id}/${uid()}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`;
      await writeBlob(folder, path, file); paths.push(path);
    }
    update(p => ({ ...p, characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, imagePaths: [...c.imagePaths, ...paths], updatedAt: now() } : c) }));
    flash('Reference images saved to the project folder.');
  }
  async function createReferenceImage() {
    if (!currentCharacter) return;
    if (!folder) throw new Error('Connect a project folder before generating reference images.');
    if (!currentCharacter.appearance.trim()) throw new Error('Describe the character’s appearance first.');
    const prompt = `Create an original, single-character visual reference portrait. Full color, clear face and clothing details, neutral unobtrusive background, no text, no copyrighted character likeness. Character: ${currentCharacter.name}. Role: ${currentCharacter.role}. Exact appearance instructions: ${currentCharacter.appearance}. Project audience: ${project.audience}. Keep this person visually consistent with these instructions.`;
    const blob = await generateImage(config, prompt);
    const path = `assets/characters/${currentCharacter.id}/${uid()}-generated.png`;
    await writeBlob(folder, path, blob);
    update(p => ({ ...p, characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, imagePaths: [...c.imagePaths, path], updatedAt: now() } : c) }));
    flash('Generated reference image saved. Review its details against the character profile.');
  }
  function addBook() {
    const book = makeBook(Math.max(0, ...project.books.map(b => b.position)) + 1);
    update(p => ({ ...p, books: [...p.books, book] })); setSelectedBook(book.id); setSelectedChapter(book.chapters[0].id); setView('books');
  }
  function generateBookOutline(book: Book) {
    if (book.chapters.some(ch => ch.outline || ch.summary || ch.draft) && !window.confirm('Replace this book’s existing chapters with a new outline?')) return;
    askAI('book-outline', `Create an original chapter outline for this book. Use the canon below, including any referenced later book if this is a prequel. Return ONLY a JSON array of 8 to 12 objects, each with "title" and "outline" strings. Each outline should describe major beats, a turn, and consequences. Do not copy influence plots.\n\nCANON:\n${canon(book)}`, text => {
      const proposed = parseJson<{ title: string; outline: string }[]>(text);
      if (!Array.isArray(proposed) || !proposed.every(x => typeof x.title === 'string' && typeof x.outline === 'string')) throw new Error('AI returned an invalid chapter outline.');
      patchBook(book.id, b => ({ ...b, chapters: proposed.map((x, i) => ({ ...makeChapter(i + 1), title: x.title, outline: x.outline, review: ['summary', 'draft'] })) }));
      setSelectedChapter('');
    });
  }
  function generateStage(book: Book, chapter: Chapter, stage: Stage) {
    const prior = book.chapters.filter(x => x.number < chapter.number).map(x => ({ title: x.title, summary: x.summary || x.outline }));
    const instruction = stage === 'outline'
      ? 'Write an original concise chapter outline with major beats, conflict, turn, and ending. Return prose, not JSON.'
      : stage === 'summary'
        ? 'Expand this chapter outline into a detailed scene-by-scene summary. Preserve continuity and describe what happens, without writing full prose. Return prose, not JSON.'
        : 'Write the complete original chapter prose based on the outline and summary. Respect reading level, audience, characterization, and continuity. Return only chapter text.';
    askAI(`chapter-${stage}`, `${instruction}\n\nCANON:\n${canon(book)}\n\nPRIOR CHAPTERS:\n${JSON.stringify(prior).slice(0, 14000)}\n\nTARGET CHAPTER:\n${JSON.stringify(chapter)}`, text => {
      patchChapter(book.id, chapter.id, ch => ({
        ...ch, [stage]: text,
        review: stage === 'outline' ? [...new Set([...ch.review.filter(x => x !== 'outline'), 'summary', 'draft'])] as Stage[]
          : stage === 'summary' ? [...new Set([...ch.review.filter(x => x !== 'summary'), 'draft'])] as Stage[]
            : ch.review.filter(x => x !== 'draft'),
      }));
    });
  }
  function extractWorld(source: Source) {
    askAI('extract-world', `Extract reusable worldbuilding facts from the document below. Return ONLY a JSON array of objects with "title", "category" (Place, Culture, History, Rule, or Other), and "details". Keep facts concise, avoid inventing anything, and omit plot-only details.\n\nDOCUMENT:\n${source.text.slice(0, 30000)}`, text => {
      const notes = parseJson<{ title: string; category: WorldNote['category']; details: string }[]>(text);
      if (!Array.isArray(notes) || !notes.every(x => typeof x.title === 'string' && typeof x.details === 'string')) throw new Error('AI returned invalid world notes.');
      update(p => ({
        ...markAllBooks(p, ['outline', 'summary', 'draft']),
        world: [...p.world, ...notes.map(x => ({ id: uid(), updatedAt: now(), ...x }))],
        sources: p.sources.map(s => s.id === source.id ? { ...s, extracted: true } : s),
      }));
    });
  }
  function generateCharacter() {
    askAI('character', `Create one original character appropriate for the project canon. Return ONLY a JSON object with strings "name", "role", "background", "appearance", "personality", and "arc". Appearance must be a precise reusable visual reference (age range, build, skin tone, hair, eyes, distinguishing features, clothing). Avoid stereotypes and copyrighted characters.\n\nCANON:\n${canon()}`, text => {
      const value = parseJson<Partial<Character>>(text);
      if (!value.name || !value.appearance) throw new Error('AI returned an incomplete character.');
      const character = { ...blankCharacter(), ...value, id: uid(), updatedAt: now(), relationships: [], imagePaths: [] };
      update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: [...p.characters, character] }));
      setSelectedCharacter(character.id);
    });
  }
  async function acquireInfluence(influence: Influence) {
    if (!influence.title.trim()) throw new Error('Enter a title first.');
    const search = new URL('https://en.wikipedia.org/w/api.php');
    search.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${influence.title} ${influence.medium}`, srlimit: '1', format: 'json', origin: '*' }).toString();
    const result = await (await fetch(search)).json();
    const page = result.query?.search?.[0];
    if (!page) throw new Error('No public encyclopedia result found. Enter a summary manually.');
    const summaryUrl = new URL('https://en.wikipedia.org/w/api.php');
    summaryUrl.search = new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '5', pageids: String(page.pageid), format: 'json', origin: '*' }).toString();
    const details = await (await fetch(summaryUrl)).json();
    const extract = details.query?.pages?.[page.pageid]?.extract;
    if (!extract) throw new Error('The source has no summary. Enter one manually.');
    const factualSummary = await generate(config, `Paraphrase these public reference facts into 2–3 plain sentences about what the source is broadly about. Do not copy phrases, scenes, character names beyond the source title, or stylistic elements. Return only the factual summary.\n\nTITLE: ${influence.title}\nSOURCE FACTS: ${extract.slice(0, 3000)}`);
    update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), influences: p.influences.map(x => x.id === influence.id ? { ...x, factualSummary, sourceUrl: `https://en.wikipedia.org/?curid=${page.pageid}`, updatedAt: now() } : x) }));
    flash('A paraphrased, source-linked overview was added. Review it for accuracy.');
  }
  const nav = (Object.keys(labels) as View[]);

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">R</div><div><strong>Rivers of Memory</strong><span>STORY STUDIO</span></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav>{nav.map(item => { const Icon = icons[item]; return <button key={item} className={view === item ? 'nav-item active' : 'nav-item'} onClick={() => setView(item)}><Icon size={18} /><span>{labels[item]}</span>{item === 'books' && reviewCount > 0 && <em>{reviewCount}</em>}</button>; })}</nav>
      <div className="sidebar-bottom">
        <div className="folder-card"><div className="folder-card-top"><FolderOpen size={18} /><strong>{connected ? folderName : 'Local workspace'}</strong></div><p>{connected ? (dirty ? 'Unsynced browser edits' : 'Folder connected') : 'Connect a folder to save separate JSON files and images.'}</p><button className="small-button" onClick={() => act('connect', connectFolder)}>{connected ? 'Change folder' : 'Connect folder'}</button>{connected && <button className="small-button ghost" onClick={() => act('sync', syncFolder)}>Sync files</button>}</div>
        <button className="help-link" onClick={() => setShowHelp(true)}><CircleHelp size={17} /> How this works</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">STORY STUDIO <ChevronRight size={14} /> {labels[view].toUpperCase()}</div><div className="top-actions"><span className={dirty ? 'save-state unsaved' : 'save-state'}><i />{dirty ? 'Changes to sync' : connected ? 'Folder in sync' : 'Saved in browser'}</span>{connected && <button className="button secondary compact" onClick={() => act('sync', syncFolder)} disabled={!!busy}><RefreshCw size={15} /> Sync folder</button>}</div></header>
      {view === 'overview' && <section className="page">
        <div className="page-heading"><div><div className="eyebrow">YOUR STORY UNIVERSE</div><h1>{project.title}</h1><p>A home for the people, places, and chapters that make up your world.</p></div><button className="button primary" onClick={() => setView('books')}><BookOpen size={17} /> Continue writing</button></div>
        <div className="hero"><div><span className="hero-kicker">THE WRITING DESK</span><h2>Every great story<br/><em>starts somewhere.</em></h2><p>Shape the world. Build the arc. Write one chapter at a time.</p><button onClick={() => setView('settings')}>Set up your story <ChevronRight size={16}/></button></div><div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="book-illustration"><div className="book-line"/><div className="book-line short"/><div className="book-line"/><div className="book-line half"/></div></div></div>
        <div className="stats"><div><span>BOOKS PLANNED</span><strong>{project.books.length.toString().padStart(2, '0')}</strong></div><div><span>CHAPTERS</span><strong>{totalChapters.toString().padStart(2, '0')}</strong></div><div><span>CHARACTERS</span><strong>{project.characters.length.toString().padStart(2, '0')}</strong></div><div><span>NEED REVIEW</span><strong>{reviewCount.toString().padStart(2, '0')}</strong></div></div>
        <div className="section-row"><h2>Your books</h2><button className="text-button" onClick={addBook}><Plus size={17}/> Add book</button></div>
        <div className="book-grid">{project.books.map(book => <button className="book-card" key={book.id} onClick={() => { setSelectedBook(book.id); setView('books'); }}><div className="book-cover"><span>RIVERS OF MEMORY</span><strong>{book.position.toString().padStart(2, '0')}</strong><div className="cover-lines"/></div><div className="book-card-copy"><span>BOOK {book.position}</span><h3>{book.title}</h3><p>{book.premise ? excerpt(book.premise, 95) : 'A new story waiting to take shape.'}</p><small>{book.chapters.length} chapter{book.chapters.length !== 1 ? 's' : ''} <ChevronRight size={14}/></small></div></button>)}</div>
        <div className="section-row"><h2>Build your world</h2></div>
        <div className="quick-grid"><button onClick={() => setView('characters')}><Users size={21}/><strong>Characters</strong><span>Names, histories, relationships, and visual references</span><ChevronRight size={16}/></button><button onClick={() => setView('world')}><Globe2 size={21}/><strong>World bible</strong><span>Places, cultures, history, and the rules of your world</span><ChevronRight size={16}/></button><button onClick={() => setView('sources')}><FileText size={21}/><strong>Source documents</strong><span>Bring in your notes, manuscripts, and PDF outline</span><ChevronRight size={16}/></button></div>
      </section>}
      {view === 'books' && <section className="page">
        <div className="page-heading"><div><div className="eyebrow">STORY STRUCTURE</div><h1>Books & chapters</h1><p>Move from chapter beats to scene summaries to finished prose.</p></div><button className="button primary" onClick={addBook}><Plus size={17}/> Add book</button></div>
        <div className="workspace-grid"><div className="collection-panel"><div className="panel-title">BOOKS <span>{project.books.length}</span></div>{[...project.books].sort((a,b) => a.position - b.position).map(book => <button key={book.id} className={currentBook?.id === book.id ? 'list-item selected' : 'list-item'} onClick={() => { setSelectedBook(book.id); setSelectedChapter(''); }}><span className="list-number">{book.position.toString().padStart(2, '0')}</span><span><strong>{book.title}</strong><small>{book.chapters.length} chapters</small></span><ChevronRight size={15}/></button>)}</div>
          {currentBook && <div className="editor-panel"><div className="editor-top"><span>BOOK {currentBook.position} / {project.format.toUpperCase()}</span><button className="icon-button danger" title="Delete book" onClick={() => { if (window.confirm(`Delete ${currentBook.title}?`)) update(p => ({ ...p, books: p.books.filter(b => b.id !== currentBook.id).map(b => b.referenceBookIds.includes(currentBook.id) ? markChapters({ ...b, referenceBookIds: b.referenceBookIds.filter(id => id !== currentBook.id) }, ['outline', 'summary', 'draft']) : b) })); }}><Trash2 size={17}/></button></div>
            <Field label="Book title" value={currentBook.title} onChange={v => patchBook(currentBook.id, b => ({ ...b, title: v }))}/>
            <label className="field"><span>Reading order (use 0 for a prequel before book 1)</span><input type="number" min="0" value={currentBook.position} onChange={e => patchBook(currentBook.id, b => ({ ...b, position: Math.max(0, Number(e.target.value) || 0) }))}/></label>
            <Field label="Premise & role in the series" value={currentBook.premise} multiline placeholder="What is this book about? What changes by the end?" onChange={v => patchBook(currentBook.id, b => markChapters({ ...b, premise: v }, ['outline', 'summary', 'draft']))}/>
            <div className="field"><span>Reference other books, including a later book for a prequel</span><div className="checks">{project.books.filter(b => b.id !== currentBook.id).map(b => <label key={b.id}><input type="checkbox" checked={currentBook.referenceBookIds.includes(b.id)} onChange={e => patchBook(currentBook.id, book => markChapters({ ...book, referenceBookIds: e.target.checked ? [...book.referenceBookIds, b.id] : book.referenceBookIds.filter(id => id !== b.id) }, ['outline', 'summary', 'draft']))}/>{b.title}</label>)}</div></div>
            {project.sources.length > 0 && <div className="field"><span>Use these source documents for this book’s outline</span><div className="checks">{project.sources.map(s => <label key={s.id}><input type="checkbox" checked={currentBook.sourceIds?.includes(s.id) || false} onChange={e => patchBook(currentBook.id, book => markChapters({ ...book, sourceIds: e.target.checked ? [...(book.sourceIds || []), s.id] : (book.sourceIds || []).filter(id => id !== s.id) }, ['outline', 'summary', 'draft']))}/>{s.name}</label>)}</div></div>}
            <div className="subsection-heading"><div><h3>Chapter path</h3><p>Outline → summary → full text. Edits to earlier stages flag later work for review.</p></div><div><button className="button secondary compact" disabled={!!busy} onClick={() => generateBookOutline(currentBook)}><Sparkles size={15}/> Generate outline</button><button className="button secondary compact" onClick={() => patchBook(currentBook.id, b => ({ ...b, chapters: [...b.chapters, makeChapter(b.chapters.length + 1)] }))}><Plus size={15}/> Chapter</button></div></div>
            <div className="chapter-list">{currentBook.chapters.map(ch => <button key={ch.id} className={currentChapter?.id === ch.id ? 'chapter-tab active' : 'chapter-tab'} onClick={() => setSelectedChapter(ch.id)}><span>{ch.number.toString().padStart(2, '0')}</span><strong>{ch.title}</strong>{ch.review.length > 0 && <i title="Needs review"/>}</button>)}</div>
            {currentChapter && <div className="chapter-editor"><div className="chapter-heading"><span>CHAPTER {currentChapter.number}</span><button className="icon-button danger" title="Delete chapter" onClick={() => { if (window.confirm('Delete this chapter?')) patchBook(currentBook.id, b => ({ ...b, chapters: b.chapters.filter(ch => ch.id !== currentChapter.id).map((ch, i) => ({ ...ch, number: i + 1 })) })); }}><Trash2 size={16}/></button></div>
              <Field label="Chapter title" value={currentChapter.title} onChange={v => patchChapter(currentBook.id, currentChapter.id, ch => ({ ...ch, title: v, review: [...new Set([...ch.review, 'summary', 'draft'])] as Stage[] }))}/>
              {stages.map(stage => <div className="stage-block" key={stage.id}><div className="stage-heading"><div><span className="stage-number">0{stages.indexOf(stage) + 1}</span><div><strong>{stage.label}</strong><small>{stage.help}</small></div>{currentChapter.review.includes(stage.id) && <span className="review-pill">Review needed</span>}</div><div className="stage-actions">{currentChapter.review.includes(stage.id) && <button onClick={() => patchChapter(currentBook.id, currentChapter.id, ch => ({ ...ch, review: ch.review.filter(s => s !== stage.id) }))}>Mark reviewed</button>}<button disabled={!!busy} onClick={() => generateStage(currentBook, currentChapter, stage.id)}><WandSparkles size={15}/> Generate</button></div></div><textarea aria-label={stage.label} value={currentChapter[stage.id]} placeholder={stage.id === 'outline' ? 'List the major beats of this chapter…' : stage.id === 'summary' ? 'Describe each scene and the change it creates…' : 'Write your chapter here…'} rows={stage.id === 'draft' ? 13 : 5} onChange={e => patchChapter(currentBook.id, currentChapter.id, ch => ({ ...ch, [stage.id]: e.target.value, review: stage.id === 'outline' ? [...new Set([...ch.review.filter(x => x !== 'outline'), 'summary', 'draft'])] as Stage[] : stage.id === 'summary' ? [...new Set([...ch.review.filter(x => x !== 'summary'), 'draft'])] as Stage[] : ch.review.filter(x => x !== 'draft') }))}/></div>)}
            </div>}</div>}</div>
      </section>}
      {view === 'characters' && <section className="page"><div className="page-heading"><div><div className="eyebrow">THE PEOPLE IN YOUR WORLD</div><h1>Characters</h1><p>Keep identity, relationships, and visual continuity in one place.</p></div><div className="heading-actions"><button className="button secondary" disabled={!!busy} onClick={generateCharacter}><Sparkles size={17}/> Generate</button><button className="button primary" onClick={() => { const c = blankCharacter(); update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: [...p.characters, c] })); setSelectedCharacter(c.id); }}><Plus size={17}/> Add character</button></div></div>
        {project.characters.length === 0 ? <Empty title="No characters yet" description="Add the first person in your story, or use AI to suggest one." action={<button className="button primary" onClick={() => { const c = blankCharacter(); update(p => ({ ...p, characters: [...p.characters, c] })); setSelectedCharacter(c.id); }}>Add character</button>}/> : <div className="workspace-grid"><div className="collection-panel"><div className="panel-title">CAST <span>{project.characters.length}</span></div>{project.characters.map(c => <button key={c.id} className={currentCharacter?.id === c.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedCharacter(c.id)}><span className="avatar">{c.name.slice(0, 1).toUpperCase()}</span><span><strong>{c.name}</strong><small>{c.role || 'Role not set'}</small></span><ChevronRight size={15}/></button>)}</div>{currentCharacter && <div className="editor-panel"><div className="editor-top"><span>CHARACTER PROFILE</span><button className="icon-button danger" title="Delete character" onClick={() => { if (window.confirm(`Delete ${currentCharacter.name}?`)) update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.filter(c => c.id !== currentCharacter.id) })); }}><Trash2 size={17}/></button></div>
          <div className="two-col"><Field label="Name" value={currentCharacter.name} onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, name: v, updatedAt: now() } : c) }))}/><Field label="Role in story" value={currentCharacter.role} placeholder="Protagonist, mentor, rival…" onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, role: v, updatedAt: now() } : c) }))}/></div>
          {(['background', 'personality', 'arc', 'appearance'] as const).map(key => <Field key={key} label={key === 'appearance' ? 'Visual reference / appearance instructions' : key[0].toUpperCase() + key.slice(1)} value={currentCharacter[key]} multiline rows={key === 'appearance' ? 6 : 4} placeholder={key === 'appearance' ? 'Age range, build, skin tone, hair, eyes, features, clothing, recurring details…' : ''} onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, [key]: v, updatedAt: now() } : c) }))}/>)}
          <div className="subsection-heading"><div><h3>Relationships</h3><p>Connections become part of the canon used for generation.</p></div></div><div className="relationship-list">{currentCharacter.relationships.map((r, index) => <div className="relationship" key={index}><select value={r.characterId} onChange={e => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, relationships: c.relationships.map((item, i) => i === index ? { ...item, characterId: e.target.value } : item) } : c) }))}><option value="">Choose character</option>{project.characters.filter(c => c.id !== currentCharacter.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input value={r.description} placeholder="How are they connected?" onChange={e => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, relationships: c.relationships.map((item, i) => i === index ? { ...item, description: e.target.value } : item) } : c) }))}/><button className="icon-button" onClick={() => update(p => ({ ...p, characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, relationships: c.relationships.filter((_, i) => i !== index) } : c) }))}><X size={17}/></button></div>)}</div><button className="text-button" onClick={() => update(p => ({ ...p, characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, relationships: [...c.relationships, { characterId: '', description: '' }] } : c) }))}><Plus size={16}/> Add relationship</button>
          <div className="subsection-heading"><div><h3>Reference images</h3><p>Saved in assets/characters inside your project folder.</p></div><div><button className="button secondary compact" disabled={!!busy} onClick={() => act('reference-image', createReferenceImage)}><Sparkles size={15}/> Generate portrait</button><button className="button secondary compact" onClick={() => imageRef.current?.click()}><CloudUpload size={15}/> Upload images</button></div></div><div className="image-grid">{currentCharacter.imagePaths.map(path => <div key={path} className="image-tile">{imageUrls[path] ? <img src={imageUrls[path]} alt={currentCharacter.name + ' reference'}/> : <div className="image-missing">Connect folder to view</div>}<button title="Remove image reference" onClick={() => update(p => ({ ...p, characters: p.characters.map(c => c.id === currentCharacter.id ? { ...c, imagePaths: c.imagePaths.filter(x => x !== path) } : c) }))}><X size={15}/></button></div>)}</div>
        </div>}</div>}</section>}
      {view === 'world' && <section className="page"><div className="page-heading"><div><div className="eyebrow">THE STORY BIBLE</div><h1>World building</h1><p>Record facts that every book should remember.</p></div><button className="button primary" onClick={() => { const n = blankWorld(); update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), world: [...p.world, n] })); setSelectedWorld(n.id); }}><Plus size={17}/> Add note</button></div>{project.world.length === 0 ? <Empty title="The world is a blank page" description="Add a place, custom, piece of history, or rule. You can also extract notes from a source document." action={<button className="button secondary" onClick={() => setView('sources')}>Import a document</button>}/> : <div className="workspace-grid"><div className="collection-panel"><div className="panel-title">WORLD NOTES <span>{project.world.length}</span></div>{project.world.map(n => <button key={n.id} className={currentWorld?.id === n.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedWorld(n.id)}><span className="list-number"><Globe2 size={17}/></span><span><strong>{n.title}</strong><small>{n.category}</small></span><ChevronRight size={15}/></button>)}</div>{currentWorld && <div className="editor-panel"><div className="editor-top"><span>WORLD NOTE</span><button className="icon-button danger" onClick={() => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), world: p.world.filter(x => x.id !== currentWorld.id) }))}><Trash2 size={17}/></button></div><Field label="Title" value={currentWorld.title} onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), world: p.world.map(x => x.id === currentWorld.id ? { ...x, title: v, updatedAt: now() } : x) }))}/><label className="field"><span>Category</span><select value={currentWorld.category} onChange={e => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), world: p.world.map(x => x.id === currentWorld.id ? { ...x, category: e.target.value as WorldNote['category'] } : x) }))}>{['Place', 'Culture', 'History', 'Rule', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label><Field label="Details" value={currentWorld.details} multiline rows={14} placeholder="What is true about this part of your world?" onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), world: p.world.map(x => x.id === currentWorld.id ? { ...x, details: v, updatedAt: now() } : x) }))}/></div>}</div>}</section>}
      {view === 'sources' && <section className="page" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); act('sources', () => uploadSources(e.dataTransfer.files)); }}><div className="page-heading"><div><div className="eyebrow">YOUR STARTING MATERIAL</div><h1>Source documents</h1><p>Bring in outlines and notes. Extract world facts for your story bible.</p></div><button className="button primary" onClick={() => sourceRef.current?.click()}><CloudUpload size={17}/> Import files</button></div><div className="info-banner"><FileText size={19}/><span>Drop PDF, TXT, or Markdown here, or choose Import files. Text from PDFs is extracted locally in your browser. Connect a folder first if you want the original files preserved.</span></div>{project.sources.length === 0 ? <Empty title="No documents imported" description="Drop in your outline PDF and any world notes when they are ready." action={<button className="button primary" onClick={() => sourceRef.current?.click()}>Import files</button>}/> : <div className="workspace-grid"><div className="collection-panel"><div className="panel-title">DOCUMENTS <span>{project.sources.length}</span></div>{project.sources.map(s => <button key={s.id} className={currentSource?.id === s.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedSource(s.id)}><span className="list-number"><FileText size={18}/></span><span><strong>{s.name}</strong><small>{s.text.length.toLocaleString()} characters</small></span><ChevronRight size={15}/></button>)}</div>{currentSource && <div className="editor-panel"><div className="editor-top"><span>IMPORTED DOCUMENT</span><button className="icon-button danger" onClick={() => update(p => ({ ...p, sources: p.sources.filter(s => s.id !== currentSource.id) }))}><Trash2 size={17}/></button></div><h2>{currentSource.name}</h2><p className="muted">Original: {currentSource.path || 'Text only — connect a folder to preserve originals on future imports'}</p><div className="source-actions"><button className="button secondary" disabled={!!busy} onClick={() => extractWorld(currentSource)}><Sparkles size={16}/> Extract worldbuilding</button>{currentSource.extracted && <span className="success-label">Extracted</span>}</div><label className="field"><span>Extracted text (editable)</span><textarea rows={20} value={currentSource.text} onChange={e => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), sources: p.sources.map(s => s.id === currentSource.id ? { ...s, text: e.target.value, extracted: false } : s) }))}/></label></div>}</div>}</section>}
      {view === 'influences' && <section className="page"><div className="page-heading"><div><div className="eyebrow">CREATIVE COMPASS</div><h1>Influences</h1><p>Capture what resonates, while keeping your story original.</p></div><button className="button primary" onClick={() => { const x = blankInfluence(); update(p => ({ ...p, influences: [...p.influences, x] })); setSelectedInfluence(x.id); }}><Plus size={17}/> Add influence</button></div><div className="info-banner"><LibraryBig size={19}/><span>Describe broad qualities you admire. The AI uses these as preferences and is instructed to avoid copying plots, characters, prose, or a creator’s style.</span></div>{project.influences.length === 0 ? <Empty title="What inspires this story?" description="Add a book, film, show, or other work—and why it matters to your project."/> : <div className="workspace-grid"><div className="collection-panel"><div className="panel-title">INFLUENCES <span>{project.influences.length}</span></div>{project.influences.map(x => <button key={x.id} className={currentInfluence?.id === x.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedInfluence(x.id)}><span className="list-number"><LibraryBig size={17}/></span><span><strong>{x.title}</strong><small>{x.medium}</small></span><ChevronRight size={15}/></button>)}</div>{currentInfluence && <div className="editor-panel"><div className="editor-top"><span>INFLUENCE</span><button className="icon-button danger" onClick={() => update(p => ({ ...p, influences: p.influences.filter(x => x.id !== currentInfluence.id) }))}><Trash2 size={17}/></button></div><div className="two-col"><Field label="Title" value={currentInfluence.title} onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), influences: p.influences.map(x => x.id === currentInfluence.id ? { ...x, title: v } : x) }))}/><label className="field"><span>Medium</span><select value={currentInfluence.medium} onChange={e => update(p => ({ ...p, influences: p.influences.map(x => x.id === currentInfluence.id ? { ...x, medium: e.target.value } : x) }))}>{['Book', 'Film', 'TV series', 'Game', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label></div><Field label="Why it resonates" value={currentInfluence.why} multiline placeholder="What broad themes, emotional qualities, or craft choices do you admire?" onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), influences: p.influences.map(x => x.id === currentInfluence.id ? { ...x, why: v } : x) }))}/><div className="subsection-heading"><div><h3>General source overview</h3><p>Optional public encyclopedia lookup and AI paraphrase. Review for accuracy.</p></div><button className="button secondary compact" disabled={!!busy} onClick={() => act('acquire-influence', () => acquireInfluence(currentInfluence))}><Sparkles size={15}/> Acquire overview</button></div><Field label="Factual summary" value={currentInfluence.factualSummary} multiline onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), influences: p.influences.map(x => x.id === currentInfluence.id ? { ...x, factualSummary: v } : x) }))}/>{currentInfluence.sourceUrl && <a className="source-link" href={currentInfluence.sourceUrl} target="_blank" rel="noreferrer">View encyclopedia source ↗</a>}<Field label="Elements to avoid" value={currentInfluence.avoid} multiline placeholder="Specific tropes, plot devices, or similarities to avoid…" onChange={v => update(p => ({ ...markAllBooks(p, ['outline', 'summary', 'draft']), influences: p.influences.map(x => x.id === currentInfluence.id ? { ...x, avoid: v } : x) }))}/></div>}</div>}</section>}
      {view === 'settings' && <section className="page narrow"><div className="page-heading"><div><div className="eyebrow">PROJECT FOUNDATION</div><h1>Settings & AI</h1><p>Define the audience and creative boundaries for every generation.</p></div></div><div className="settings-card"><h2>Story profile</h2><div className="two-col"><Field label="Project title" value={project.title} onChange={v => update(p => markAllBooks({ ...p, title: v }, ['outline', 'summary', 'draft']))}/><label className="field"><span>Format</span><select value={project.format} onChange={e => update(p => markAllBooks({ ...p, format: e.target.value as Format }, ['outline', 'summary', 'draft']))}>{formats.map(x => <option key={x}>{x}</option>)}</select></label></div><Field label="Series premise" value={project.premise} multiline rows={5} placeholder="What is the heart of this story or series?" onChange={v => update(p => markAllBooks({ ...p, premise: v }, ['outline', 'summary', 'draft']))}/><div className="two-col"><Field label="Audience / demographics" value={project.audience} placeholder="e.g. adults, ages 8–12" onChange={v => update(p => markAllBooks({ ...p, audience: v }, ['outline', 'summary', 'draft']))}/><Field label="Reading level" value={project.readingLevel} placeholder="e.g. Grade 4, YA, general" onChange={v => update(p => markAllBooks({ ...p, readingLevel: v }, ['outline', 'summary', 'draft']))}/></div><Field label="Genres (comma separated)" value={project.genres.join(', ')} onChange={v => update(p => markAllBooks({ ...p, genres: v.split(',').map(x => x.trim()).filter(Boolean) }, ['outline', 'summary', 'draft']))}/><Field label="Tone" value={project.tone} placeholder="Lyrical, warm, suspenseful…" onChange={v => update(p => markAllBooks({ ...p, tone: v }, ['outline', 'summary', 'draft']))}/><Field label="Themes" value={project.themes} multiline onChange={v => update(p => markAllBooks({ ...p, themes: v }, ['outline', 'summary', 'draft']))}/><Field label="Content boundaries" value={project.boundaries} multiline placeholder="Topics, imagery, or intensity to avoid…" onChange={v => update(p => markAllBooks({ ...p, boundaries: v }, ['outline', 'summary', 'draft']))}/></div>
        <div className="settings-card"><h2>AI provider</h2><p className="muted">AI is optional. Generation runs only when you click a Generate or Extract button.</p><div className="provider-toggle"><button className={config.provider === 'ollama' ? 'active' : ''} onClick={() => setConfig({ ...config, provider: 'ollama', model: 'llama3.2', endpoint: 'http://localhost:11434' })}>Local Ollama</button><button className={config.provider === 'openai' ? 'active' : ''} onClick={() => setConfig({ ...config, provider: 'openai', model: 'gpt-4.1-mini', endpoint: 'https://api.openai.com/v1' })}>OpenAI</button></div><div className="two-col"><Field label="Model" value={config.model} onChange={v => setConfig({ ...config, model: v })}/><Field label="API base URL" value={config.endpoint} onChange={v => setConfig({ ...config, endpoint: v })}/></div>{config.provider === 'openai' && <label className="field"><span>OpenAI API key (this tab only)</span><input type="password" autoComplete="off" value={config.apiKey} onChange={e => setConfig({ ...config, apiKey: e.target.value })} placeholder="sk-…"/></label>}<div className="info-banner compact"><CircleHelp size={18}/><span>{config.provider === 'openai' ? 'The key stays in memory and is sent directly from this browser to your chosen API endpoint. Never place a key in project files or GitHub Pages settings.' : 'Ollama must allow this browser origin. On GitHub Pages, HTTPS and browser security may require a local HTTPS proxy.'}</span></div></div>
        <div className="settings-card"><h2>Project files</h2><p className="muted">Browser changes are cached locally. Sync writes separate JSON records into your chosen folder.</p><div className="settings-actions"><button className="button secondary" onClick={() => act('connect', connectFolder)}><FolderOpen size={16}/>{connected ? 'Change folder' : 'Connect folder'}</button>{connected && <><button className="button secondary" onClick={() => act('sync', syncFolder)}><RefreshCw size={16}/> Sync files</button><button className="button secondary" onClick={() => act('reload', reloadFolder)}><Download size={16}/> Reload folder</button></>}<button className="button secondary" onClick={() => downloadProject(project)}><Download size={16}/> Export snapshot</button><button className="button secondary" onClick={() => importRef.current?.click()}><CloudUpload size={16}/> Import snapshot</button></div></div></section>}
    </main>
    <input ref={importRef} hidden type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) act('import', () => importSnapshot(file)); e.target.value = ''; }}/>
    <input ref={sourceRef} hidden type="file" multiple accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" onChange={e => { const files = e.target.files; act('sources', () => uploadSources(files)); e.target.value = ''; }}/>
    <input ref={imageRef} hidden type="file" multiple accept="image/*" onChange={e => { const files = e.target.files; act('images', () => uploadImages(files)); e.target.value = ''; }}/>
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
    {!!busy && <div className="busy-indicator"><Sparkles size={16}/> Working on {busy.replaceAll('-', ' ')}…</div>}
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowHelp(false)}><X size={20}/></button><div className="eyebrow">THE WORKFLOW</div><h2>Write in layers</h2><ol><li><strong>Set the foundation.</strong> Choose format, audience, reading level, and premise.</li><li><strong>Build the bible.</strong> Add characters, world notes, influences, and source documents.</li><li><strong>Shape each book.</strong> Connect earlier or later books as references, then create chapter outlines.</li><li><strong>Deepen and draft.</strong> Add summaries and full chapter text. Changed canon flags downstream work for review.</li><li><strong>Sync your files.</strong> Connect a folder to keep editable JSON and uploaded assets on your computer.</li></ol><p>Future audio and screenplay work can build on the same story files; this first version focuses on prose.</p></div></div>}
  </div>;
}
