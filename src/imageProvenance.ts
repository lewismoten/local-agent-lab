import {
  BROWSER_IMAGE_MODEL_PATHS, browserImageAssets, browserImageDefaultGuidance,
  browserImageDefaultSteps, browserImageOutputSize, type BrowserImageModelGroup,
} from './browserImageAssets.ts';
import type { ImageConfig, ImagePreset } from './imageGeneration.ts';
import { writeBlob } from './storage.ts';

const GROUP_BY_PRESET: Partial<Record<ImagePreset, BrowserImageModelGroup>> = {
  'browser-sd15': 'model', 'browser-tiny-q4': 'tiny-q4', 'browser-tiny-fp16': 'tiny-fp16',
  'browser-sdxs': 'sdxs', 'browser-lcm': 'lcm', 'browser-supra-mobile': 'supra-mobile',
};

export function imageExtensionFromMimeType(type: string): string {
  const mime = type.split(';', 1)[0].trim().toLowerCase();
  const extension = ({ 'image/png': 'png', 'image/x-png': 'png', 'image/jpeg': 'jpg',
    'image/jpg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' } as Record<string, string>)[mime];
  if (!extension) throw new Error(`The image provider returned an unsupported image format: ${mime || 'unknown'}.`);
  return extension;
}

export function imageRunProvenance(config: ImageConfig, prompt: string, imagePath: string, generatedAt: string, seed?: number) {
  const group = config.provider === 'browser' ? GROUP_BY_PRESET[config.preset] : undefined;
  const modelPath = group ? BROWSER_IMAGE_MODEL_PATHS[group] : null;
  const modelFiles = group ? browserImageAssets(group)
    .filter(asset => !/^(?:LICENSE|NOTICE|.*_LICENSE)/i.test(asset.name))
    .map(asset => ({ path: `${modelPath}/${asset.name}`, sha256: asset.sha256 })) : [];
  const settings = group
    ? { width: browserImageOutputSize(group), height: browserImageOutputSize(group), steps: config.steps ?? browserImageDefaultSteps(group), guidanceScale: config.guidanceScale ?? browserImageDefaultGuidance(group) }
    : config.provider === 'bonsai'
      ? { width: 512, height: 512, steps: 4, guidanceScale: 1, backend: config.backend || 'bonsai-ternary-mlx' }
      : { requestedSize: config.preset === 'pixart-delta' || config.preset === 'openai' ? '1024x1024' : '512x512' };
  return {
    version: 1,
    imagePath, prompt, generatedAt,
    imageModel: config.model, imageProvider: config.provider, imagePreset: config.preset,
    seed: group && seed !== undefined ? seed : null,
    settings,
    modelPackage: modelPath ? { path: modelPath, files: modelFiles } : null,
  };
}

export async function saveImageOutput(folder: FileSystemDirectoryHandle, image: Blob, config: ImageConfig, prompt: string, imagePath: string, generatedAt: string, seed?: number) {
  const provenance = imageRunProvenance(config, prompt, imagePath, generatedAt, seed);
  const metadataPath = imagePath.replace(/\.[^/.]+$/, '.json');
  await writeBlob(folder, imagePath, image);
  await writeBlob(folder, metadataPath, new Blob([JSON.stringify(provenance, null, 2)], { type: 'application/json' }));
  return { provenance, metadataPath };
}
