import { searchableMessageText } from './harnessCompaction.ts';

export type ModelStamp = {
  profileId: string;
  profileLabel?: string;
  provider: string;
  model: string;
  modelLabel?: string;
  thinking: string;
  contextWindow: number;
  maxOutputTokens: number;
  family?: string;
  version?: string;
  parametersB?: number;
  quantization?: string;
  engine?: string;
  license?: string;
};

export type HarnessMessage = {
  id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  model?: ModelStamp;
  inputTokens?: number;
  outputTokens?: number;
  toolEvents?: string[];
  hasDiagnostics?: boolean;
};

export type ContextSegment = {
  id: string;
  chapterId: string;
  title: string;
  summary: string;
  tags: string[];
  startSeq: number;
  endSeq: number;
  startAt: string;
  endAt: string;
};

export type ConversationMeta = {
  id: string;
  projectId: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeFrom: number;
  contextSummary: string;
  segments: ContextSegment[];
  tags: string[];
  searchBits: string;
  preview: string;
  autoTitled: boolean;
  agentId?: string;
  /** Per-conversation choices may narrow or adjust project tool rules. */
  toolPermissions?: Record<string, 'allow' | 'deny' | 'ask' | 'once' | 'session'>;
  approvedTools?: string[];
  toolProfileId?: string;
};

export type HarnessProject = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  filesPath?: string;
  /** Applies to model and agent tools; direct edits by the person remain available. */
  toolAccess?: 'full' | 'read-only';
  toolPermissions?: Record<string, 'allow' | 'deny' | 'ask' | 'once' | 'session'>;
  approvedTools?: string[];
  toolProfileId?: string;
  createdAt: string;
  updatedAt: string;
  defaultProfileId?: string;
  identityId?: string;
};

