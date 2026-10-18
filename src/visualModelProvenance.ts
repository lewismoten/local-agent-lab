import { BROWSER_IMAGE_ENGINE_ASSETS } from './browserImageAssets.ts';
import { MOTION_MODELS, type MotionAssetId } from './motionAssets.ts';

export type VisualModelPackage = { path: string; files: { path: string; sha256: string }[] };
const isPayload = (name: string) => !/^(?:LICENSE|NOTICE|MODEL-CARD)/i.test(name) && !/_LICENSE/i.test(name);

/** Call only after the package has passed its file integrity check. */
export function motionPackageProvenance(id: MotionAssetId): VisualModelPackage {
  const model = MOTION_MODELS[id];
  return { path: model.path, files: model.assets.filter(asset => isPayload(asset.name))
    .map(asset => ({ path: `${model.path}/${asset.name}`, sha256: asset.sha256 })) };
}

/** The shared ONNX engine is verified before visual inference begins. */
export function onnxImageEngineProvenance(): VisualModelPackage {
  const path = 'engines/ONNX-Image';
  return { path, files: BROWSER_IMAGE_ENGINE_ASSETS.filter(asset => isPayload(asset.name))
    .map(asset => ({ path: `${path}/${asset.name}`, sha256: asset.sha256 })) };
}
