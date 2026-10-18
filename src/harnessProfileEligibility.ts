import type { AIConfig } from './ai.ts';

/** A successful session test confirms this model endpoint, not one output setting. */
export function profileConfirmationKey(config: AIConfig): string {
  return [config.id, config.provider, config.model, config.endpoint, config.runtimePreset, config.apiKey].join('\u0000');
}

/** An unloaded browser model remains usable after its session test if its files are still accessible. */
export function canRunProfile(profile: AIConfig, loaded: boolean, confirmed: boolean, browserWorkspaceAvailable: boolean): boolean {
  return loaded || profile.provider === 'browser' && confirmed && browserWorkspaceAvailable;
}
