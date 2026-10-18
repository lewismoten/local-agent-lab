export type VisualAvailability = {
  state: 'disconnected' | 'checking' | 'ready' | 'engine-needed' | 'model-needed' | 'not-saved';
  label: string;
};

export function visualAvailability(
  connected: boolean,
  checked: boolean,
  modelSaved: boolean,
  engineSaved: boolean,
  engineLabel: string,
): VisualAvailability {
  if (!connected) return { state: 'disconnected', label: 'Connect a workspace to check saved files.' };
  if (!checked) return { state: 'checking', label: 'Checking saved files…' };
  if (modelSaved && engineSaved) return { state: 'ready', label: 'Model and engine files verified for offline use.' };
  if (modelSaved) return { state: 'engine-needed', label: `Model saved; ${engineLabel} is needed.` };
  if (engineSaved) return { state: 'model-needed', label: `${engineLabel} saved; model is needed.` };
  return { state: 'not-saved', label: 'Model and engine are not saved in this workspace.' };
}
