import type { ToolScope } from './harnessTools.ts';
import { assertToolAllowed, toolPermission, type ToolPermission } from './harnessToolPermissions.ts';

export type ToolApprovalRequest = {
  name: string;
  arguments: Record<string, unknown>;
  projectId: string;
  mode: Exclude<ToolPermission, 'allow' | 'deny'>;
  conversationId?: string;
  signal?: AbortSignal;
};

const sessionGrants = new Set<string>();

/** A changed policy must never inherit a grant made under its old rules. */
export function clearSessionToolGrants(): void { sessionGrants.clear(); }

/** Called immediately before a tool executes, after the model has supplied arguments. */
export async function authorizeToolCall(options: {
  scope: ToolScope;
  name: string;
  arguments: Record<string, unknown>;
  projectId: string;
  sessionKey: string;
  runGrants: Set<string>;
  approve?: (request: ToolApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<void> {
  const { scope, name, projectId, sessionKey, runGrants, approve, signal } = options;
  assertToolAllowed(scope, name, projectId);
  const mode = toolPermission(scope, name, projectId);
  if (mode === 'allow') return;
  if (mode === 'deny') throw new Error(`${name} is blocked in Project settings.`);
  if (mode === 'session' && !sessionKey) throw new Error('This tool needs a conversation or agent session before it can be approved.');
  const key = `${projectId}:${name}`;
  const conversationSetting = scope.conversationPermissions?.[name] ?? scope.toolProfiles?.find(profile => profile.id === scope.conversationProfileId)?.permissions[name];
  const conversationOnce = projectId === scope.defaultProjectId && conversationSetting === 'once' && !!scope.conversationId;
  if (mode === 'once' && ((conversationOnce ? scope.conversationApprovedTools : scope.projects.find(project => project.id === projectId)?.approvedTools)?.includes(name) || runGrants.has(key))) return;
  const sessionGrant = `${sessionKey}:${key}`;
  if (mode === 'session' && sessionGrants.has(sessionGrant)) return;
  if (signal?.aborted) throw signal.reason || new DOMException('Tool call stopped.', 'AbortError');
  if (!approve || !await approve({ name, arguments: options.arguments, projectId, mode, conversationId: conversationOnce ? scope.conversationId : undefined, signal })) throw new Error(`${name} was not approved.`);
  if (signal?.aborted) throw signal.reason || new DOMException('Tool call stopped.', 'AbortError');
  if (mode === 'once') runGrants.add(key);
  if (mode === 'session') sessionGrants.add(sessionGrant);
}
