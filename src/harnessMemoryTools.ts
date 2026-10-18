import type { BrowserTools } from './browserModel.ts';
import type { ConversationMeta, MemoryRecord } from './harnessData.ts';
import { memoryMatchScore, memoryQueryTerms } from './harnessMemoryPrompt.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';

function canRead(record: MemoryRecord, projectId: string, sessionId: string): boolean {
  return record.scope === 'global'
    || record.scope === 'project' && record.ownerId === projectId
    || record.scope === 'session' && !!sessionId && record.ownerId === sessionId;
}

/** The memory store is private to a workspace; a tool receives only its allowed scopes. */
export function browserMemoryTools(store: Pick<HarnessStore, 'memory'>, meta: ConversationMeta, scope: ToolScope, signal?: AbortSignal): BrowserTools {
  const string = (description: string) => ({ type: 'string', description });
  const projectFor = (value: unknown) => {
    const id = typeof value === 'string' && value ? value : scope.defaultProjectId;
    if (!scope.workspaceAccess && !scope.projects.some(project => project.id === id)) throw new Error('This project is outside the agent’s scope.');
    return id;
  };
  const checkStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Memory lookup stopped.', 'AbortError'); };
  return {
    definitions: [
      { type: 'function', function: { name: 'search_memory', description: 'Find saved global, allowed-project, and current-conversation memories by topic. Returns brief excerpts and IDs.', parameters: { type: 'object', properties: { query: string('Specific topic or phrase.'), project: string('Allowed project ID; omit for the current project.') }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_memory', description: 'Read a bounded part of one saved memory returned by search_memory.', parameters: { type: 'object', properties: { id: string('Memory ID returned by search_memory.'), project: string('Same project ID used when searching; omit for the current project.'), offset: { type: 'number', description: 'Character offset; omit for the start.' }, length: { type: 'number', description: 'Characters to read, up to 4000.' } }, required: ['id'] } } },
      { type: 'function', function: { name: 'propose_memory', description: 'Draft one durable fact or preference worth remembering. The person reviews it before saving. Do not draft transient task details.', parameters: { type: 'object', properties: { title: string('Short title.'), content: string('Specific fact or preference, up to 2000 characters.'), scope: string('session, project, or global.'), tags: string('Optional comma-separated topics.') }, required: ['title', 'content'] } } },
    ],
    execute: async (name, args) => {
      checkStopped();
      const projectId = projectFor(args.project);
      const sessionId = projectId === meta.projectId ? meta.id : '';
      if (name === 'search_memory') {
        const query = String(args.query || '').trim();
        if (!query || query.length > 200) throw new Error('Search memory with a topic up to 200 characters.');
        const words = memoryQueryTerms(query);
        if (!words.length) return 'Use a more specific topic to search memory.';
        const records = await store.memory();
        checkStopped();
        const matches = records.filter(record => canRead(record, projectId, sessionId))
          .map(record => ({ record, score: memoryMatchScore(record, words) }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt));
        return JSON.stringify({ project: projectId, matches: matches.slice(0, 8).map(({ record }) => ({
          id: record.id, scope: record.scope, title: record.title, tags: record.tags,
          updatedAt: record.updatedAt, excerpt: record.content.slice(0, 360), moreContent: record.content.length > 360,
        })), moreMatches: matches.length > 8 });
      }
      if (name === 'read_memory') {
        const id = String(args.id || '');
        if (!id) throw new Error('Choose a memory ID from search_memory.');
        const offset = Number(args.offset ?? 0), length = Number(args.length ?? 2000);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 4000) throw new Error('Read memory with a nonnegative character offset and 1 to 4000 characters.');
        const record = (await store.memory()).find(item => item.id === id);
        checkStopped();
        if (!record || !canRead(record, projectId, sessionId)) throw new Error('Memory not found in the allowed scope.');
        const content = record.content.slice(offset, offset + length);
        return JSON.stringify({ id, scope: record.scope, title: record.title, offset, content, nextOffset: offset + content.length < record.content.length ? offset + content.length : null });
      }
      if (name === 'propose_memory') {
        const title = String(args.title || '').trim();
        const content = String(args.content || '').trim();
        const proposedScope = String(args.scope || 'session');
        const memoryScope = proposedScope === 'global' || proposedScope === 'project' || proposedScope === 'session' ? proposedScope : 'session';
        const tags = String(args.tags || '').slice(0, 200);
        if (!title || title.length > 100 || !content || content.length > 2000) throw new Error('Use a title up to 100 characters and content up to 2000 characters.');
        if (memoryScope === 'session' && !meta.id) throw new Error('A conversation is required for session memory.');
        return JSON.stringify({ draft: { title, content, scope: memoryScope, tags }, reviewRequired: true });
      }
      throw new Error(`Unknown memory tool: ${name}`);
    },
  };
}
