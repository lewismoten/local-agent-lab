import type { BrowserTools } from './browserModel.ts';
import type { ChatCompletionTool } from './browserEngineTypes.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ModelPurpose } from './harnessData.ts';
import { IMAGE_PRESETS } from './imageGeneration.ts';

type PreferencePurpose = Extract<ModelPurpose, 'chat' | 'code' | 'image'>;
type PreferenceStore = Pick<HarnessStore, 'workspaceId' | 'manifest' | 'settings' | 'updateManifest'>;

const preferencePurpose = (value: unknown): PreferencePurpose => {
  if (value === 'chat' || value === 'code' || value === 'image') return value;
  throw new Error('Choose chat, code, or image for the fallback order.');
};

const preferenceIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 8 || value.some(id => typeof id !== 'string' || !id || id.length > 100)) {
    throw new Error('Give up to eight saved profile or image preset IDs in priority order. Use [] to clear fallbacks.');
  }
  if (new Set(value).size !== value.length) throw new Error('List each fallback only once.');
  return value;
};

async function choices(store: PreferenceStore, purpose: PreferencePurpose) {
  const settings = await store.settings();
  if (!settings) throw new Error('Workspace model settings are unavailable.');
  return purpose === 'image'
    ? Object.entries(IMAGE_PRESETS).filter(([id]) => id !== 'none').map(([id, preset]) => ({ id, label: preset.model, configured: !!preset.model }))
    : settings.profiles.map(profile => ({ id: profile.id, label: profile.label, configured: !!profile.model.trim() }));
}

export async function modelPreferenceReview(store: PreferenceStore, purposeInput: unknown, idsInput: unknown): Promise<Record<string, unknown>> {
  const purpose = preferencePurpose(purposeInput);
  const ids = preferenceIds(idsInput);
  const available = await choices(store, purpose);
  for (const id of ids) if (!available.some(item => item.id === id)) throw new Error(`${id} is not a saved ${purpose === 'image' ? 'image preset' : 'AI profile'} in this workspace.`);
  const manifest = await store.manifest();
  return {
    scope: 'Entire workspace', purpose,
    current: (manifest.modelPreferences[purpose] || []).map(id => ({ id, label: available.find(item => item.id === id)?.label || 'Missing profile' })),
    requested: ids.map(id => available.find(item => item.id === id)),
    effect: 'Replace this fallback order. The selected chat or agent profile remains first; unloaded models still need to be loaded before use.',
  };
}

export function browserModelPreferenceTools(store: PreferenceStore, projectId: string, allowChange: boolean, signal?: AbortSignal): BrowserTools {
  const stopped = () => { if (signal?.aborted) throw signal.reason || new DOMException('Model preference change stopped.', 'AbortError'); };
  return {
    definitions: [
      { type: 'function', function: { name: 'get_model_preferences', description: 'Read the workspace fallback order and available profile IDs for chat, agent coding, and image generation.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'get_project_chat_profile', description: 'Read the current project’s selected chat profile and available saved profile IDs. This does not load a model.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'propose_project_chat_profile', description: 'Suggest a saved AI profile with a model name for the current project. Opens a project edit draft for the person; does not change settings or confirm the model works.', parameters: { type: 'object', properties: { profile_id: { type: 'string', description: 'ID from get_project_chat_profile.' } }, required: ['profile_id'] } } },
      ...(allowChange ? [{ type: 'function', function: { name: 'set_model_preferences', description: 'Replace one workspace fallback order after the person reviews the current and requested order. The selected chat or agent profile stays first.', parameters: { type: 'object', properties: { purpose: { type: 'string', description: 'chat, code, or image' }, ids: { type: 'array', items: { type: 'string' }, description: 'Saved profile or image preset IDs, highest priority first. [] clears fallbacks.' } }, required: ['purpose', 'ids'] } } } as ChatCompletionTool] : []),
    ],
    execute: async (name, args) => {
      stopped();
      if (name === 'get_model_preferences') {
        const manifest = await store.manifest();
        const available = Object.fromEntries(await Promise.all((['chat', 'code', 'image'] as const).map(async purpose => [purpose, await choices(store, purpose)])));
        stopped();
        return JSON.stringify({ scope: 'workspace', order: { chat: manifest.modelPreferences.chat || [], code: manifest.modelPreferences.code || [], image: manifest.modelPreferences.image || [] }, available });
      }
      if (name === 'get_project_chat_profile' || name === 'propose_project_chat_profile') {
        const [manifest, settings] = await Promise.all([store.manifest(), store.settings()]);
        stopped();
        const project = manifest.projects.find(item => item.id === projectId);
        if (!project || !settings) throw new Error('The current project or saved AI profiles are unavailable.');
        const available = settings.profiles.map(profile => ({ id: profile.id, label: profile.label, modelSelected: !!profile.model.trim() }));
        if (name === 'get_project_chat_profile') return JSON.stringify({ projectId, projectName: project.name, selectedId: project.defaultProfileId || settings.selectedProfileId, available });
        const profileId = args.profile_id;
        if (typeof profileId !== 'string' || !profileId || profileId.length > 100) throw new Error('Choose a saved profile ID from get_project_chat_profile.');
        const profile = available.find(item => item.id === profileId);
        if (!profile) throw new Error('That AI profile is no longer saved in this workspace.');
        if (!profile.modelSelected) throw new Error('Choose a model for this profile in Models before proposing it for chat.');
        if (profile.id === (project.defaultProfileId || settings.selectedProfileId)) return JSON.stringify({ status: 'already-selected', projectId, profileId });
        return JSON.stringify({ draft: { projectId, profileId, profileLabel: profile.label }, reviewRequired: true, saved: false, note: 'The profile may still need credentials or a model test before chat can use it.' });
      }
      if (name !== 'set_model_preferences' || !allowChange) throw new Error(`Unknown model preference tool: ${name}`);
      const approvedCurrent = args.__reviewedCurrent;
      if (!Array.isArray(approvedCurrent) || approvedCurrent.some(id => typeof id !== 'string')) throw new Error('Review the current fallback order before changing it.');
      const review = await modelPreferenceReview(store, args.purpose, args.ids);
      const purpose = review.purpose as PreferencePurpose;
      const requested = (review.requested as { id: string }[]).map(item => item.id);
      const expected = approvedCurrent as string[];
      stopped();
      await store.updateManifest(current => {
        if (current.workspaceToolAccess === 'read-only') throw new Error('Workspace model tools are read-only.');
        const project = current.projects.find(item => item.id === projectId);
        if (!project || project.toolAccess === 'read-only') throw new Error('Project model tools are read-only or the project is unavailable.');
        if (JSON.stringify(current.modelPreferences[purpose] || []) !== JSON.stringify(expected)) throw new Error('The fallback order changed during review. Read it again before replacing it.');
        stopped();
        return { ...current, modelPreferences: { ...current.modelPreferences, [purpose]: requested } };
      });
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('harness:manifest-changed', { detail: { workspaceId: store.workspaceId } }));
      return JSON.stringify({ status: 'saved', purpose, ids: requested, scope: 'workspace' });
    },
  };
}
