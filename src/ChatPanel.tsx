import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Archive, ArrowUp, BookOpen, ChevronDown, FilePlus2, ImagePlus, Search, Settings2, Sparkles, X } from 'lucide-react';
import { complete, parseJson, type AIConfig, type ChatTurn } from './ai';
import { generateImage, imageConfigured, type ImageConfig } from './imageGeneration';
import { getImageSession, isImageReady, subscribeImageSession } from './imageSession';
import { emptyThread, estimatedTokens, loadArchive, loadThread, projectContext, relevantMemories, saveArchive, saveThread, searchProject, type ChatArchive, type ChatMessage, type ChatMode, type ChatThread, type MemoryShard } from './chatStore';
import { extractText } from './extract';
import { now, projectFiles, uid, type ContinuityReport, type Project, type StorySuggestion, type WorldNote } from './model';
import { readBlob, writeBlob } from './storage';
import { getBrowserModelStatus, subscribeBrowserModel, type BrowserTools } from './browserModel';
import { BROWSER_IMAGE_MODEL_PATH } from './browserImageAssets';
import { hasOllamaModel, listOllamaModels } from './modelAvailability';
import { getModelSession, isModelReady, modelFingerprint, subscribeModelSession } from './modelSession';
import { checkContinuity } from './continuity';
import { showCompletionToast, showToast } from './toastStore';
import { catalogModelForPath } from './modelLicenses';
import { NEEDLE_LABELS, NEEDLE_MODEL_PATHS, type NeedleVersion } from './needleAssets';
import MarkdownContent from './MarkdownContent';
import './writingModes.css';

