import type { ToolScope } from './harnessTools.ts';
import type { ChatCompletionTool } from './browserEngineTypes.ts';
import type { HarnessProject, ToolPolicyProfile } from './harnessData.ts';
import { isMutatingToolName } from './harnessToolActions.ts';

export type ToolPermission = 'allow' | 'deny' | 'ask' | 'once' | 'session';

export function toolPermission(scope: ToolScope, name: string, projectId = scope.defaultProjectId): ToolPermission {
  if (scope.workspaceReadOnly && isMutatingToolName(name)) return 'deny';
  const project = scope.projects.find(item => item.id === projectId);
  const projectValue = project?.toolPermissions?.[name] ?? scope.toolProfiles?.find(profile => profile.id === project?.toolProfileId)?.permissions[name];
  // A blocked project tool is a hard ceiling. Conversation rules may only
  // change tools that the parent project has made available.
  const conversationValue = scope.conversationPermissions?.[name] ?? scope.toolProfiles?.find(profile => profile.id === scope.conversationProfileId)?.permissions[name];
  const value = projectValue === 'deny' ? 'deny' : projectId === scope.defaultProjectId ? conversationValue ?? projectValue : projectValue;
  return value === 'deny' || value === 'ask' || value === 'once' || value === 'session' ? value : ['queue_model_download', 'queue_browser_engine', 'set_model_download_speed', 'pause_model_queue', 'resume_model_queue', 'set_model_preferences', 'set_journal_enabled'].includes(name) ? 'ask' : 'allow';
}

export function effectiveToolPermissions(scope: ToolScope, projectId = scope.defaultProjectId): Record<string, ToolPermission> {
  const project = scope.projects.find(item => item.id === projectId);
  const profile = scope.toolProfiles?.find(item => item.id === project?.toolProfileId);
  return { ...profile?.permissions, ...project?.toolPermissions };
}

export function effectiveConversationToolPermissions(scope: ToolScope): Record<string, ToolPermission> {
  const profile = scope.toolProfiles?.find(item => item.id === scope.conversationProfileId);
  const candidates = new Set([...Object.keys(effectiveToolPermissions(scope)), ...Object.keys(profile?.permissions || {}), ...Object.keys(scope.conversationPermissions || {})]);
  return Object.fromEntries([...candidates].map(name => [name, toolPermission(scope, name)]));
}

/** Detaching a shared profile keeps the project's effective rules as local settings. */
export function detachToolProfile(project: HarnessProject, profiles: ToolPolicyProfile[], updatedAt: string): HarnessProject {
  const toolPermissions = effectiveToolPermissions({ projects: [project], defaultProjectId: project.id, workspaceAccess: false, toolProfiles: profiles });
  return { ...project, toolProfileId: undefined, toolPermissions, approvedTools: [], updatedAt };
}

export function assertToolAllowed(scope: ToolScope, name: string, projectId = scope.defaultProjectId): void {
  if (toolPermission(scope, name, projectId) === 'deny') throw new Error(`${name} is blocked in Project settings.`);
}

export function filterPermittedTools(scope: ToolScope, definitions: ChatCompletionTool[]): ChatCompletionTool[] {
  return definitions.filter(tool => toolPermission(scope, tool.function.name) !== 'deny');
}
