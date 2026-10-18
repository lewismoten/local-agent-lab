import { browserImageTotal, type BrowserImageModelGroup } from './browserImageAssets.ts';
import { motionPackageBytes } from './motionAssets.ts';
import { PRISM_ASSETS } from './prismEngine.ts';
import { WLLAMA_ASSETS } from './wllamaEngine.ts';
import type { CatalogModel } from './catalogModels.ts';

export { VISUAL_PACKAGE_LIMIT_BYTES } from './visualLimit.ts';

const total = (assets: readonly { bytes: number }[]) => assets.reduce((sum, asset) => sum + asset.bytes, 0);

export const imagePackageBytes = (group: BrowserImageModelGroup) =>
  browserImageTotal(group) + browserImageTotal('engine');

export { motionPackageBytes };

/** Model and projector plus browser engine; optional notices may add bytes. */
export const visionReaderMinimumBytes = (model: CatalogModel) =>
  model.bytes + (model.visionProjector?.bytes || 0) + (model.runtime === 'local-server' ? 0 : model.family === 'Bonsai' ? total(PRISM_ASSETS) : total(WLLAMA_ASSETS));
