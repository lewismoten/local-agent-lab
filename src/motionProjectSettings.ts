import { readBlob, writeBlob } from './storage.ts';
import type { CameraKeyframe, ParallaxControls } from './motionRuntime.ts';
import type { VideoExportFormat } from './videoEncodingSupport.ts';

export type MotionProjectSettings = {
  version: 1;
  updatedAt: string;
  mode: 'loop' | 'keyframes';
  loop: ParallaxControls;
  keyframes: CameraKeyframe[];
  durationSeconds: number;
  frameRate: number;
  exportFormat?: VideoExportFormat;
  videoBitrateMbps?: number;
};

export function motionProjectSettingsPath(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)) throw new Error('Invalid project ID for camera settings.');
  return `harness/projects/${projectId}/media/depth-camera.json`;
}

const controlsValid = (camera: unknown): camera is ParallaxControls => {
  if (!camera || typeof camera !== 'object') return false;
  const value = camera as Record<string, unknown>;
  return ['strengthPx', 'panXPx', 'panYPx', 'zoomPercent', 'tiltDegrees'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Math.abs(value[key]) <= 100);
};

function settingsValid(value: unknown): value is MotionProjectSettings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.updatedAt !== 'string' || item.mode !== 'loop' && item.mode !== 'keyframes' || !controlsValid(item.loop)) return false;
  if (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 6) return false;
  if (typeof item.frameRate !== 'number' || ![8, 12, 16, 24].includes(item.frameRate) || !Array.isArray(item.keyframes) || item.keyframes.length > 12) return false;
  if (item.exportFormat !== undefined && (typeof item.exportFormat !== 'string' || !['auto', 'webm', 'mp4'].includes(item.exportFormat))) return false;
  if (item.videoBitrateMbps !== undefined && (typeof item.videoBitrateMbps !== 'number' || ![0, 0.5, 1, 2, 4, 8].includes(item.videoBitrateMbps))) return false;
  let previous = -1;
  for (const frame of item.keyframes) {
    if (!frame || typeof frame.at !== 'number' || !Number.isFinite(frame.at) || frame.at < 0 || frame.at > 1 || frame.at <= previous || !controlsValid(frame.camera) || !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(frame.easing)) return false;
    previous = frame.at;
  }
  return item.mode !== 'keyframes' || item.keyframes.length >= 2 && item.keyframes[0].at === 0 && item.keyframes[item.keyframes.length - 1].at === 1;
}

export async function loadMotionProjectSettings(folder: FileSystemDirectoryHandle, projectId: string): Promise<MotionProjectSettings | null> {
  let file: File;
  try { file = await readBlob(folder, motionProjectSettingsPath(projectId)); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('Saved camera settings are not valid JSON.'); }
  if (!settingsValid(value)) throw new Error('Saved camera settings are invalid.');
  return value;
}

export async function saveMotionProjectSettings(folder: FileSystemDirectoryHandle, projectId: string, settings: MotionProjectSettings): Promise<string> {
  if (!settingsValid(settings)) throw new Error('Camera settings are invalid.');
  const path = motionProjectSettingsPath(projectId);
  await writeBlob(folder, path, new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
  return path;
}
