import { MODEL_CATALOG } from './catalogModels.ts';
import { NEEDLE_CATALOG } from './needleCatalog.ts';
import { BROWSER_IMAGE_ENGINE_ASSETS, BROWSER_IMAGE_GROUPS, browserImageAssets, browserImageLicenseLinks, browserImageModelLabel, type BrowserImageModelGroup } from './browserImageAssets.ts';
import { MOTION_MODEL_IDS, MOTION_MODELS } from './motionAssets.ts';
import { SPEECH_MODELS, SPEECH_ENGINE_ASSETS, KOKORO_ENGINE_ASSETS, CHATTERBOX_ENGINE_ASSETS, QWEN_TTS_ENGINE_ASSETS, OPENVOICE_ENGINE_ASSETS } from './speechManifest.ts';
import { TRANSCRIPTION_MODELS, TRANSCRIPTION_ENGINE_ASSETS } from './transcriptionManifest.ts';
import { WLLAMA_ASSETS } from './wllamaEngine.ts';
import { PRISM_ASSETS } from './prismEngine.ts';
import { NEEDLE_ENGINE_ASSETS } from './needleAssets.ts';

export type OptionalNotice = {
  id: string;
  name: string;
  kind: 'Model' | 'Engine';
  type: string;
  developer: string;
  source: string;
  licenses: { label: string; url: string }[];
};

type LicensedAsset = { name: string; url: string };
const assetLicenses = (assets: readonly LicensedAsset[]) => assets
  .filter(asset => /(?:license|licence|notice)/i.test(asset.name))
  .map(asset => ({ label: asset.name.replace(/\.(?:txt|md)$/i, '').replace(/[-_]/g, ' '), url: asset.url }));
const engine = (id: string, name: string, developer: string, source: string, assets: readonly LicensedAsset[]): OptionalNotice =>
  ({ id: `engine:${id}`, name, kind: 'Engine', type: 'Browser runtime', developer, source, licenses: assetLicenses(assets) });
const imageSource = (group: BrowserImageModelGroup) => browserImageAssets(group)
  .find(asset => asset.url.includes('huggingface.co') && !/(?:license|notice)/i.test(asset.name))?.url.replace('/resolve/', '/blob/') || browserImageAssets(group)[0].url;
const sherpa = TRANSCRIPTION_MODELS.find(item => item.id === 'sherpa')!;

export const OPTIONAL_NOTICES: OptionalNotice[] = [
  ...MODEL_CATALOG.map(item => ({ id: `model:${item.id}`, name: item.label, kind: 'Model' as const, type: 'Text', developer: item.company, source: item.source, licenses: [{ label: item.license, url: item.licenseUrl }] })),
  ...NEEDLE_CATALOG.map(item => ({ id: `model:${item.id}`, name: item.label, kind: 'Model' as const, type: 'Tool routing', developer: item.company, source: item.source, licenses: [{ label: item.license, url: item.licenseUrl }] })),
  ...BROWSER_IMAGE_GROUPS.map(group => ({ id: `image:${group}`, name: browserImageModelLabel(group), kind: 'Model' as const, type: 'Image generation', developer: 'See source', source: imageSource(group), licenses: browserImageLicenseLinks(group) })),
  ...MOTION_MODEL_IDS.map(id => ({ id: `motion:${id}`, name: MOTION_MODELS[id].label, kind: 'Model' as const, type: id === 'tripo' ? '3D' : id === 'pose' || id === 'vector' ? 'Visual utility' : 'Video', developer: 'See source', source: MOTION_MODELS[id].source, licenses: assetLicenses(MOTION_MODELS[id].assets) })),
  ...SPEECH_MODELS.map(item => ({ id: `speech:${item.id}`, name: item.label, kind: 'Model' as const, type: 'Speech', developer: 'See source', source: item.source, licenses: [{ label: 'License', url: item.licenseUrl }] })),
  ...TRANSCRIPTION_MODELS.map(item => ({ id: `transcription:${item.id}`, name: item.label, kind: 'Model' as const, type: 'Transcription', developer: item.company, source: `https://huggingface.co/${item.repo}`, licenses: [{ label: item.license, url: item.licenseUrl }] })),
  engine('wllama', 'Wllama', 'ngxson', 'https://github.com/ngxson/wllama', WLLAMA_ASSETS),
  engine('prismml', 'PrismML', 'Prism ML', 'https://github.com/PrismML-Eng/Talk', PRISM_ASSETS),
  engine('needle', 'Needle', 'Cactus Compute', 'https://github.com/Geekgineer/needle-rs', NEEDLE_ENGINE_ASSETS),
  engine('onnx-image', 'ONNX image', 'Microsoft / Scribbler', 'https://github.com/microsoft/onnxruntime', BROWSER_IMAGE_ENGINE_ASSETS),
  engine('mediapipe-vision', MOTION_MODELS.pose_engine.label, 'Google', MOTION_MODELS.pose_engine.source, MOTION_MODELS.pose_engine.assets),
  engine('vtracer', MOTION_MODELS.vector_engine.label, 'VisionCortex', MOTION_MODELS.vector_engine.source, MOTION_MODELS.vector_engine.assets),
  engine('pocket-tts', 'Pocket TTS', 'Kyutai / vlapky', 'https://github.com/vlapky/pocket-tts-js', SPEECH_ENGINE_ASSETS),
  engine('kokoro', 'Kokoro', 'Hugging Face / Microsoft', 'https://github.com/hexgrad/kokoro', KOKORO_ENGINE_ASSETS),
  engine('chatterbox', 'Chatterbox', 'Hugging Face / Microsoft', 'https://github.com/resemble-ai/chatterbox', CHATTERBOX_ENGINE_ASSETS),
  engine('qwen3-tts', 'Qwen3-TTS', 'Alibaba Cloud / leehack', 'https://github.com/leehack/llama-web-bridge', QWEN_TTS_ENGINE_ASSETS),
  engine('openvoice', 'OpenVoice', 'Microsoft', 'https://github.com/microsoft/onnxruntime', OPENVOICE_ENGINE_ASSETS),
  engine('transformers-asr', 'Transformers ASR', 'Hugging Face / Microsoft', 'https://huggingface.co/docs/transformers.js', TRANSCRIPTION_ENGINE_ASSETS),
  engine('sherpa-asr', 'Sherpa ONNX ASR', 'k2-fsa', 'https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.32', sherpa.assets),
].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
