import type { BrowserTools } from './browserModel.ts';
import { conversationHasTag, conversationTagCloud, findConversationTopic, titleCaseTag } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';

/** Browse compacted conversation topics without reading whole message archives. */
export function browserTopicTools(store: Pick<HarnessStore, 'sessions'>, scope: ToolScope, signal?: AbortSignal): BrowserTools {
  const checkStopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Topic lookup stopped.', 'AbortError'); };
  const projectFor = (value: unknown) => {
    const id = typeof value === 'string' && value ? value : scope.defaultProjectId;
    if (!scope.projects.some(project => project.id === id)) throw new Error('This project is outside the agent’s scope.');
    return id;
  };
  const offsetFor = (value: unknown) => {
    const offset = value === undefined ? 0 : Number(value);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new Error('Topic offset must be a nonnegative integer up to 10000.');
    return offset;
  };
  return {
    definitions: [
      { type: 'function', function: { name: 'list_project_tags', description: 'List title-cased conversation and chapter tags in an allowed project, ranked by conversation count.', parameters: { type: 'object', properties: { project: { type: 'string', description: 'Allowed project ID; defaults to the current project.' }, offset: { type: 'number', description: 'Skip this many tags.' } } } } },
      { type: 'function', function: { name: 'find_tagged_conversations', description: 'Find conversations and chapter positions with an exact tag in an allowed project.', parameters: { type: 'object', properties: { tag: { type: 'string', description: 'Tag from list_project_tags.' }, project: { type: 'string', description: 'Allowed project ID; defaults to the current project.' }, offset: { type: 'number', description: 'Skip this many matches, newest first.' } }, required: ['tag'] } } },
    ],
    execute: async (name, args) => {
      checkStopped();
      if (name !== 'list_project_tags' && name !== 'find_tagged_conversations') throw new Error(`Unknown topic tool: ${name}`);
      const projectId = projectFor(args.project);
      const offset = offsetFor(args.offset);
      const sessions = await store.sessions(projectId);
      checkStopped();
      if (name === 'list_project_tags') {
        const tags = conversationTagCloud(sessions, 10_001);
        return JSON.stringify({ project: projectId, tags: tags.slice(offset, offset + 25).map(({ tag, count }) => ({ tag, conversations: count })),
          nextOffset: offset + 25 < tags.length ? offset + 25 : null });
      }
      const tag = titleCaseTag(String(args.tag || ''));
      if (tag.length < 2 || tag.length > 40) throw new Error('Choose a tag of 2 to 40 characters.');
      const matches = sessions.filter(session => conversationHasTag(session, tag))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const page = matches.slice(offset, offset + 8).map(session => {
        const topic = findConversationTopic(session, tag, true);
        return { session: session.id, title: session.title, updatedAt: session.updatedAt, excerpt: topic?.excerpt.slice(0, 300) || '',
          ...(topic?.seq !== undefined ? { chapterSeq: topic.seq } : {}) };
      });
      return JSON.stringify({ project: projectId, tag, conversations: page, nextOffset: offset + 8 < matches.length ? offset + 8 : null });
    },
  };
}
