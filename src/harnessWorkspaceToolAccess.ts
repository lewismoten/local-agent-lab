import { isMutatingToolName } from './harnessToolActions.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ToolScope } from './harnessTools.ts';

/** Recheck a portable workspace lock before a model changes it, including locks set in another tab. */
export async function assertCurrentWorkspaceToolAccess(name: string, scope: ToolScope, store?: Pick<HarnessStore, 'manifest'>): Promise<void> {
  if (!isMutatingToolName(name)) return;
  if (scope.workspaceReadOnly || (store && (await store.manifest()).workspaceToolAccess === 'read-only')) {
    throw new Error('Workspace model tools are read-only. Change Workspace model access in Files & tools to allow this action.');
  }
}