type Props = {
  project: Project; folder: FileSystemDirectoryHandle | null; config: AIConfig; imageConfig: ImageConfig;
  profiles: AIConfig[]; onSelectProfile: (id: string) => void;
  onSettings: () => void; onOpenWorld: (id: string) => void; onUpload: (files: FileList | null) => Promise<void>;
  onSaveWorldNote: (note: WorldNote) => Promise<boolean>;
  onSaveReport: (report: ContinuityReport) => Promise<boolean>;
  onUpdateReport: (report: ContinuityReport) => Promise<boolean>;
  onRequestModelTest: (reason?: 'image') => void;
  onChatActivityChange: (active: boolean) => void;
  onSuggestionStatus: (id: string, status: StorySuggestion['status']) => void;
  onAddSuggestions: (suggestions: StorySuggestion[]) => void;
};
const makeMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({ id: uid(), role, content, createdAt: now() });
function ImagePreview({ folder, path }: { folder: FileSystemDirectoryHandle | null; path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!folder) return;
    let active = true;
    let objectUrl = '';
    readBlob(folder, path).then(file => { objectUrl = URL.createObjectURL(file); if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl); }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [folder, path]);
  return url ? <img className="chat-generated-image" src={url} alt="Generated story reference"/> : <span className="chat-image-placeholder">Connect the project folder to view this image.</span>;
}
export default function ChatPanel({ project, folder, config, imageConfig, profiles, onSelectProfile, onSettings, onOpenWorld, onUpload, onSaveWorldNote, onSaveReport, onUpdateReport, onRequestModelTest, onChatActivityChange, onSuggestionStatus, onAddSuggestions }: Props) {
  const [thread, setThread] = useState<ChatThread>(() => emptyThread(project));
  const threadRef = useRef(thread);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState(() => sessionStorage.getItem(`chat-draft:${project.id}`) || '');
  const previousProjectId = useRef(project.id);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showContext, setShowContext] = useState(true);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [selectedArchive, setSelectedArchive] = useState<ChatArchive | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState('');
  const [lastUsage, setLastUsage] = useState<{ input?: number; output?: number }>({});
  const [noteTitle, setNoteTitle] = useState('');
  const [noteCategory, setNoteCategory] = useState<WorldNote['category']>('Other');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [ollamaState, setOllamaState] = useState<'checking' | 'ready' | 'missing' | 'unavailable'>('checking');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const browserStatus = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const modelSession = useSyncExternalStore(subscribeModelSession, getModelSession);
  useSyncExternalStore(subscribeImageSession, getImageSession);
  const mode: ChatMode = thread.mode || 'chat';
  useEffect(() => { onChatActivityChange(!!busy || !!draft.trim()); return () => onChatActivityChange(false); }, [busy, draft, onChatActivityChange]);
  const aiReady = isModelReady(config) && !(modelSession.state === 'testing' && modelSession.fingerprint === modelFingerprint(config));
  const imageReady = imageConfigured(imageConfig) && isImageReady(imageConfig);
  const activeCatalogModel = config.provider === 'browser' && aiReady ? catalogModelForPath(config.model) : undefined;
  const selectedNeedle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === config.model)?.[0];
  const modelLabel = config.provider === 'browser' ? (config.model === BROWSER_IMAGE_MODEL_PATH ? 'Stable Diffusion creates images; choose a chat model for writing' : selectedNeedle ? `${NEEDLE_LABELS[selectedNeedle]} is a tool model; choose a chat model for writing` : aiReady ? `Ready: ${config.model}` : browserStatus.state === 'ready' && browserStatus.path === config.model ? 'Model loaded; test it for this session' : 'No browser model loaded')
    : config.provider === 'ollama' ? (!config.model ? 'No Ollama model selected' : aiReady ? `Ready: ${config.model}` : ollamaState === 'ready' ? `Installed, test required: ${config.model}` : ollamaState === 'missing' ? `Model not installed: ${config.model}` : ollamaState === 'unavailable' ? 'Cannot reach Ollama' : 'Checking Ollama…')
    : aiReady ? `${config.model} · tested this session` : config.model ? `${config.model} · test required` : 'No AI model configured';
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  threadRef.current = thread;
  useEffect(() => {
    if (previousProjectId.current !== project.id) {
      previousProjectId.current = project.id;
      setDraft(sessionStorage.getItem(`chat-draft:${project.id}`) || '');
      setNoteTitle(''); setSelectedReportId(''); setResolutionDrafts({});
    }
  }, [project.id]);
  useEffect(() => { sessionStorage.setItem(`chat-draft:${project.id}`, draft); }, [project.id, draft]);
  useEffect(() => {
    if (config.provider !== 'ollama' || !config.model) { setOllamaState('missing'); setOllamaModels([]); return; }
    const controller = new AbortController();
    setOllamaState('checking');
    listOllamaModels(config.endpoint, controller.signal).then(models => { if (!controller.signal.aborted) { setOllamaModels(models); setOllamaState(hasOllamaModel(models, config.model) ? 'ready' : 'missing'); } })
      .catch(() => { if (!controller.signal.aborted) setOllamaState('unavailable'); });
    return () => controller.abort();
  }, [config.provider, config.endpoint, config.model]);
  useEffect(() => {
    let active = true;
    setHydrated(false);
    (async () => {
      const local = await loadThread(project.id).catch(() => null);
      let disk: ChatThread | null = null;
      if (folder) {
        try { disk = JSON.parse(await (await readBlob(folder, 'chat/thread.json')).text()) as ChatThread; }
        catch { /* A new folder has no chat file yet. */ }
      }
      const validDisk = disk?.projectId === project.id ? disk : null;
      const chosen = validDisk && (!local || validDisk.updatedAt > local.updatedAt) ? validDisk : local || emptyThread(project);
      if (active) { setThread({ ...chosen, pinnedIds: chosen.pinnedIds || [] }); setSelectedArchive(null); setSelectedArchiveId(''); }
      if (folder && chosen === local && (!validDisk || chosen.updatedAt > validDisk.updatedAt)) {
        try {
          await writeBlob(folder, 'chat/thread.json', new Blob([JSON.stringify(chosen, null, 2)], { type: 'application/json' }));
          for (const meta of chosen.archives) {
            const archive = await loadArchive(meta.id).catch(() => null);
            if (archive) await writeBlob(folder, `chat/archives/${meta.id}.json`, new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
          }
        } catch { if (active) setError('Chat loaded from IndexedDB, but could not be copied to the connected folder.'); }
      }
      if (active) setHydrated(true);
    })().catch(e => { if (active) { setError(e instanceof Error ? e.message : String(e)); setHydrated(true); } });
    return () => { active = false; };
  }, [project.id, folder]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.messages.length]);
  async function persist(next: ChatThread) {
    next.updatedAt = now();
    threadRef.current = next; setThread(next);
    let saved = false;
    try { await saveThread(next); saved = true; } catch { /* Folder storage may still succeed. */ }
    if (folder) {
      try { await writeBlob(folder, 'chat/thread.json', new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' })); saved = true; }
      catch { if (saved) setError('Chat saved in this browser. Folder access was unavailable; reconnect it to copy the chat there.'); }
    }
    if (!saved) throw new Error('Could not save chat in IndexedDB or the connected folder.');
  }
  async function archiveWindow(current: ChatThread, query: string): Promise<ChatThread> {
    const active = current.messages.slice(current.activeFrom);
    if (!active.length) return current;
    const archiveId = uid();
    const transcript = active.map(x => `${x.role.toUpperCase()}: ${x.content}`).join('\n\n');
    const archive: ChatArchive = {
      id: archiveId, projectId: project.id, createdAt: now(),
      messages: active, summaryBefore: current.summary, summaryAfter: '',
    };
    let archived = false;
    try { await saveArchive(archive); archived = true; } catch { /* Folder storage may still succeed. */ }
    if (folder) {
      try { await writeBlob(folder, `chat/archives/${archiveId}.json`, new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })); archived = true; }
      catch { setError('The pre-compaction archive is safe in IndexedDB, but could not be copied to the folder.'); }
    }
    if (!archived) throw new Error('Could not save the uncompacted window. Compaction was stopped.');
    const compactPrompt = `Summarize the conversation for continued story development. Preserve decisions, canon changes, open questions, user preferences, and file references. Return ONLY JSON with "summary" (at most 1000 characters) and "memories" (2 to 6 objects with "title", "text" at most 450 characters, and "keywords" array). Each memory should be a small, independently useful fact cluster. Do not invent facts.\n\nPREVIOUS SUMMARY:\n${current.summary}\n\nCONVERSATION:\n${transcript.slice(-Math.max(3000, Math.floor(config.contextWindow * 2.5)))}\n\nLATEST USER TOPIC:\n${query}`;
    let summary = '';
    let memories: MemoryShard[] = [];
    try {
      if (!aiReady) throw new Error('No tested model is available.');
      const compactConfig = { ...config, maxOutputTokens: Math.min(1200, config.maxOutputTokens) };
      const result = await complete(compactConfig, [{ role: 'user', content: compactPrompt }], 'Return faithful, concise JSON memory for a writing assistant.');
      const parsed = parseJson<{ summary: string; memories: { title: string; text: string; keywords?: string[] }[] }>(result.text);
      if (!parsed.summary || !Array.isArray(parsed.memories)) throw new Error('Invalid compaction response');
      summary = parsed.summary.slice(0, 1200);
      memories = parsed.memories.slice(0, 8).filter(x => x.title && x.text).map(x => ({
        id: uid(), archiveId, title: x.title.slice(0, 80), text: x.text.slice(0, 500),
        keywords: Array.isArray(x.keywords) ? x.keywords.slice(0, 10).map(String) : [],
      }));
    } catch {
      summary = (current.summary + '\n' + transcript).slice(-1200);
      memories = active.filter(x => x.role === 'user').slice(-6).map(x => ({
        id: uid(), archiveId, title: x.content.slice(0, 65), text: x.content.slice(0, 450),
        keywords: x.content.toLowerCase().match(/[a-z0-9]{4,}/g)?.slice(0, 8) || [],
      }));
      setError(aiReady ? 'The model could not summarize this window. A short local fallback was saved; the full archive is intact.' : 'A local fallback summary was saved; the full archive is intact. Test a model for AI summaries.');
    }
    archive.summaryAfter = summary;
    try { await saveArchive(archive); } catch { /* Folder copy is written below. */ }
    if (folder) {
      try { await writeBlob(folder, `chat/archives/${archiveId}.json`, new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })); }
      catch { /* IndexedDB copy remains available. */ }
    }
    const rawShards: MemoryShard[] = active.filter(x => x.role === 'user').map((message, index) => {
      const following = active[active.indexOf(message) + 1];
      const text = [message.content, following && following.role !== 'user' ? following.content : ''].filter(Boolean).join(' → ');
      return {
        id: uid(), archiveId, title: message.content.slice(0, 70) || `Exchange ${index + 1}`,
        text: text.slice(0, 500),
        keywords: (text.toLowerCase().match(/[a-z0-9]{4,}/g) || []).slice(0, 12),
      };
    });
    const next: ChatThread = {
      ...current, activeFrom: current.messages.length, summary,
      memories: [...current.memories, ...memories, ...rawShards],
      archives: [...current.archives, { id: archiveId, createdAt: archive.createdAt, messageCount: active.length, summary }],
    };
    await persist(next);
    return next;
  }
  function contextFor(current: ChatThread, query: string) {
    const budget = config.contextWindow - config.maxOutputTokens - 256;
    if (budget < 512) throw new Error('Context window must exceed max output tokens by at least 768.');
    const memories = [
      ...current.memories.filter(x => current.pinnedIds.includes(x.id)),
      ...relevantMemories(current.memories.filter(x => !current.pinnedIds.includes(x.id)), query, 3),
    ].slice(0, 5);
    const base = `You are the writing studio assistant. Help develop original stories, and use project facts accurately. You can suggest edits, but never claim you changed a file unless a tool result says so.\n\nPROJECT CANON:\n${projectContext(project).slice(0, Math.floor(budget * 1.2))}\n\nPRIOR CONTEXT SUMMARY:\n${current.summary.slice(0, 1200)}\n\nRETRIEVED MEMORY SHARDS:\n${memories.map(x => `[${x.title}] ${x.text}`).join('\n').slice(0, Math.floor(budget * .8))}`;
    const turns: ChatTurn[] = current.messages.slice(current.activeFrom).map(x => ({
      role: x.role === 'assistant' ? 'assistant' : 'user',
      content: x.role === 'tool' ? 'Workspace tool result: ' + x.content : x.content,
    }));
    return { system: base, turns, estimate: estimatedTokens(base + turns.map(x => x.content).join('')) };
  }
  const browserTools: BrowserTools = {
    definitions: [
      { type: 'function', function: { name: 'list_project_files', description: 'List story JSON files and imported sources available in this workspace.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'search_project', description: 'Search project canon, characters, books, notes, and source extracts for a topic.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words or topic to search' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_project_file', description: 'Read a specific text, JSON, Markdown, or PDF file from the connected workspace. Use list_project_files first.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path inside the connected project folder' } }, required: ['path'] } } },
    ],
    execute: async (name, args) => {
      if (name === 'list_project_files') return [...Object.keys(projectFiles(project)), ...project.sources.map(x => x.path).filter(Boolean)].sort().join('\n') || 'No project files yet.';
      if (name === 'search_project') {
        const query = String(args.query || '').slice(0, 200);
        if (!query) throw new Error('A search query is required.');
        const results = searchProject(project, query);
        return results.length ? results.map(x => `${x.title}\n${x.text.slice(0, 2000)}`).join('\n\n') : 'No matching records.';
      }
      if (name === 'read_project_file') {
        if (!folder) throw new Error('Connect a project folder first.');
        const path = String(args.path || '');
        if (!path || path.startsWith('/') || path.split('/').some(x => !x || x === '..') || !/\.(json|txt|md|pdf)$/i.test(path)) throw new Error('Choose a relative JSON, text, Markdown, or PDF path.');
        const file = await readBlob(folder, path);
        const content = path.toLowerCase().endsWith('.json') ? await file.text() : await extractText(file);
        return `${path}\n${content.slice(0, 12000)}${content.length > 12000 ? '\n[Truncated]' : ''}`;
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };
  async function changeMode(next: ChatMode) {
    setError('');
    await persist({ ...threadRef.current, mode: next });
  }
  const starterQuestions = [
    `What is the central change you want readers to see across ${project.format.toLowerCase()}?`,
    'Which place matters most to the opening, and what makes it distinctive?',
    'What does the main character want before the story begins, and what stands in the way?',
    'Which rule of this world creates the most trouble for its people?',
    'What historical event still shapes how the characters behave?',
    'Which relationship is likely to change most, and why?',
  ];
  async function askQuestion(current = threadRef.current, extra = '') {
    const startedAt = performance.now();
    setBusy('Preparing a question');
    let question = '';
    const previous = current.messages.filter(x => x.provider === 'Interviewer').map(x => x.content.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' '));
    if (aiReady) {
      try {
        const prompt = `Ask exactly one specific, open-ended worldbuilding question. Use the collected canon, prioritize a consequential gap or uncertainty, and avoid repeating a question already answered. If little is collected, build from the project metadata. Return only the question.\n\nCANON: ${projectContext(project).slice(0, Math.max(1000, (config.contextWindow - config.maxOutputTokens - 1100) * 1.7))}\n\nSOURCE EXCERPTS: ${project.sources.slice(-3).map(x => `${x.name}: ${x.text.slice(0, 350)}`).join(' | ').slice(0, 1200)}\n\nINFLUENCES: ${project.influences.map(x => `${x.title}: ${x.why.slice(0, 100)}`).join(' | ').slice(0, 400)}\n\nRECENT ANSWER: ${extra.slice(0, 800)}\n\nPREVIOUS QUESTIONS: ${current.messages.filter(x => x.provider === 'Interviewer').slice(-5).map(x => x.content).join(' | ').slice(0, 700)}`;
        question = (await complete({ ...config, maxOutputTokens: Math.min(config.maxOutputTokens, 180) }, [{ role: 'user', content: prompt }], 'You are an interviewer helping an author discover original story world facts. Ask one question only.', undefined, config.provider === 'browser' ? browserTools : undefined)).text.trim().slice(0, 500);
      } catch (error) { setError(`AI question unavailable; using a starter question. ${error instanceof Error ? error.message : String(error)}`); }
    }
    const unseen = (candidate: string) => !previous.includes(candidate.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' '));
    const scaffoldQuestions = [
      ...project.storyGraph.units.filter(x => x.status !== 'dismissed').slice(0, 20).map(x => `What needs to change in ${x.title} for this part of the story to matter?`),
      ...project.characters.slice(0, 20).map(x => `What does ${x.name} believe at the start, and what could challenge that belief?`),
      ...project.world.slice(0, 20).map(x => `Which detail about ${x.title} still needs your decision?`),
    ];
    if (!question || !unseen(question)) question = [...starterQuestions, ...scaffoldQuestions].find(unseen) || `What is unresolved about ${project.title} in question ${previous.length + 1}?`;
    const nextQuestion = question.replace(/^\d+[.)]\s*/, '').trim();
    await persist({ ...current, interviewQuestion: nextQuestion, messages: [...current.messages, { ...makeMessage('assistant', nextQuestion), provider: 'Interviewer', model: aiReady ? config.model : 'Starter questions' }] });
    showCompletionToast('Your next interview question is ready.', startedAt);
    setBusy('');
  }
  async function saveFreeWriting(content: string) {
    const startedAt = performance.now();
    const note: WorldNote = { id: uid(), updatedAt: now(), title: noteTitle.trim() || content.split('\n').find(Boolean)?.slice(0, 72) || 'Untitled idea', category: noteCategory, details: content };
    const onDrive = await onSaveWorldNote(note);
    setDraft(''); setNoteTitle('');
    await persist({ ...threadRef.current, messages: [...threadRef.current.messages, makeMessage('user', content), makeMessage('tool', `${onDrive ? 'Saved' : 'Saved in browser; sync folder for USB access'} world note: world/notes/${note.id}.json · ${note.title}`)] });
    showCompletionToast('World note saved to your story bible.', startedAt);
    return note;
  }
  async function saveInterviewAnswer(content: string) {
    const current = threadRef.current;
    const question = current.interviewQuestion || 'Worldbuilding answer';
    const note: WorldNote = { id: uid(), updatedAt: now(), title: `Interview: ${question.replace(/[?!.]+$/, '').slice(0, 72)}`, category: 'Other', details: `Question: ${question}\n\nAnswer: ${content}` };
    const onDrive = await onSaveWorldNote(note);
    setDraft('');
    const next = { ...current, interviewQuestion: '', messages: [...current.messages, makeMessage('user', content), makeMessage('tool', `${onDrive ? 'Saved' : 'Saved in browser; sync folder for USB access'} answer: world/notes/${note.id}.json · ${note.title}`)] };
    await persist(next);
    await askQuestion(next, content);
  }
  async function generateSuggestions() {
    if (!aiReady) { setError('Choose and load an AI model to generate more suggestions. Document candidates remain available below.'); return; }
    const startedAt = performance.now();
    setBusy('Finding story suggestions'); setError('');
    try {
      const prompt = `Suggest 3 to 5 original, specific worldbuilding ideas grounded in this project. Treat imported candidates as uncertain. Do not copy an influence's characters, scenes, wording, or distinctive setting. Return ONLY a JSON array of objects with title, detail, category (Place, Culture, History, Rule, Other). Each detail should be an optional addition, not a fact. Avoid duplicates.\nPROJECT: ${projectContext(project).slice(0, 10000)}\nSOURCE CANDIDATES: ${JSON.stringify(project.storyGraph?.units.filter(x => x.status !== 'dismissed').slice(0, 35).map(x => x.title))}`;
      const response = await complete({ ...config, maxOutputTokens: Math.min(config.maxOutputTokens, 900) }, [{ role: 'user', content: prompt }], 'Create original, optional story suggestions as JSON.', undefined, config.provider === 'browser' ? browserTools : undefined);
      const parsed = parseJson<{ title: string; detail: string; category: WorldNote['category'] }[]>(response.text);
      const allowed = new Set(['Place', 'Culture', 'History', 'Rule', 'Other']);
      const suggestions = parsed.filter(x => x.title?.trim() && x.detail?.trim()).slice(0, 5).map(x => ({ id: uid(), title: x.title.slice(0, 100), detail: x.detail.slice(0, 900), category: allowed.has(x.category) ? x.category : 'Other' as const, status: 'proposed' as const }));
      onAddSuggestions(suggestions);
      showCompletionToast(`${suggestions.length} story suggestion${suggestions.length === 1 ? '' : 's'} ready to review.`, startedAt);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  }
  async function runContinuityCheck(focus = '') {
    if (busy || !hydrated) return;
    const startedAt = performance.now();
    setError(''); setBusy('Reviewing continuity');
    try {
      const report = await checkContinuity(project, config, aiReady, config.provider === 'browser' && aiReady ? browserTools : undefined, focus);
      const onDrive = await onSaveReport(report);
      setSelectedReportId(report.id);
      await persist({ ...threadRef.current, messages: [...threadRef.current.messages, ...(focus ? [makeMessage('user', focus)] : []), makeMessage('tool', `${report.title}\n${report.summary}${onDrive ? `\nSaved to world/reviews/${report.id}.json` : '\nSaved in browser; connect and sync a folder for USB access.'}`)] });
      setDraft('');
      showCompletionToast('Continuity review complete. Open the saved report to review its findings.', startedAt);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  }
  async function reviseIssue(report: ContinuityReport, issueId: string, patch: Partial<ContinuityReport['issues'][number]>) {
    await onUpdateReport({ ...report, updatedAt: now(), issues: report.issues.map(item => item.id === issueId ? { ...item, ...patch } : item) });
  }
  async function readArchive(id: string) {
    setSelectedArchiveId(id);
    let archive = await loadArchive(id).catch(() => null);
    if (!archive && folder) {
      try { archive = JSON.parse(await (await readBlob(folder, `chat/archives/${id}.json`)).text()) as ChatArchive; await saveArchive(archive).catch(() => {}); }
      catch { /* Report below. */ }
    }
    if (!archive) { setError('This archive was not found in the browser or connected folder.'); return; }
    setSelectedArchive(archive);
  }
  async function compactNow() {
    if (busy || threadRef.current.messages.length === threadRef.current.activeFrom) return;
    const startedAt = performance.now();
    setBusy('Compacting context'); setError('');
    try { await archiveWindow(threadRef.current, 'Manual checkpoint'); showCompletionToast('Context compacted; the full archive is saved.', startedAt); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  async function send() {
    const content = draft.trim();
    if (!content || busy || !hydrated) return;
    const startedAt = performance.now();
    if (mode === 'checker') { await runContinuityCheck(content); return; }
    if (mode === 'freewrite' || mode === 'interview') {
      setBusy(mode === 'freewrite' ? 'Saving world note' : 'Saving answer'); setError('');
      try {
        if (mode === 'freewrite') await saveFreeWriting(content);
        else if (threadRef.current.interviewQuestion) await saveInterviewAnswer(content);
        else { const next = { ...threadRef.current, messages: [...threadRef.current.messages, makeMessage('user', content)] }; await persist(next); setDraft(''); await askQuestion(next, content); }
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(''); }
      return;
    }
    if (content.startsWith('/image ') && !imageReady) { onRequestModelTest('image'); return; }
    if (!aiReady && content !== '/files' && !content.startsWith('/read ') && !content.startsWith('/image ')) { onRequestModelTest(); return; }
    setDraft(''); setError('');
    setBusy('Thinking');
    let persistedUser = false;
    try {
      let current = threadRef.current;
      const user = makeMessage('user', content);
      if (content === '/files') {
        const paths = [...Object.keys(projectFiles(project)), ...project.sources.map(x => x.path).filter(Boolean), ...project.characters.flatMap(x => x.imagePaths)].sort();
        await persist({ ...current, messages: [...current.messages, user, makeMessage('tool', paths.length ? paths.join('\n') : 'No project files yet.')] });
        persistedUser = true;
        return;
      }
      if (content.startsWith('/read ')) {
        const query = content.slice(6).trim();
        let text: string;
        if (query.startsWith('path:')) {
          if (!folder) throw new Error('Connect a folder to read a file by path.');
          const path = query.slice(5).trim();
          if (!path || path.startsWith('/') || path.split('/').some(x => x === '..' || !x)) throw new Error('Use a relative path inside the connected folder.');
          const file = await readBlob(folder, path);
          const raw = path.endsWith('.json') ? await file.text() : await extractText(file);
          text = `${path}\n${raw.slice(0, 20000)}${raw.length > 20000 ? '\n[Truncated to 20,000 characters]' : ''}`;
        } else {
          const results = searchProject(project, query);
          text = results.length ? results.map(x => `${x.title}\n${x.text.slice(0, 2500)}`).join('\n\n——\n\n') : 'No matching project records found.';
        }
        await persist({ ...current, messages: [...current.messages, user, makeMessage('tool', text)] });
        persistedUser = true;
        showCompletionToast('File reading complete.', startedAt);
        return;
      }
      if (content.startsWith('/image ')) {
        if (!folder) throw new Error('Connect a folder before generating an image.');
        const blob = await generateImage(imageConfig, `Create an original visual reference for this story world. ${content.slice(7)}. Project context: ${project.title}; ${project.premise.slice(0, 900)}. Avoid copyrighted characters and logos.`);
        const path = `assets/chat/${uid()}.png`;
        await writeBlob(folder, path, blob);
        await persist({ ...current, messages: [...current.messages, user, { ...makeMessage('assistant', 'Generated image saved to ' + path), imagePath: path, provider: 'Image generator', model: imageConfig.model }] });
        persistedUser = true;
        showToast('Image generation complete. The image is saved in your project folder.');
        return;
      }
      if (!aiReady) throw new Error(config.provider === 'ollama' && ollamaState === 'missing' && config.model
        ? `Ollama does not have “${config.model}”. Choose an installed model in Settings & AI${ollamaModels.length ? `, such as ${ollamaModels.filter(x => x.startsWith('llama3.2:')).join(' or ') || ollamaModels[0]}` : ''}.`
        : `No usable AI model is ready. ${modelLabel}. Open Settings & AI to choose and configure one.`);
      const projected = contextFor({ ...current, messages: [...current.messages, user] }, content).estimate;
      if (projected > config.contextWindow - config.maxOutputTokens - 256) {
        setBusy('Compacting context');
        current = await archiveWindow(current, content);
      }
      if (contextFor({ ...current, messages: [...current.messages, user] }, content).estimate > config.contextWindow - config.maxOutputTokens - 256) {
        setDraft(content);
        throw new Error('This message exceeds the configured context budget. Shorten it or increase the profile’s context window.');
      }
      const withUser = { ...current, messages: [...current.messages, user] };
      await persist(withUser);
      persistedUser = true;
      const context = contextFor(withUser, content);
      setBusy('Thinking');
      const result = await complete(config, context.turns, context.system, undefined, config.provider === 'browser' ? browserTools : undefined);
      setLastUsage({ input: result.inputTokens, output: result.outputTokens });
      await persist({ ...withUser, messages: [...withUser.messages, ...(result.toolEvents || []).map(event => makeMessage('tool', event)), { ...makeMessage('assistant', result.text), provider: config.label, model: config.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens }] });
      showCompletionToast('AI response ready in the writing room.', startedAt);
    } catch (e) { if (!persistedUser) setDraft(content); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length || !hydrated) return;
    const names = Array.from(files).map(x => x.name);
    setBusy('Importing files'); setError('');
    try {
      await onUpload(files);
      await persist({ ...threadRef.current, messages: [...threadRef.current.messages, makeMessage('tool', `Imported ${names.join(', ')} into Source documents. Use /read to inspect the extracted text.`)] });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  const visibleMemories = memoryQuery ? relevantMemories(thread.memories, memoryQuery, 30) : [...thread.memories].reverse().slice(0, 12);
  const activeCount = thread.messages.length - thread.activeFrom;
  const currentEstimate = (() => { try { return contextFor(thread, '').estimate; } catch { return 0; } })();
  const reports = project.reviews || [];
  const selectedReport = reports.find(x => x.id === selectedReportId) || reports.at(-1);
  return <div className="chat-layout">
    <div className="chat-main" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void importFiles(e.dataTransfer.files); } }}>
      <div className="chat-header"><div><span className="eyebrow">STORY STUDIO / ASSISTANT</span><h1>Writing room</h1><p>Explore ideas, consult your files, and build the story together.</p></div><div className="chat-header-controls"><select aria-label="AI profile" value={config.id} onChange={e => onSelectProfile(e.target.value)}>{profiles.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><button title="AI settings" onClick={onSettings}><Settings2 size={18}/></button></div></div>
      <div className="writing-mode-panel">
        <div className="writing-mode-tabs" role="tablist" aria-label="Writing mode">{([['chat', 'Chat'], ['interview', 'Interviewer'], ['freewrite', 'Free writing'], ['suggest', 'Suggestions'], ['checker', 'Continuity check']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'active' : ''} disabled={!!busy || !hydrated} onClick={() => void changeMode(id).catch(error => setError(error instanceof Error ? error.message : String(error)))}>{label}</button>)}</div>
        {mode === 'interview' && <div className="mode-content"><p>The interviewer asks one question at a time based on your story metadata and saved world notes. Your answer becomes an editable world note. Starter questions work without an AI model.</p><div className="mode-actions"><button className="button secondary compact" disabled={!!busy || !hydrated} onClick={() => void askQuestion().catch(error => { setBusy(''); setError(error instanceof Error ? error.message : String(error)); })}>{thread.interviewQuestion ? 'Ask a different question' : 'Ask the first question'}</button>{project.world.some(x => x.title.startsWith('Interview:')) && <button className="button secondary compact" onClick={() => onOpenWorld([...project.world].reverse().find(x => x.title.startsWith('Interview:'))!.id)}>Edit latest answer</button>}{thread.interviewQuestion && <span>Answer the question below to save it and continue.</span>}</div></div>}
        {mode === 'freewrite' && <div className="mode-content"><p>Write freely in the box below. Saving creates an editable world note and, when a folder is connected, writes its JSON file immediately.</p><div className="mode-fields"><input aria-label="Note title" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Note title (optional)"/><select aria-label="World note category" value={noteCategory} onChange={e => setNoteCategory(e.target.value as WorldNote['category'])}>{(['Other', 'Place', 'Culture', 'History', 'Rule'] as const).map(category => <option key={category}>{category}</option>)}</select><button className="button secondary compact" onClick={() => onOpenWorld(project.world.at(-1)?.id || '')}>Open world bible</button></div></div>}
        {mode === 'suggest' && <div className="mode-content"><p>Review optional ideas drawn from your imported story structure. Add an idea to the world bible only when you want it to become part of your project.</p><div className="mode-actions"><button className="button secondary compact" disabled={!!busy || !aiReady} onClick={() => void generateSuggestions()}>Generate more suggestions</button><span>{aiReady ? 'Uses the selected model' : 'Load a model to generate more'}</span></div><div className="suggestion-list">{(project.storyGraph?.suggestions || []).filter(x => x.status === 'proposed').length ? project.storyGraph.suggestions.filter(x => x.status === 'proposed').map(x => <div className="suggestion-card" key={x.id}><strong>{x.title}</strong><p>{x.detail}</p>{x.evidence && <small>From: {x.evidence}</small>}<div><button onClick={() => onSuggestionStatus(x.id, 'accepted')}>Add to world bible</button><button onClick={() => onSuggestionStatus(x.id, 'dismissed')}>Dismiss</button></div></div>) : <p>No suggestions yet. Import an outline or generate ideas with a model.</p>}</div></div>}
        {mode === 'checker' && <div className="mode-content"><p>Review canon for contradictions, paradoxes, plot holes, anachronisms, narrator discrepancies, and retcons. Findings are questions for you to resolve; each run is saved for offline review.</p><div className="mode-actions"><button className="button secondary compact" disabled={!!busy || !hydrated} onClick={() => void runContinuityCheck()}>Run continuity check</button><span>{aiReady ? 'AI and structural checks' : 'Structural checks only until a model is ready'}</span></div>{reports.length > 0 && <><label className="mode-report-select">Saved reviews <select value={selectedReport?.id || ''} onChange={e => setSelectedReportId(e.target.value)}>{[...reports].reverse().map(report => <option key={report.id} value={report.id}>{report.title}</option>)}</select></label>{selectedReport && <div className="mode-report"><p>{selectedReport.summary}</p>{selectedReport.issues.length ? selectedReport.issues.map(issue => <div className="mode-issue" key={issue.id}><strong>{issue.category} · {issue.severity}</strong><p>{issue.summary}</p><small>{issue.evidence}<br/>{issue.paths.join(', ')}</small><p>{issue.question}</p><div><select aria-label={`Status for ${issue.summary}`} value={issue.status} onChange={e => void reviseIssue(selectedReport, issue.id, { status: e.target.value as typeof issue.status }).catch(error => setError(String(error)))}><option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select><input aria-label={`Resolution for ${issue.summary}`} value={resolutionDrafts[issue.id] ?? issue.resolution} onChange={e => setResolutionDrafts(previous => ({ ...previous, [issue.id]: e.target.value }))} placeholder="Your decision or correction"/><button onClick={() => void reviseIssue(selectedReport, issue.id, { resolution: resolutionDrafts[issue.id] ?? issue.resolution }).catch(error => setError(String(error)))}>Save</button></div></div>) : <p>No issues in this review. This does not prove the story is contradiction-free.</p>}</div>}</>}</div>}
      </div>
      <div className="chat-messages">
        {thread.messages.length === 0 && hydrated && <div className="chat-welcome"><div className="chat-welcome-mark"><Sparkles size={27}/></div><span>YOUR CREATIVE PARTNER</span><h2>Where should we begin?</h2><p>Talk through your story, import an outline, read from the project, or create a visual reference. Your conversation stays in this browser and can be copied to your workspace folder.</p><div><button onClick={() => { setDraft('Help me plan the first book based on the project premise.'); composerRef.current?.focus(); }}>Plan the first book</button><button onClick={() => fileRef.current?.click()}>Import an outline</button><button onClick={() => { setDraft('/read '); composerRef.current?.focus(); }}>Read project files</button></div></div>}
        {thread.messages.map((message, index) => <div key={message.id} className={`chat-row ${message.role}`}><div className="chat-avatar">{message.role === 'user' ? 'Y' : message.role === 'tool' ? <BookOpen size={15}/> : <Sparkles size={15}/>}</div><div className="chat-bubble"><div className="chat-message-meta"><strong>{message.role === 'user' ? 'You' : message.role === 'tool' ? 'Workspace tool' : message.provider || 'Assistant'}</strong><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{index === thread.activeFrom && thread.activeFrom > 0 && <em>New context window</em>}</div><div className="chat-text">{message.role === 'assistant' ? <MarkdownContent>{message.content}</MarkdownContent> : message.content}</div>{message.imagePath && <ImagePreview folder={folder} path={message.imagePath}/>}</div></div>)}
        {busy && <div className="chat-row assistant"><div className="chat-avatar"><Sparkles size={15}/></div><div className="chat-bubble chat-thinking"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/>{busy}…</div></div>}
        <div ref={bottomRef}/>
      </div>
      <div className="chat-compose-wrap">{error && <div className="chat-error" role="alert">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}<div className="chat-composer"><textarea ref={composerRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && mode !== 'freewrite') { e.preventDefault(); void send(); } }} placeholder={!hydrated ? 'Loading your conversation…' : mode === 'freewrite' ? 'Write an idea, fact, scene thought, or question for your world bible…' : mode === 'interview' ? thread.interviewQuestion ? 'Answer the interviewer’s question…' : 'Suggest a topic, or click Ask the first question…' : mode === 'checker' ? 'Optional: name an area to focus on, then run a check…' : 'Ask about your story, or type /read or /image…'} rows={mode === 'freewrite' ? 7 : 3}/><div className="chat-compose-actions"><div>{mode === 'chat' && <><button title="Import files" disabled={!hydrated || !!busy} onClick={() => fileRef.current?.click()}><FilePlus2 size={17}/> Import</button><button title="Read project files" disabled={!hydrated || !!busy} onClick={() => { setDraft('/read '); composerRef.current?.focus(); }}><Search size={17}/> Read</button><button title="Generate image" disabled={!hydrated || !!busy} onClick={() => { if (!imageReady) { onRequestModelTest('image'); return; } setDraft('/image '); composerRef.current?.focus(); }}><ImagePlus size={17}/> Image</button></>}</div><button className="chat-send" title={mode === 'freewrite' ? 'Save world note' : mode === 'checker' ? 'Run focused check' : 'Send message'} disabled={!draft.trim() || !!busy || !hydrated} onClick={() => void send()}><ArrowUp size={18}/></button></div></div><div className="chat-footnote"><span role="status">{modelLabel}{config.provider === 'ollama' && ollamaState === 'missing' && ollamaModels.length ? ` · installed: ${ollamaModels.join(', ')}` : ''}{activeCatalogModel && <> · <a href={activeCatalogModel.licenseUrl} target="_blank" rel="noreferrer">{activeCatalogModel.license}</a>{activeCatalogModel.id === 'qwen25-3b' && <> · Noncommercial research/evaluation use</>}{activeCatalogModel.id === 'gemma3-1b' && <> · <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noreferrer">Use restrictions</a></>}</>}</span><span>{activeCount} active messages · ~{currentEstimate.toLocaleString()} / {config.contextWindow.toLocaleString()} context tokens{lastUsage.input ? ` · last input ${lastUsage.input.toLocaleString()}` : ''}</span></div></div>
      <input ref={fileRef} hidden type="file" multiple accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" onChange={e => { void importFiles(e.target.files); e.target.value = ''; }}/>
    </div>
    <aside className={showContext ? 'context-panel' : 'context-panel collapsed'}>
      <button className="context-toggle" onClick={() => setShowContext(!showContext)}><Archive size={17}/>{showContext && <span>Context & memory</span>}<ChevronDown size={15}/></button>
      {showContext && <div className="context-content"><div className="context-meter"><div><span>ACTIVE WINDOW</span><strong>~{currentEstimate.toLocaleString()} / {config.contextWindow.toLocaleString()}</strong></div><div className="meter-track"><i style={{ width: `${Math.min(100, currentEstimate / config.contextWindow * 100)}%` }}/></div><small>Estimated tokens. Compacts before the configured limit.</small><button className="compact-now" disabled={!!busy || !activeCount} onClick={() => void compactNow()}>Compact now</button></div><div className="context-section"><h3>Current summary</h3><p>{thread.summary || 'No compaction yet. Your full conversation is kept.'}</p></div><div className="context-section"><h3>Memory shards <span>{thread.memories.length}</span></h3><input className="memory-search" value={memoryQuery} onChange={e => setMemoryQuery(e.target.value)} placeholder="Search prior context…"/>{visibleMemories.length ? visibleMemories.map(m => <div className="memory-card" key={m.id}><div><strong>{m.title}</strong><button onClick={() => void persist({ ...threadRef.current, pinnedIds: threadRef.current.pinnedIds.includes(m.id) ? threadRef.current.pinnedIds.filter(id => id !== m.id) : [...threadRef.current.pinnedIds, m.id] })}>{thread.pinnedIds.includes(m.id) ? 'Unpin' : 'Pin'}</button></div><p>{m.text}</p></div>) : <p className="context-empty">Archived memories will appear here after compaction.</p>}</div><div className="context-section"><h3>Full archives <span>{thread.archives.length}</span></h3>{[...thread.archives].reverse().map(a => <button key={a.id} className={selectedArchiveId === a.id ? 'archive-item selected' : 'archive-item'} onClick={() => void readArchive(a.id)}><strong>{new Date(a.createdAt).toLocaleString()}</strong><small>{a.messageCount} messages · original window</small></button>)}{selectedArchive && <div className="archive-preview"><div className="archive-preview-title"><strong>Uncompacted copy</strong><button onClick={() => { setSelectedArchive(null); setSelectedArchiveId(''); }}><X size={14}/></button></div>{selectedArchive.messages.map(x => <div key={x.id}><b>{x.role}</b><p>{x.content}</p></div>)}</div>}</div></div>}
    </aside>
  </div>;
}
