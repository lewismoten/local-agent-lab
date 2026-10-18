import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowDown, ArrowUp, BookOpen, BookmarkPlus, Brain, ChevronRight, ClipboardList, Copy, FileCode2, FolderOpen, Menu, MessageSquare, MoreHorizontal, Pin, Plus, ScanSearch, Search, Settings2, Sparkles, Timer, Upload, UserRound, Wrench, X } from 'lucide-react';
import { DEFAULT_PROFILES, type AIConfig } from './ai.ts';
import { browserImageAssetsManager } from './browserImageAssets.ts';
import { setBrowserImageFolder, unloadBrowserImageModel } from './browserImage.ts';
import { getBrowserModelStatus, isBrowserModelLoadedFrom, subscribeBrowserModel, unloadBrowserModel } from './browserModel.ts';
import { unloadBrowserSpeech, stopBrowserSpeech } from './browserSpeech.ts';
import { unloadBrowserTranscription } from './browserTranscription.ts';
import { browserThinkingBudget, browserThinkingMode } from './browserThinking.ts';
import HarnessTimeline from './HarnessTimeline.tsx';
import { recentTimelineTopics } from './harnessTimeline.ts';
import HarnessChapters from './HarnessChapters.tsx';
import HarnessConversationSearch from './HarnessConversationSearch.tsx';
import HarnessQuickOpen from './HarnessQuickOpen.tsx';
import HarnessAgentEvents from './HarnessAgentEvents.tsx';
import HarnessIdentities from './HarnessIdentities.tsx';
import { IdentityAvatar, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';
import HarnessTasks from './HarnessTasks.tsx';
import HarnessJournal from './HarnessJournal.tsx';
import type { TaskRecord } from './harnessTasks.ts';
import HarnessFileEditor from './HarnessFileEditor.tsx';
import HarnessToolInventory from './HarnessToolInventory.tsx';
import { detachToolProfile, effectiveConversationToolPermissions, effectiveToolPermissions, toolPermission, type ToolPermission } from './harnessToolPermissions.ts';
import { clearSessionToolGrants, type ToolApprovalRequest } from './harnessToolApprovals.ts';
import { useConfirmDialog } from './ConfirmDialog.tsx';
import FileHistoryDialog from './FileHistoryDialog.tsx';
import { compactConversation, messagesForModel, needsCompaction, promptForConversation, systemPromptCharBudget, titleConversation } from './harnessContext.ts';
import { searchableMessageText } from './harnessCompaction.ts';
import { recallHistory } from './harnessHistory.ts';
import { memoryDraftFromToolEvent, type MemoryDraft } from './harnessMemoryDraft.ts';
import { agentDraftFromToolEvent, type AgentDraft } from './harnessAgentDraft.ts';
import { projectProfileDraftFromToolEvent, type ProjectProfileDraft } from './harnessProjectProfileDraft.ts';
import { projectDraftFromToolEvent, type ProjectDraft } from './harnessProjectDraft.ts';
import { projectInstructionDraftFromToolEvent, type ProjectInstructionDraft } from './harnessProjectInstructionDraft.ts';
import HarnessResponseDiagnostics from './HarnessResponseDiagnostics.tsx';
import { responseDiagnostic, type ResponseDiagnostic } from './harnessResponseDiagnostics.ts';
import { followUpLibraryQuery, isBriefFollowUp } from './harnessFollowUp.ts';
import { addSearchBits, chatIdentity, cleanTags, conversationTagCloud, createConversation, createSearchTermProbe, findConversationTopic, identityInstructions, isoNow, moveVisiblePreference, newId, visiblePreferenceIds, type ConversationMeta, type HarnessAgent, type HarnessIdentity, type HarnessManifest, type HarnessMessage, type HarnessProject, type MemoryRecord, type ModelPurpose, type ModelStamp, type ToolPolicyProfile } from './harnessData.ts';
import { modelStamp, modelStampDetails, modelStampLabel } from './harnessModelStamp.ts';
import { agentDue, agentHasPendingRun, agentRunProject, executeHarnessAgent, finishAgentRun, nextAgentEvent, nextAgentRun, queueAgentEvent, retryAgentRun } from './harnessAgents.ts';
import { AGENT_TEMPLATES, chooseAgentTemplate } from './harnessAgentTemplates.ts';
import { dismissAgentEvent } from './harnessAgentEvents.ts';
import { withAgentRunLock, withIdleAgentLock } from './harnessAgentRunLock.ts';
import { MODEL_PURPOSES, imageCandidates, readyProfile, readyProfiles } from './harnessPreferences.ts';
import { acquireModel, getModelLease, subscribeModelLease } from './harnessLease.ts';
import { openBrowserWorkspace, openFolderWorkspace, type HarnessStore } from './harnessStore.ts';
import { DEFAULT_COMPACTION_AT, shouldMigrateLegacySettings, workspaceSettings, type WorkspaceSettings } from './harnessSettings.ts';
import { listToolFilesPage, toolFilePath, unusedToolFilePath, writeToolFile, type ToolArea, type ToolScope } from './harnessTools.ts';
import { HarnessPartialToolError, harnessComplete, harnessToolReserve } from './harnessMultimodal.ts';
import { interruptedResponseContent } from './harnessInterrupted.ts';
import { HarnessDrafts } from './harnessDrafts.ts';
import { HarnessFileDrafts } from './harnessFileDrafts.ts';
import { projectWithGuide } from './harnessProjectGuide.ts';
import { sidebarScrollForSelection, sidebarSessionWindow, SIDEBAR_SESSION_HEIGHT, sortedSidebarSessions } from './harnessSidebarWindow.ts';
import { formatLibraryHits, indexLibraryFile, indexLibraryProject, indexableLibraryPath, libraryIndexCount, searchLibrary, type LibraryHit, type LibrarySearchPhase } from './harnessLibrary.ts';
import { IMAGE_PRESETS, type ImageConfig, type ImagePreset } from './imageGeneration.ts';
import { ensureBrowserModelReady, invalidateModelSession, isModelConfirmed, isModelReady, testModel, getModelSession, subscribeModelSession } from './modelSession.ts';
import { modelDownloadManager } from './modelDownloadSession.ts';
import { motionAssetsManager } from './motionAssets.ts';
import { needleAssetsManager } from './needleAssets.ts';
import { unloadNeedle } from './needleRuntime.ts';
import { prismEngineManager } from './prismEngine.ts';
import { speechAssetsManager } from './speechAssets.ts';
import { transcriptionAssetsManager } from './transcriptionAssets.ts';
import { wllamaEngineManager } from './wllamaEngine.ts';
import { browserFiles, clearHandle, ensureWritableFolder, hasWritableFolderPermission, loadHandle, readBlob, saveHandle, writeBlob } from './storage.ts';
import HarnessContextInspector from './HarnessContextInspector.tsx';
import ToastViewport from './ToastViewport.tsx';
import { showToast } from './toastStore.ts';
import './harness.css';
import './harness-visual.css';
import './cyber-theme.css';
import './theme-polish.css';
import './theme-upgrade.css';
import './theme-cyber-next.css';
import brandLogo from '../docs/logo.svg?url';

type View = 'chat' | 'discover' | 'journal' | 'tasks' | 'agents' | 'identities' | 'files' | 'memory' | 'models' | 'notices';
const VIEWS: Exclude<View, 'notices'>[] = ['chat', 'discover', 'journal', 'tasks', 'agents', 'identities', 'files', 'memory', 'models'];
const ROUTES: View[] = [...VIEWS, 'notices'];
const VIEW_LABELS: Record<View, string> = { chat: 'Chat', discover: 'Discover', journal: 'Journal', tasks: 'Tasks', agents: 'Agents', identities: 'Identities', files: 'Files & tools', memory: 'Memory', models: 'Models', notices: 'Third-party notices' };
const VIEW_ICONS = { chat: MessageSquare, discover: Search, journal: BookOpen, tasks: ClipboardList, agents: Timer, identities: UserRound, files: FileCode2, memory: Brain, models: Sparkles };
const ProviderSettings = lazy(() => import('./ProviderSettings.tsx'));
const GitPanel = lazy(() => import('./GitPanel.tsx'));
const StarterSetup = lazy(() => import('./StarterSetup.tsx'));
const ThirdPartyNotices = lazy(() => import('./ThirdPartyNotices.tsx'));
const PAGE_SIZE = 48;
const MAX_VISIBLE_MESSAGES = PAGE_SIZE * 3;
const DISCOVER_PAGE_SIZE = 40;
const TIMELINE_PAGE_SIZE = 30;
type SearchResult = { meta: ConversationMeta; excerpt: string; seq?: number };
type SearchFailure = { id: string; title: string; reason: string };
const readRoute = () => {
  const [, section, id] = location.hash.match(/^#\/?([^/?]+)?\/?([^?]*)/) || [];
  const rawSeq = new URLSearchParams(location.hash.split('?')[1] || '').get('seq');
  const seq = rawSeq !== null && /^\d+$/.test(rawSeq) && Number.isSafeInteger(Number(rawSeq)) ? Number(rawSeq) : null;
  return { view: ROUTES.includes(section as View) ? section as View : 'chat', id: id || '', seq };
};
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => { const update = () => setRoute(readRoute()); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return route;
}
const plainError = (error: unknown) => error instanceof Error ? error.message : String(error);
const prettyDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function loadProfiles(): AIConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem('ai-profiles') || 'null') as AIConfig[] | null;
    if (saved?.length) return [...saved.map(profile => ({ ...profile, apiKey: '', browserThinkingMode: profile.browserThinkingMode ?? browserThinkingMode(profile) })), ...DEFAULT_PROFILES.filter(profile => !saved.some(item => item.id === profile.id))];
  } catch { /* Use new defaults. */ }
  return DEFAULT_PROFILES;
}
function loadImageConfig(): ImageConfig {
  try { const saved = JSON.parse(localStorage.getItem('image-generator') || '{}') as ImageConfig; return saved.preset in IMAGE_PRESETS ? { ...IMAGE_PRESETS[saved.preset], ...saved, apiKey: '' } : IMAGE_PRESETS.none; }
  catch { return IMAGE_PRESETS.none; }
}
async function loadWorkspaceSettings(store: HarnessStore): Promise<WorkspaceSettings> {
  const saved = await store.settings();
  if (saved) {
    const profiles = [...saved.profiles, ...DEFAULT_PROFILES.filter(item => !saved.profiles.some(profile => profile.id === item.id))];
    return workspaceSettings(profiles, profiles.some(item => item.id === saved.selectedProfileId) ? saved.selectedProfileId : 'browser',
      saved.imageConfig.preset in IMAGE_PRESETS ? { ...IMAGE_PRESETS[saved.imageConfig.preset], ...saved.imageConfig } : IMAGE_PRESETS.none, saved.compactionAt);
  }
  const migrate = shouldMigrateLegacySettings(store.workspaceId, localStorage.getItem('harness-settings-migrated') === 'yes', !!localStorage.getItem('ai-profiles'));
  const initial = migrate
    ? workspaceSettings(loadProfiles(), localStorage.getItem('ai-selected-profile') || 'browser', loadImageConfig())
    : workspaceSettings(DEFAULT_PROFILES, 'browser', IMAGE_PRESETS.none);
  await store.saveSettings(initial);
  if (migrate) localStorage.setItem('harness-settings-migrated', 'yes');
  return initial;
}
type AgentStage = 'preparing' | 'queued' | 'working';
function AgentNotice({ agents, runningId, runningStage, chatBusy, modelBusy, onDelay, onPause }: { agents: HarnessAgent[]; runningId: string; runningStage: AgentStage; chatBusy: boolean; modelBusy: boolean; onDelay: (agent: HarnessAgent) => void; onPause: (agent: HarnessAgent) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const running = agents.find(agent => agent.id === runningId);
  if (running) return <div className="harness-agent-notice"><span className="harness-pulse"/><span className="harness-agent-notice-label">{running.name} {runningStage === 'working' ? 'is working' : runningStage === 'queued' ? 'is waiting for the model' : 'is preparing'}</span><span className="harness-agent-notice-mobile" aria-hidden="true">{runningStage === 'working' ? 'Running' : runningStage === 'queued' ? 'Queued' : 'Preparing'}</span><button aria-label={`Stop and pause ${running.name}`} onClick={() => onPause(running)}>Stop & pause</button></div>;
  const upcoming = agents.filter(agentHasPendingRun).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))[0];
  if (!upcoming) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(upcoming.nextRunAt) - now) / 1000));
  if (seconds > 30) return null;
  const waiting = seconds === 0 && (chatBusy || modelBusy);
  const label = waiting ? `${upcoming.name} waits for ${chatBusy ? 'chat' : 'model'}` : `${upcoming.name} in ${seconds}s`;
  return <div className="harness-agent-notice"><Timer size={14}/><span className="harness-agent-notice-label">{label}</span><span className="harness-agent-notice-mobile" aria-hidden="true">{waiting ? 'Queued' : `${seconds}s`}</span><button aria-label={`Delay ${upcoming.name} by five minutes`} onClick={() => onDelay(upcoming)}>Delay 5m</button><button aria-label={`Pause ${upcoming.name}`} onClick={() => onPause(upcoming)}>Pause</button></div>;
}
function GeneratedImage({ folder, path }: { folder: FileSystemDirectoryHandle | null; path: string }) {
  const [url, setUrl] = useState('');
  const [provenance, setProvenance] = useState<{ model: string; provider: string; prompt: string } | null>(null);
  useEffect(() => {
    setUrl(''); setProvenance(null);
    if (!folder) return;
    let active = true, next = '';
    void readBlob(folder, path).then(file => { next = URL.createObjectURL(file); if (active) setUrl(next); else URL.revokeObjectURL(next); }).catch(() => {});
    void readBlob(folder, path.replace(/\.png$/i, '.json')).then(file => file.text()).then(raw => {
      const info = JSON.parse(raw) as Record<string, unknown>;
      if (active && typeof info.imageModel === 'string' && typeof info.imageProvider === 'string') {
        setProvenance({ model: info.imageModel, provider: info.imageProvider, prompt: typeof info.prompt === 'string' ? info.prompt : '' });
      }
    }).catch(() => {});
    return () => { active = false; if (next) URL.revokeObjectURL(next); };
  }, [folder, path]);
  return url ? <figure className="harness-generated-figure"><a href={url} download={path.split('/').at(-1)} title={`Download ${path}`}><img className="harness-generated-image" src={url} alt={provenance?.prompt ? `Generated image: ${provenance.prompt.slice(0, 180)}` : 'Generated image'}/></a>{provenance && <figcaption title={provenance.prompt || undefined}>🎨 {provenance.model.split('/').at(-1)} · {provenance.provider}</figcaption>}</figure> : null;
}

function DiscoverEmptyState({ onChat, onModels, onFiles }: { onChat: () => void; onModels: () => void; onFiles: () => void }) {
  return <div className="harness-discover-empty">
    <div className="harness-discover-map" aria-hidden="true"><span className="harness-discover-map-ring"/><span className="harness-discover-map-core"><Sparkles size={28}/></span><span className="harness-discover-map-node node-chat"><MessageSquare size={18}/></span><span className="harness-discover-map-node node-models"><Brain size={18}/></span><span className="harness-discover-map-node node-files"><FileCode2 size={18}/></span></div>
    <div className="harness-discover-empty-copy"><span className="harness-overline">YOUR WORK STARTS HERE</span><h2>Make your first connection.</h2><p>Conversations and their topics will appear here as you work. Start a chat, choose a model, or add project files.</p><div className="harness-discover-empty-actions"><button className="harness-primary" onClick={onChat}><MessageSquare size={16}/> Start a chat</button><button className="harness-secondary" onClick={onModels}><Brain size={16}/> Explore models</button><button className="harness-secondary" onClick={onFiles}><FileCode2 size={16}/> Open files</button></div></div>
  </div>;
}