export type HarnessIdentity = {
  id: string;
  name: string;
  focus: 'coding' | 'research' | 'review' | 'general';
  instructions: string;
  icon?: 'person' | 'robot' | 'code' | 'brain' | 'compass' | 'shield' | 'spark';
  avatarPath?: string;
  avatarAssetId?: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryScope = 'global' | 'project' | 'session';
export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  ownerId: string;
  title: string;
  content: string;
  /** Broad, user-defined topic. Older memories without one belong to General. */
  category?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type AgentSchedule = 'manual' | 'continuous' | 'interval' | 'event';
export type AgentEvent = { id: string; projectId: string; description: string; createdAt: string };
export type HarnessAgent = {
  id: string;
  name: string;
  identity: string;
  identityId?: string;
  prompt: string;
  profileId: string;
  projectIds: string[];
  allProjects: boolean;
  workspaceAccess: boolean;
  schedule: AgentSchedule;
  everyMinutes: number;
  paused: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastResult?: string;
  pendingEvent?: string;
  pendingProjectId?: string;
  pendingEvents?: AgentEvent[];
  lastProjectId?: string;
  runClaim?: { id: string; startedAt: string; projectId: string; eventId?: string };
};

export type ModelPurpose = 'chat' | 'code' | 'image' | 'speech' | 'transcription';
export type ModelPreferences = Record<ModelPurpose, string[]>;

export type ToolPolicyProfile = {
  id: string;
  name: string;
  permissions: Record<string, 'allow' | 'deny' | 'ask' | 'once' | 'session'>;
  createdAt: string;
  updatedAt: string;
};

export function orderedPreferenceIds(preferred: string[], fallback: string): string[] {
  return [...new Set([...preferred, fallback].filter(id => id && id !== 'none'))];
}

/** The active chat profile is shown separately and must not appear twice in its fallback list. */
export function visiblePreferenceIds(preferred: string[], activeId = ''): string[] {
  return orderedPreferenceIds(preferred, '').filter(id => id !== activeId);
}

export function moveVisiblePreference(preferred: string[], activeId: string, index: number, step: number): string[] {
  const visible = visiblePreferenceIds(preferred, activeId);
  const target = index + step;
  if (index < 0 || index >= visible.length || target < 0 || target >= visible.length) return preferred;
  [visible[index], visible[target]] = [visible[target], visible[index]];
  return preferred.includes(activeId) ? [...visible, activeId] : visible;
}

export type HarnessManifest = {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  projects: HarnessProject[];
  agents: HarnessAgent[];
  identities: HarnessIdentity[];
  chatIdentityId: string;
  userProfile?: { name: string; avatarAssetId?: string };
  modelPreferences: ModelPreferences;
  /** Model and agent tools may read, but not change, this workspace. Person-initiated edits remain available. */
  workspaceToolAccess?: 'full' | 'read-only';
  toolProfiles?: ToolPolicyProfile[];
};

export const DEFAULT_PROJECT_ID = 'home';
export const DEFAULT_WORKSPACE_ID = 'browser-home';
export const MESSAGE_CHUNK_SIZE = 24;
export const isoNow = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
export const identityAvatarPath = (id: string) => `harness/avatars/${id}.png`;

export function defaultIdentities(now = isoNow()): HarnessIdentity[] {
  return [
    { id: 'ada', name: 'Ada', focus: 'coding', icon: 'code', instructions: 'Careful coding partner. Inspect relevant files before editing, make focused changes, and test meaningful behavior. Explain what changed and any remaining risk.', createdAt: now, updatedAt: now },
    { id: 'lumen', name: 'Lumen', focus: 'research', icon: 'compass', instructions: 'Precise research partner. Trace claims to available sources, separate evidence from inference, and point out uncertainty.', createdAt: now, updatedAt: now },
    { id: 'trace', name: 'Trace', focus: 'review', icon: 'shield', instructions: 'Quality reviewer. Look for concrete bugs, contradictions, and missing checks. Prioritize issues by impact and cite the relevant files.', createdAt: now, updatedAt: now },
  ];
}

export function identityInstructions(manifest: HarnessManifest, id: string | undefined, fallback = ''): string {
  return id && id !== 'none' ? manifest.identities.find(item => item.id === id)?.instructions || fallback : fallback;
}

export function chatIdentity(manifest: HarnessManifest, project: HarnessProject): string {
  return identityInstructions(manifest, project.identityId === 'none' ? '' : project.identityId || manifest.chatIdentityId);
}

export function createManifest(id = DEFAULT_WORKSPACE_ID, name = 'My workspace'): HarnessManifest {
  const createdAt = isoNow();
  return {
    version: 1, id, name, createdAt, updatedAt: createdAt,
    projects: [{ id: DEFAULT_PROJECT_ID, name: 'Home', description: 'Conversations outside a project.', instructions: '', createdAt, updatedAt: createdAt }],
    agents: [], identities: defaultIdentities(createdAt), chatIdentityId: 'ada', userProfile: { name: 'You' }, toolProfiles: [], workspaceToolAccess: 'full',
    modelPreferences: { chat: [], code: [], image: [], speech: [], transcription: [] },
  };
}

export function createConversation(projectId: string, agentId?: string): ConversationMeta {
  const createdAt = isoNow();
  return {
    id: newId(), projectId, title: 'New conversation', pinned: false,
    createdAt, updatedAt: createdAt, messageCount: 0, activeFrom: 0,
    contextSummary: '', segments: [], tags: [], searchBits: '', preview: '', autoTitled: false,
    ...(agentId ? { agentId } : {}),
  };
}

export function titleCaseTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40)
    .replace(/(^|[^\p{L}\p{N}_])(\p{L})/gu, (_match, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function cleanTags(values: unknown, limit = 10): string[] {
  if (!Array.isArray(values) || limit <= 0) return [];
  const unique = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = titleCaseTag(value);
    if (tag.length >= 2 && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

/** Rank topics by the number of conversations that carry each tag. */
export function conversationTagCloud(sessions: ConversationMeta[], limit = 40): { tag: string; count: number; level: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const session of sessions) {
    const unique = new Set<string>();
    const add = (value: string) => {
      const tag = titleCaseTag(value);
      const key = tag.toLocaleLowerCase();
      if (!tag || unique.has(key)) return;
      unique.add(key);
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag || tag, count: (current?.count || 0) + 1 });
    };
    for (const tag of session.tags || []) add(tag);
    for (const segment of session.segments || []) for (const tag of segment.tags || []) add(tag);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(0, limit)).map(({ tag, count }) => ({ tag, count, level: Math.min(4, Math.floor(Math.log2(count))) }));
}

export function conversationHasTag(session: ConversationMeta, tag: string): boolean {
  const target = titleCaseTag(tag).toLocaleLowerCase();
  return (session.tags || []).some(value => titleCaseTag(value).toLocaleLowerCase() === target)
    || (session.segments || []).some(segment => (segment.tags || []).some(value => titleCaseTag(value).toLocaleLowerCase() === target));
}

export function findConversationTopic(session: ConversationMeta, search: string, exactTag = false): { excerpt: string; seq?: number } | null {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return null;
  const exact = exactTag ? titleCaseTag(query).toLocaleLowerCase() : '';
  const segments = session.segments || [];
  let chapter: (typeof segments)[number] | undefined;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (exactTag
      ? (segment.tags || []).some(tag => titleCaseTag(tag).toLocaleLowerCase() === exact)
      : `${segment.title} ${segment.tags.join(' ')} ${segment.summary}`.toLocaleLowerCase().includes(query)) {
      chapter = segment;
      break;
    }
  }
  const topLevel = exactTag ? conversationHasTag(session, query)
    : `${session.title} ${(session.tags || []).join(' ')} ${session.preview || ''}`.toLocaleLowerCase().includes(query);
  if (!topLevel && !chapter) return null;
  return chapter ? { excerpt: `${chapter.title}: ${chapter.summary}`.slice(0, 300), seq: chapter.startSeq }
    : { excerpt: session.preview };
}

export const estimatedTokens = (text: string) => Math.ceil(text.length / 4);

