import type { ImageConfig } from './imageGeneration';

type Session = { fingerprint: string; ready: boolean };
let current: Session = { fingerprint: '', ready: false };
const listeners = new Set<() => void>();
export const imageFingerprint = (config: ImageConfig) => JSON.stringify([config.preset, config.provider, config.endpoint, config.model, config.backend, config.apiKey, config.steps ?? (config.preset === 'browser-sdxs' ? 1 : config.preset === 'browser-lcm' ? 4 : 20), config.guidanceScale ?? (config.preset === 'browser-sdxs' || config.preset === 'browser-lcm' ? 0 : config.preset === 'browser-supra-mobile' ? 3 : 7.5)]);
export const getImageSession = () => current;
export const subscribeImageSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const markImageReady = (config: ImageConfig) => {
  current = { fingerprint: imageFingerprint(config), ready: true };
  listeners.forEach(listener => listener());
};
export const clearImageReady = () => {
  current = { fingerprint: '', ready: false };
  listeners.forEach(listener => listener());
};
export const clearImageReadyForPreset = (preset: ImageConfig['preset']) => {
  if (current.ready && JSON.parse(current.fingerprint)[0] === preset) clearImageReady();
};
export const isImageReady = (config: ImageConfig) => current.ready && current.fingerprint === imageFingerprint(config);