export default function HarnessApp() {
  const confirmAction = useConfirmDialog();
  const route = useRoute();
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => document.documentElement.style.setProperty('--h-visible-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--h-visible-height');
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [store, setStore] = useState<HarnessStore | null>(null);
  const [manifest, setManifest] = useState<HarnessManifest | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [rememberedFolder, setRememberedFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectId, setProjectId] = useState(() => localStorage.getItem('harness-project-id') || 'home');
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const sortedSessions = useMemo(() => sortedSidebarSessions(sessions), [sessions]);
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
  const [sidebarViewportHeight, setSidebarViewportHeight] = useState(480);
  const sidebarWindow = sidebarSessionWindow(sortedSessions.length, sidebarScrollTop, sidebarViewportHeight);
  const sessionsRef = useRef<ConversationMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [oldest, setOldest] = useState(0);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [draftReadyKey, setDraftReadyKey] = useState('');
  const draftLoadRun = useRef(0);
  const draftManagerRef = useRef<HarnessDrafts | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('Working…');
  const [liveResponse, setLiveResponse] = useState('');
  const [liveThinking, setLiveThinking] = useState('');
  const liveResponseTarget = useRef<{ projectId: string; sessionId: string } | null>(null);
  const liveResponseBuffer = useRef('');
  const liveThinkingBuffer = useRef('');
  const liveResponseTimer = useRef<number | null>(null);
  const lastTokenStatusAt = useRef(0);
  const busyRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  if (!draftManagerRef.current) draftManagerRef.current = new HarnessDrafts(cause => setError(`Could not save chat draft: ${plainError(cause)}`));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarWasOpen = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => { setMobileLayout(media.matches); if (!media.matches) setSidebarOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (mobileLayout && sidebarOpen) {
      sidebarWasOpen.current = true;
      sidebarCloseRef.current?.focus();
    } else if (sidebarWasOpen.current) {
      sidebarWasOpen.current = false;
      if (mobileLayout) menuButtonRef.current?.focus();
    }
  }, [mobileLayout, sidebarOpen]);
  useLayoutEffect(() => {
    const list = sidebarListRef.current;
    if (!list) return;
    const update = () => setSidebarViewportHeight(list.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [loading, sidebarOpen]);
  useEffect(() => {
    const list = sidebarListRef.current;
    if (!list || !sortedSessions.length || !selectedId || route.view !== 'chat') return;
    const index = sortedSessions.findIndex(item => item.id === selectedId);
    const next = sidebarScrollForSelection(index, list.scrollTop, list.clientHeight);
    if (next !== list.scrollTop) { list.scrollTop = next; setSidebarScrollTop(next); }
  }, [sortedSessions, selectedId, route.view, projectId]);
  useEffect(() => {
    if (!mobileLayout || !sidebarOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { setSidebarOpen(false); return; }
      if (event.key !== 'Tab' || !sidebarRef.current) return;
      const buttons = [...sidebarRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (!first || !last) return;
      if (!sidebarRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mobileLayout, sidebarOpen]);
  const [profiles, setProfiles] = useState<AIConfig[]>(loadProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState(() => localStorage.getItem('ai-selected-profile') || 'browser');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [imageConfig, setImageConfig] = useState<ImageConfig>(loadImageConfig);
  const [compactionAt, setCompactionAt] = useState(DEFAULT_COMPACTION_AT);
  const [settingsReadyId, setSettingsReadyId] = useState('');
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'topics' | 'full'>('topics');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchProgress, setSearchProgress] = useState('');
  const [searchFailures, setSearchFailures] = useState<SearchFailure[]>([]);
  const [searchFailureTotal, setSearchFailureTotal] = useState(0);
  const searchRun = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const [searched, setSearched] = useState(false);
  const [allSessions, setAllSessions] = useState<ConversationMeta[]>([]);
  const [discoverLimit, setDiscoverLimit] = useState(DISCOVER_PAGE_SIZE);
  const [timelineLimit, setTimelineLimit] = useState(TIMELINE_PAGE_SIZE);
  const [actionMeta, setActionMeta] = useState<ConversationMeta | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionAbortRef = useRef<AbortController | null>(null);
  const [actionCanStop, setActionCanStop] = useState(false);
  const [actionProgress, setActionProgress] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [actionDestination, setActionDestination] = useState('home');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectInstructions, setProjectInstructions] = useState('');
  const [projectIdentityId, setProjectIdentityId] = useState('');
  const [projectProfileId, setProjectProfileId] = useState('');
  const [projectFilesPath, setProjectFilesPath] = useState('');
  const [projectToolAccess, setProjectToolAccess] = useState<'full' | 'read-only'>('full');
  const [toolPolicyBusy, setToolPolicyBusy] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState('');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryTags, setMemoryTags] = useState('');
  const [memoryScope, setMemoryScope] = useState<MemoryRecord['scope']>('project');
  const [editingMemoryId, setEditingMemoryId] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);
  const memoryFormRef = useRef<HTMLDivElement>(null);
  const [fileArea, setFileArea] = useState<'files' | 'library'>('files');
  const [fileDirectory, setFileDirectory] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileEntries, setFileEntries] = useState<{ path: string; kind: 'file' | 'directory'; bytes?: number }[]>([]);
  const [fileNextOffset, setFileNextOffset] = useState<number | null>(null);
  const [fileTotal, setFileTotal] = useState(0);
  const fileListRun = useRef(0);
  const [fileText, setFileText] = useState('');
  const openedFile = useRef<{ folder: FileSystemDirectoryHandle; projectId: string; area: ToolArea; path: string; text: string } | null>(null);
  const [fileDraftReadyKey, setFileDraftReadyKey] = useState('');
  const fileDraftLoadRun = useRef(0);
  const fileDraftManagerRef = useRef<HarnessFileDrafts | null>(null);
  if (!fileDraftManagerRef.current) fileDraftManagerRef.current = new HarnessFileDrafts(cause => setError(`Could not save file editor draft: ${plainError(cause)}`));
  const [fileBusy, setFileBusy] = useState(false);
  const [chatUploadBusy, setChatUploadBusy] = useState(false);
  const [chatDragOver, setChatDragOver] = useState(false);
  const chatDragDepth = useRef(0);
  const fileWorkCount = useRef(0);
  const [libraryCount, setLibraryCount] = useState(0);
  const [libraryProgress, setLibraryProgress] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryHits, setLibraryHits] = useState<LibraryHit[]>([]);
  const [librarySearched, setLibrarySearched] = useState(false);
  const [librarySearchBusy, setLibrarySearchBusy] = useState(false);
  const [librarySearchProgress, setLibrarySearchProgress] = useState<{ checked: number; total: number; phase: LibrarySearchPhase } | null>(null);
  const libraryAbortRef = useRef<AbortController | null>(null);
  const librarySearchAbortRef = useRef<AbortController | null>(null);
  const workspaceReadTasks = useRef(new Set<Promise<void>>());
  const switchingWorkspace = useRef(false);
  const gitActivityBusy = useRef(false);
  const [gitBusy, setGitBusy] = useState(false);
  const workspaceWrites = useRef(0);
  const workspaceEpoch = useRef(0);
  const [gitRevision, setGitRevision] = useState(0);
  const [modelStatus, setModelStatus] = useState('');
  const [autoLoadingKey, setAutoLoadingKey] = useState('');
  const autoLoadPending = useRef(new Set<string>());
  const autoLoadFailed = useRef(new Set<string>());
  const [preferencePurpose, setPreferencePurpose] = useState<ModelPurpose>('chat');
  const [agentDraft, setAgentDraft] = useState<HarnessAgent | null>(null);
  const [runningAgentId, setRunningAgentId] = useState('');
  const [runningAgentStage, setRunningAgentStage] = useState<AgentStage>('preparing');
  const runningAgentRef = useRef('');
  const agentAbortRef = useRef<AbortController | null>(null);
  const manifestRef = useRef(manifest);
  const actionDialog = useRef<HTMLDialogElement>(null);
  const projectDialog = useRef<HTMLDialogElement>(null);
  const agentDialog = useRef<HTMLDialogElement>(null);
  const modelStampDialog = useRef<HTMLDialogElement>(null);
  const responseDiagnosticDialog = useRef<HTMLDialogElement>(null);
  const diagnosticOpenRun = useRef(0);
  const conversationToolsDialog = useRef<HTMLDialogElement>(null);
  const [selectedModelStamp, setSelectedModelStamp] = useState<ModelStamp | null>(null);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<ResponseDiagnostic | null>(null);
  const [selectedDiagnosticMessageId, setSelectedDiagnosticMessageId] = useState('');
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState('');
  const messageEnd = useRef<HTMLDivElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const pendingHistoryScroll = useRef<number | null>(null);
  const pendingPageAnchor = useRef<{ seq: number; top: number } | null>(null);
  const suppressHistoryAutoScroll = useRef(false);
  const historyPagingGuard = useRef<'older' | 'newer' | null>(null);
  const historyViewEpoch = useRef(0);
  const historyPageBusy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatFileInput = useRef<HTMLInputElement>(null);
  const lease = useSyncExternalStore(subscribeModelLease, getModelLease);
  const modelSessionStatus = useSyncExternalStore(subscribeModelSession, getModelSession);
  const browserStatus = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);

  const project = manifest?.projects.find(item => item.id === projectId) || manifest?.projects[0];
  const selected = sessions.find(item => item.id === selectedId) || null;
  const conversationAgent = selected?.agentId ? manifest?.agents.find(item => item.id === selected.agentId) : undefined;
  const identityId = conversationAgent ? conversationAgent.identityId : project?.identityId === 'none' ? '' : project?.identityId || manifest?.chatIdentityId;
  const activeIdentity = manifest?.identities.find(item => item.id === identityId);
  const activeIdentityAvatarUrl = useIdentityAvatarUrl(store, activeIdentity);
  const profile = profiles.find(item => item.id === selectedProfileId) || profiles[0];
  const config: AIConfig = { ...profile, apiKey: apiKeys[profile.id] || '' };
  const chatProfileId = project?.defaultProfileId && profiles.some(item => item.id === project.defaultProfileId) ? project.defaultProfileId : selectedProfileId;
  const chatProfile = profiles.find(item => item.id === chatProfileId) || profile;
  const chatCandidates = manifest ? readyProfiles(chatProfileId, 'chat', manifest.modelPreferences, profiles, apiKeys, !!folder) : [];
  const displayedPreferences = manifest ? visiblePreferenceIds(manifest.modelPreferences[preferencePurpose] || [], preferencePurpose === 'chat' ? chatProfileId : '') : [];
  const chatConfig = chatCandidates[0] || null;
  const modelReady = !!chatConfig;
  const chatUsingFallback = !!chatConfig && chatConfig.id !== chatProfileId;
  const quickModelReady = isModelReady(config);
  const scope: ToolScope = { projects: project ? [project] : [], workspaceAccess: false, workspaceReadOnly: manifest?.workspaceToolAccess === 'read-only', defaultProjectId: projectId, toolProfiles: manifest?.toolProfiles || [] };
  const conversationScope: ToolScope = { ...scope, conversationId: selected?.id, conversationProfileId: selected?.toolProfileId, conversationPermissions: selected?.toolPermissions, conversationApprovedTools: selected?.approvedTools };
  const discoveryTags = useMemo(() => route.view === 'discover' ? conversationTagCloud(searched ? searchResults.map(item => item.meta) : allSessions) : [], [route.view, searched, searchResults, allSessions]);
  const timelinePage = useMemo(() => route.view === 'discover' && !searched ? recentTimelineTopics(allSessions, timelineLimit) : { items: [], total: 0 }, [route.view, searched, allSessions, timelineLimit]);
  const draftSessionId = selected && selected.projectId === project?.id ? selected.id : 'new';
  const draftKey = store && project ? `${store.workspaceId}:${project.id}:${draftSessionId}` : '';
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const projectKey = manifest?.projects.map(item => item.id).join(',') || '';
  const fileDraftKey = store && folder ? `${store.workspaceId}:${projectId}:${fileArea}` : '';
  const fileDraftKeyRef = useRef(fileDraftKey);
  fileDraftKeyRef.current = fileDraftKey;

  // Opening Models from any route should inspect this project's chat profile first.
  // A user can still select another profile while staying on the Models page.
  useEffect(() => {
    if (route.view !== 'models' || !project?.defaultProfileId) return;
    if (profiles.some(item => item.id === project.defaultProfileId)) setSelectedProfileId(project.defaultProfileId);
  }, [route.view, project?.id, project?.defaultProfileId]);

  useEffect(() => {
    if (!store || !project || !draftKey) return;
    const run = ++draftLoadRun.current;
    setDraftReadyKey('');
    void draftManagerRef.current!.open(store, project.id, draftSessionId).then(text => {
      if (run !== draftLoadRun.current || text === null) return;
      setDraft(text); setDraftReadyKey(draftKey);
    }).catch(cause => { if (run === draftLoadRun.current) setError(`Could not open chat draft: ${plainError(cause)}`); });
    return () => { draftLoadRun.current++; };
  }, [store, project?.id, draftSessionId, draftKey]);

  useEffect(() => {
    const flush = () => { void draftManagerRef.current?.flush().catch(cause => setError(`Could not save chat draft: ${plainError(cause)}`)); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  function updateDraft(text: string) {
    if (draftReadyKey !== draftKey) return;
    setDraft(text);
    draftManagerRef.current?.update(text);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      let saved: FileSystemDirectoryHandle | null = null;
      try {
        saved = await loadHandle();
        let workspace;
        let openedFolder: FileSystemDirectoryHandle | null = null;
        // A remembered drive may need a user gesture to restore permission.
        // Startup checks quietly; the sidebar offers an explicit reconnect.
        if (saved && await hasWritableFolderPermission(saved)) {
          workspace = await openFolderWorkspace(saved);
          openedFolder = saved;
        } else { workspace = await openBrowserWorkspace(); openedFolder = await browserFiles(); }
        if (!active) return;
        const settings = await loadWorkspaceSettings(workspace.store);
        if (!active) return;
        const memory = await workspace.store.memory();
        setProfiles(settings.profiles); setSelectedProfileId(settings.selectedProfileId); setImageConfig(settings.imageConfig); setCompactionAt(settings.compactionAt); setApiKeys({});
        setSettingsReadyId(workspace.store.workspaceId);
        manifestRef.current = workspace.manifest; setStore(workspace.store); setManifest(workspace.manifest); setFolder(openedFolder); setRememberedFolder(saved && !workspace.store.folder ? saved : null);
        setMemories(memory); setStartupError('');
      } catch (cause) {
        if (active) {
          try {
            const fallback = await openBrowserWorkspace();
            const settings = await loadWorkspaceSettings(fallback.store);
            const memory = await fallback.store.memory();
            const files = await browserFiles();
            if (!active) return;
            setError(`Could not open the saved workspace: ${plainError(cause)}`);
            setProfiles(settings.profiles); setSelectedProfileId(settings.selectedProfileId); setImageConfig(settings.imageConfig); setCompactionAt(settings.compactionAt); setApiKeys({}); setSettingsReadyId(fallback.store.workspaceId);
            manifestRef.current = fallback.manifest; setStore(fallback.store); setManifest(fallback.manifest); setFolder(files); setRememberedFolder(saved); setMemories(memory); setStartupError('');
          } catch (fallbackCause) {
            if (active) { setStore(null); setManifest(null); setRememberedFolder(saved); setStartupError(`Browser storage could not open: ${plainError(fallbackCause)}`); }
          }
        }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [bootAttempt]);
  useEffect(() => {
    if (!store) return;
    const refresh = (event: Event) => {
      if (switchingWorkspace.current || (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId !== store.workspaceId) return;
      void store.manifest().then(latest => { if (!switchingWorkspace.current) { manifestRef.current = latest; setManifest(latest); } })
        .catch(cause => setError(`Could not refresh workspace settings: ${plainError(cause)}`));
    };
    window.addEventListener('harness:manifest-changed', refresh);
    return () => window.removeEventListener('harness:manifest-changed', refresh);
  }, [store]);
  useEffect(() => {
    if (!store || settingsReadyId !== store.workspaceId) return;
    const next = workspaceSettings(profiles, selectedProfileId, imageConfig, compactionAt);
    const task = settingsWrites.current.catch(() => {}).then(() => trackedWorkspaceWrite(() => store.saveSettings(next)));
    settingsWrites.current = task.catch(() => {});
    void task.catch(cause => setError(`Could not save workspace settings: ${plainError(cause)}`));
  }, [store, settingsReadyId, profiles, selectedProfileId, imageConfig, compactionAt]);
  useEffect(() => {
    if (!folder) return;
    setBrowserImageFolder(folder);
    void modelDownloadManager.discover(folder).catch(cause => setError(plainError(cause)));
    void browserImageAssetsManager.discover(folder).catch(() => {});
    void speechAssetsManager.discover(folder).catch(() => {});
  }, [folder]);
  useEffect(() => {
    if (!store || !manifest) return;
    const id = manifest.projects.some(item => item.id === projectId) ? projectId : manifest.projects[0].id;
    if (id !== projectId) { setProjectId(id); return; }
    let active = true;
    localStorage.setItem('harness-project-id', id);
    setSessions([]); sessionsRef.current = []; setSelectedId(''); setMessages([]);
    if (sidebarListRef.current) sidebarListRef.current.scrollTop = 0;
    setSidebarScrollTop(0);
    void store.sessions(id).then(records => { if (active) { sessionsRef.current = records; setSessions(records); setSelectedId(route.view === 'chat' && records.some(item => item.id === route.id) ? route.id : records[0]?.id || ''); } }).catch(cause => { if (active) setError(plainError(cause)); });
    return () => { active = false; };
  }, [store, projectId]);
  useEffect(() => { if (!busy && route.view === 'chat' && route.id && sessions.some(item => item.id === route.id)) setSelectedId(route.id); }, [busy, route.view, route.id, sessions]);
  useEffect(() => {
    if (!store || !selected) { setMessages([]); setOldest(0); return; }
    if (route.view !== 'chat' || route.id && route.id !== selected.id) return;
    let active = true;
    const epoch = ++historyViewEpoch.current;
    const workspace = workspaceEpoch.current;
    pendingPageAnchor.current = null;
    historyPagingGuard.current = null;
    void (async () => {
      const current = await recoverSession(selected);
      if (!active || epoch !== historyViewEpoch.current || workspace !== workspaceEpoch.current) return;
      const target = route.seq === null || !current.messageCount ? null : Math.min(route.seq, current.messageCount - 1);
      const from = target === null ? Math.max(0, current.messageCount - PAGE_SIZE) : Math.max(0, Math.min(target - 6, current.messageCount - PAGE_SIZE));
      const to = target === null ? current.messageCount : Math.min(current.messageCount, from + PAGE_SIZE);
      const items = await store.messages(current, from, to);
      if (active && epoch === historyViewEpoch.current && workspace === workspaceEpoch.current) { pendingHistoryScroll.current = target; setMessages(items); setOldest(from); if (target === null) requestAnimationFrame(() => messageEnd.current?.scrollIntoView({ block: 'end' })); }
    })().catch(cause => { if (active && epoch === historyViewEpoch.current) setError(plainError(cause)); });
    return () => { active = false; historyViewEpoch.current++; };
  }, [store, selectedId, route.view, route.id, route.seq]);
  useLayoutEffect(() => {
    const anchor = pendingPageAnchor.current;
    if (anchor && chatScroll.current) {
      const node = chatScroll.current.querySelector<HTMLElement>(`[data-message-seq="${anchor.seq}"]`);
      if (node) chatScroll.current.scrollTop += node.getBoundingClientRect().top - anchor.top;
      pendingPageAnchor.current = null;
      suppressHistoryAutoScroll.current = false;
      historyPageBusy.current = false;
      return;
    }
    const target = pendingHistoryScroll.current;
    if (target !== null) {
      const node = chatScroll.current?.querySelector<HTMLElement>(`[data-message-seq="${target}"]`);
      if (node) { node.scrollIntoView({ block: 'center' }); pendingHistoryScroll.current = null; }
      return;
    }
    if (suppressHistoryAutoScroll.current) { suppressHistoryAutoScroll.current = false; return; }
    if (messages.length && chatScroll.current && chatScroll.current.scrollHeight - chatScroll.current.scrollTop - chatScroll.current.clientHeight < 240) messageEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);
  useLayoutEffect(() => {
    const viewport = chatScroll.current;
    if (liveResponse && viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 240) messageEnd.current?.scrollIntoView({ block: 'end' });
  }, [liveResponse]);
  useEffect(() => () => { if (liveResponseTimer.current !== null) clearTimeout(liveResponseTimer.current); }, []);
  useEffect(() => {
    if (route.view !== 'discover' || !store || !manifest) return;
    let active = true;
    void Promise.all(manifest.projects.map(item => store.sessions(item.id))).then(groups => { if (active) setAllSessions(groups.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }).catch(cause => { if (active) setError(plainError(cause)); });
    return () => { active = false; };
  }, [route.view, store, projectKey]);
  useEffect(() => () => {
    searchAbort.current?.abort();
    searchAbort.current = null;
    searchRun.current++;
  }, [route.view, store]);
  useEffect(() => {
    if (route.view !== 'files' || !folder || !project) return;
    const run = ++fileListRun.current;
    beginFileWork();
    setFileEntries([]); setFileNextOffset(null); setFileTotal(0);
    void listToolFilesPage(folder, { projects: [project], workspaceAccess: false, defaultProjectId: project.id }, project.id, fileArea, fileDirectory).then(page => {
      if (run === fileListRun.current) { setFileEntries(page.entries); setFileNextOffset(page.nextOffset); setFileTotal(page.total); }
    }).catch(cause => { if (run === fileListRun.current) setError(plainError(cause)); }).finally(endFileWork);
    return () => { fileListRun.current++; };
  }, [route.view, folder, projectId, project?.filesPath, fileArea, fileDirectory]);
  useEffect(() => {
    if (route.view !== 'files' || fileArea !== 'library' || !folder) return;
    let active = true;
    void libraryIndexCount(folder, projectId).then(count => { if (active) setLibraryCount(count); }).catch(cause => { if (active) setError(plainError(cause)); });
    return () => { active = false; };
  }, [route.view, fileArea, folder, projectId]);
  useEffect(() => { setLibraryHits([]); setLibrarySearched(false); }, [folder, projectId, route.view]);
  useEffect(() => {
    const run = ++fileDraftLoadRun.current;
    setFileDraftReadyKey(''); openedFile.current = null; setFilePath(''); setFileText('');
    if (!store || !folder || !fileDraftKey) return;
    void fileDraftManagerRef.current!.open(store, projectId, fileArea).then(draft => {
      if (run !== fileDraftLoadRun.current || !draft) return;
      setFilePath(draft.path); setFileText(draft.text);
      if (draft.basePath) openedFile.current = { folder, projectId, area: fileArea, path: draft.basePath, text: draft.baseText };
      setFileDraftReadyKey(fileDraftKey);
    }).catch(cause => { if (run === fileDraftLoadRun.current) setError(`Could not open file editor draft: ${plainError(cause)}`); });
    return () => { fileDraftLoadRun.current++; };
  }, [store, folder, projectId, fileArea, fileDraftKey]);
  useEffect(() => {
    const flush = () => { void fileDraftManagerRef.current?.flush().catch(cause => setError(`Could not save file editor draft: ${plainError(cause)}`)); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  useEffect(() => { resetMemoryForm(); }, [store, projectId, selectedId]);

  async function trackedWorkspaceWrite<T>(action: () => Promise<T>): Promise<T> {
    workspaceWrites.current++;
    try { return await action(); }
    finally { workspaceWrites.current--; }
  }
  async function updateManifest(change: (current: HarnessManifest) => HarnessManifest) {
    if (!store) return;
    workspaceWrites.current++;
    try {
      const next = await store.updateManifest(change);
      manifestRef.current = next;
      setManifest(next);
    }
    finally { workspaceWrites.current--; }
  }
  async function mutateSessions(id: string, change: (current: ConversationMeta[]) => ConversationMeta[]) {
    if (!store) return [];
    const next = await trackedWorkspaceWrite(() => store.updateSessions(id, change));
    if (id === projectIdRef.current) { sessionsRef.current = next; setSessions(next); }
    return next;
  }
  async function saveMemories(change: (current: MemoryRecord[]) => MemoryRecord[]) {
    if (!store) return;
    try {
      const next = await trackedWorkspaceWrite(() => store.updateMemory(change));
      setMemories(next);
    } catch (error) {
      try { setMemories(await store.memory()); } catch { /* Keep the write error visible. */ }
      throw error;
    }
  }
  async function upsertSession(next: ConversationMeta, preserveDisplay = false) {
    return mutateSessions(next.projectId, current => {
      const existing = current.find(item => item.id === next.id);
      const record = preserveDisplay && existing ? { ...next, title: existing.title, pinned: existing.pinned, autoTitled: existing.autoTitled } : next;
      return [record, ...current.filter(item => item.id !== next.id)];
    });
  }
  async function recoverSession(meta: ConversationMeta): Promise<ConversationMeta> {
    if (!store) return meta;
    const workspace = workspaceEpoch.current;
    const recovered = await store.recoverConversation(meta);
    if (workspace !== workspaceEpoch.current || recovered.messageCount === meta.messageCount) return meta;
    const records = await mutateSessions(meta.projectId, current => current.map(item => item.id === meta.id && item.messageCount < recovered.messageCount
      ? { ...item, messageCount: recovered.messageCount, updatedAt: recovered.updatedAt, preview: recovered.preview, searchBits: recovered.searchBits }
      : item));
    showToast(`Recovered ${recovered.messageCount - meta.messageCount} message${recovered.messageCount - meta.messageCount === 1 ? '' : 's'} from the workspace.`);
    return records.find(item => item.id === meta.id) || recovered;
  }
  function navigate(view: View, id = '', seq?: number) { location.hash = `/${view}${id ? `/${id}` : ''}${seq === undefined ? '' : `?seq=${seq}`}`; setSidebarOpen(false); }
  async function newConversation() {
    if (!store || busyRef.current || switchingWorkspace.current) return;
    const next = createConversation(projectId);
    await upsertSession(next); setSelectedId(next.id); setMessages([]); setOldest(0); navigate('chat', next.id);
  }
  async function stopWorkspaceActivity() {
    searchAbort.current?.abort();
    searchRun.current++;
    librarySearchAbortRef.current?.abort();
    await draftManagerRef.current?.flush();
    await fileDraftManagerRef.current?.flush();
    await settingsWrites.current;
    // Abort every queue first; each manager then waits for its open writer to close.
    await Promise.all([
      modelDownloadManager.pauseAndDetach(), browserImageAssetsManager.pauseAndWait(),
      speechAssetsManager.pauseAndWait(), transcriptionAssetsManager.pauseAndWait(),
      motionAssetsManager.pauseAndWait(), needleAssetsManager.pauseAndWait(),
      prismEngineManager.pauseAndWait(), wllamaEngineManager.pauseAndWait(),
    ]);
    await stopBrowserSpeech();
    await Promise.all([unloadBrowserModel(), unloadBrowserImageModel(), unloadNeedle(), unloadBrowserSpeech(), unloadBrowserTranscription()]);
    invalidateModelSession();
    prismEngineManager.resetWorkspace();
    wllamaEngineManager.resetWorkspace();
    setBrowserImageFolder(null);
    await Promise.allSettled([...workspaceReadTasks.current]);
    workspaceEpoch.current++;
  }
  function clearWorkspaceView() {
    fileListRun.current++;
    historyViewEpoch.current++;
    diagnosticOpenRun.current++;
    for (const dialog of [actionDialog.current, projectDialog.current, agentDialog.current, modelStampDialog.current, responseDiagnosticDialog.current, conversationToolsDialog.current]) if (dialog?.open) dialog.close();
    setSessions([]); sessionsRef.current = []; setSelectedId(''); setMessages([]); setOldest(0);
    setDraft(''); setDraftReadyKey('');
    setAllSessions([]); setSearch(''); setSearchMode('topics'); setSearchResults([]); setSearched(false); setSearchProgress(''); setSearchFailures([]); setSearchFailureTotal(0);
    setDiscoverLimit(DISCOVER_PAGE_SIZE); setTimelineLimit(TIMELINE_PAGE_SIZE);
    setActionMeta(null); setActionTitle(''); setActionDestination('home'); setActionError(''); setActionProgress('');
    setAgentDraft(null); setSelectedModelStamp(null); setSelectedDiagnostic(null); setDiagnosticError('');
    setProjectName(''); setProjectDescription(''); setProjectInstructions(''); setProjectIdentityId(''); setProjectProfileId(''); setProjectFilesPath(''); setEditingProjectId('');
    setMemories([]); resetMemoryForm();
    setFileArea('files'); setFileDirectory(''); setFilePath(''); setFileText(''); setFileEntries([]); setFileNextOffset(null); setFileTotal(0); openedFile.current = null;
    setLibraryCount(0); setLibraryQuery(''); setLibraryHits([]); setLibrarySearched(false); setLibrarySearchBusy(false); setLibrarySearchProgress(null); setLibraryProgress('');
    setChatDragOver(false); chatDragDepth.current = 0;
    pendingHistoryScroll.current = null; pendingPageAnchor.current = null; suppressHistoryAutoScroll.current = false; historyPagingGuard.current = null;
    setGitRevision(0);
    setModelStatus('');
  }
  function workspaceInUse() { return busyRef.current || !!runningAgentRef.current || fileWorkCount.current > 0 || gitActivityBusy.current || workspaceWrites.current > 0 || !!getModelLease().owner; }
  async function openSelectedFolder(picked: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
    if (workspaceInUse() || switchingWorkspace.current) { setError('Wait for the current chat, agent, model, or file operation before changing workspaces.'); return null; }
    try {
      if (!await ensureWritableFolder(picked)) { setError('Folder access was not granted.'); return null; }
      if (workspaceInUse()) { setError('A model or file operation started while choosing a folder. Try again when it finishes.'); return null; }
      switchingWorkspace.current = true;
      setLoading(true);
      await stopWorkspaceActivity();
      const opened = await openFolderWorkspace(picked);
      const settings = await loadWorkspaceSettings(opened.store);
      const memory = await opened.store.memory();
      let remembered = true;
      try { await saveHandle(picked); }
      catch { remembered = false; try { await clearHandle(); } catch { /* Browser storage is unavailable. */ } }
      clearWorkspaceView();
      setProfiles(settings.profiles); setSelectedProfileId(settings.selectedProfileId); setImageConfig(settings.imageConfig); setCompactionAt(settings.compactionAt); setApiKeys({}); setSettingsReadyId(opened.store.workspaceId);
      manifestRef.current = opened.manifest; setStore(opened.store); setManifest(opened.manifest); setFolder(picked); setRememberedFolder(null); setMemories(memory);
      setProjectId(opened.manifest.projects[0].id); setError(''); setStartupError(''); navigate('chat');
      showToast(remembered ? `Opened ${picked.name}.` : `Opened ${picked.name}. Reconnect this folder after a refresh; browser storage could not remember it.`);
      return picked;
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(plainError(cause)); return null; }
    finally { switchingWorkspace.current = false; setLoading(false); }
  }
  async function connectFolder(): Promise<FileSystemDirectoryHandle | null> {
    if (workspaceInUse() || switchingWorkspace.current) { setError('Wait for the current chat, agent, model, or file operation before changing workspaces.'); return null; }
    if (!window.showDirectoryPicker) { setError('This browser cannot open a local folder. Browser storage remains available.'); return null; }
    try { return await openSelectedFolder(await window.showDirectoryPicker({ mode: 'readwrite' })); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(plainError(cause)); return null; }
  }
  async function reconnectFolder(): Promise<FileSystemDirectoryHandle | null> {
    return rememberedFolder ? openSelectedFolder(rememberedFolder) : null;
  }
  async function ejectFolder() {
    if (workspaceInUse() || switchingWorkspace.current) { setError('Wait for the current chat, agent, model, or file operation before ejecting.'); return; }
    switchingWorkspace.current = true;
    setLoading(true);
    try {
      await stopWorkspaceActivity();
      const opened = await openBrowserWorkspace();
      const settings = await loadWorkspaceSettings(opened.store);
      const localFiles = await browserFiles();
      await clearHandle();
      clearWorkspaceView();
      setProfiles(settings.profiles); setSelectedProfileId(settings.selectedProfileId); setImageConfig(settings.imageConfig); setCompactionAt(settings.compactionAt); setApiKeys({}); setSettingsReadyId(opened.store.workspaceId);
      manifestRef.current = opened.manifest; setFolder(localFiles); setRememberedFolder(null); setStore(opened.store); setManifest(opened.manifest); setMemories(await opened.store.memory()); setProjectId('home'); navigate('chat');
      showToast('Workspace ejected. You can remove the drive.');
    } catch (cause) { setError(`Could not eject workspace: ${plainError(cause)}`); }
    finally { switchingWorkspace.current = false; setLoading(false); }
  }
  function openProjectDialog(edit = false, target = project) {
    setEditingProjectId(edit ? target?.id || '' : '');
    setProjectName(edit ? target?.name || '' : '');
    setProjectDescription(edit ? target?.description || '' : '');
    setProjectInstructions(edit ? target?.instructions || '' : '');
    setProjectIdentityId(edit ? target?.identityId || '' : '');
    setProjectProfileId(edit ? target?.defaultProfileId || '' : '');
    setProjectFilesPath(edit ? target?.filesPath || '' : '');
    setProjectToolAccess(edit && target?.toolAccess === 'read-only' ? 'read-only' : 'full');
    projectDialog.current?.showModal();
  }
  function reviewProjectProfileDraft(draft: ProjectProfileDraft) {
    const target = manifestRef.current?.projects.find(item => item.id === draft.projectId);
    const profile = profiles.find(item => item.id === draft.profileId && item.model.trim());
    if (!target || !profile) { setError('The proposed project or model profile is no longer available.'); return; }
    openProjectDialog(true, target);
    setProjectProfileId(profile.id);
  }
  function reviewProjectDraft(draft: ProjectDraft) {
    if (!manifestRef.current?.projects.some(item => item.id === draft.sourceProjectId)) {
      setError('The project that requested this draft is no longer available.');
      return;
    }
    openProjectDialog();
    setProjectName(draft.name);
    setProjectDescription(draft.description);
    setProjectInstructions(draft.instructions);
  }
  async function reviewProjectInstructionDraft(draft: ProjectInstructionDraft) {
    if (!store) return;
    let target: HarnessProject | undefined;
    try {
      const latest = await store.manifest();
      target = latest.projects.find(item => item.id === draft.projectId);
      manifestRef.current = latest;
      setManifest(latest);
    }
    catch (cause) { setError(`Could not check current project settings: ${plainError(cause)}`); return; }
    if (!target) { setError('The project for this instruction draft is no longer available.'); return; }
    if (target.updatedAt !== draft.expectedUpdatedAt) { setError('Project settings changed since this draft was prepared. Ask the model to review the current instructions again.'); return; }
    openProjectDialog(true, target);
    setProjectInstructions(draft.instructions);
  }
  async function saveProjectDetails() {
    if (!manifest || !store || !projectName.trim()) return;
    const filesPath = projectFilesPath.trim().replace(/\/+$/, '');
    if (filesPath && (filesPath.startsWith('/') || filesPath.includes('\\') || filesPath.split('/').some(part => !part || part === '.' || part === '..') || /^(harness|models|engines|\.git|node_modules)(\/|$)/i.test(filesPath))) { setError('Choose a relative code folder outside the app, model, engine, and Git internals.'); return; }
    const now = isoNow();
    const previous = manifest.projects.find(item => item.id === editingProjectId);
    const next: HarnessProject = { id: previous?.id || newId(), name: projectName.trim().slice(0, 80), description: projectDescription.trim(), instructions: projectInstructions.trim(), identityId: projectIdentityId, defaultProfileId: projectProfileId, filesPath, toolAccess: projectToolAccess, toolPermissions: previous?.toolPermissions, approvedTools: previous?.approvedTools, toolProfileId: previous?.toolProfileId, createdAt: previous?.createdAt || now, updatedAt: now };
    await trackedWorkspaceWrite(async () => {
      await store.saveProject(next);
      await updateManifest(current => ({ ...current, projects: previous ? current.projects.map(item => item.id === next.id ? next : item) : [...current.projects, next] }));
    });
    projectDialog.current?.close(); if (!previous) { setProjectId(next.id); navigate('chat'); }
  }
  async function selectProjectChatProfile(profileId: string) {
    if (!store || !project || !profiles.some(item => item.id === profileId) || project.defaultProfileId === profileId) return;
    const next: HarnessProject = { ...project, defaultProfileId: profileId, updatedAt: isoNow() };
    try {
      await trackedWorkspaceWrite(async () => {
        await store.saveProject(next);
        await updateManifest(current => ({ ...current, projects: current.projects.map(item => item.id === next.id ? next : item) }));
      });
    } catch (cause) { setError(`Could not save project model: ${plainError(cause)}`); }
  }
  async function saveToolPermission(name: string, permission: ToolPermission | 'inherit') {
    if (!store || !project || toolPolicyBusy) return;
    setToolPolicyBusy(true);
    try {
      const toolPermissions = { ...project.toolPermissions };
      if (permission === 'inherit' || permission === 'allow' && !project.toolProfileId) delete toolPermissions[name];
      else toolPermissions[name] = permission;
      const next: HarnessProject = { ...project, toolPermissions, approvedTools: project.approvedTools?.filter(item => item !== name), updatedAt: isoNow() };
      await trackedWorkspaceWrite(() => store.saveProject(next));
      await updateManifest(current => ({ ...current, projects: current.projects.map(item => item.id === next.id ? next : item) }));
      clearSessionToolGrants();
    } catch (cause) { setError(`Could not save tool permission: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function saveWorkspaceToolAccess(access: 'full' | 'read-only') {
    if (!store || !manifest || toolPolicyBusy || busy || runningAgentId || manifest.workspaceToolAccess === access) return;
    setToolPolicyBusy(true);
    try {
      await updateManifest(current => ({ ...current, workspaceToolAccess: access }));
      clearSessionToolGrants();
      showToast(access === 'read-only' ? 'Model tools can now read this workspace without changing it.' : 'Model tools can change files where project permissions allow.');
    } catch (cause) { setError(`Could not save workspace model access: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function saveConversationToolPermission(name: string, permission: ToolPermission | 'inherit') {
    if (!store || !selected || busy || toolPolicyBusy) return;
    if (toolPermission(scope, name) === 'deny') { setError(`${name} is blocked by this project or workspace.`); return; }
    setToolPolicyBusy(true);
    try {
      await mutateSessions(selected.projectId, current => current.map(item => {
        if (item.id !== selected.id) return item;
        const toolPermissions = { ...item.toolPermissions };
        if (permission === 'inherit') delete toolPermissions[name];
        else toolPermissions[name] = permission;
        return { ...item, toolPermissions, approvedTools: item.approvedTools?.filter(tool => tool !== name), updatedAt: isoNow() };
      }));
      clearSessionToolGrants();
    } catch (cause) { setError(`Could not save conversation tool permission: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function applyConversationToolProfile(id: string) {
    if (!store || !selected || busy || toolPolicyBusy) return;
    if (id && !manifest?.toolProfiles?.some(item => item.id === id)) { setError('This permission profile is no longer available.'); return; }
    setToolPolicyBusy(true);
    try {
      await mutateSessions(selected.projectId, current => current.map(item => item.id === selected.id
        ? { ...item, toolProfileId: id || undefined, toolPermissions: {}, approvedTools: [], updatedAt: isoNow() } : item));
      clearSessionToolGrants();
    } catch (cause) { setError(`Could not apply conversation permission profile: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function saveNewConversationToolProfile(name: string): Promise<boolean> {
    if (!store || !selected || !manifest || busy || toolPolicyBusy) return false;
    const cleaned = name.trim().slice(0, 80);
    if (!cleaned || manifest.toolProfiles?.some(item => item.name.toLowerCase() === cleaned.toLowerCase())) { setError('Choose a unique permission profile name.'); return false; }
    setToolPolicyBusy(true);
    try {
      const now = isoNow();
      const profile: ToolPolicyProfile = { id: newId(), name: cleaned, permissions: effectiveConversationToolPermissions(conversationScope), createdAt: now, updatedAt: now };
      await updateManifest(current => ({ ...current, toolProfiles: [...(current.toolProfiles || []), profile] }));
      await mutateSessions(selected.projectId, current => current.map(item => item.id === selected.id
        ? { ...item, toolProfileId: profile.id, toolPermissions: {}, approvedTools: [], updatedAt: now } : item));
      clearSessionToolGrants();
      return true;
    } catch (cause) { setError(`Could not save conversation permission profile: ${plainError(cause)}`); return false; }
    finally { setToolPolicyBusy(false); }
  }
  async function applyToolProfile(id: string) {
    if (!store || !project || toolPolicyBusy) return;
    if (id && !manifest?.toolProfiles?.some(item => item.id === id)) { setError('This permission profile is no longer available.'); return; }
    setToolPolicyBusy(true);
    try {
      const toolPermissions = id ? {} : effectiveToolPermissions(scope);
      const next: HarnessProject = { ...project, toolProfileId: id || undefined, toolPermissions, approvedTools: [], updatedAt: isoNow() };
      await trackedWorkspaceWrite(() => store.saveProject(next));
      await updateManifest(current => ({ ...current, projects: current.projects.map(item => item.id === next.id ? next : item) }));
      clearSessionToolGrants();
    } catch (cause) { setError(`Could not apply permission profile: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function saveNewToolProfile(name: string): Promise<boolean> {
    if (!store || !project || toolPolicyBusy) return false;
    const cleaned = name.trim().slice(0, 80);
    if (!cleaned || manifest?.toolProfiles?.some(item => item.name.toLowerCase() === cleaned.toLowerCase())) { setError('Choose a unique permission profile name.'); return false; }
    setToolPolicyBusy(true);
    try {
      const now = isoNow();
      const profile: ToolPolicyProfile = { id: newId(), name: cleaned, permissions: effectiveToolPermissions(scope), createdAt: now, updatedAt: now };
      const next: HarnessProject = { ...project, toolProfileId: profile.id, toolPermissions: {}, approvedTools: [], updatedAt: now };
      await trackedWorkspaceWrite(() => store.saveProject(next));
      await updateManifest(current => ({ ...current, toolProfiles: [...(current.toolProfiles || []), profile], projects: current.projects.map(item => item.id === next.id ? next : item) }));
      clearSessionToolGrants();
      return true;
    } catch (cause) { setError(`Could not save permission profile: ${plainError(cause)}`); return false; }
    finally { setToolPolicyBusy(false); }
  }
  async function updateToolProfile(id: string) {
    if (!store || !manifest || !project || toolPolicyBusy || project.toolProfileId !== id) return;
    const current = manifestRef.current;
    const profile = current?.toolProfiles?.find(item => item.id === id);
    if (!profile) { setError('This permission profile is no longer available.'); return; }
    const linked = current!.projects.filter(item => item.toolProfileId === id);
    const accepted = await confirmAction(`Update “${profile.name}” from this project's current rules? Linked projects and conversations will receive the new defaults and lose remembered tool approvals. Their own overrides remain.`, { title: 'Update permission profile', confirmLabel: 'Update profile' });
    if (!accepted) return;
    setToolPolicyBusy(true);
    try {
      const now = isoNow();
      const permissions = effectiveToolPermissions(scope);
      const changed = linked.map(item => ({ ...item, ...(item.id === project.id ? { toolPermissions: {} } : {}), approvedTools: [], updatedAt: now }));
      await trackedWorkspaceWrite(() => Promise.all(changed.map(item => store.saveProject(item))));
      for (const owner of current!.projects) {
        if (!(await store.sessions(owner.id)).some(item => item.toolProfileId === id)) continue;
        await mutateSessions(owner.id, sessions => sessions.map(item => item.toolProfileId === id ? { ...item, approvedTools: [], updatedAt: now } : item));
      }
      await updateManifest(manifest => ({ ...manifest,
        toolProfiles: (manifest.toolProfiles || []).map(item => item.id === id ? { ...item, permissions, updatedAt: now } : item),
        projects: manifest.projects.map(item => changed.find(next => next.id === item.id) || item),
      }));
      clearSessionToolGrants();
      showToast(`${profile.name} updated.`);
    } catch (cause) { setError(`Could not update permission profile: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function deleteToolProfile(id: string) {
    if (!store || !manifest || toolPolicyBusy) return;
    const current = manifestRef.current;
    const profile = current?.toolProfiles?.find(item => item.id === id);
    if (!profile) { setError('This permission profile is no longer available.'); return; }
    const linked = current!.projects.filter(item => item.toolProfileId === id);
    const accepted = await confirmAction(`Remove “${profile.name}”? Linked projects and conversations will keep their current rules as custom settings. Remembered tool approvals will reset.`, { title: 'Remove permission profile', confirmLabel: 'Remove profile', destructive: true });
    if (!accepted) return;
    setToolPolicyBusy(true);
    try {
      const now = isoNow();
      const detached = linked.map(item => detachToolProfile(item, current!.toolProfiles || [], now));
      for (const owner of current!.projects) {
        if (!(await store.sessions(owner.id)).some(item => item.toolProfileId === id)) continue;
        await mutateSessions(owner.id, sessions => sessions.map(item => {
          if (item.toolProfileId !== id) return item;
          const source: ToolScope = { projects: [owner], defaultProjectId: owner.id, workspaceAccess: false, toolProfiles: current!.toolProfiles || [], conversationId: item.id, conversationProfileId: id, conversationPermissions: item.toolPermissions };
          return { ...item, toolProfileId: undefined, toolPermissions: effectiveConversationToolPermissions(source), approvedTools: [], updatedAt: now };
        }));
      }
      await trackedWorkspaceWrite(() => Promise.all(detached.map(item => store.saveProject(item))));
      await updateManifest(manifest => ({ ...manifest,
        toolProfiles: (manifest.toolProfiles || []).filter(item => item.id !== id),
        projects: manifest.projects.map(item => detached.find(next => next.id === item.id) || item),
      }));
      clearSessionToolGrants();
      showToast(`${profile.name} removed.`);
    } catch (cause) { setError(`Could not remove permission profile: ${plainError(cause)}`); }
    finally { setToolPolicyBusy(false); }
  }
  async function approveToolCall(request: ToolApprovalRequest): Promise<boolean> {
    if (!store || request.signal?.aborted) return false;
    const target = manifestRef.current?.projects.find(item => item.id === request.projectId);
    if (!target) return false;
    const preferenceOrder = (value: unknown) => Array.isArray(value) && value.length
      ? value.map((item, index) => `${index + 1}. ${String(item?.label || item?.id || '').slice(0, 70)} (${String(item?.id || '').slice(0, 100)})`).join('\n')
      : '(none)';
    const details = request.name === 'set_model_preferences'
      ? `${String(request.arguments.purpose || '').toUpperCase()} fallback order for the entire workspace\nCurrent:\n${preferenceOrder(request.arguments.current)}\nProposed:\n${preferenceOrder(request.arguments.requested)}\nThe selected profile stays first.`
      : request.name === 'set_journal_enabled'
        ? `Journal recording for the entire workspace\nCurrent: ${request.arguments.current ? 'On' : 'Off'}\nProposed: ${request.arguments.requested ? 'On' : 'Off'}\n${String(request.arguments.effect || '')}`
      : JSON.stringify(request.arguments).slice(0, 1200);
    const repeat = request.mode === 'ask' ? 'This call only' : request.mode === 'once' ? request.conversationId ? 'Remember for this conversation' : 'Remember for this project' : 'Remember until this browser session ends';
    const accepted = await confirmAction(`${request.name === 'set_model_preferences' || request.name === 'set_journal_enabled' ? 'Entire workspace' : target.name} · ${request.name}\n${details}\n${repeat}`, { title: 'Allow model tool?', confirmLabel: 'Allow', signal: request.signal });
    if (!accepted || request.signal?.aborted) return false;
    if (request.mode !== 'once') return true;
    try {
      if (request.conversationId) {
        const records = await mutateSessions(request.projectId, current => current.map(item => {
          if (item.id !== request.conversationId) return item;
          const latestProject = manifestRef.current?.projects.find(project => project.id === item.projectId);
          const currentScope: ToolScope = { projects: latestProject ? [latestProject] : [], defaultProjectId: item.projectId, workspaceAccess: false, toolProfiles: manifestRef.current?.toolProfiles || [], conversationId: item.id, conversationProfileId: item.toolProfileId, conversationPermissions: item.toolPermissions };
          const conversationMode = item.toolPermissions?.[request.name] ?? currentScope.toolProfiles?.find(profile => profile.id === item.toolProfileId)?.permissions[request.name];
          if (toolPermission(currentScope, request.name) !== 'once' || conversationMode !== 'once') return item;
          return { ...item, approvedTools: [...new Set([...(item.approvedTools || []), request.name])], updatedAt: isoNow() };
        }));
        return !request.signal?.aborted && !!records.find(item => item.id === request.conversationId)?.approvedTools?.includes(request.name);
      }
      const current = manifestRef.current?.projects.find(item => item.id === request.projectId);
      if (!current || toolPermission({ projects: [current], defaultProjectId: current.id, workspaceAccess: false, toolProfiles: manifestRef.current?.toolProfiles || [] }, request.name) !== 'once') return false;
      const next: HarnessProject = { ...current, approvedTools: [...new Set([...(current.approvedTools || []), request.name])], updatedAt: isoNow() };
      await trackedWorkspaceWrite(() => store.saveProject(next));
      await updateManifest(manifest => ({ ...manifest, projects: manifest.projects.map(item => item.id === next.id ? next : item) }));
      return !request.signal?.aborted;
    } catch (cause) { setError(`Could not save tool approval: ${plainError(cause)}`); return false; }
  }
  async function saveIdentity(identity: HarnessIdentity) {
    await updateManifest(current => ({ ...current, identities: current.identities.some(item => item.id === identity.id) ? current.identities.map(item => item.id === identity.id ? identity : item) : [...current.identities, identity] }));
    showToast(`${identity.name} saved.`);
  }
  async function selectChatIdentity(id: string) {
    await updateManifest(current => ({ ...current, chatIdentityId: id }));
  }
  async function append(meta: ConversationMeta, message: Omit<HarnessMessage, 'seq'>): Promise<ConversationMeta> {
    if (!store) return meta;
    const { meta: updated, sessions: records, journalWarning } = await trackedWorkspaceWrite(() => store.appendConversationMessage(meta, message));
    if (journalWarning) showToast(journalWarning, 'error');
    if (updated.projectId === projectIdRef.current) { sessionsRef.current = records; setSessions(records); }
    if (updated.projectId === projectIdRef.current && updated.id === selectedIdRef.current) setMessages(previous => [...previous, { ...message, seq: updated.messageCount - 1 }]);
    return updated;
  }
  async function send() {
    const input = draft.trim();
    if (!input || !store || !project || busyRef.current || toolPolicyBusy || switchingWorkspace.current || draftReadyKey !== draftKey) return;
    if (!chatConfig) {
      if (chatProfile.provider === 'browser' && chatProfile.model && folder) {
        setModelStatus(`Loading ${chatProfile.model.split('/').at(-1)} before chat…`);
        void ensureChatModel({ ...chatProfile, apiKey: apiKeys[chatProfile.id] || '' }, true);
        return;
      }
      setError('Load and test a model in Models before sending. Your draft is still here.'); navigate('models'); return;
    }
    const controller = new AbortController();
    const targetDraftProjectId = project.id;
    let targetDraftSessionId = draftSessionId;
    chatAbortRef.current = controller;
    busyRef.current = true; setBusy(true); setStopping(false); setError(''); setWorkingLabel('Preparing conversation…'); updateDraft(''); setLiveResponse(''); setLiveThinking(''); liveResponseBuffer.current = ''; liveThinkingBuffer.current = ''; lastTokenStatusAt.current = 0;
    let release: (() => void) | undefined;
    let userMessageSaved = false;
    let responseSaved = false;
    let fullResponseReady = false;
    const responseState: { config: AIConfig | null; lastVisible: { config: AIConfig; text: string; outputTokens: number } | null } = { config: null, lastVisible: null };
    let runMeta: ConversationMeta | null = null;
    try {
      let meta = selected ? await recoverSession(selected) : createConversation(projectId);
      liveResponseTarget.current = { projectId: meta.projectId, sessionId: meta.id };
      if (!selected) {
        await upsertSession(meta);
        await draftManagerRef.current!.open(store, project.id, meta.id);
        targetDraftSessionId = meta.id;
        selectedIdRef.current = meta.id;
        setSelectedId(meta.id); setDraftReadyKey(`${store.workspaceId}:${project.id}:${meta.id}`); navigate('chat', meta.id);
      }
      let libraryContext = '';
      let historyContext = '';
      if (folder && chatConfig && isBriefFollowUp(input) && meta.activeFrom > 0) {
        try { historyContext = await recallHistory(store, meta, input, Math.floor(systemPromptCharBudget(chatConfig) * .35), controller.signal); }
        catch (cause) { if (controller.signal.aborted) throw cause; setError(`History recall could not finish: ${plainError(cause)}`); }
      }
      const libraryQuery = folder && isBriefFollowUp(input)
        ? followUpLibraryQuery(input, await store.messages(meta, meta.activeFrom), historyContext)
        : input;
      if (folder && chatConfig && libraryQuery) {
        setWorkingLabel('Searching project library…');
        try {
          const budget = Math.max(300, Math.min(3000, Math.floor(systemPromptCharBudget(chatConfig) * .35)));
          libraryContext = formatLibraryHits(await searchLibrary(folder, project.id, libraryQuery, budget, controller.signal));
        } catch (cause) { if (controller.signal.aborted) throw cause; setError(`Library search could not finish: ${plainError(cause)}`); }
      }
      setWorkingLabel('Waiting for model…');
      release = await acquireModel(`chat:${meta.id}`, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason || new DOMException('Stopped.', 'AbortError');
      setWorkingLabel('Reading conversation…');
      const latest = (await store.sessions(meta.projectId)).find(item => item.id === meta.id);
      if (!latest) throw new Error('This conversation is no longer in the project. Refresh the conversation list before sending.');
      const recovered = await store.recoverConversation(latest);
      if (recovered.messageCount !== meta.messageCount || recovered.activeFrom !== meta.activeFrom || recovered.contextSummary !== meta.contextSummary || JSON.stringify(recovered.segments) !== JSON.stringify(meta.segments) || JSON.stringify(recovered.toolPermissions) !== JSON.stringify(meta.toolPermissions) || recovered.toolProfileId !== meta.toolProfileId || JSON.stringify(recovered.approvedTools) !== JSON.stringify(meta.approvedTools)) {
        throw new Error('This conversation changed in another tab. Review its latest messages before sending again.');
      }
      meta = recovered;
      const runScope: ToolScope = { ...scope, conversationId: meta.id, conversationProfileId: meta.toolProfileId, conversationPermissions: meta.toolPermissions, conversationApprovedTools: meta.approvedTools };
      const active = await store.messages(meta, meta.activeFrom);
      if (meta.activeFrom > 0 && chatConfig && !historyContext) {
        setWorkingLabel('Recalling earlier work…');
        try { historyContext = await recallHistory(store, meta, input, Math.floor(systemPromptCharBudget(chatConfig) * .35), controller.signal); }
        catch (cause) { if (controller.signal.aborted) throw cause; setError(`History recall could not finish: ${plainError(cause)}`); }
      }
      const identity = chatIdentity(manifest!, project);
      const guidedProject = await projectWithGuide(folder, project);
      let system = promptForConversation(guidedProject, meta, memories, input, identity, libraryContext, true, historyContext, systemPromptCharBudget(chatConfig!));
      const imagePriority = imageCandidates(imageConfig, manifest!.modelPreferences.image);
      const toolReserve = harnessToolReserve({ folder, scope: runScope, history: { store, meta }, imageConfig, imagePriority, signal: controller.signal }, chatConfig, [...messagesForModel(active), { role: 'user', content: input }], historyContext);
      if (needsCompaction(meta, active, input, chatConfig, system, toolReserve, compactionAt)) {
        setWorkingLabel('Compacting conversation…');
        meta = await compactConversation(meta, active, chatConfig, controller.signal, setWorkingLabel);
        meta = (await upsertSession(meta, true)).find(item => item.id === meta.id) || meta;
        setWorkingLabel('Updating conversation context…');
        try { historyContext = await recallHistory(store, meta, input, Math.floor(systemPromptCharBudget(chatConfig) * .35), controller.signal); }
        catch (cause) { if (controller.signal.aborted) throw cause; setError(`History recall could not finish: ${plainError(cause)}`); }
        system = promptForConversation(guidedProject, meta, memories, input, identity, libraryContext, true, historyContext, systemPromptCharBudget(chatConfig));
      }
      if (controller.signal.aborted) throw controller.signal.reason || new DOMException('Stopped.', 'AbortError');
      meta = await append(meta, { id: newId(), role: 'user', content: input, createdAt: isoNow() });
      userMessageSaved = true;
      runMeta = meta;
      const recent = await store.messages(meta, meta.activeFrom);
      let responseStartedAt = performance.now();
      let observedTokensPerSecond = 0;
      const result = await harnessComplete({ config: chatConfig, fallbacks: chatCandidates.slice(1), turns: messagesForModel(recent), system, systemForConfig: candidate => promptForConversation(guidedProject, meta, memories, input, identity, libraryContext, true, historyContext, systemPromptCharBudget(candidate)), folder, scope: runScope, history: { store, meta }, toolIntentHint: historyContext, imageConfig, imagePriority, signal: controller.signal, approvalSessionKey: `${store.workspaceId}:${meta.id}`, onToolApproval: approveToolCall, onProgress: setWorkingLabel, onCandidate: candidate => {
        responseStartedAt = performance.now();
        observedTokensPerSecond = 0;
        responseState.config = candidate;
        responseState.lastVisible = null;
        liveResponseBuffer.current = '';
        liveThinkingBuffer.current = '';
        setLiveResponse(''); setLiveThinking('');
      }, onTokenProgress: progress => {
        if (controller.signal.aborted) return;
        if (progress.outputTokensPerSecond > 0) observedTokensPerSecond = progress.outputTokensPerSecond;
        liveResponseBuffer.current = progress.visibleText || '';
        liveThinkingBuffer.current = progress.reasoningText || '';
        if (responseState.config && liveResponseBuffer.current.trim()) responseState.lastVisible = { config: responseState.config, text: liveResponseBuffer.current, outputTokens: progress.outputTokens };
        else responseState.lastVisible = null;
        if (liveResponseTimer.current === null) liveResponseTimer.current = window.setTimeout(() => {
          liveResponseTimer.current = null;
          setLiveResponse(liveResponseBuffer.current);
          setLiveThinking(liveThinkingBuffer.current);
        }, 80);
        const now = performance.now();
        if (now - lastTokenStatusAt.current > 250 || progress.outputTokens === progress.maxOutputTokens) {
          lastTokenStatusAt.current = now;
          if (progress.outputTokens) setWorkingLabel(`Writing · ${progress.outputTokens}/${progress.maxOutputTokens} tokens · ${progress.outputTokensPerSecond.toFixed(1)} tok/s`);
          else if (progress.promptTotal) setWorkingLabel(`Reading prompt · ${progress.promptProcessed}/${progress.promptTotal}${progress.promptCachedTokens ? ` · ${progress.promptCachedTokens} cached` : ''}`);
        }
      } });
      fullResponseReady = true;
      const responseId = newId();
      const stamp = modelStamp(result.usedConfig);
      let hasDiagnostics = false;
      try {
        const report = responseDiagnostic(result.usedConfig, stamp, result.submittedPrompt, result, performance.now() - responseStartedAt, observedTokensPerSecond);
        await trackedWorkspaceWrite(() => store.saveResponseDiagnostic(meta.projectId, meta.id, responseId, report));
        hasDiagnostics = true;
      } catch (cause) { showToast(`Diagnostics could not be saved: ${plainError(cause)}`, 'error'); }
      meta = await append(meta, { id: responseId, role: 'assistant', content: result.text, createdAt: isoNow(), model: stamp, inputTokens: result.inputTokens, outputTokens: result.outputTokens, toolEvents: result.toolEvents, hasDiagnostics });
      if (liveResponseTimer.current !== null) { clearTimeout(liveResponseTimer.current); liveResponseTimer.current = null; }
      liveResponseBuffer.current = ''; liveThinkingBuffer.current = ''; setLiveResponse(''); setLiveThinking('');
      responseSaved = true;
      if (result.fallbackNotice) showToast(result.fallbackNotice);
      if (!meta.autoTitled && meta.messageCount >= 2) {
        const titled = await titleConversation(await store.messages(meta, 0, Math.min(meta.messageCount, 4)), result.usedConfig, controller.signal);
        const next = await mutateSessions(meta.projectId, current => current.map(item => item.id === meta.id ? { ...item, title: titled.title, tags: cleanTags([...item.tags, ...titled.tags], 40), autoTitled: true, searchBits: addSearchBits(item.searchBits, titled.title + ' ' + titled.tags.join(' ')) } : item));
        meta = next.find(item => item.id === meta.id) || meta;
      }
      const latestMessages = await store.recentMessages(meta, PAGE_SIZE);
      if (projectIdRef.current === meta.projectId && selectedIdRef.current === meta.id) {
        setMessages(latestMessages);
        setOldest(Math.max(0, meta.messageCount - PAGE_SIZE));
      }
      await signalAgents(`Conversation ${meta.title} received a new exchange.`, meta.projectId);
    } catch (cause) {
      let partialLogSaved = false;
      let partialResponseSaved = false;
      if (cause instanceof HarnessPartialToolError && runMeta) {
        try {
          runMeta = await append(runMeta, { id: newId(), role: 'tool', content: `Interrupted tool run: ${cause.message}`, createdAt: isoNow(), model: modelStamp(cause.usedConfig), toolEvents: cause.completedChanges });
          partialLogSaved = true;
        } catch (saveError) { showToast(`Could not save the interrupted tool run: ${plainError(saveError)}`, 'error'); }
      }
      const lastVisiblePart = responseState.lastVisible;
      const partialContent = interruptedResponseContent(lastVisiblePart?.text || '', controller.signal.aborted && lastVisiblePart?.config.id === responseState.config?.id);
      if (runMeta && userMessageSaved && !fullResponseReady && lastVisiblePart && partialContent && !(cause instanceof HarnessPartialToolError)) {
        try {
          runMeta = await append(runMeta, { id: newId(), role: 'assistant', content: partialContent, createdAt: isoNow(), model: modelStamp(lastVisiblePart.config), outputTokens: lastVisiblePart.outputTokens });
          partialResponseSaved = true;
        } catch (saveError) { showToast(`Could not save the partial response: ${plainError(saveError)}`, 'error'); }
      }
      if (!userMessageSaved) {
        try {
          const active = await draftManagerRef.current!.restoreTo(store, targetDraftProjectId, targetDraftSessionId, input);
          if (active && draftKeyRef.current === `${store.workspaceId}:${targetDraftProjectId}:${targetDraftSessionId}`) setDraft(input);
        } catch (restoreError) { showToast(`Could not restore the unsent draft: ${plainError(restoreError)}`, 'error'); }
      }
      const problem = plainError(cause);
      if (selected && projectIdRef.current === selected.projectId && selectedIdRef.current === selected.id && (problem.includes('conversation changed in another tab') || problem.includes('conversation is no longer in the project'))) {
        try {
          const refreshed = await store.sessions(selected.projectId);
          const current = refreshed.find(item => item.id === selected.id);
          if (current) {
            const latest = await recoverSession(current);
            const records = await store.sessions(selected.projectId);
            sessionsRef.current = records; setSessions(records);
            setMessages(await store.recentMessages(latest, PAGE_SIZE));
            setOldest(Math.max(0, latest.messageCount - PAGE_SIZE));
          } else {
            sessionsRef.current = refreshed; setSessions(refreshed);
            setSelectedId(''); setMessages([]); setOldest(0); navigate('chat');
          }
        } catch { /* Preserve the original conflict and the user's draft. */ }
      }
      if (controller.signal.aborted) showToast(responseSaved ? 'Response saved. Remaining work stopped.' : partialLogSaved ? 'Stopped. Your message and tool log were saved.' : partialResponseSaved ? 'Stopped. The partial response was saved.' : userMessageSaved ? 'Stopped. Your message remains in the conversation.' : 'Stopped. Your draft was restored.');
      else setError(problem);
    } finally { release?.(); if (liveResponseTimer.current !== null) { clearTimeout(liveResponseTimer.current); liveResponseTimer.current = null; } liveResponseBuffer.current = ''; liveThinkingBuffer.current = ''; liveResponseTarget.current = null; if (chatAbortRef.current === controller) chatAbortRef.current = null; busyRef.current = false; setBusy(false); setStopping(false); setLiveResponse(''); setLiveThinking(''); setWorkingLabel('Working…'); }
  }
  async function loadOlder() {
    if (!store || !selected || oldest <= 0 || historyPageBusy.current) return;
    historyPageBusy.current = true;
    const epoch = historyViewEpoch.current;
    const from = Math.max(0, oldest - PAGE_SIZE);
    const first = messages[0];
    const anchor = first && chatScroll.current?.querySelector<HTMLElement>(`[data-message-seq="${first.seq}"]`);
    try {
      const items = await store.messages(selected, from, oldest);
      if (epoch !== historyViewEpoch.current || !items.length) { historyPageBusy.current = false; return; }
      if (first && anchor) pendingPageAnchor.current = { seq: first.seq, top: anchor.getBoundingClientRect().top };
      suppressHistoryAutoScroll.current = true;
      historyPagingGuard.current = 'older';
      setOldest(from);
      setMessages(current => [...items, ...current].slice(0, MAX_VISIBLE_MESSAGES));
      if (!pendingPageAnchor.current) historyPageBusy.current = false;
    } catch (cause) { historyPageBusy.current = false; setError(plainError(cause)); }
  }
  async function loadNewer() {
    if (!store || !selected || historyPageBusy.current) return;
    const from = (messages.at(-1)?.seq ?? oldest - 1) + 1;
    if (from >= selected.messageCount) return;
    historyPageBusy.current = true;
    const epoch = historyViewEpoch.current;
    const last = messages.at(-1);
    const anchor = last && chatScroll.current?.querySelector<HTMLElement>(`[data-message-seq="${last.seq}"]`);
    try {
      const items = await store.messages(selected, from, Math.min(selected.messageCount, from + PAGE_SIZE));
      if (epoch !== historyViewEpoch.current || !items.length) { historyPageBusy.current = false; return; }
      if (last && anchor) pendingPageAnchor.current = { seq: last.seq, top: anchor.getBoundingClientRect().top };
      suppressHistoryAutoScroll.current = true;
      historyPagingGuard.current = 'newer';
      setOldest(Math.max(oldest, from + items.length - MAX_VISIBLE_MESSAGES));
      setMessages(current => [...current, ...items].slice(-MAX_VISIBLE_MESSAGES));
      if (!pendingPageAnchor.current) historyPageBusy.current = false;
    } catch (cause) { historyPageBusy.current = false; setError(plainError(cause)); }
  }
  function onHistoryScroll() {
    const viewport = chatScroll.current;
    if (!viewport || historyPageBusy.current || !selected || !messages.length) return;
    // Replacing the far end of a full render window can move the scrollbar to
    // the opposite edge. Wait until the person scrolls away from that edge
    // before automatically paging back and undoing the requested page.
    const gapBelow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (historyPagingGuard.current === 'older') {
      if (gapBelow < 180) return;
      historyPagingGuard.current = null;
    } else if (historyPagingGuard.current === 'newer') {
      if (viewport.scrollTop < 180) return;
      historyPagingGuard.current = null;
    }
    if (viewport.scrollTop < 180 && oldest > 0) void loadOlder();
    else if (gapBelow < 180 && (messages.at(-1)?.seq ?? -1) + 1 < selected.messageCount) void loadNewer();
  }
  async function jumpLatest() {
    if (!store || !selected) return;
    const epoch = ++historyViewEpoch.current;
    historyPageBusy.current = false;
    pendingPageAnchor.current = null;
    historyPagingGuard.current = null;
    suppressHistoryAutoScroll.current = false;
    pendingHistoryScroll.current = null;
    if (route.seq !== null) navigate('chat', selected.id);
    const from = Math.max(0, selected.messageCount - PAGE_SIZE);
    const items = await store.messages(selected, from);
    if (epoch !== historyViewEpoch.current) return;
    setMessages(items); setOldest(from);
    requestAnimationFrame(() => messageEnd.current?.scrollIntoView({ block: 'end' }));
  }
  function openAction(meta: ConversationMeta) { setActionMeta(meta); setActionTitle(meta.title); setActionDestination(projectId); setActionProgress(''); setActionError(''); actionDialog.current?.showModal(); }
  async function applyAction(kind: 'rename' | 'copy' | 'move' | 'pin') {
    if (!actionMeta || !store || actionBusy) return;
    if ((kind === 'copy' || kind === 'move') && ((busyRef.current && selectedId === actionMeta.id) || (actionMeta.agentId && runningAgentRef.current === actionMeta.agentId))) {
      setActionError('Wait for this conversation to finish before transferring it.');
      return;
    }
    workspaceWrites.current++;
    setActionBusy(true); setActionError('');
    const controller = (kind === 'copy' || kind === 'move') && actionDestination !== projectId ? new AbortController() : null;
    actionAbortRef.current = controller;
    setActionCanStop(!!controller);
    try {
      if (kind === 'rename') await mutateSessions(actionMeta.projectId, current => current.map(item => item.id === actionMeta.id ? { ...item, title: actionTitle.trim() || item.title, autoTitled: true, updatedAt: isoNow() } : item));
      if (kind === 'pin') await mutateSessions(actionMeta.projectId, current => current.map(item => item.id === actionMeta.id ? { ...item, pinned: !item.pinned } : item));
      if ((kind === 'copy' || kind === 'move') && actionDestination !== projectId) {
        await draftManagerRef.current?.flush();
        const live = (await store.sessions(actionMeta.projectId)).find(item => item.id === actionMeta.id);
        if (!live) throw new Error('This conversation is no longer in the source project. Refresh the conversation list.');
        const source = await store.recoverConversation(live);
        const copied = await store.copyConversation(source, actionDestination, (done, total) => setActionProgress(total ? `Copying ${done} / ${total} message chunks…` : 'Copying conversation…'), controller?.signal);
        actionAbortRef.current = null;
        setActionCanStop(false);
        setActionProgress('Saving destination…');
        try { await mutateSessions(actionDestination, current => [copied, ...current.filter(item => item.id !== copied.id)]); }
        catch (saveError) {
          let removed: boolean;
          try { removed = await store.discardUnlistedCopy(copied); }
          catch (cleanupError) { throw new Error(`The destination could not save the conversation, and cleanup could not be verified. The source remains. Save error: ${plainError(saveError)}. Cleanup error: ${plainError(cleanupError)}`); }
          throw new Error(removed
            ? `The destination could not save the conversation. Its incomplete copy was removed; the source remains. ${plainError(saveError)}`
            : `The destination copy was saved, but its confirmation failed. The source remains; review the destination before trying again. ${plainError(saveError)}`);
        }
        if (kind === 'move') {
          await store.removeMovedSource(source);
          try { await store.remapJournalConversation(source, copied); }
          catch (journalError) { showToast(`Conversation moved, but its journal links could not update: ${plainError(journalError)}`); }
          if (actionMeta.projectId === projectIdRef.current) {
            const current = await store.sessions(actionMeta.projectId);
            sessionsRef.current = current;
            setSessions(current);
          }
          await store.removeConversationMemory(actionMeta.id);
          if (selectedId === actionMeta.id) setSelectedId('');
        }
        setMemories(await store.memory());
        showToast(`${kind === 'copy' ? 'Copied' : 'Moved'} to ${manifest?.projects.find(item => item.id === actionDestination)?.name || 'project'}.`);
      }
      actionDialog.current?.close();
    } catch (cause) { setActionError(controller?.signal.aborted && !plainError(cause).includes('incomplete destination') ? 'Copy stopped. The source conversation is unchanged.' : plainError(cause)); }
    finally { actionAbortRef.current = null; setActionCanStop(false); workspaceWrites.current--; setActionBusy(false); setActionProgress(''); }
  }
  function trackWorkspaceRead(task: Promise<void>): Promise<void> {
    workspaceReadTasks.current.add(task);
    void task.then(() => workspaceReadTasks.current.delete(task), () => workspaceReadTasks.current.delete(task));
    return task;
  }
  function searchConversations(override?: string, mode = searchMode, exactTag = false): Promise<void> {
    return switchingWorkspace.current ? Promise.resolve() : trackWorkspaceRead(searchConversationsImpl(override, mode, exactTag));
  }
  async function searchConversationsImpl(override?: string, mode = searchMode, exactTag = false) {
    if (!store || !manifest) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const run = ++searchRun.current;
    setDiscoverLimit(DISCOVER_PAGE_SIZE);
    setSearchFailures([]);
    setSearchFailureTotal(0);
    const query = (override ?? search).trim().toLowerCase();
    try {
      const all = (await Promise.all(manifest.projects.map(item => store.sessions(item.id)))).flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (controller.signal.aborted || run !== searchRun.current) return;
      if (!query) { setSearchResults(all.map(meta => ({ meta, excerpt: meta.preview }))); setSearchProgress(''); setSearched(true); return; }
      setSearchProgress('Searching titles and tags…');
      const results: SearchResult[] = [];
      let lastTopicYield = performance.now();
      for (const [index, meta] of all.entries()) {
        if (controller.signal.aborted || run !== searchRun.current) return;
        const match = findConversationTopic(meta, query, exactTag);
        if (match) results.push({ meta, ...match });
        if (performance.now() - lastTopicYield > 12) {
          setSearchProgress(`Searching titles and tags ${index + 1} / ${all.length}…`);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          lastTopicYield = performance.now();
        }
      }
      if (controller.signal.aborted || run !== searchRun.current) return;
      setSearchResults([...results]); setSearched(true);
      if (mode === 'full' && query.length < 2) { setSearchProgress('Use at least 2 characters to search message text.'); return; }
      let finalResults = results;
      let failedSearchCount = 0;
      if (mode === 'full') {
        const mayContain = createSearchTermProbe([query]);
        const candidates = all.filter(meta => !meta.searchBits || mayContain(meta.searchBits) > 0);
        const failures: SearchFailure[] = [];
        const positions = new Map(results.map((item, index) => [item.meta.id, index]));
        const hits: (SearchResult | null)[] = Array(candidates.length).fill(null);
        const mergedResults = () => {
          const merged = [...results];
          const seen = new Map(positions);
          for (const hit of hits) {
            if (!hit) continue;
            const existing = seen.get(hit.meta.id);
            if (existing !== undefined) merged[existing] = hit;
            else { seen.set(hit.meta.id, merged.length); merged.push(hit); }
          }
          return merged;
        };
        let next = 0, completed = 0;
        let lastPublishedAt = 0, lastProgressAt = 0;
        const worker = async () => {
          while (!controller.signal.aborted) {
            const index = next++;
            if (index >= candidates.length) return;
            const meta = candidates[index];
            let hit: HarnessMessage | undefined;
            try { hit = (await store.searchMessages(meta, query, 1, meta.messageCount, 0, controller.signal))[0]; }
            catch (cause) {
              if (controller.signal.aborted) return;
              failedSearchCount++;
              if (failures.length < 20) failures.push({ id: meta.id, title: meta.title, reason: plainError(cause) });
            }
            if (hit) {
              const content = searchableMessageText(hit);
              const at = content.toLowerCase().indexOf(query);
              const from = Math.max(0, at - 70);
              hits[index] = { meta, seq: hit.seq, excerpt: `${from ? '…' : ''}${content.slice(from, from + 220).replace(/\s+/g, ' ')}${from + 220 < content.length ? '…' : ''}` };
            }
            completed++;
            if (run === searchRun.current && !controller.signal.aborted) {
              const now = performance.now();
              if (hit && (lastPublishedAt === 0 || now - lastPublishedAt > 250)) {
                setSearchResults(mergedResults());
                lastPublishedAt = now;
              }
              if (completed === candidates.length || now - lastProgressAt > 250) {
                setSearchProgress(`Searching ${completed} / ${candidates.length} conversations…`);
                lastProgressAt = now;
              }
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
        if (controller.signal.aborted || run !== searchRun.current) return;
        finalResults = mergedResults();
        setSearchFailures(failures);
        setSearchFailureTotal(failedSearchCount);
      }
      if (controller.signal.aborted || run !== searchRun.current) return;
      setSearchResults(finalResults); setSearchProgress(`${finalResults.length} found${failedSearchCount ? ` · ${failedSearchCount} could not be searched` : ''}`); setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted && run === searchRun.current) setSearchProgress(`Search failed: ${plainError(cause)}`);
    } finally { if (searchAbort.current === controller) searchAbort.current = null; }
  }
  function resetMemoryForm() {
    setEditingMemoryId(''); setMemoryTitle(''); setMemoryContent(''); setMemoryTags(''); setMemoryScope('project');
  }
  function editMemory(record: MemoryRecord) {
    setEditingMemoryId(record.id);
    setMemoryTitle(record.title);
    setMemoryContent(record.content);
    setMemoryTags((record.tags || []).join(', '));
    setMemoryScope(record.scope);
    memoryFormRef.current?.scrollIntoView({ block: 'start' });
  }
  function rememberMessage(message: HarnessMessage) {
    const firstLine = message.content.split('\n').find(line => line.trim() && !line.trim().startsWith('```')) || '';
    const title = firstLine.replace(/^[\s#>*`-]+/, '').trim().slice(0, 80);
    setEditingMemoryId('');
    setMemoryTitle(title || `Conversation message ${message.seq + 1}`);
    setMemoryContent(message.content.slice(0, 4000));
    setMemoryTags(selected?.tags.slice(0, 4).join(', ') || '');
    setMemoryScope('session');
    navigate('memory');
    requestAnimationFrame(() => memoryFormRef.current?.scrollIntoView({ block: 'start' }));
  }
  async function inspectResponse(message: HarnessMessage) {
    if (!store || !selected || !message.hasDiagnostics) return;
    const run = ++diagnosticOpenRun.current;
    setSelectedDiagnostic(null);
    setSelectedDiagnosticMessageId(message.id);
    setDiagnosticError('');
    setDiagnosticLoading(true);
    responseDiagnosticDialog.current?.showModal();
    try {
      const report = await store.responseDiagnostic(selected.projectId, selected.id, message.id);
      if (run !== diagnosticOpenRun.current) return;
      if (!report) throw new Error('This response diagnostic is missing from the workspace.');
      setSelectedDiagnostic(report);
    } catch (cause) { if (run === diagnosticOpenRun.current) setDiagnosticError(plainError(cause)); }
    finally { if (run === diagnosticOpenRun.current) setDiagnosticLoading(false); }
  }
  async function reviewMemoryDraft(draft: MemoryDraft) {
    if ((memoryTitle || memoryContent || memoryTags || editingMemoryId) && !await confirmAction('Replace the unsaved memory draft?', { title: 'Review proposed memory', confirmLabel: 'Replace draft' })) return;
    setEditingMemoryId('');
    setMemoryTitle(draft.title);
    setMemoryContent(draft.content);
    setMemoryTags(draft.tags);
    setMemoryScope(draft.scope);
    navigate('memory');
    requestAnimationFrame(() => memoryFormRef.current?.scrollIntoView({ block: 'start' }));
  }
  async function saveMemory() {
    if (!store || memorySaving || !memoryTitle.trim() || !memoryContent.trim() || memoryScope === 'session' && !selectedId) return;
    setMemorySaving(true);
    try {
      const now = isoNow();
      const previous = memories.find(item => item.id === editingMemoryId);
      const record: MemoryRecord = {
        id: previous?.id || newId(), scope: memoryScope,
        ownerId: memoryScope === 'global' ? '' : memoryScope === 'project' ? projectId : selectedId,
        title: memoryTitle.trim().slice(0, 100), content: memoryContent.trim(),
        tags: cleanTags(memoryTags.split(','), 12), createdAt: previous?.createdAt || now, updatedAt: now,
      };
      await saveMemories(current => {
        if (!previous) return [...current, record];
        const latest = current.find(item => item.id === previous.id);
        if (!latest || latest.updatedAt !== previous.updatedAt) throw new Error('This memory changed in another tab. Review the latest version before saving again.');
        return current.map(item => item.id === previous.id ? record : item);
      });
      resetMemoryForm();
      showToast(previous ? 'Memory updated.' : 'Memory saved.');
    } catch (cause) { setError(`Could not save memory: ${plainError(cause)}`); }
    finally { setMemorySaving(false); }
  }
  function beginFileWork() { fileWorkCount.current++; setFileBusy(true); }
  function endFileWork() { fileWorkCount.current = Math.max(0, fileWorkCount.current - 1); if (!fileWorkCount.current) setFileBusy(false); }
  async function refreshFiles() {
    if (!folder || switchingWorkspace.current) return;
    const run = ++fileListRun.current;
    beginFileWork();
    try {
      const page = await listToolFilesPage(folder, scope, projectId, fileArea, fileDirectory);
      if (run === fileListRun.current) { setFileEntries(page.entries); setFileNextOffset(page.nextOffset); setFileTotal(page.total); }
    } catch (cause) { if (run === fileListRun.current) setError(plainError(cause)); }
    finally { endFileWork(); }
  }
  async function loadMoreFiles() {
    if (!folder || switchingWorkspace.current || fileNextOffset === null || fileWorkCount.current) return;
    const run = fileListRun.current;
    const offset = fileNextOffset;
    beginFileWork();
    try {
      const page = await listToolFilesPage(folder, scope, projectId, fileArea, fileDirectory, offset);
      if (run === fileListRun.current) {
        setFileEntries(previous => [...previous, ...page.entries]);
        setFileNextOffset(page.nextOffset);
        setFileTotal(page.total);
      }
    } catch (cause) { if (run === fileListRun.current) setError(plainError(cause)); }
    finally { endFileWork(); }
  }
  function updateFileEditor(path: string, text: string) {
    if (fileDraftReadyKey !== fileDraftKey) return;
    setFilePath(path); setFileText(text);
    const base = openedFile.current;
    fileDraftManagerRef.current?.update({ path, text, basePath: base?.path || '', baseText: base?.text || '' });
  }
  async function openFile(path: string) {
    if (!folder || switchingWorkspace.current || fileDraftReadyKey !== fileDraftKey) return;
    const base = openedFile.current;
    if ((base ? filePath !== base.path || fileText !== base.text : !!filePath || !!fileText) &&
      !await confirmAction('Discard unsaved file editor changes before opening another file?', { title: 'Unsaved file edits', confirmLabel: 'Discard', destructive: true })) return;
    const epoch = workspaceEpoch.current, key = fileDraftKey;
    beginFileWork();
    try {
      const file = await readBlob(folder, toolFilePath(scope, projectId, fileArea, path));
      if (file.size > 200_000) throw new Error('This editor opens text files up to 200 KB. The read tool can inspect larger files in parts.');
      const text = await file.text();
      if (epoch === workspaceEpoch.current && key === fileDraftKeyRef.current) {
        await fileDraftManagerRef.current?.clear();
        setFilePath(path); setFileText(text); openedFile.current = { folder, projectId, area: fileArea, path, text };
      }
    } catch (cause) { if (epoch === workspaceEpoch.current) setError(plainError(cause)); }
    finally { endFileWork(); }
  }
  async function uploadFiles(files: FileList | null, targetArea: ToolArea = fileArea, targetDirectory = fileDirectory): Promise<string[]> {
    if (!folder || switchingWorkspace.current || !files?.length) return [];
    const targetFolder = folder, targetScope = scope, targetProjectId = projectId;
    const uploaded: string[] = [];
    beginFileWork();
    try {
      const unindexed: string[] = [];
      const failed: string[] = [];
      for (const file of Array.from(files)) {
        try {
          if (!/^[\w .()\-]+$/.test(file.name)) throw new Error(`Unsafe file name: ${file.name}`);
          const path = await unusedToolFilePath(targetFolder, targetScope, targetProjectId, targetArea, [targetDirectory, file.name].filter(Boolean).join('/'));
          await writeBlob(targetFolder, toolFilePath(targetScope, targetProjectId, targetArea, path), file);
          uploaded.push(path);
          if (targetArea === 'library' && indexableLibraryPath(path)) {
            setLibraryProgress(`Indexing ${path}…`);
            try { await indexLibraryFile(targetFolder, targetProjectId, path); }
            catch (cause) { unindexed.push(`${path}: ${plainError(cause)}`); }
          }
        } catch (cause) {
          failed.push(`${file.name}: ${plainError(cause)}`);
        }
      }
      if (targetArea === 'library' && projectIdRef.current === targetProjectId) { setLibraryHits([]); setLibrarySearched(false); setLibraryCount(await libraryIndexCount(targetFolder, targetProjectId)); }
      if (route.view === 'files' && fileArea === targetArea && projectIdRef.current === targetProjectId) await refreshFiles();
      if (uploaded.length) { setGitRevision(value => value + 1); await signalAgents(`${uploaded.length} file${uploaded.length === 1 ? '' : 's'} uploaded in project ${project?.name || targetProjectId}.`, targetProjectId); showToast(`${uploaded.length} file${uploaded.length === 1 ? '' : 's'} added.`); }
      if (unindexed.length) setError(`Some library files could not be indexed: ${unindexed.slice(0, 3).join(' | ')}`);
      if (failed.length) setError(`${failed.length} upload${failed.length === 1 ? '' : 's'} failed: ${failed.slice(0, 3).join(' | ')}`);
    } catch (cause) { setError(plainError(cause)); }
    finally { endFileWork(); setLibraryProgress(''); }
    return uploaded;
  }
  async function attachChatFiles(files: FileList | null) {
    if (!files?.length || !store || switchingWorkspace.current || chatUploadBusy || busy || draftReadyKey !== draftKey) return;
    if (!folder) { setError('Connect a workspace folder before adding chat files.'); return; }
    const targetStore = store, targetProjectId = projectId, targetSessionId = draftSessionId;
    setChatUploadBusy(true);
    try {
      const uploaded = await uploadFiles(files, 'library', '');
      if (!uploaded.length) return;
      const references = uploaded.map(path => `library/${path}`).join(', ');
      const next = draftManagerRef.current?.appendTo(targetStore, targetProjectId, targetSessionId, `Please use these project library files: ${references}`);
      if (next !== null && next !== undefined && draftKeyRef.current === `${targetStore.workspaceId}:${targetProjectId}:${targetSessionId}`) setDraft(next);
      if (next === null || next === undefined) {
        const previous = await targetStore.draft(targetProjectId, targetSessionId);
        await targetStore.saveDraft(targetProjectId, targetSessionId, [previous.trimEnd(), `Please use these project library files: ${references}`].filter(Boolean).join('\n\n'));
      }
    } catch (cause) {
      setError(`Could not attach files to this chat: ${plainError(cause)}`);
    } finally { setChatUploadBusy(false); }
  }
  function chatFileDrag(event: DragEvent<HTMLDivElement>, phase: 'enter' | 'over' | 'leave' | 'drop') {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (phase === 'drop') {
      chatDragDepth.current = 0;
      setChatDragOver(false);
      void attachChatFiles(event.dataTransfer.files);
    } else if (phase === 'enter') {
      chatDragDepth.current++;
      if (folder && !busy && !chatUploadBusy && draftReadyKey === draftKey) setChatDragOver(true);
    } else if (phase === 'leave') {
      chatDragDepth.current = Math.max(0, chatDragDepth.current - 1);
      if (!chatDragDepth.current) setChatDragOver(false);
    } else event.dataTransfer.dropEffect = folder && !busy && !chatUploadBusy ? 'copy' : 'none';
  }
  async function saveFile() {
    if (!folder || switchingWorkspace.current || fileDraftReadyKey !== fileDraftKey || !filePath.trim() || fileWorkCount.current) return;
    const path = filePath, content = fileText, area = fileArea, id = projectId, key = fileDraftKey;
    const previous = openedFile.current;
    const expected = previous?.folder === folder && previous.projectId === id && previous.area === area && previous.path === path ? previous.text : undefined;
    beginFileWork();
    try {
      await writeToolFile(folder, scope, id, area, path, content, expected);
      if (fileDraftKeyRef.current === key) {
        openedFile.current = { folder, projectId: id, area, path, text: content };
        await fileDraftManagerRef.current?.clear();
      }
      showToast('File saved with a backup.');
      if (area === 'library' && indexableLibraryPath(path)) {
        if (projectIdRef.current === id) { setLibraryHits([]); setLibrarySearched(false); }
        try { await indexLibraryFile(folder, id, path); if (projectIdRef.current === id) setLibraryCount(await libraryIndexCount(folder, id)); }
        catch (cause) { setError(`File saved, but its library index could not be updated: ${plainError(cause)}`); }
      }
      if (projectIdRef.current === id) { await refreshFiles(); setGitRevision(value => value + 1); }
      try { await signalAgents(`File changed: ${area}/${path}`, id); }
      catch (cause) { setError(`File saved, but agents could not be notified: ${plainError(cause)}`); }
    } catch (cause) { setError(plainError(cause)); }
    finally { endFileWork(); }
  }
  async function updateLibraryIndex() {
    if (!folder || switchingWorkspace.current || fileWorkCount.current) return;
    const controller = new AbortController();
    libraryAbortRef.current = controller;
    beginFileWork(); setLibraryProgress('Finding library files…'); setLibraryHits([]); setLibrarySearched(false);
    try {
      const result = await indexLibraryProject(folder, projectId, progress => setLibraryProgress(progress.paused ? 'Indexing paused while chat or an agent uses the workspace.' : progress.total ? `Indexing ${progress.completed} / ${progress.total}${progress.path ? ` · ${progress.path}` : ''}` : 'Finding library files…'), controller.signal, () => busyRef.current || !!runningAgentRef.current);
      setLibraryCount(await libraryIndexCount(folder, projectId));
      showToast(`Library index updated: ${result.indexed} changed, ${result.total} files checked.`);
      if (result.skipped.length) setError(`${result.skipped.length} library item${result.skipped.length === 1 ? '' : 's'} skipped: ${result.skipped.slice(0, 3).join(' | ')}`);
    } catch (cause) {
      if (controller.signal.aborted) showToast('Library indexing stopped. Completed files remain indexed.');
      else setError(plainError(cause));
    } finally { if (libraryAbortRef.current === controller) libraryAbortRef.current = null; endFileWork(); setLibraryProgress(''); }
  }
  function searchProjectLibrary(): Promise<void> {
    return switchingWorkspace.current ? Promise.resolve() : trackWorkspaceRead(searchProjectLibraryImpl());
  }
  async function searchProjectLibraryImpl() {
    if (!folder || !libraryQuery.trim() || librarySearchBusy || librarySearchAbortRef.current) return;
    const epoch = workspaceEpoch.current;
    const controller = new AbortController();
    librarySearchAbortRef.current = controller;
    setLibrarySearchBusy(true);
    setLibrarySearchProgress(null);
    try {
      const hits = await searchLibrary(folder, projectId, libraryQuery.trim(), 3600, controller.signal, (checked, total, phase) => {
        if (epoch === workspaceEpoch.current && !controller.signal.aborted) setLibrarySearchProgress({ checked, total, phase });
      });
      if (epoch === workspaceEpoch.current && !controller.signal.aborted) { setLibraryHits(hits); setLibrarySearched(true); }
    } catch (cause) {
      if (epoch === workspaceEpoch.current && !controller.signal.aborted) setError(plainError(cause));
    } finally {
      if (librarySearchAbortRef.current === controller) librarySearchAbortRef.current = null;
      if (epoch === workspaceEpoch.current) { setLibrarySearchBusy(false); setLibrarySearchProgress(null); }
    }
  }
  async function loadAndTestProfile(candidate: AIConfig) {
    const release = await acquireModel(`setup:${candidate.id}`);
    try {
      if (candidate.provider === 'browser') {
        if (!folder) throw new Error('Connect the folder containing this browser model first.');
        if (!isBrowserModelLoadedFrom(folder, candidate.model, candidate.contextWindow, browserThinkingBudget(candidate))) {
          setModelStatus(`Loading ${candidate.model.split('/').at(-1)}…`);
        }
        await ensureBrowserModelReady(candidate, folder);
      } else {
        setModelStatus('Testing model…');
        await testModel(candidate);
      }
    } finally { release(); }
  }
  function chatLoadKey(candidate: AIConfig) {
    return `${store?.workspaceId || ''}:${candidate.id}:${candidate.model}:${candidate.contextWindow}:${browserThinkingBudget(candidate)}`;
  }
  async function ensureChatModel(candidate: AIConfig, retry = false) {
    if (!store || !folder || candidate.provider !== 'browser' || !candidate.model.trim()) return;
    const key = chatLoadKey(candidate);
    if (isModelConfirmed(candidate)) autoLoadFailed.current.delete(key);
    if (retry) autoLoadFailed.current.delete(key);
    if (autoLoadPending.current.has(key) || autoLoadFailed.current.has(key) || isModelReady(candidate)) return;
    autoLoadPending.current.add(key);
    setAutoLoadingKey(key);
    setModelStatus(`Loading ${candidate.model.split('/').at(-1)}…`);
    try {
      await loadAndTestProfile(candidate);
      setModelStatus(`${candidate.model.split('/').at(-1)} is ready for chat.`);
      showToast('Chat model is ready.');
    } catch (cause) {
      autoLoadFailed.current.add(key);
      const message = plainError(cause);
      setModelStatus(`${candidate.model.split('/').at(-1)} could not load: ${message}`);
    } finally {
      autoLoadPending.current.delete(key);
      setAutoLoadingKey(current => current === key ? '' : current);
    }
  }
  const primaryChatConfig = { ...chatProfile, apiKey: apiKeys[chatProfile.id] || '' };
  const primaryChatLoadKey = chatLoadKey(primaryChatConfig);
  const chatAutoLoading = autoLoadingKey === primaryChatLoadKey;
  const chatLoadProgress = browserStatus.state === 'loading' && browserStatus.path === chatProfile.model ? browserStatus.message : modelSessionStatus.state === 'testing' ? modelSessionStatus.message : modelStatus;
  useEffect(() => {
    if (route.view !== 'chat' || !store || !folder || settingsReadyId !== store.workspaceId || switchingWorkspace.current || busy || lease.owner) return;
    if (primaryChatConfig.provider !== 'browser' || !primaryChatConfig.model.trim() || isModelReady(primaryChatConfig)) return;
    void ensureChatModel(primaryChatConfig);
  }, [route.view, store, folder, settingsReadyId, busy, lease.owner, browserStatus.state, browserStatus.path, browserStatus.contextWindow, browserStatus.thinkingBudgetTokens, modelSessionStatus.state, modelSessionStatus.fingerprint, chatProfile.id, chatProfile.provider, chatProfile.model, chatProfile.contextWindow, chatProfile.browserThinkingMode, chatProfile.maxOutputTokens]);
  async function quickTest() {
    setModelStatus('Preparing model…');
    try { await loadAndTestProfile(config); setModelStatus(`${config.model} is ready in this session.`); }
    catch (cause) { setModelStatus(plainError(cause)); }
  }
  async function loadStarterModel(path: string) {
    const browser = profiles.find(item => item.id === 'browser') || DEFAULT_PROFILES[0];
    const next = { ...browser, model: path, apiKey: '' };
    setModelStatus(`Loading ${path.split('/').at(-1)}…`); setError('');
    try {
      await loadAndTestProfile(next);
      setProfiles(items => items.some(item => item.id === browser.id) ? items.map(item => item.id === browser.id ? next : item) : [...items, next]);
      setSelectedProfileId(browser.id); setModelStatus('Ready in this browser session.');
      showToast('Starter model is ready for chat.'); navigate('chat');
    }
    catch (cause) { const message = plainError(cause); setModelStatus(message); setError(`The starter model could not load: ${message}`); }
  }
  async function setPreferenceOrder(purpose: ModelPurpose, order: string[]) {
    await updateManifest(current => ({ ...current, modelPreferences: { ...current.modelPreferences, [purpose]: [...new Set(order)] } }));
  }
  async function movePreference(purpose: ModelPurpose, index: number, step: number) {
    const list = [...(manifestRef.current?.modelPreferences[purpose] || [])];
    const next = moveVisiblePreference(list, purpose === 'chat' ? chatProfileId : '', index, step);
    if (next !== list) await setPreferenceOrder(purpose, next);
  }
  async function updateAgent(id: string, change: (agent: HarnessAgent) => HarnessAgent) {
    await updateManifest(current => ({ ...current, agents: current.agents.map(agent => agent.id === id ? change(agent) : agent) }));
  }
  function editAgent(agent?: HarnessAgent, templateIndex?: number) {
    const now = isoNow();
    const { template, name } = chooseAgentTemplate(manifest?.agents || [], templateIndex);
    setAgentDraft(agent || { id: newId(), name, identity: template.identity, identityId: manifest?.identities.find(item => item.id === template.id)?.id, prompt: template.prompt, profileId: chatProfileId, projectIds: [projectId], allProjects: false, workspaceAccess: false, schedule: 'manual', everyMinutes: 5, paused: false, nextRunAt: now });
    agentDialog.current?.showModal();
  }
  function reviewAgentDraft(draft: AgentDraft) {
    if (!manifest?.projects.some(item => item.id === draft.projectId)) { setError('The proposed agent’s project is no longer available.'); return; }
    setAgentDraft({ id: newId(), name: draft.name, identity: draft.identity, prompt: draft.task, profileId: chatProfileId,
      projectIds: [draft.projectId], allProjects: false, workspaceAccess: false, schedule: 'manual', everyMinutes: 5, paused: false, nextRunAt: '' });
    agentDialog.current?.showModal();
  }
  async function saveAgent() {
    if (!agentDraft || !manifest || !agentDraft.name.trim() || !agentDraft.prompt.trim()) return;
    const allowed = (id: string) => agentDraft.allProjects || agentDraft.projectIds.includes(id);
    await updateManifest(current => {
      const live = current.agents.find(agent => agent.id === agentDraft.id) || agentDraft;
      const keepLegacy = agentDraft.schedule === 'event' && !!live.pendingEvent && allowed(live.pendingProjectId || projectId);
      const next = { ...agentDraft, name: agentDraft.name.trim(), prompt: agentDraft.prompt.trim(), everyMinutes: Math.max(5, agentDraft.everyMinutes),
        pendingEvents: agentDraft.schedule === 'event' ? (live.pendingEvents || []).filter(event => allowed(event.projectId)) : [],
        pendingEvent: keepLegacy ? live.pendingEvent : '', pendingProjectId: keepLegacy ? live.pendingProjectId : '' };
      next.nextRunAt = next.schedule === 'manual' ? '' : next.schedule === 'event' ? nextAgentEvent(next) ? live.nextRunAt || isoNow() : '' : nextAgentRun(next);
      return { ...current, agents: [...current.agents.filter(agent => agent.id !== next.id), next] };
    });
    agentDialog.current?.close(); setAgentDraft(null);
  }
  async function runAgent(agent: HarnessAgent, manual = false) {
    if (!store || !manifestRef.current || runningAgentRef.current || toolPolicyBusy || switchingWorkspace.current) return;
    runningAgentRef.current = agent.id; setRunningAgentId(agent.id); setRunningAgentStage('preparing');
    const controller = new AbortController(); agentAbortRef.current = controller;
    try {
      const outcome = await withAgentRunLock(store, agent, manual, async (liveAgent, liveManifest) => {
        const consumedEventId = liveAgent.schedule === 'event' ? nextAgentEvent(liveAgent)?.id : undefined;
        let claimed = false;
        let modelAcquired = false;
        const claimId = newId();
        try {
          const runProject = agentRunProject(liveAgent, liveManifest, manual ? projectId : undefined).project;
          await updateAgent(liveAgent.id, current => {
            if (current.runClaim || current.schedule !== liveAgent.schedule || current.profileId !== liveAgent.profileId || current.prompt !== liveAgent.prompt || current.identity !== liveAgent.identity || current.identityId !== liveAgent.identityId || current.allProjects !== liveAgent.allProjects || current.workspaceAccess !== liveAgent.workspaceAccess || JSON.stringify(current.projectIds) !== JSON.stringify(liveAgent.projectIds) || !manual && (current.paused || current.nextRunAt !== liveAgent.nextRunAt) || current.schedule === 'event' && nextAgentEvent(current)?.id !== consumedEventId) {
              throw new Error('This agent schedule changed before its run started.');
            }
            return { ...current, runClaim: { id: claimId, startedAt: isoNow(), projectId: runProject.id, eventId: consumedEventId } };
          });
          claimed = true;
          const result = await executeHarnessAgent({ agent: liveAgent, manifest: liveManifest, store, folder, profiles, apiKeys, memories, imageConfig, compactionAt, preferredProjectId: manual ? projectId : undefined, signal: controller.signal, onToolApproval: approveToolCall,
            onModelWait: () => setRunningAgentStage('queued'), onModelAcquired: () => { modelAcquired = true; setRunningAgentStage('working'); } });
          await updateAgent(liveAgent.id, current => ({ ...finishAgentRun(current, consumedEventId), runClaim: undefined, lastRunAt: isoNow(), lastProjectId: result.session.projectId, lastResult: result.result.slice(0, 500) }));
          showToast(`${liveAgent.name} finished a run. Open its conversation to review.`);
          if (result.session.projectId === projectIdRef.current) {
            try {
              const current = await store.sessions(result.session.projectId);
              if (result.session.projectId === projectIdRef.current) { sessionsRef.current = current; setSessions(current); }
            } catch (cause) { setError(`Agent finished, but the conversation list could not refresh: ${plainError(cause)}`); }
          }
        } catch (cause) {
          const message = controller.signal.aborted ? 'Stopped by user.' : plainError(cause);
          if (claimed && !modelAcquired) {
            await updateAgent(liveAgent.id, current => current.runClaim?.id === claimId ? { ...current, runClaim: undefined, paused: true, lastResult: controller.signal.aborted ? 'Stopped before the model started.' : message } : current);
          } else if (claimed) {
            await updateAgent(liveAgent.id, current => ({ ...current, paused: true, lastRunAt: isoNow(), lastResult: `${message} Review the run log before allowing another run.` }));
          } else {
            await updateAgent(liveAgent.id, current => current.runClaim ? current : { ...retryAgentRun(current), lastRunAt: isoNow(), lastResult: message });
          }
          if (!controller.signal.aborted) showToast(`${liveAgent.name}: ${message}`, 'error');
        }
      });
      if (outcome === null) {
        const latest = await store.manifest();
        manifestRef.current = latest;
        setManifest(latest);
      }
    } catch (cause) { setError(`Agent run could not start: ${plainError(cause)}`); }
    finally { runningAgentRef.current = ''; setRunningAgentId(''); setRunningAgentStage('preparing'); agentAbortRef.current = null; }
  }
  async function retryInterruptedAgent(agent: HarnessAgent) {
    if (!store || !agent.runClaim) return;
    const nextRun = agent.schedule === 'manual' ? 'You can start it manually afterward.' : agent.schedule === 'event' ? 'Its pending event will run again.' : 'Its schedule will resume.';
    const okay = await confirmAction(`Review ${agent.name}'s run log before retrying. The interrupted run may already have changed files. ${nextRun}`, { title: 'Retry interrupted agent', confirmLabel: 'Allow retry' });
    if (!okay) return;
    try {
      const changed = await withIdleAgentLock(store.workspaceId, agent.id, async () => {
        let cleared = false;
        await updateAgent(agent.id, current => {
          if (current.runClaim?.id !== agent.runClaim?.id) return current;
          cleared = true;
          return { ...current, runClaim: undefined, paused: false, nextRunAt: current.schedule === 'manual' ? '' : isoNow() };
        });
        return cleared;
      });
      if (changed === null) showToast(`${agent.name} is still running in another tab.`, 'error');
      else if (changed) showToast(`${agent.name} can run again.`);
      else showToast(`${agent.name}'s run state changed. Review it before retrying.`);
    } catch (cause) { setError(`Could not retry ${agent.name}: ${plainError(cause)}`); }
  }
  async function pauseAgent(agent: HarnessAgent) {
    const running = runningAgentRef.current === agent.id;
    if (running) agentAbortRef.current?.abort();
    await updateAgent(agent.id, current => ({ ...current, paused: running ? true : !current.paused }));
  }
  async function delayAgent(agent: HarnessAgent) {
    await updateAgent(agent.id, current => ({ ...current, nextRunAt: new Date(Date.now() + 5 * 60_000).toISOString() }));
  }
  async function queueTaskForAgent(task: TaskRecord, agent: HarnessAgent) {
    if (!store) return;
    const latest = (await store.tasks()).find(item => item.id === task.id);
    if (!latest || latest.status === 'done' || latest.humanOnly || latest.assignee?.kind !== 'agent' || latest.assignee.agentId !== agent.id) throw new Error('This task is no longer assigned to that agent. Refresh tasks.');
    await updateManifest(current => {
      const active = current.agents.find(item => item.id === agent.id);
      if (!active || active.paused || active.schedule === 'manual') throw new Error('This agent is unavailable for queued work.');
      if (latest.scope === 'workspace' ? !active.workspaceAccess : !(active.allProjects || active.projectIds.includes(latest.projectId!))) throw new Error('This agent cannot access the task scope.');
      const runProject = latest.scope === 'project' ? latest.projectId! : active.allProjects ? projectId : active.projectIds[0];
      if (!runProject) throw new Error('Give this agent access to a project before queuing work.');
      return { ...current, agents: current.agents.map(item => item.id === agent.id ? queueAgentEvent(item, runProject, `Work on task ${latest.id}: ${latest.title}. Read the task, leave progress notes, and mark it blocked or done when appropriate.`) : item) };
    });
    showToast(`Queued “${latest.title}” for ${agent.name}.`);
  }
  async function signalAgents(event: string, sourceProjectId = projectId) {
    const applies = (agent: HarnessAgent) => agent.schedule === 'event' && (agent.allProjects || agent.projectIds.includes(sourceProjectId));
    if (!manifestRef.current?.agents.some(applies)) return;
    await updateManifest(current => ({ ...current, agents: current.agents.map(agent => applies(agent) ? queueAgentEvent(agent, sourceProjectId, event) : agent) }));
  }
  async function dismissPendingEvent(agent: HarnessAgent, eventId: string, description: string) {
    const okay = await confirmAction(`Dismiss “${description.slice(0, 150)}” for ${agent.name}? The agent will not run for this event.`, { title: 'Dismiss agent event', confirmLabel: 'Dismiss', destructive: true });
    if (!okay) return;
    try {
      if (runningAgentRef.current === agent.id) throw new Error('This agent is starting or running. Stop it before changing its event queue.');
      await updateManifest(current => {
        if (!current.agents.some(item => item.id === agent.id)) throw new Error('This agent was removed.');
        return { ...current, agents: current.agents.map(item => item.id === agent.id ? dismissAgentEvent(item, eventId) : item) };
      });
      showToast(`Dismissed an event for ${agent.name}.`);
    } catch (cause) { setError(`Could not dismiss agent event: ${plainError(cause)}`); }
  }
  async function openRunLog(agent: HarnessAgent) {
    if (!store || !manifest) return;
    const allowed = agent.allProjects ? manifest.projects : manifest.projects.filter(item => agent.projectIds.includes(item.id));
    const owner = allowed.find(item => item.id === agent.runClaim?.projectId) || allowed.find(item => item.id === agent.lastProjectId) || allowed[0];
    if (!owner) return;
    const log = (await store.sessions(owner.id)).find(item => item.agentId === agent.id);
    if (!log) return;
    setProjectId(owner.id); navigate('chat', log.id);
  }
  useEffect(() => {
    if (!manifest || !store) return;
    const timer = setInterval(() => {
      const current = manifestRef.current;
      if (!current || switchingWorkspace.current || runningAgentRef.current || busyRef.current || toolPolicyBusy || getModelLease().owner) return;
      const due = current.agents.find(agent => agentDue(agent));
      if (due) void runAgent(due);
    }, 1000);
    return () => clearInterval(timer);
  }, [store, manifest, folder, profiles, apiKeys, memories, imageConfig, projectId, toolPolicyBusy]);

  if (loading) return <div className="harness-loading" role="status"><div className="harness-loading-emblem" aria-hidden="true"><Sparkles size={30}/></div><strong>LOCAL AGENT LAB</strong><span>Opening workspace…</span></div>;
  if (!manifest || !store || !project) return <div className="harness-loading harness-startup-failure" role="alert"><div className="harness-loading-emblem" aria-hidden="true"><Sparkles size={30}/></div><strong>WORKSPACE UNAVAILABLE</strong><p>{startupError || 'The workspace could not be opened.'}</p>{error && <p>{error}</p>}<div><button className="harness-secondary" onClick={() => { setStartupError(''); setLoading(true); setBootAttempt(attempt => attempt + 1); }}>Retry</button>{rememberedFolder && <button className="harness-primary" onClick={() => void reconnectFolder()}><FolderOpen size={16}/> Reconnect drive</button>}{window.showDirectoryPicker && <button className="harness-secondary" onClick={() => void connectFolder()}><FolderOpen size={16}/> Choose drive</button>}</div></div>;
  const portableWorkspace = !!store.folder;
  const browserFileStorage = !!folder && !portableWorkspace;
  const actionSessionBusy = !!actionMeta && ((busy && selectedId === actionMeta.id) || (actionMeta.agentId && runningAgentId === actionMeta.agentId));
  const discoveryCount = searched ? searchResults.length : allSessions.length;
  const discoveryItems: SearchResult[] = searched ? searchResults.slice(0, discoverLimit) : allSessions.slice(0, discoverLimit).map(meta => ({ meta, excerpt: meta.preview }));
  return <div className={`harness${busy || runningAgentId ? ' is-working' : ''}`} data-view={route.view}>
    <aside id="harness-sidebar" ref={sidebarRef} className={`harness-sidebar ${sidebarOpen ? 'open' : ''}`} role={mobileLayout && sidebarOpen ? 'dialog' : undefined} aria-label={mobileLayout && sidebarOpen ? 'Navigation' : undefined} aria-modal={mobileLayout && sidebarOpen ? true : undefined} inert={mobileLayout && !sidebarOpen}>
      <div className="harness-brand"><div className="harness-brand-mark"><img src={brandLogo} alt="" width="42" height="42"/></div><div><strong>Local Agent Lab</strong><small>YOUR OFFLINE WORKSPACE</small></div><button ref={sidebarCloseRef} className="harness-mobile-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18}/></button></div>
      <div className="harness-workspace"><span className="harness-overline">WORKSPACE</span><strong>{portableWorkspace ? folder?.name : manifest.name}</strong><div>{portableWorkspace ? <button onClick={() => void connectFolder()}><FolderOpen size={15}/>Swap drive</button> : rememberedFolder ? <><button onClick={() => void reconnectFolder()} title={`Reconnect ${rememberedFolder.name}`}><FolderOpen size={15}/>Reconnect drive</button>{window.showDirectoryPicker && <button className="harness-icon" onClick={() => void connectFolder()} title="Choose another drive" aria-label="Choose another drive"><FolderOpen size={15}/></button>}</> : window.showDirectoryPicker ? <button onClick={() => void connectFolder()}><FolderOpen size={15}/>Connect drive</button> : <span className="harness-storage-note">{browserFileStorage ? 'Browser files' : 'Browser storage'}</span>}{portableWorkspace && <button className="harness-icon" onClick={() => void ejectFolder()} title="Eject workspace" aria-label="Eject workspace"><ArrowUp size={15}/></button>}</div>{rememberedFolder && !portableWorkspace && <small className="harness-reconnect-note">{rememberedFolder.name} is not open.</small>}</div>
      <div className="harness-project-select"><label htmlFor="project-select" className="harness-overline">PROJECT</label><div><select id="project-select" value={projectId} disabled={busy || fileBusy || chatUploadBusy || gitBusy} onChange={event => { setProjectId(event.target.value); navigate('chat'); }}>{manifest.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="harness-icon" title="Edit project" aria-label="Edit project" disabled={busy || gitBusy} onClick={() => openProjectDialog(true)}><Settings2 size={16}/></button><button className="harness-icon" title="New project" aria-label="New project" disabled={busy || gitBusy} onClick={() => openProjectDialog()}><Plus size={17}/></button></div></div>
      <nav className="harness-nav" aria-label="Main navigation">{VIEWS.map((view, index) => { const Icon = VIEW_ICONS[view]; return <button key={view} className={route.view === view ? 'active' : ''} onClick={() => navigate(view)}><Icon size={17}/><span>{VIEW_LABELS[view]}</span><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small></button>; })}</nav>
      <div className="harness-conversations">
        <div className="harness-section-head"><span className="harness-overline">CONVERSATIONS</span><button className="harness-icon" title="New conversation" aria-label="New conversation" disabled={busy} onClick={() => void newConversation()}><Plus size={17}/></button></div>
        <div className="harness-session-list" ref={sidebarListRef} onScroll={event => setSidebarScrollTop(event.currentTarget.scrollTop)} aria-label="Conversations">
          {sortedSessions.length ? <div className="harness-session-window" role="list" style={{ height: sidebarWindow.height }}>
            {sortedSessions.slice(sidebarWindow.start, sidebarWindow.end).map((meta, offset) => <div key={meta.id} role="listitem" aria-posinset={sidebarWindow.start + offset + 1} aria-setsize={sortedSessions.length} className={`harness-session ${selectedId === meta.id && route.view === 'chat' ? 'active' : ''}`} style={{ top: (sidebarWindow.start + offset) * SIDEBAR_SESSION_HEIGHT }}>
              <button className="harness-session-open" aria-current={selectedId === meta.id && route.view === 'chat' ? 'page' : undefined} disabled={busy} onClick={() => { setSelectedId(meta.id); navigate('chat', meta.id); }}>{meta.pinned && <Pin size={12}/>}<span>{meta.title}</span><small>{meta.preview || prettyDate(meta.createdAt)}</small></button>
              <button className="harness-session-more" title={`Options for ${meta.title}`} aria-label={`Options for ${meta.title}`} onClick={() => openAction(meta)}><MoreHorizontal size={16}/></button>
            </div>)}
          </div> : <p className="harness-muted">Start a conversation to build your history.</p>}
        </div>
      </div>
      <div className="harness-sidebar-signal" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div>
      <button type="button" className="harness-notices-link" aria-current={route.view === 'notices' ? 'page' : undefined} onClick={() => navigate('notices')}>Third-party notices</button>
    </aside>
    {sidebarOpen && <button type="button" className="harness-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>}
    <main className="harness-main" inert={mobileLayout && sidebarOpen}>
      <div className="harness-atmosphere" aria-hidden="true"><span className="harness-atmosphere-orbit"/><span className="harness-atmosphere-reticle"/><span className="harness-atmosphere-points"/><span className="harness-atmosphere-trace"/><span className="harness-atmosphere-flare"/><span className="harness-atmosphere-scan"/><span className="harness-atmosphere-horizon"/><span className="harness-atmosphere-glyphs"/><span className="harness-atmosphere-beam"/><span className="harness-atmosphere-sparks"/><svg className="harness-atmosphere-network" viewBox="0 0 520 520" fill="none" preserveAspectRatio="xMidYMid meet"><path d="M56 392 146 305 235 338 325 208 442 154M146 305 105 164 238 94 325 208 390 365 235 338M238 94 442 154 390 365 475 435"/><circle cx="56" cy="392" r="3"/><circle cx="146" cy="305" r="4"/><circle cx="235" cy="338" r="3"/><circle cx="325" cy="208" r="5"/><circle cx="442" cy="154" r="3"/><circle cx="105" cy="164" r="3"/><circle cx="238" cy="94" r="4"/><circle cx="390" cy="365" r="4"/><circle cx="475" cy="435" r="3"/></svg></div>
      <header className="harness-topbar"><button ref={menuButtonRef} className="harness-menu" aria-label="Open navigation" aria-controls="harness-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={19}/></button><div className="harness-breadcrumb"><span>{project.name}</span><ChevronRight size={14}/><strong>{VIEW_LABELS[route.view]}</strong></div><HarnessQuickOpen key={store.workspaceId} store={store} projects={manifest.projects} onOpen={session => { setProjectId(session.projectId); navigate('chat', session.id); }}/><AgentNotice agents={manifest.agents} runningId={runningAgentId} runningStage={runningAgentStage} chatBusy={busy} modelBusy={!!lease.owner} onDelay={agent => void delayAgent(agent)} onPause={agent => void pauseAgent(agent)}/><div className="harness-top-actions"><span className="harness-signal-bars" aria-hidden="true"><i/><i/><i/><i/></span><span className="harness-status-dot" title={portableWorkspace ? `Saved to ${folder?.name}` : 'Saved in this browser'}/><span>{portableWorkspace ? folder?.name : browserFileStorage ? 'Browser files' : 'Browser workspace'}</span></div></header>
      {error && <div className="harness-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {route.view === 'notices' && <Suspense fallback={<section className="harness-page" role="status">Opening notices…</section>}><ThirdPartyNotices/></Suspense>}
      {route.view === 'chat' && <div className="harness-chat"><div className="harness-chat-header"><div><div className="harness-chat-kicker"><span className="harness-overline">ACTIVE CONVERSATION</span><span className={`harness-model-state${chatUsingFallback ? " fallback" : modelReady ? " ready" : ""}`} role="status" title={chatUsingFallback ? `${chatProfile.label} is unavailable in this browser session. ${chatConfig?.label} is ready as the fallback.` : undefined}><i aria-hidden="true"/>{chatAutoLoading && !modelReady ? "LOADING MODEL" : chatUsingFallback ? "FALLBACK READY" : modelReady ? "MODEL READY" : "MODEL NOT LOADED"}</span></div><h1>{selected?.title || 'New conversation'}</h1><p>{selected ? `${selected.messageCount} messages · ${selected.segments.length} compacted parts` : 'Ask a question or start a coding task.'}</p>{selected?.segments.length ? <HarnessChapters key={selected.id} segments={selected.segments} onOpen={seq => navigate('chat', selected.id, seq)} onLatest={() => void jumpLatest()}/> : null}{selected && selected.messageCount > 0 && <HarnessConversationSearch key={`search:${selected.id}`} store={store} meta={selected} onOpen={seq => navigate('chat', selected.id, seq)}/>}</div><div className="harness-model-controls"><label className="harness-control" title="AI profile"><Sparkles size={15} aria-hidden="true"/><select aria-label="AI profile" value={chatProfileId} onChange={event => void selectProjectChatProfile(event.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="harness-control" title="Thinking mode"><Brain size={15} aria-hidden="true"/><select aria-label="Thinking mode" value={chatProfile.provider === 'browser' ? chatProfile.browserThinkingMode || 'none' : chatProfile.effort} onChange={event => { const value = event.target.value; setProfiles(items => items.map(item => item.id !== chatProfile.id ? item : chatProfile.provider === 'browser' ? { ...item, browserThinkingMode: value as AIConfig['browserThinkingMode'] } : { ...item, effort: value as AIConfig['effort'] })); }}><option value="none">No thinking</option>{chatProfile.provider === 'browser' ? <><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option></> : <><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></>}</select></label><button className="harness-icon" title="Conversation tools" aria-label="Conversation tools" disabled={!selected || busy || toolPolicyBusy} onClick={() => conversationToolsDialog.current?.showModal()}><Wrench size={18}/></button><button className="harness-icon" title="Model settings" aria-label="Model settings" onClick={() => { setSelectedProfileId(chatProfileId); navigate('models'); }}><Settings2 size={18}/></button></div></div>
        <div className="harness-chat-messages" ref={chatScroll} onScroll={onHistoryScroll}>{oldest > 0 && <button className="harness-load-older" onClick={() => void loadOlder()}><ArrowUp size={14}/> Load older messages</button>}{!messages.length && <div className="harness-welcome"><div className="harness-signal-art" aria-hidden="true"><span className="harness-signal-orbit orbit-one"/><span className="harness-signal-orbit orbit-two"/><span className="harness-signal-core"><Sparkles size={29}/></span><span className="harness-signal-node node-one"/><span className="harness-signal-node node-two"/><span className="harness-signal-node node-three"/></div><span className="harness-overline">PRIVATE BY DEFAULT</span><h2>What will we build?</h2><p>{browserFileStorage ? 'Private chat and project files stay in this browser. Connect a drive to take them with you.' : 'Chat privately in your browser. Connect a folder to give tools access to project files.'}</p>{!modelReady && !profiles.some(item => item.id === 'browser' && item.model) ? <><Suspense fallback={<p className="harness-muted">Checking starter model…</p>}><StarterSetup folder={folder} onConnectFolder={connectFolder} onLoad={loadStarterModel}/></Suspense><button className="harness-secondary" onClick={() => navigate('models')}>Browse other models <ChevronRight size={15}/></button></> : !modelReady ? chatProfile.provider === 'browser' && chatProfile.model && folder ? <div className="harness-chat-load"><button className="harness-primary" disabled={chatAutoLoading || !!lease.owner} onClick={() => void ensureChatModel(primaryChatConfig, true)}>{chatAutoLoading ? 'Loading model…' : autoLoadFailed.current.has(primaryChatLoadKey) ? 'Retry model load' : 'Load model'} <ChevronRight size={16}/></button>{(chatAutoLoading || modelStatus) && <p role="status">{chatAutoLoading && browserStatus.path === chatProfile.model ? browserStatus.message : modelStatus}</p>}</div> : <button className="harness-primary" onClick={() => navigate('models')}>Load and test model <ChevronRight size={16}/></button> : <button className="harness-secondary" onClick={() => { updateDraft('Help me plan a small coding project.'); }}>Plan a project</button>}<div className="harness-launch-grid" aria-label="Explore your workspace"><button onClick={() => navigate('files')}><FileCode2 size={17}/><span>Files & tools</span><ChevronRight size={14}/></button><button onClick={() => navigate('discover')}><Search size={17}/><span>Discover</span><ChevronRight size={14}/></button><button onClick={() => navigate('memory')}><Brain size={17}/><span>Memory</span><ChevronRight size={14}/></button></div></div>}{messages.map(message => <article className={`harness-message ${message.role}${route.seq === message.seq ? ' target' : ''}`} data-message-seq={message.seq} key={message.id}><div className="harness-message-avatar" aria-hidden="true">{message.role === 'user' ? <UserRound size={16}/> : message.role === 'tool' ? <Wrench size={16}/> : <IdentityAvatar identity={activeIdentity} url={activeIdentityAvatarUrl} size={30}/>}</div><div className="harness-message-body"><div className="harness-message-meta"><strong>{message.role === 'user' ? 'You' : message.role === 'tool' ? 'Tool' : 'Assistant'}</strong><time title={message.createdAt}>{prettyDate(message.createdAt)}</time>{message.model && <button type="button" className="harness-model-stamp" title="Show model details" aria-label={`Model details: ${modelStampLabel(message.model)}`} onClick={() => { setSelectedModelStamp(message.model!); modelStampDialog.current?.showModal(); }}>{modelStampLabel(message.model)}</button>}{message.hasDiagnostics && <button type="button" className="harness-message-inspect" title="Inspect response" aria-label={`Inspect response ${message.seq + 1}`} onClick={() => void inspectResponse(message)}><ScanSearch size={13}/><span>Inspect</span></button>}<button type="button" className="harness-message-remember" title="Save this message as a memory" aria-label={`Remember ${message.role} message ${message.seq + 1}`} onClick={() => rememberMessage(message)}><BookmarkPlus size={13}/><span>Remember</span></button></div><div className="harness-message-content"><ReactMarkdown>{message.content}</ReactMarkdown></div>{message.toolEvents?.length ? <details><summary>{message.toolEvents.length} tool event{message.toolEvents.length === 1 ? '' : 's'}</summary><pre>{message.toolEvents.join('\n\n')}</pre></details> : null}{message.toolEvents?.flatMap((event, index) => { const draft = memoryDraftFromToolEvent(event); return draft ? [<button type="button" className="harness-memory-proposal" key={`memory:${message.id}:${index}`} onClick={() => void reviewMemoryDraft(draft)}><Brain size={15}/> Review memory: {draft.title}</button>] : []; })}{message.toolEvents?.flatMap((event, index) => { const draft = agentDraftFromToolEvent(event); return draft ? [<button type="button" className="harness-memory-proposal" key={`agent:${message.id}:${index}`} onClick={() => reviewAgentDraft(draft)}><Timer size={15}/> Review agent: {draft.name}</button>] : []; })}{message.toolEvents?.flatMap((event, index) => { const draft = projectDraftFromToolEvent(event); return draft ? [<button type="button" className="harness-memory-proposal" key={`project:${message.id}:${index}`} onClick={() => reviewProjectDraft(draft)}><FolderOpen size={15}/> Review project: {draft.name}</button>] : []; })}{message.toolEvents?.flatMap((event, index) => { const draft = projectInstructionDraftFromToolEvent(event); return draft ? [<button type="button" className="harness-memory-proposal" key={`instructions:${message.id}:${index}`} onClick={() => void reviewProjectInstructionDraft(draft)}><FileCode2 size={15}/> Review project instructions</button>] : []; })}{message.toolEvents?.flatMap((event, index) => { const draft = projectProfileDraftFromToolEvent(event); return draft ? [<button type="button" className="harness-memory-proposal" key={`profile:${message.id}:${index}`} onClick={() => reviewProjectProfileDraft(draft)}><Sparkles size={15}/> Review chat profile: {draft.profileLabel}</button>] : []; })}{message.toolEvents?.flatMap(event => { const path = /^generate_image: Image saved to (.+?\.png) \(/.exec(event)?.[1]; return path ? [<GeneratedImage key={path} folder={folder} path={path}/>] : []; })}</div></article>)}{selected && (messages.at(-1)?.seq ?? -1) + 1 < selected.messageCount && <div className="harness-history-actions"><button className="harness-load-older" onClick={() => void loadNewer()}><ArrowDown size={14}/> Load newer messages</button><button className="harness-secondary" onClick={() => void jumpLatest()}>Latest</button></div>}{busy && liveThinking && liveResponseTarget.current?.projectId === projectId && liveResponseTarget.current?.sessionId === selectedId && <details className="harness-live-thinking"><summary><Brain size={14}/> Thinking live</summary><div><ReactMarkdown>{liveThinking}</ReactMarkdown></div></details>}{busy && liveResponse && liveResponseTarget.current?.projectId === projectId && liveResponseTarget.current?.sessionId === selectedId && <article className="harness-message assistant harness-live-message" aria-label="Assistant response in progress"><div className="harness-message-avatar" aria-hidden="true"><IdentityAvatar identity={activeIdentity} url={activeIdentityAvatarUrl} size={30}/></div><div className="harness-message-body"><div className="harness-message-meta"><strong>Assistant</strong><span>Writing</span></div><div className="harness-message-content harness-live-content"><ReactMarkdown>{liveResponse}</ReactMarkdown></div></div></article>}{busy && <div className="harness-generating"><span className="harness-pulse"/>{lease.owner && !lease.owner.startsWith('chat:') ? 'Waiting for model…' : workingLabel}</div>}<div ref={messageEnd}/></div>
        <div className="harness-compose"><div className={`harness-compose-box${chatDragOver ? ' drop-target' : ''}`} onDragEnter={event => chatFileDrag(event, 'enter')} onDragOver={event => chatFileDrag(event, 'over')} onDragLeave={event => chatFileDrag(event, 'leave')} onDrop={event => chatFileDrag(event, 'drop')}>{chatDragOver && <div className="harness-drop-hint" aria-hidden="true"><Upload size={24}/>Drop files into this project's Library</div>}<textarea value={draft} onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} placeholder={draftReadyKey !== draftKey ? 'Opening saved draft…' : modelReady ? 'Ask, plan, research, or work on project files…' : chatAutoLoading ? 'Loading your browser model…' : 'Load a model to start chatting…'} rows={3} disabled={busy || draftReadyKey !== draftKey}/><div><div className="harness-compose-tools"><button className="harness-secondary" title="Add files to this project’s library" onClick={() => chatFileInput.current?.click()} disabled={!folder || busy || chatUploadBusy || draftReadyKey !== draftKey}><Upload size={15}/>{chatUploadBusy ? "Adding…" : "Add files"}</button><HarnessContextInspector key={`${store.workspaceId}:${project.id}:${selected?.id || "new"}`} store={store} meta={selected} project={project} manifest={manifest} memories={memories} config={chatConfig || { ...chatProfile, apiKey: apiKeys[chatProfile.id] || '' }} selectedConfig={chatProfile} profiles={profiles} onSelectProfile={id => void selectProjectChatProfile(id)} onUpdateProfile={next => setProfiles(items => items.map(item => item.id === next.id ? next : item))} compactionAt={compactionAt} onCompactionAtChange={setCompactionAt} draft={draft} folder={folder}/><span>{folder ? browserFileStorage ? 'Browser file tools available' : 'Project tools available' : 'Connect a folder to use file tools'}</span></div>{busy ? <button className="harness-danger harness-stop" onClick={() => { setStopping(true); chatAbortRef.current?.abort(new DOMException("Stopped by user.", "AbortError")); }} disabled={stopping} title="Stop response"><X size={15}/> {stopping ? "Stopping…" : "Stop"}</button> : <button className="harness-primary" onClick={() => void send()} disabled={!draft.trim() || !modelReady || chatUploadBusy || draftReadyKey !== draftKey} title="Send message"><ArrowUp size={18}/></button>}</div></div><input ref={chatFileInput} type="file" multiple hidden onChange={event => { void attachChatFiles(event.target.files); event.target.value = ""; }}/><small>{chatConfig?.model || chatProfile.model || 'No model selected'}{chatUsingFallback ? ' · fallback' : ''}{lease.owner && !lease.owner.startsWith('chat:') ? ` · ${lease.owner} using model` : ''}</small>{chatAutoLoading && <small role="status">{chatLoadProgress}</small>}{!modelReady && chatProfile.provider === 'browser' && !!chatProfile.model && !!folder && !chatAutoLoading && <button className="harness-compose-load" disabled={!!lease.owner} onClick={() => void ensureChatModel(primaryChatConfig, true)}>{autoLoadFailed.current.has(primaryChatLoadKey) ? 'Retry model load' : 'Load model'}</button>}{!modelReady && autoLoadFailed.current.has(primaryChatLoadKey) && <small role="alert">{modelStatus}</small>}</div>
      </div>}
      {route.view === 'discover' && <section className="harness-page"><div className="harness-heading"><span className="harness-overline">FIND YOUR WORK</span><h1>Discover</h1><p>Browse by topic, tag, date, or search the full conversation text.</p></div><div className="harness-search"><input aria-label="Search conversations" value={search} onChange={event => { searchAbort.current?.abort(); searchRun.current++; setSearch(event.target.value); setSearched(false); setSearchProgress(''); setSearchFailures([]); setSearchFailureTotal(0); setDiscoverLimit(DISCOVER_PAGE_SIZE); }} onKeyDown={event => { if (event.key === 'Enter') void searchConversations(); }} placeholder="Search conversations…"/><select aria-label="Search mode" value={searchMode} onChange={event => { searchAbort.current?.abort(); searchRun.current++; setSearchMode(event.target.value as 'topics' | 'full'); setSearched(false); setSearchProgress(''); setSearchFailures([]); setSearchFailureTotal(0); setDiscoverLimit(DISCOVER_PAGE_SIZE); }}><option value="topics">Titles & tags</option><option value="full">Full text</option></select><button className="harness-primary" onClick={() => void searchConversations()}><Search size={16}/> Search</button></div>{searchProgress && <p className="harness-muted" role="status">{searchProgress}</p>}{searchFailureTotal > 0 && <details className="harness-search-failures"><summary>{searchFailureTotal} conversation{searchFailureTotal === 1 ? "" : "s"} could not be searched</summary><ul>{searchFailures.map(item => <li key={item.id}><strong>{item.title}</strong> · {item.reason}</li>)}</ul>{searchFailureTotal > searchFailures.length && <small>Showing the first {searchFailures.length} failures.</small>}</details>}<div className="harness-tag-cloud">{discoveryTags.map(({ tag, count, level }) => <button key={tag} className={`harness-tag-level-${level}`} title={`${count} conversation${count === 1 ? '' : 's'}`} aria-label={`${tag}, ${count} conversation${count === 1 ? '' : 's'}`} onClick={() => { setSearch(tag); setSearchMode('topics'); void searchConversations(tag, 'topics', true); }}>{tag}</button>)}</div>{!allSessions.length && !searched && <DiscoverEmptyState onChat={() => navigate('chat')} onModels={() => navigate('models')} onFiles={() => navigate('files')}/>} {!searched && !!allSessions.length && <HarnessTimeline sessions={allSessions} onOpen={(meta, seq) => { setProjectId(meta.projectId); navigate('chat', meta.id, seq); }}/>}<div className="harness-results">{discoveryItems.map(({ meta, excerpt, seq }) => <button key={meta.id} onClick={() => { setProjectId(meta.projectId); navigate('chat', meta.id, seq); }}><div><strong>{meta.title}</strong><span>{manifest.projects.find(item => item.id === meta.projectId)?.name} · {prettyDate(meta.createdAt)}–{prettyDate(meta.updatedAt)}</span></div><p>{excerpt}</p><small>{meta.tags.join(' · ')}</small></button>)}{searched && !searchResults.length && !searchProgress.startsWith('Searching') && <p className="harness-muted">No conversations matched. Try full-text search or a shorter phrase.</p>}</div>{discoveryCount > discoverLimit && <button className="harness-secondary harness-show-more" onClick={() => setDiscoverLimit(limit => limit + DISCOVER_PAGE_SIZE)}>Show more conversations · {Math.min(discoverLimit, discoveryCount)} of {discoveryCount}</button>}{!searched && !!allSessions.length && <><div className="harness-timeline"><h2>Topic timeline</h2>{timelinePage.items.map(({ meta, segment }) => <button key={segment.id} onClick={() => { setProjectId(meta.projectId); navigate('chat', meta.id, segment.startSeq); }}><time>{prettyDate(segment.startAt)}–{prettyDate(segment.endAt)}</time><strong>{segment.title}</strong><span>{meta.title} · {segment.tags.join(' · ')}</span><p>{segment.summary}</p></button>)}{timelinePage.total > timelineLimit && <button className="harness-secondary harness-show-more" onClick={() => setTimelineLimit(limit => limit + TIMELINE_PAGE_SIZE)}>Show older topics · {Math.min(timelineLimit, timelinePage.total)} of {timelinePage.total}</button>}</div></>}</section>}
      {route.view === 'identities' && <HarnessIdentities identities={manifest.identities} chatIdentityId={manifest.chatIdentityId} store={store} folder={folder} imageOptions={imageCandidates(imageConfig, manifest.modelPreferences.image)} onSave={saveIdentity} onSelectChat={selectChatIdentity} onSaveAvatar={(id, blob) => trackedWorkspaceWrite(() => store.saveIdentityAvatar(id, blob))} onOpenModels={() => navigate('models')}/>}
      {route.view === 'tasks' && <HarnessTasks key={`${store.workspaceId}:${project.id}`} store={store} project={project} agents={manifest.agents} onQueueAgent={queueTaskForAgent} onWrite={trackedWorkspaceWrite}/>}
      {route.view === 'journal' && <HarnessJournal key={store.workspaceId} store={store} projects={manifest.projects} agents={manifest.agents} onOpen={(id, sessionId, seq) => { setProjectId(id); navigate('chat', sessionId, seq); }} onWrite={trackedWorkspaceWrite}/>}
      {route.view === 'agents' && <section className="harness-page"><div className="harness-heading harness-agent-heading"><div><span className="harness-overline">BROWSER ACTIVE ONLY</span><h1>Agents</h1><p>Schedules run while this tab is open. Chat takes the next available model slot.</p></div><button className="harness-primary" onClick={() => editAgent()}><Plus size={16}/> New agent</button></div>{!manifest.agents.length && <div className="harness-agent-templates">{AGENT_TEMPLATES.map((template, index) => <button key={template.name} className="harness-card" onClick={() => editAgent(undefined, index)}><Sparkles size={22}/><h2>{template.name}</h2><p>{template.identity}</p><span>Create agent <ChevronRight size={14}/></span></button>)}</div>}<div className="harness-agent-list">{manifest.agents.map(agent => <div className="harness-card" key={agent.id}><div className="harness-agent-card-head"><div><span className="harness-overline">{agent.schedule === 'interval' ? `EVERY ${Math.max(5, agent.everyMinutes)} MIN` : agent.schedule.toUpperCase()}{agent.paused ? ' · PAUSED' : ''}</span><h2>{agent.name}</h2></div><span className={agent.paused ? 'harness-agent-state paused' : 'harness-agent-state'}>{runningAgentId === agent.id ? runningAgentStage === 'working' ? 'Working' : runningAgentStage === 'queued' ? 'Queued' : 'Preparing' : agent.runClaim ? 'Needs review' : agent.paused ? 'Paused' : agent.schedule === 'manual' ? 'Manual' : agent.schedule === 'event' ? nextAgentEvent(agent) ? `${(agent.pendingEvents?.length || 0) + Number(!!agent.pendingEvent)} queued` : 'Waiting for event' : 'Scheduled'}</span></div><p>{identityInstructions(manifest, agent.identityId, agent.identity)}</p><p className="harness-agent-prompt">{agent.prompt}</p>{agent.runClaim && <p className="harness-agent-interrupted" role="status">Run started {prettyDate(agent.runClaim.startedAt)}. Review its log before retrying.</p>}<div className="harness-agent-meta">{agent.allProjects ? 'All projects' : `${agent.projectIds.length} project${agent.projectIds.length === 1 ? '' : 's'}`} · {profiles.find(item => item.id === agent.profileId)?.label || 'Missing profile'}{agent.workspaceAccess ? ' · Workspace files' : ''}</div>{agent.lastResult && <details><summary>Last run · {agent.lastRunAt ? prettyDate(agent.lastRunAt) : ''}</summary><p>{agent.lastResult}</p></details>}<HarnessAgentEvents agent={agent} projects={manifest.projects} disabled={!!agent.runClaim || runningAgentId === agent.id} onDismiss={(eventId, description) => void dismissPendingEvent(agent, eventId, description)}/><div className="harness-agent-actions"><button className="harness-primary" onClick={() => void runAgent(agent, true)} disabled={toolPolicyBusy || !!runningAgentId || !!agent.runClaim || !readyProfile(agent.profileId, 'code', manifest.modelPreferences, profiles, apiKeys, !!folder) && !(!!folder && profiles.some(item => item.id === agent.profileId && item.provider === 'browser' && !!item.model))}>{runningAgentId === agent.id ? runningAgentStage === 'working' ? 'Working…' : runningAgentStage === 'queued' ? 'Queued…' : 'Preparing…' : 'Run now'}</button><button className="harness-secondary" onClick={() => void pauseAgent(agent)} disabled={!!agent.runClaim && runningAgentId !== agent.id}>{runningAgentId === agent.id ? 'Stop & pause' : agent.paused ? 'Resume' : 'Pause'}</button>{agent.runClaim && runningAgentId !== agent.id && <button className="harness-secondary" onClick={() => void retryInterruptedAgent(agent)}>Allow retry</button>}<button className="harness-secondary" onClick={() => editAgent(agent)}>Edit</button>{(agent.lastRunAt || agent.runClaim) && <button className="harness-secondary" onClick={() => void openRunLog(agent)}>Open run log</button>}</div></div>)}</div></section>}
      {route.view === 'files' && <section className="harness-page"><div className="harness-heading"><span className="harness-overline">PROJECT SCOPE</span><h1>Files & tools</h1><p>Models can list, search, read, and edit project files. Edits keep a backup.</p></div>{folder ? <><HarnessToolInventory folder={folder} scope={scope} project={project} store={store} conversation={selected || null} imageAvailable={imageCandidates(imageConfig, manifest.modelPreferences.image).length > 0} policyBusy={toolPolicyBusy || busy || !!runningAgentId} profiles={manifest.toolProfiles || []} onPolicyChange={(name, permission) => void saveToolPermission(name, permission)} onWorkspaceAccessChange={access => void saveWorkspaceToolAccess(access)} onProfileChange={id => void applyToolProfile(id)} onSaveProfile={saveNewToolProfile} onUpdateProfile={id => void updateToolProfile(id)} onDeleteProfile={id => void deleteToolProfile(id)}/><div className="harness-file-toolbar"><select aria-label="File area" value={fileArea} onChange={event => { setFileArea(event.target.value as 'files' | 'library'); setFileDirectory(''); setFilePath(''); setFileText(''); }}><option value="files">Code files</option><option value="library">Library</option></select>{fileDirectory && <button className="harness-secondary" onClick={() => setFileDirectory(fileDirectory.split('/').slice(0, -1).join('/'))}>Up</button>}<button className="harness-secondary" onClick={() => void refreshFiles()}>{fileBusy ? 'Loading…' : 'Refresh files'}</button><button className="harness-secondary" onClick={() => fileInput.current?.click()} disabled={fileBusy}><Upload size={15}/> Upload</button>{fileArea === 'library' && <><span className="harness-library-status">{libraryCount} indexed</span>{libraryAbortRef.current ? <button className="harness-danger" onClick={() => libraryAbortRef.current?.abort()}>Stop indexing</button> : <button className="harness-secondary" onClick={() => void updateLibraryIndex()} disabled={fileBusy}>Update index</button>}</>}<FileHistoryDialog folder={folder} scope={scope} projectId={projectId} area={fileArea} onActivityChange={active => { if (active) beginFileWork(); else endFileWork(); }} onRestored={() => { if (projectIdRef.current !== projectId) return; const base = openedFile.current; const dirty = base ? filePath !== base.path || fileText !== base.text : !!filePath || !!fileText; if (!dirty) { openedFile.current = null; setFilePath(''); setFileText(''); void fileDraftManagerRef.current?.clear().catch(cause => setError(plainError(cause))); } else showToast('File restored. Your unsaved editor text is still here.'); void refreshFiles(); setGitRevision(value => value + 1); if (fileArea === 'library') { setLibraryHits([]); setLibrarySearched(false); void libraryIndexCount(folder, projectId).then(setLibraryCount).catch(cause => setError(plainError(cause))); } }}/><input ref={fileInput} type="file" multiple hidden onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }}/></div>{libraryProgress && <div className="harness-library-progress" role="status">{libraryProgress}</div>}{fileArea === 'library' && <div className="harness-library-search"><div className="harness-library-search-controls"><Search size={16}/><input aria-label="Search project library" value={libraryQuery} onChange={event => { librarySearchAbortRef.current?.abort(); setLibraryQuery(event.target.value); setLibrarySearched(false); }} onKeyDown={event => { if (event.key === 'Enter') void searchProjectLibrary(); }} placeholder="Find a passage in your library…"/><button className="harness-secondary" onClick={() => void searchProjectLibrary()} disabled={!libraryQuery.trim() || librarySearchBusy}>{librarySearchBusy ? 'Searching…' : 'Search library'}</button>{librarySearchBusy && <button className="harness-secondary" onClick={() => librarySearchAbortRef.current?.abort()}>Stop</button>}</div>{librarySearchBusy && <div className="harness-library-search-progress" role="status"><progress max={Math.max(1, librarySearchProgress?.total || 1)} value={librarySearchProgress?.checked ?? 0}/><span>{librarySearchProgress ? (librarySearchProgress.phase === 'index' ? `Scanning ${librarySearchProgress.checked} / ${librarySearchProgress.total} files` : `Checking ${librarySearchProgress.checked} / ${librarySearchProgress.total} candidates`) : 'Reading index…'}</span></div>}{librarySearched && <div className="harness-library-results" role="status">{libraryHits.length ? libraryHits.map(hit => <article key={`${hit.path}:${hit.offset}`}><div><strong>{hit.path}</strong><small>Character {hit.offset.toLocaleString()}</small></div><p>{hit.text}</p></article>) : <p>No indexed passages matched. Update the index if files changed outside this app.</p>}</div>}</div>}<Suspense fallback={<div className="harness-card">Opening Git…</div>}><GitPanel key={store.workspaceId} folder={folder} workspaceId={store.workspaceId} project={project} revision={gitRevision} editorDirty={!!filePath && (filePath !== openedFile.current?.path || fileText !== openedFile.current?.text) || !!fileText && !filePath} onEditProject={() => openProjectDialog(true)} onActivityChange={value => { gitActivityBusy.current = value; setGitBusy(value); }} onWorkingTreeChange={() => { openedFile.current = null; setFilePath(''); setFileText(''); void refreshFiles(); }}/></Suspense><div className="harness-file-grid"><div className="harness-file-list">{!fileEntries.length && <div className="harness-file-empty" role="status"><div className="harness-file-empty-art" aria-hidden="true"><span/><span/><span/><FileCode2 size={27}/></div><strong>{fileBusy ? 'Scanning files…' : fileDirectory ? 'This folder is empty' : fileArea === 'library' ? 'Your library is ready' : 'Start with a file'}</strong><p>{fileBusy ? 'Reading your workspace.' : fileArea === 'library' ? 'Upload a document to make it searchable.' : 'Create a file in the editor or upload one.'}</p></div>}{fileEntries.map(entry => <button key={entry.path} onClick={() => entry.kind === 'file' ? void openFile(entry.path) : setFileDirectory(entry.path)}><FileCode2 size={15}/><span>{entry.path}</span><small>{entry.kind === 'file' ? `${entry.bytes?.toLocaleString()} B` : 'Folder'}</small></button>)}{fileNextOffset !== null && <button className="harness-file-more" onClick={() => void loadMoreFiles()} disabled={fileBusy}>Show more files · {fileEntries.length} of {fileTotal}</button>}</div><HarnessFileEditor path={filePath} text={fileText} busy={fileBusy || fileDraftReadyKey !== fileDraftKey} onPathChange={path => updateFileEditor(path, fileText)} onTextChange={text => updateFileEditor(filePath, text)} onSave={() => void saveFile()}/></div></> : <div className="harness-card"><FolderOpen size={26}/><h2>Connect a workspace folder</h2><p>File tools use your chosen local folder and can travel with a USB drive.</p><button className="harness-primary" onClick={connectFolder}>Connect folder</button></div>}</section>}
      {route.view === 'memory' && <section className="harness-page"><div className="harness-heading"><span className="harness-overline">LONG TERM CONTEXT</span><h1>Memory</h1><p>Only relevant memory notes are added to a model request.</p></div><div className="harness-memory-grid"><div className="harness-card" ref={memoryFormRef}><h2>{editingMemoryId ? 'Edit memory' : 'Add memory'}</h2><label>Scope<select value={memoryScope} onChange={event => setMemoryScope(event.target.value as MemoryRecord['scope'])}><option value="global">All projects</option><option value="project">Current project</option><option value="session" disabled={!selectedId}>Current conversation</option></select></label><label>Title<input value={memoryTitle} onChange={event => setMemoryTitle(event.target.value)}/></label><label>What to remember<textarea rows={6} value={memoryContent} onChange={event => setMemoryContent(event.target.value)}/></label><label>Tags, separated by commas<input value={memoryTags} onChange={event => setMemoryTags(event.target.value)} placeholder="API, Build, Preferences"/></label><div className="harness-memory-actions"><button className="harness-primary" onClick={() => void saveMemory()} disabled={memorySaving || !memoryTitle.trim() || !memoryContent.trim() || memoryScope === 'session' && !selectedId}>{memorySaving ? 'Saving…' : editingMemoryId ? 'Save changes' : 'Save memory'}</button>{(editingMemoryId || memoryTitle || memoryContent || memoryTags) && <button className="harness-secondary" onClick={resetMemoryForm} disabled={memorySaving}>Clear draft</button>}</div></div><div className="harness-memory-list">{memories.filter(item => item.scope === 'global' || item.scope === 'project' && item.ownerId === projectId || item.scope === 'session' && item.ownerId === selectedId).map(item => <div className="harness-card" key={item.id}><small>{item.scope.toUpperCase()}</small><h3>{item.title}</h3><p>{item.content}</p>{(item.tags || []).length > 0 && <div className="harness-memory-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<div className="harness-memory-actions"><button className="harness-secondary" onClick={() => editMemory(item)} disabled={memorySaving}>Edit</button><button className="harness-danger" onClick={() => { void confirmAction(`Remove memory “${item.title}”?`, { title: 'Remove memory', confirmLabel: 'Remove', destructive: true }).then(async okay => { if (!okay) return; await saveMemories(current => { const latest = current.find(record => record.id === item.id); if (!latest || latest.updatedAt !== item.updatedAt) throw new Error('This memory changed in another tab. Review the latest version before removing it.'); return current.filter(record => record.id !== item.id); }); if (editingMemoryId === item.id) resetMemoryForm(); }).catch(cause => setError(`Could not remove memory: ${plainError(cause)}`)); }}>Remove</button></div></div>)}</div></div></section>}
      {route.view === 'models' && <section className="harness-page harness-models"><div className="harness-heading"><span className="harness-overline">LOCAL FIRST</span><h1>Models & engines</h1><p>Choose a profile, download models to your folder, then load and test one for this session.</p></div>{!folder && profiles.some(item => item.id === 'browser' && !!item.model) && <div className="harness-callout"><FolderOpen size={19}/> Connect a folder to download local models for offline use. <button onClick={connectFolder}>Connect folder</button></div>}{!profiles.some(item => item.id === 'browser' && !!item.model) && <Suspense fallback={<div className="harness-card">Checking starter model…</div>}><StarterSetup folder={folder} onConnectFolder={connectFolder} onLoad={loadStarterModel}/></Suspense>}<div className="harness-model-quick"><select aria-label="Selected model profile" value={selectedProfileId} onChange={event => setSelectedProfileId(event.target.value)}>{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button className="harness-primary" onClick={() => void quickTest()} disabled={!config.model || !!lease.owner}>{quickModelReady ? 'Test again' : 'Load & test'}</button><span>{modelStatus || (quickModelReady ? 'Ready in this browser session' : config.model ? 'Load and test before chat' : 'No model selected')}</span></div><div className="harness-preferences"><div className="harness-preference-head"><div><span className="harness-overline">FALLBACK ORDER</span><h2>Model priority</h2></div><select aria-label="Model purpose" value={preferencePurpose} onChange={event => setPreferencePurpose(event.target.value as ModelPurpose)}>{MODEL_PURPOSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><p>{preferencePurpose === 'image' ? 'Generators run in the order below. The current image service is the final fallback unless listed. Switching local models can take time.' : preferencePurpose === 'code' ? 'Each agent tries its own profile first, then ready coding fallbacks in this order.' : 'Chat tries this project’s selected model first, then ready fallbacks in this order.'}</p>{preferencePurpose === 'chat' && <div className="harness-preference-row harness-preference-fixed"><span>1</span><strong>{chatProfile.label}</strong><small>Selected in Chat</small></div>}{displayedPreferences.map((id, index) => <div className="harness-preference-row" key={id}><span>{index + (preferencePurpose === 'chat' ? 2 : 1)}</span><strong>{preferencePurpose === 'image' ? IMAGE_PRESETS[id as ImagePreset]?.model || id : profiles.find(item => item.id === id)?.label || id}</strong><button title="Move up" aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => void movePreference(preferencePurpose, index, -1)}>↑</button><button title="Move down" aria-label={`Move ${id} down`} disabled={index === displayedPreferences.length - 1} onClick={() => void movePreference(preferencePurpose, index, 1)}>↓</button><button className="harness-danger" onClick={() => void setPreferenceOrder(preferencePurpose, manifest.modelPreferences[preferencePurpose].filter(item => item !== id))}>Remove</button></div>)}{preferencePurpose === 'image' && imageConfig.preset !== 'none' && !manifest.modelPreferences.image.includes(imageConfig.preset) && <div className="harness-preference-row harness-preference-fixed"><span>{manifest.modelPreferences.image.length + 1}</span><strong>{imageConfig.model}</strong><small>Current service fallback</small></div>}<select aria-label="Add fallback profile" value="" onChange={event => { if (event.target.value) void setPreferenceOrder(preferencePurpose, [...manifest.modelPreferences[preferencePurpose], event.target.value]); }}><option value="">Add profile…</option>{preferencePurpose === 'image' ? Object.entries(IMAGE_PRESETS).filter(([id]) => id !== 'none' && !manifest.modelPreferences.image.includes(id)).map(([id, item]) => <option key={id} value={id}>{item.model}</option>) : profiles.filter(item => !manifest.modelPreferences[preferencePurpose].includes(item.id) && (preferencePurpose !== 'chat' || item.id !== chatProfileId)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><Suspense fallback={<div className="harness-card">Opening model catalog…</div>}><ProviderSettings config={config} profiles={profiles} onSelect={setSelectedProfileId} onChange={next => { setProfiles(items => items.map(item => item.id === next.id ? { ...next, apiKey: '' } : item)); if (next.apiKey !== config.apiKey) setApiKeys(keys => ({ ...keys, [next.id]: next.apiKey })); }} onAdd={next => { setProfiles(items => [...items, { ...next, apiKey: '' }]); if (next.apiKey) setApiKeys(keys => ({ ...keys, [next.id]: next.apiKey })); setSelectedProfileId(next.id); }} onDelete={id => { setProfiles(items => items.filter(item => item.id !== id)); if (selectedProfileId === id) setSelectedProfileId('browser'); }} onModelDownloaded={(id, path) => { setProfiles(items => items.map(item => item.id === id ? { ...item, model: path } : item)); }} onConnectFolder={connectFolder} folder={folder} imageConfig={imageConfig} onImageConfigChange={setImageConfig}/></Suspense></section>}
    </main>
    <dialog ref={conversationToolsDialog} className="harness-dialog harness-conversation-tools-dialog" aria-label="Conversation tools"><div className="harness-conversation-tools-head"><h2>Conversation tools</h2><button className="harness-secondary" onClick={() => conversationToolsDialog.current?.close()}>Close</button></div>{selected && <HarnessToolInventory folder={folder} scope={conversationScope} project={project} store={store} conversation={selected} imageAvailable={imageCandidates(imageConfig, manifest.modelPreferences.image).length > 0} policyBusy={toolPolicyBusy || busy} profiles={manifest.toolProfiles || []} conversationMode onPolicyChange={(name, permission) => void saveConversationToolPermission(name, permission)} onProfileChange={id => void applyConversationToolProfile(id)} onSaveProfile={saveNewConversationToolProfile} onUpdateProfile={() => {}} onDeleteProfile={() => {}}/>}</dialog>
    <dialog ref={modelStampDialog} className="harness-dialog harness-model-stamp-dialog" aria-label="Reply model details"><h2>Reply model</h2>{selectedModelStamp && <pre>{modelStampDetails(selectedModelStamp)}</pre>}<button className="harness-secondary" onClick={() => modelStampDialog.current?.close()}>Close</button></dialog>
    <dialog ref={responseDiagnosticDialog} className="harness-dialog harness-response-dialog" aria-label="Response diagnostics" onClose={() => { diagnosticOpenRun.current++; setSelectedDiagnostic(null); }}><HarnessResponseDiagnostics report={selectedDiagnostic} loading={diagnosticLoading} error={diagnosticError} messageId={selectedDiagnosticMessageId} onClose={() => responseDiagnosticDialog.current?.close()}/></dialog>
    <dialog ref={projectDialog} className="harness-dialog"><h2>{editingProjectId ? 'Project settings' : 'New project'}</h2><label>Name<input autoFocus value={projectName} onChange={event => setProjectName(event.target.value)}/></label><label>Description<textarea rows={2} value={projectDescription} onChange={event => setProjectDescription(event.target.value)}/></label><label>Default chat model<select value={projectProfileId} onChange={event => setProjectProfileId(event.target.value)}><option value="">Workspace selection</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Chat identity<select value={projectIdentityId} onChange={event => setProjectIdentityId(event.target.value)}><option value="">Workspace default</option><option value="none">No identity</option>{manifest.identities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Instructions & personality<textarea rows={6} value={projectInstructions} onChange={event => setProjectInstructions(event.target.value)} placeholder="How should the assistant work in this project?"/></label><p className="harness-muted">The project also reads AGENTS.md from its code folder before each chat or agent run. Create or edit it in Files &amp; tools.</p><label>Code folder in workspace<input value={projectFilesPath} onChange={event => setProjectFilesPath(event.target.value)} placeholder="repositories/my-app (optional)"/></label><label>Model tool access<select value={projectToolAccess} onChange={event => setProjectToolAccess(event.target.value as 'full' | 'read-only')}><option value="full">Read and change files</option><option value="read-only">Read-only</option></select></label><div><button className="harness-secondary" onClick={() => projectDialog.current?.close()}>Cancel</button><button className="harness-primary" onClick={() => void saveProjectDetails()} disabled={!projectName.trim()}>{editingProjectId ? 'Save' : 'Create'}</button></div></dialog>
    <dialog ref={actionDialog} className="harness-dialog" onCancel={event => { if (actionBusy) event.preventDefault(); }}><h2>Conversation</h2><label>Title<input value={actionTitle} disabled={actionBusy} onChange={event => setActionTitle(event.target.value)}/></label><div><button className="harness-secondary" disabled={actionBusy} onClick={() => void applyAction('rename')}>Rename</button><button className="harness-secondary" disabled={actionBusy} onClick={() => void applyAction('pin')}><Pin size={14}/>{actionMeta?.pinned ? 'Unpin' : 'Pin'}</button></div><label>Destination<select value={actionDestination} disabled={actionBusy} onChange={event => setActionDestination(event.target.value)}>{manifest.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div><button className="harness-secondary" onClick={() => void applyAction('copy')} disabled={actionBusy || actionSessionBusy || actionDestination === projectId} title={actionSessionBusy ? "Wait for this conversation to finish" : undefined}><Copy size={14}/> Copy</button><button className="harness-secondary" onClick={() => void applyAction('move')} disabled={actionBusy || actionSessionBusy || actionDestination === projectId} title={actionSessionBusy ? "Wait for this conversation to finish" : undefined}><ArrowDown size={14}/> Move</button></div>{actionProgress && <div className="harness-action-progress" role="status"><span>{actionProgress}</span>{actionCanStop && <button className="harness-danger" disabled={!!actionAbortRef.current?.signal.aborted} onClick={() => { const active = actionAbortRef.current; if (!active) return; active.abort(new DOMException("Copy stopped.", "AbortError")); setActionProgress("Stopping copy…"); }}>Stop copy</button>}</div>}{actionError && <p role="alert" className="harness-git-error">{actionError}</p>}<button className="harness-secondary" disabled={actionBusy} onClick={() => actionDialog.current?.close()}>Close</button></dialog>
    <dialog ref={agentDialog} className="harness-dialog harness-agent-dialog"><div className="harness-agent-dialog-head"><h2>{manifest.agents.some(item => item.id === agentDraft?.id) ? 'Edit agent' : 'New agent'}</h2><button type="button" className="harness-icon" aria-label="Close agent editor" onClick={() => agentDialog.current?.close()}><X size={17}/></button></div>{agentDraft && <><label>Name<input value={agentDraft.name} onChange={event => setAgentDraft({ ...agentDraft, name: event.target.value })}/></label><label>Identity preset<select value={agentDraft.identityId || ""} onChange={event => { const id = event.target.value; const previous = manifest.identities.find(item => item.id === agentDraft.identityId); const chosen = manifest.identities.find(item => item.id === id); setAgentDraft({ ...agentDraft, name: chosen && previous?.name === agentDraft.name ? chosen.name : agentDraft.name, identityId: id, identity: id ? identityInstructions(manifest, id, agentDraft.identity) : agentDraft.identity }); }}><option value="">Custom</option>{manifest.identities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Identity<textarea rows={3} value={agentDraft.identityId ? identityInstructions(manifest, agentDraft.identityId, agentDraft.identity) : agentDraft.identity} disabled={!!agentDraft.identityId} onChange={event => setAgentDraft({ ...agentDraft, identity: event.target.value })}/></label><label>Task<textarea rows={4} value={agentDraft.prompt} onChange={event => setAgentDraft({ ...agentDraft, prompt: event.target.value })}/></label><div className="harness-agent-form-row"><label>Model profile<select value={agentDraft.profileId} onChange={event => setAgentDraft({ ...agentDraft, profileId: event.target.value })}>{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Schedule<select value={agentDraft.schedule} onChange={event => setAgentDraft({ ...agentDraft, schedule: event.target.value as HarnessAgent['schedule'] })}><option value="manual">Manual</option><option value="continuous">Continuous</option><option value="interval">Interval</option><option value="event">On project event</option></select></label></div>{agentDraft.schedule === 'interval' && <label>Minutes between runs<input type="number" min={5} max={10080} value={agentDraft.everyMinutes} onChange={event => setAgentDraft({ ...agentDraft, everyMinutes: Number(event.target.value) || 5 })}/></label>}<fieldset className="harness-agent-scopes"><legend>Access</legend><label><input type="checkbox" checked={agentDraft.allProjects} onChange={event => setAgentDraft({ ...agentDraft, allProjects: event.target.checked })}/> All projects</label>{!agentDraft.allProjects && manifest.projects.map(item => <label key={item.id}><input type="checkbox" checked={agentDraft.projectIds.includes(item.id)} onChange={event => setAgentDraft({ ...agentDraft, projectIds: event.target.checked ? [...agentDraft.projectIds, item.id] : agentDraft.projectIds.filter(id => id !== item.id) })}/> {item.name}</label>)}<label><input type="checkbox" checked={agentDraft.workspaceAccess} onChange={event => setAgentDraft({ ...agentDraft, workspaceAccess: event.target.checked })}/> Entire workspace folder</label></fieldset><div className="harness-dialog-actions"><button className="harness-secondary" onClick={() => agentDialog.current?.close()}>Cancel</button>{manifest.agents.some(item => item.id === agentDraft.id) && <button className="harness-danger" onClick={() => { void confirmAction(`Remove agent “${agentDraft.name}”? Its run log remains in conversations.`, { title: 'Remove agent', confirmLabel: 'Remove', destructive: true }).then(async okay => { if (!okay) return; if (runningAgentRef.current === agentDraft.id) agentAbortRef.current?.abort(); await updateManifest(current => ({ ...current, agents: current.agents.filter(item => item.id !== agentDraft.id) })); agentDialog.current?.close(); }); }}>Remove</button>}<button className="harness-primary" onClick={() => void saveAgent()} disabled={!agentDraft.name.trim() || !agentDraft.prompt.trim() || !agentDraft.allProjects && !agentDraft.projectIds.length}>Save agent</button></div></>}</dialog>
    <ToastViewport/>
  </div>;
}