// A compact per-conversation filter. Full-text search still verifies every candidate chunk.
const BLOOM_BYTES = 2048;
const MIN_CHUNK_BLOOM_BYTES = 256;
const MAX_CHUNK_BLOOM_BYTES = 16_384;
// v6 adds repository initialization to saved actions. Older filters cannot
// safely rule out a match in a newly indexed tool event.
const SEARCH_INDEX_VERSION = 'v6:';
const PREVIOUS_SEARCH_INDEX_VERSION = 'v5:';
const LEGACY_SEARCH_INDEX_VERSION = 'v3:';
const UNINDEXED = 'unindexed';
const SEARCH_SEEDS = [2166136261, 3141592653, 1013904223] as const;
function hash(term: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < term.length; index++) value = Math.imul(value ^ term.charCodeAt(index), 16777619) >>> 0;
  return value;
}
export function searchTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || [])];
}
function grams(text: string, includeBigrams = true): string[] {
  const result = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || []) {
    if (includeBigrams) for (let index = 0; index <= word.length - 2; index++) result.add(word.slice(index, index + 2));
    for (let index = 0; index <= word.length - 3; index++) result.add(word.slice(index, index + 3));
  }
  return [...result];
}
function addBits(encoded: string, text: string, bytes: number): string {
  const version = encoded.startsWith(LEGACY_SEARCH_INDEX_VERSION) ? LEGACY_SEARCH_INDEX_VERSION
    : encoded.startsWith(PREVIOUS_SEARCH_INDEX_VERSION) ? PREVIOUS_SEARCH_INDEX_VERSION : SEARCH_INDEX_VERSION;
  if (encoded && !encoded.startsWith(version)) return encoded; // Unknown indexes cannot safely rule out substring matches.
  if (text.length > 500_000) return UNINDEXED; // Never restart a partial index after a large pasted document.
  let bits: Uint8Array;
  try { bits = encoded ? Uint8Array.from(atob(encoded.slice(version.length)), character => character.charCodeAt(0)) : new Uint8Array(bytes); }
  catch { return UNINDEXED; }
  if (!bits.length) return UNINDEXED;
  for (const term of grams(text, version !== LEGACY_SEARCH_INDEX_VERSION)) for (const seed of SEARCH_SEEDS) {
    const bit = hash(term, seed) % (bits.length * 8);
    bits[bit >> 3] |= 1 << (bit & 7);
  }
  return version + btoa(String.fromCharCode(...bits));
}
export function addSearchBits(encoded: string, text: string): string { return addBits(encoded, text, BLOOM_BYTES); }
function chunkBloomBytes(messages: Pick<HarnessMessage, 'content' | 'toolEvents'>[]): number {
  const characters = messages.reduce((total, message) => total + searchableMessageText(message).length, 0);
  const target = Math.min(MAX_CHUNK_BLOOM_BYTES, Math.max(MIN_CHUNK_BLOOM_BYTES, Math.ceil(characters / 32)));
  let bytes = MIN_CHUNK_BLOOM_BYTES;
  while (bytes < target) bytes *= 2;
  return bytes;
}
/** Upgrade old content-only indexes and small current indexes when a chunk is read. */
export function chunkSearchIndexNeedsUpgrade(encoded: string, messages: Pick<HarnessMessage, 'content' | 'toolEvents'>[]): boolean {
  if (encoded === UNINDEXED) return false;
  if (!encoded.startsWith(SEARCH_INDEX_VERSION)) return true;
  try { return atob(encoded.slice(SEARCH_INDEX_VERSION.length)).length < chunkBloomBytes(messages); }
  catch { return true; }
}
export function chunkSearchBits(messages: Pick<HarnessMessage, 'content' | 'toolEvents'>[]): string {
  let bits = '';
  const bytes = chunkBloomBytes(messages);
  for (const message of messages) {
    bits = addBits(bits, searchableMessageText(message), bytes);
    if (bits === UNINDEXED) return bits;
  }
  return bits;
}
/** Reuse one query's trigram hashes and decode each candidate index only once. */
export function createSearchTermProbe(terms: string[]): (encoded: string) => number {
  const currentHashes = terms.map(term => grams(term).flatMap(gram => SEARCH_SEEDS.map(seed => hash(gram, seed))));
  return encoded => {
    if (!encoded.startsWith(SEARCH_INDEX_VERSION)) return terms.length;
    let bits: Uint8Array;
    try { bits = Uint8Array.from(atob(encoded.slice(SEARCH_INDEX_VERSION.length)), character => character.charCodeAt(0)); }
    catch { return terms.length; }
    if (!bits.length) return terms.length;
    return currentHashes.reduce((count, termHashes) => count + Number(termHashes.every(value => {
      const bit = value % (bits.length * 8);
      return !!(bits[bit >> 3] & (1 << (bit & 7)));
    })), 0);
  };
}
export function mayContainTerms(encoded: string | undefined, query: string): boolean {
  if (!encoded?.startsWith(SEARCH_INDEX_VERSION)) return true;
  let bits: Uint8Array;
  try { bits = Uint8Array.from(atob(encoded.slice(SEARCH_INDEX_VERSION.length)), character => character.charCodeAt(0)); }
  catch { return true; }
  if (!bits.length) return true;
  return grams(query).every(term => SEARCH_SEEDS.every(seed => {
    const bit = hash(term, seed) % (bits.length * 8);
    return !!(bits[bit >> 3] & (1 << (bit & 7)));
  }));
}
