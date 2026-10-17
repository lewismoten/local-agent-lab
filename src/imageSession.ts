import type { ImageConfig } from './imageGeneration';

type Session = { fingerprint: string; ready: boolean };
let current: Session = { fingerprint: '', ready: false };
const listeners = new Set<() => void>();
export const imageFingerprint = (config: ImageConfig) => JSON.stringify([config.preset, config.provider, config.endpoint, config.model, config.backend, config.apiKey]);
export const getImageSession = () => current;
export const subscribeImageSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const markImageReady = (config: ImageConfig) => {
  current = { fingerprint: imageFingerprint(config), ready: true };
  listeners.forEach(listener => listener());
};
export const isImageReady = (config: ImageConfig) => current.ready && current.fingerprint === imageFingerprint(config);
