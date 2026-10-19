import type { BrowserModelStatus } from './browserModel.ts';

export function avatarVisionSetupMessage(status: BrowserModelStatus, ready: boolean): string {
  if (ready) return '';
  if (status.state === 'loading') return 'The vision model is still loading. Wait until it is ready.';
  if (status.state === 'error') return 'The selected model failed to load. Reload it with its vision projector in Models.';
  if (status.state === 'ready') return 'This model is loaded without a working vision projector. Reload it with the projector in Models.';
  return 'A past vision test confirms capability, but does not keep the model loaded. Load it with its projector in Models for this browser session.';
}
