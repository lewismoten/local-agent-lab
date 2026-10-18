import { browserImageModelGroup } from './browserImageAssets.ts';
import { speechModelForPath } from './speechManifest.ts';
import { transcriptionModelForPath } from './transcriptionManifest.ts';
import { motionModelForPath } from './motionAssets.ts';

export const MODEL_TYPES = [
  { id: 'text', label: 'Text & tools' },
  { id: 'image', label: 'Image generation' },
  { id: 'speech', label: 'Speech & voice' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'video', label: 'Video & motion' },
  { id: 'pose', label: 'Pose & animation' },
  { id: 'vector', label: 'Vector graphics' },
  { id: 'mesh', label: '3D models' },
] as const;

export type ModelType = typeof MODEL_TYPES[number]['id'];
export type ModelTypeFilter = ModelType | 'all';

export const modelTypeForPath = (path: string): ModelType => motionModelForPath(path) === 'tripo' ? 'mesh' : motionModelForPath(path) === 'vector' ? 'vector' : motionModelForPath(path) === 'pose' ? 'pose' : motionModelForPath(path) ? 'video' : transcriptionModelForPath(path) ? 'transcription' : browserImageModelGroup(path) ? 'image' : speechModelForPath(path) ? 'speech' : 'text';
export const matchesModelType = (filter: ModelTypeFilter, type: ModelType) => filter === 'all' || filter === type;
