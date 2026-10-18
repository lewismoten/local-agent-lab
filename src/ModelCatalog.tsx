import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import HarnessSurfaceArtwork, { SurfaceArtworkButton } from './HarnessSurfaceArtwork.tsx';
import { emptySurfaceArtwork, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ImageConfig } from './imageGeneration.ts';
import { MODEL_CATALOG, type CatalogModel } from './catalogModels';
import type { PartialModel } from './modelDownload';
import type { ModelDownloadState } from './modelDownloadSession';
import { hasGemmaConsent, hasQwenResearchConsent, visionProjectorDownloadUrl } from './modelLicenses';
import { compareModelNames } from './modelSort';
import { capabilityBadges, pendingCapabilities, type CapabilityLedger } from './capabilityLedger';
import NeedleAssetCard from './NeedleAssetCard';
import { NEEDLE_CATALOG } from './needleCatalog';
import { useConfirmDialog } from './ConfirmDialog';
import { getNeedleAssets, NEEDLE_LABELS, needleAssetsManager, subscribeNeedleAssets } from './needleAssets';
import { needleLoaded, unloadNeedle } from './needleRuntime';
import { ensureWritableFolder } from './storage';
import { isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility';
import { BROWSER_IMAGE_GROUPS, BROWSER_IMAGE_MODEL_ASSETS, BROWSER_SDXS_ASSETS, BROWSER_SUPRA_ASSETS, browserImageAssetsManager, browserImageDefaultSteps, browserImageModelLabel, browserImageOutputSize, browserImageTotal, getBrowserImageAssets, imageModelAcceptsPreviousEngine, subscribeBrowserImageAssets, type BrowserImageModelGroup } from './browserImageAssets';
import DownloadRing from './DownloadRing';
import { matchesModelType, MODEL_TYPES, type ModelTypeFilter } from './modelTypes';
import { getSpeechAssets, speechAssetsManager, speechTotal, subscribeSpeechAssets } from './speechAssets.ts';
import { SPEECH_MODELS, speechModel, type SpeechModelId } from './speechManifest.ts';
import { getTranscriptionAssets, subscribeTranscriptionAssets, transcriptionAssetsManager } from './transcriptionAssets.ts';
import { TRANSCRIPTION_MODELS, transcriptionTotal, type TranscriptionModelId } from './transcriptionManifest.ts';
import SherpaArchiveImport from './SherpaArchiveImport.tsx';
import { getMotionAssets, MOTION_MODELS, motionAssetsManager, motionTotal, subscribeMotionAssets, type MotionModel } from './motionAssets.ts';

type Props = {
  store?: HarnessStore;
  imageOptions: ImageConfig[];
  onWrite?: <T,>(action: () => Promise<T>) => Promise<T>;
  folder: FileSystemDirectoryHandle | null;
  download: ModelDownloadState;
  fileSizes: Record<string, number>;
  licensedModels: Set<string>;
  partialNames: Set<string>;
  partialModels: PartialModel[];
  busy: boolean;
  modelTypeFilter: ModelTypeFilter;
  onModelTypeFilterChange: (type: ModelTypeFilter) => void;
  ledger: CapabilityLedger;
  onTest: (model: CatalogModel) => void;
  onTestImage: (group: BrowserImageModelGroup) => void;
  onOpenSpeech: (model: SpeechModelId) => void;
  onOpenTranscription: (model: TranscriptionModelId) => void;
  onOpenMotion: (model: MotionModel) => void;
  onRefreshCapabilities: () => void;
  onQueue: (models: CatalogModel[]) => void;
  onQueueVision: (model: CatalogModel) => void;
  onPrioritizeLicense: (model: CatalogModel) => void;
  onResumeQueued: (model: CatalogModel) => void;
  onRemoveQueued: (url: string) => void;
  onDiscard: (name: string) => void;
  onLicenseConsentNeeded: (kind: 'gemma' | 'qwen-research', action: () => void) => void;
};

type SortKey = 'family' | 'version' | 'parameters' | 'bytes' | 'contextTokens' | 'capabilities';
const columns: { key: SortKey; label: string }[] = [
  { key: 'family', label: 'Model' }, { key: 'version', label: 'Version' },
  { key: 'parameters', label: 'Params / resolution' }, { key: 'bytes', label: 'File' },
  { key: 'contextTokens', label: 'Context / steps' }, { key: 'capabilities', label: 'Capabilities' },
];
const textTableModels = [
  ...MODEL_CATALOG.map(model => ({ kind: 'gguf' as const, model })),
  ...NEEDLE_CATALOG.map(model => ({ kind: 'needle' as const, model })),
];
const imageCatalogModels = BROWSER_IMAGE_GROUPS.map(group => ({
  kind: 'image' as const,
  model: {
    group, id: `${group}-image`, family: group === 'model' ? 'Stable Diffusion' : group === 'sdxs' ? 'SDXS' : group === 'lcm' ? 'DreamShaper' : group === 'supra-mobile' ? 'Supra-IMG' : 'Tiny-SD', label: group === 'model' ? 'Stable Diffusion' : group === 'lcm' ? 'DreamShaper LCM' : group === 'supra-mobile' ? 'Supra-IMG Mobile' : browserImageModelLabel(group),
    name: group === 'model' ? 'SD-1.5-ONNX' : group === 'tiny-q4' ? 'Tiny-SD-Q4-ONNX' : group === 'tiny-fp16' ? 'Tiny-SD-FP16-ONNX' : group === 'sdxs' ? 'SDXS-DreamShaper-ONNX' : group === 'lcm' ? 'DreamShaper-8-LCM-INT8-ONNX' : 'Supra2-IMG-Mobile-ONNX',
    company: group === 'model' ? 'CompVis / Microsoft' : group === 'sdxs' || group === 'lcm' ? 'Lykon / skillsafeai' : group === 'supra-mobile' ? 'SupraLabs / mikhsol' : 'Segmind / cursedhelm', country: '—',
    companyUrl: group === 'model' ? 'https://github.com/CompVis/stable-diffusion' : group === 'sdxs' || group === 'lcm' ? 'https://huggingface.co/skillsafeai' : group === 'supra-mobile' ? 'https://huggingface.co/mikhsol' : 'https://huggingface.co/segmind',
    version: group === 'model' ? '1.5' : group === 'lcm' ? '8' : group === 'supra-mobile' ? '2' : '—', parameters: 0,
    quantization: group === 'tiny-q4' ? 'Q4F16' : group === 'lcm' || group === 'supra-mobile' ? 'INT8' : 'FP16',
    bytes: browserImageTotal(group), contextTokens: 0,
    license: group === 'sdxs' ? 'Open RAIL++-M' : group === 'supra-mobile' ? 'Apache 2.0' : 'Open RAIL-M', toolUse: 'not-applicable', thinking: 'not-applicable',
    reason: group === 'model' ? 'Standard 20-step diffusion model.' : group === 'tiny-q4' ? 'Smallest image download; Q4 export.' : group === 'tiny-fp16' ? 'Higher-precision Tiny-SD export.' : group === 'sdxs' ? 'One-step diffusion for fast generation.' : group === 'lcm' ? 'DreamShaper look in four steps.' : 'Compact 256px rectified-flow model.',
    source: group === 'model' ? 'https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn' : group === 'sdxs' ? 'https://huggingface.co/skillsafeai/sdxs-512-dreamshaper-onnx-webgpu' : group === 'lcm' ? 'https://huggingface.co/skillsafeai/dreamshaper-8-lcm-onnx-webgpu' : group === 'supra-mobile' ? 'https://huggingface.co/mikhsol/Supra2-IMG-mobile-onnx' : 'https://huggingface.co/cursedhelm/aderpy-deepdreamer-onnx',
    licenseUrl: group === 'sdxs' ? BROWSER_SDXS_ASSETS[0].url : group === 'supra-mobile' ? BROWSER_SUPRA_ASSETS[0].url : BROWSER_IMAGE_MODEL_ASSETS[0].url,
  },
}));
const speechCatalogModels = SPEECH_MODELS.map(item => ({ kind: 'speech' as const, model: {
  group: item.id, id: `${item.id}-speech`, family: item.engine === 'kokoro' ? 'Kokoro' : item.engine === 'chatterbox' ? 'Chatterbox' : item.engine === 'qwen' ? 'Qwen3-TTS' : item.engine === 'openvoice' ? 'OpenVoice' : 'Pocket TTS', label: item.label, name: item.path.slice('models/'.length),
  company: item.engine === 'kokoro' ? 'hexgrad / ONNX Community' : item.engine === 'chatterbox' ? 'Resemble AI' : item.engine === 'qwen' ? 'Alibaba Cloud / ggml-org' : item.engine === 'openvoice' ? 'MyShell.ai / TigreGotico' : 'Kyutai / vlapky', country: item.engine === 'kokoro' ? '—' : item.engine === 'chatterbox' ? 'United States' : item.engine === 'qwen' ? 'China' : item.engine === 'openvoice' ? '—' : 'France', companyUrl: item.engine === 'kokoro' ? 'https://github.com/hexgrad/kokoro' : item.engine === 'chatterbox' ? 'https://www.resemble.ai/' : item.engine === 'qwen' ? 'https://github.com/QwenLM/Qwen3-TTS' : item.engine === 'openvoice' ? 'https://github.com/myshell-ai/OpenVoice' : 'https://kyutai.org/', version: item.engine === 'kokoro' ? '1.0' : item.id === 'chatterbox_q4f16' ? 'Original' : item.engine === 'chatterbox' ? 'Turbo' : item.engine === 'qwen' ? '3' : item.engine === 'openvoice' ? '2' : '2026', parameters: item.engine === 'kokoro' ? 0.082 : item.id === 'chatterbox_q4f16' ? 0.5 : item.engine === 'chatterbox' ? 0.35 : item.engine === 'qwen' ? 1.7 : 0,
  quantization: item.engine === 'kokoro' ? 'Q8' : item.engine === 'chatterbox' ? 'Q4F16' : item.engine === 'qwen' ? 'Q4_K_M' : item.engine === 'openvoice' ? 'Q8' : 'INT8', bytes: item.bytes, contextTokens: 0, license: item.engine === 'kokoro' || item.engine === 'qwen' ? 'Apache 2.0' : item.engine === 'chatterbox' || item.engine === 'openvoice' ? 'MIT' : 'CC BY 4.0', toolUse: 'not-applicable', thinking: 'not-applicable',
  reason: item.engine === 'kokoro' ? 'Expressive English speech with selectable voices.' : item.id === 'chatterbox_q4f16' ? 'Voice cloning with adjustable expression.' : item.engine === 'chatterbox' ? 'Fast voice cloning with sound tags.' : item.engine === 'qwen' ? 'Multilingual voice cloning with a larger browser runtime.' : item.engine === 'openvoice' ? 'Converts existing speech into a reference voice; pair with any TTS model.' : `${item.language} speech with built-in voices or a short voice recording.`, source: item.source, licenseUrl: item.licenseUrl,
} }));
const transcriptionCatalogModels = TRANSCRIPTION_MODELS.map(item => ({ kind: 'transcription' as const, model: { id: item.id, family: item.family, label: item.label, name: item.path.slice('models/'.length), group: item.id, company: item.company, country: item.country, companyUrl: item.id === 'sherpa' ? 'https://github.com/k2-fsa/sherpa-onnx' : `https://huggingface.co/${item.repo}`, version: item.version, parameters: item.parametersB, quantization: item.quantization, bytes: transcriptionTotal(item.id), contextTokens: 0, license: item.license, toolUse: 'not-applicable', thinking: 'not-applicable', reason: item.description, source: item.id === 'sherpa' ? `https://github.com/k2-fsa/sherpa-onnx/releases/tag/${item.revision}` : `https://huggingface.co/${item.repo}/tree/${item.revision}`, licenseUrl: item.licenseUrl } }));
const motionCatalogModels = (['depth', 'rife', 'pose', 'vector', 'tripo'] as const).map(id => ({ kind: 'motion' as const, model: {
  id: `${id}-motion`, family: id === 'depth' ? 'Depth Anything' : id === 'rife' ? 'RIFE' : id === 'pose' ? 'Pose Landmarker' : id === 'vector' ? 'VTracer' : 'TripoSR', label: MOTION_MODELS[id].label,
  name: MOTION_MODELS[id].path.slice('models/'.length), group: id, company: id === 'depth' ? 'Depth Anything / ONNX Community' : id === 'rife' ? 'hzwer / Edge Tools' : id === 'pose' ? 'Google' : id === 'vector' ? 'Visioncortex' : 'Tripo AI / Stability AI', country: id === 'pose' ? 'United States' : '—', companyUrl: MOTION_MODELS[id].source,
  version: id === 'depth' ? '2 Small' : id === 'rife' ? '4.9' : id === 'pose' ? 'Full' : id === 'vector' ? '1.0 alpha 4' : 'Q8 export', parameters: 0, quantization: id === 'depth' ? 'Q4' : id === 'rife' ? 'FP32' : id === 'pose' ? 'FP16' : id === 'vector' ? 'WASM' : 'INT8', bytes: motionTotal(id), contextTokens: 0,
  license: MOTION_MODELS[id].license, toolUse: 'not-applicable', thinking: 'not-applicable', reason: MOTION_MODELS[id].purpose,
  source: MOTION_MODELS[id].source, licenseUrl: id === 'depth' ? 'https://github.com/DepthAnything/Depth-Anything-V2/blob/main/LICENSE' : id === 'rife' ? 'https://huggingface.co/edgetools/rife/blob/main/LICENSE' : id === 'pose' ? 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE' : id === 'vector' ? 'https://github.com/visioncortex/vtracer/blob/master/LICENSE' : 'https://github.com/VAST-AI-Research/TripoSR/blob/main/LICENSE',
} }));
const tableModels = [...textTableModels, ...imageCatalogModels, ...speechCatalogModels, ...transcriptionCatalogModels, ...motionCatalogModels];
type TableModel = typeof tableModels[number];
const unique = (key: 'family' | 'version' | 'parameters' | 'license' | 'company' | 'country') =>
  [...new Set(tableModels.map(row => String(row.model[key])))].filter(value => key !== 'parameters' || value !== '0').sort(compareModelNames);
const formatContext = (tokens: number) => `${Math.round(tokens / 1024)}K`;
const hasMatchingVariant = (model: CatalogModel) => MODEL_CATALOG.some(other => other.id !== model.id && other.family === model.family && other.version === model.version && other.parameters === model.parameters);

export default function ModelCatalog({ store, imageOptions, onWrite, folder, download, fileSizes, licensedModels, partialNames, partialModels, busy, modelTypeFilter, onModelTypeFilterChange, ledger, onTest, onTestImage, onOpenSpeech, onOpenTranscription, onOpenMotion, onRefreshCapabilities, onQueue, onQueueVision, onPrioritizeLicense, onResumeQueued, onRemoveQueued, onDiscard, onLicenseConsentNeeded }: Props) {
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const [detailsRow, setDetailsRow] = useState<TableModel | null>(null);
  const [detailsError, setDetailsError] = useState('');
  const [surfaceMap, setSurfaceMap] = useState<SurfaceArtworkMap>(emptySurfaceArtwork);
  const [artworkRow, setArtworkRow] = useState<TableModel | null>(null);
  useEffect(() => { if (!store) return; let active = true; void store.surfaceArtwork().then(value => { if (active) setSurfaceMap(value); }).catch(error => { if (active) setDetailsError(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, [store]);
  const artworkKey = (row: TableModel) => `model:${row.kind}:${row.model.id}`;
  const artworkControl = (row: TableModel) => store && onWrite ? <SurfaceArtworkButton store={store} title={row.model.label} assetId={surfaceMap.items[artworkKey(row)]?.assetId} onOpen={() => setArtworkRow(row)}/> : null;
  const needleAssets = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const browserImage = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const speech = useSyncExternalStore(subscribeSpeechAssets, getSpeechAssets);
  const transcription = useSyncExternalStore(subscribeTranscriptionAssets, getTranscriptionAssets);
  const motionAssets = useSyncExternalStore(subscribeMotionAssets, getMotionAssets);
  const [imageError, setImageError] = useState('');
  const [speechError, setSpeechError] = useState('');
  const confirmAction = useConfirmDialog();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ family: '', company: '', country: '', version: '', parameters: '', license: '', toolUse: '', thinking: '', maxBytes: '', minContext: '' });
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: 'family', direction: 1 });
  const installed = (model: CatalogModel) => !!fileSizes[model.name] && !partialNames.has(model.name);
  const visible = useMemo(() => tableModels.filter(({ kind, model }) => {
    const search = `${model.family} ${model.company} ${model.country} ${model.version} ${model.parameters} ${model.quantization} ${model.license} ${model.reason}`.toLowerCase();
    return matchesModelType(modelTypeFilter, kind === 'image' ? 'image' : kind === 'speech' ? 'speech' : kind === 'transcription' ? 'transcription' : kind === 'motion' ? model.group === 'tripo' ? 'mesh' : model.group === 'pose' ? 'pose' : model.group === 'vector' ? 'vector' : 'video' : 'text')
      && (!query || search.includes(query.toLowerCase().trim()))
      && (!filters.family || model.family === filters.family)
      && (!filters.company || model.company === filters.company)
      && (!filters.country || model.country === filters.country)
      && (!filters.version || model.version === filters.version)
      && (!filters.parameters || String(model.parameters) === filters.parameters)
      && (!filters.license || model.license === filters.license)
      && (!filters.toolUse || model.toolUse === filters.toolUse)
      && (!filters.thinking || model.thinking === filters.thinking)
      && (!filters.maxBytes || model.bytes <= Number(filters.maxBytes) * 1e9)
      && (!filters.minContext || model.contextTokens >= Number(filters.minContext));
  }).sort((a, b) => {
    if (sort.key === 'capabilities') return (capabilityBadges(ledger, `models/${a.model.name}`).length - capabilityBadges(ledger, `models/${b.model.name}`).length) * sort.direction || compareModelNames(a.model.label, b.model.label);
    const left = a.model[sort.key];
    const right = b.model[sort.key];
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right : compareModelNames(String(left), String(right));
    return compared * sort.direction || compareModelNames(a.model.label, b.model.label);
  }), [query, filters, sort, ledger, modelTypeFilter]);
  const available = visible.filter(row => row.kind === 'gguf').map(row => row.model).filter(model => model.runtime !== 'local-server' && !installed(model) && !download.queue.some(item => item.url === model.url) && !(download.status === 'downloading' && download.url === model.url));
  const availableImages = visible.filter(row => row.kind === 'image').map(row => row.model.group).filter(group => browserImage.folder !== folder || !browserImage.installed[group] && browserImage.active !== group && !browserImage.queue.includes(group));
  const availableTranscription = visible.filter(row => row.kind === 'transcription').map(row => row.model.group).filter(id => id !== 'sherpa' && (transcription.folder !== folder || !transcription.installed[id] && transcription.active !== id && !transcription.queue.includes(id)));
  const availableSpeech = visible.filter(row => row.kind === 'speech').map(row => row.model.group).filter(group => speech.folder === folder && speech.checked[group] && !speech.installed[group] && speech.active !== group && !speech.queue.includes(group));
  const availableMotion = visible.filter(row => row.kind === 'motion').map(row => row.model.group).filter(id => motionAssets.folder !== folder || !motionAssets.installed[id] && motionAssets.active !== id && !motionAssets.queue.includes(id));
  const changeFilter = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const changeSort = (key: SortKey) => setSort(current => ({ key, direction: current.key === key && current.direction === 1 ? -1 : 1 }));
  const queue = (items: CatalogModel[]) => {
    if (items.some(item => item.id === 'qwen25-3b') && !hasQwenResearchConsent()) onLicenseConsentNeeded('qwen-research', () => queue(items));
    else if (items.some(item => item.id === 'gemma3-1b') && !hasGemmaConsent()) onLicenseConsentNeeded('gemma', () => queue(items));
    else onQueue(items);
  };
  const queueVision = (model: CatalogModel) => {
    if (model.id === 'qwen25-3b' && !hasQwenResearchConsent()) onLicenseConsentNeeded('qwen-research', () => queueVision(model));
    else if (model.id === 'gemma3-1b' && !hasGemmaConsent()) onLicenseConsentNeeded('gemma', () => queueVision(model));
    else onQueueVision(model);
  };
  const repairLicense = (model: CatalogModel) => {
    if (model.id === 'qwen25-3b' && !hasQwenResearchConsent()) onLicenseConsentNeeded('qwen-research', () => repairLicense(model));
    else if (model.id === 'gemma3-1b' && !hasGemmaConsent()) onLicenseConsentNeeded('gemma', () => repairLicense(model));
    else onPrioritizeLicense(model);
  };
  const resumeQueued = (model: CatalogModel) => {
    if (model.id === 'qwen25-3b' && !hasQwenResearchConsent()) onLicenseConsentNeeded('qwen-research', () => resumeQueued(model));
    else if (model.id === 'gemma3-1b' && !hasGemmaConsent()) onLicenseConsentNeeded('gemma', () => resumeQueued(model));
    else onResumeQueued(model);
  };
  const showDetails = (row: TableModel) => { setDetailsError(''); setDetailsRow(row); detailsDialog.current?.showModal(); };
  const removeNeedle = async () => {
    if (!folder || detailsRow?.kind !== 'needle') return;
    const version = detailsRow.model.id;
    if (!await confirmAction(`Remove ${NEEDLE_LABELS[version]} from this workspace?`, { title: 'Remove Needle files', confirmLabel: 'Remove', destructive: true })) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to remove Needle files.');
      if (needleLoaded(folder, version)) await unloadNeedle();
      await needleAssetsManager.remove(folder, version);
      detailsDialog.current?.close();
    } catch (reason) { setDetailsError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const queueImages = async (groups: BrowserImageModelGroup[]) => {
    if (!folder) return;
    setImageError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the image model.');
      if (browserImage.folder !== folder || !browserImage.installed.engine && !browserImage.legacyInstalled || groups.some(group => !imageModelAcceptsPreviousEngine(group)) && !browserImage.installed.engine) browserImageAssetsManager.queue(folder, 'engine');
      for (const group of groups) browserImageAssetsManager.queue(folder, group);
      if (browserImage.paused && browserImage.folder === folder) browserImageAssetsManager.resume(folder);
    } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
  };
  const startImageDownload = (group: BrowserImageModelGroup) => queueImages([group]);
  const queueSpeech = async (groups: SpeechModelId[]) => {
    if (!folder) return;
    setImageError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save speech models.');
      for (const engine of new Set(groups.map(group => speechModel(group).engine === 'kokoro' ? 'kokoro_engine' as const : speechModel(group).engine === 'chatterbox' ? 'chatterbox_engine' as const : speechModel(group).engine === 'qwen' ? 'qwen_engine' as const : speechModel(group).engine === 'openvoice' ? 'openvoice_engine' as const : 'engine' as const))) if (speech.folder !== folder || !speech.installed[engine]) speechAssetsManager.queue(folder, engine);
      for (const group of groups) speechAssetsManager.queue(folder, group);
      if (speech.paused && speech.folder === folder) speechAssetsManager.resume(folder);
    } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
  };
  const queueTranscription = async (ids: TranscriptionModelId[]) => { if (!folder) return; setSpeechError(''); try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save transcription files.'); if (ids.some(id => id !== 'sherpa') && !transcription.installed.engine) transcriptionAssetsManager.queue(folder, 'engine'); for (const id of ids) if (transcription.folder !== folder || !transcription.installed[id]) transcriptionAssetsManager.queue(folder, id); if (transcription.paused) transcriptionAssetsManager.resume(folder); } catch (error) { setSpeechError(error instanceof Error ? error.message : String(error)); } };
  const queueMotion = async (ids: MotionModel[]) => { if (!folder) return; setImageError(''); try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save graphics and motion models.'); if (ids.some(id => id === 'depth' || id === 'rife' || id === 'tripo') && (browserImage.folder !== folder || !browserImage.installed.engine)) browserImageAssetsManager.queue(folder, 'engine'); if (ids.includes('pose') && (motionAssets.folder !== folder || !motionAssets.installed.pose_engine)) motionAssetsManager.queue(folder, 'pose_engine'); if (ids.includes('vector') && (motionAssets.folder !== folder || !motionAssets.installed.vector_engine)) motionAssetsManager.queue(folder, 'vector_engine'); for (const id of ids) motionAssetsManager.queue(folder, id); if (motionAssets.paused) motionAssetsManager.resume(folder); } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); } };
  const detailRecord = detailsRow && ledger.models[`models/${detailsRow.model.name}`];
  const detailTests = detailRecord ? Object.entries(detailRecord.tests).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const detailWarnings = detailsRow?.kind === 'gguf' ? detailsRow.model.warnings : undefined;

  return <section className="model-catalog" aria-label="Model catalog">
    <div className="model-catalog-toolbar"><div className="model-catalog-filterbar">
      <label><input type="search" aria-label="Search models" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" /></label>
      <label><select aria-label="Model type" value={modelTypeFilter} onChange={event => onModelTypeFilterChange(event.target.value as ModelTypeFilter)}><option value="all">All types</option>{MODEL_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
      <details><summary>Filters</summary><div className="model-catalog-filters">
      {(['family', 'company', 'country', 'version', 'parameters', 'license'] as const).map(key => <label key={key}><span>{{ family: 'Model', company: 'Company', country: 'Country', version: 'Version', parameters: 'Params', license: 'License' }[key]}</span><select value={filters[key]} onChange={event => changeFilter(key, event.target.value)}><option value="">All</option>{unique(key).map(value => <option key={value} value={value}>{key === 'parameters' ? `${value}B` : value}</option>)}</select></label>)}
      <label><span>Tools</span><select value={filters.toolUse} onChange={event => changeFilter('toolUse', event.target.value)}><option value="">All</option><option value="documented">Documented</option><option value="confirmed-browser-test">Passed browser test</option><option value="confirmed-constrained">Constrained browser test</option><option value="unconfirmed">Unconfirmed</option><option value="failed-browser-test">Failed browser test</option></select></label>
      <label><span>Thinking</span><select value={filters.thinking} onChange={event => changeFilter('thinking', event.target.value)}><option value="">All</option><option value="documented">Mode documented</option><option value="no-mode">No dedicated mode</option><option value="unconfirmed">Unconfirmed</option></select></label>
      <label><span>Max file</span><select value={filters.maxBytes} onChange={event => changeFilter('maxBytes', event.target.value)}><option value="">All</option><option value="1">1 GB</option><option value="1.5">1.5 GB</option><option value="2">2 GB</option></select></label>
      <label><span>Min context</span><select value={filters.minContext} onChange={event => changeFilter('minContext', event.target.value)}><option value="">All</option><option value="65536">64K</option><option value="131072">128K</option></select></label>
      </div></details>
    </div><div className="model-catalog-actions">
      <button className="button secondary compact" type="button" disabled={!folder} title="Recheck downloaded files and saved capabilities" onClick={() => { onRefreshCapabilities(); if (folder) { setSpeechError(''); void speechAssetsManager.discover(folder).catch(error => setSpeechError(error instanceof Error ? error.message : String(error))); void transcriptionAssetsManager.discover(folder).catch((error: unknown) => setSpeechError(error instanceof Error ? error.message : String(error))); void motionAssetsManager.discover(folder).catch(error => setImageError(error instanceof Error ? error.message : String(error))); } }}>Refresh results</button>
      <button className="button secondary compact" type="button" disabled={!folder || busy || !(modelTypeFilter === 'image' ? availableImages.length : modelTypeFilter === 'speech' ? availableSpeech.length : modelTypeFilter === 'transcription' ? availableTranscription.length : modelTypeFilter === 'video' || modelTypeFilter === 'pose' || modelTypeFilter === 'vector' || modelTypeFilter === 'mesh' ? availableMotion.length : available.length)} onClick={() => modelTypeFilter === 'image' ? void queueImages(availableImages) : modelTypeFilter === 'speech' ? void queueSpeech(availableSpeech) : modelTypeFilter === 'transcription' ? void queueTranscription(availableTranscription) : modelTypeFilter === 'video' || modelTypeFilter === 'pose' || modelTypeFilter === 'vector' || modelTypeFilter === 'mesh' ? void queueMotion(availableMotion) : queue(available)}>{modelTypeFilter === 'image' ? 'Queue images' : 'Queue models'}</button>
    </div></div>
    <div className="model-catalog-scroll"><table className="model-catalog-table"><thead><tr><th scope="col" aria-sort={sort.key === 'family' ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort('family')}>Model{sort.key === 'family' ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th><th scope="col">Download</th>{columns.slice(1).map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort(column.key)}>{column.label}{sort.key === column.key ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>{visible.map(row => {
      if (row.kind === 'motion') {
        const id = row.model.group;
        const installed = motionAssets.folder === folder && motionAssets.installed[id];
        const active = motionAssets.active === id;
        const queued = motionAssets.queue.includes(id);
        const bytes = motionAssets.folder === folder ? motionAssets.saved[id] : 0;
        return <tbody key={row.model.id}><tr><td className="model-catalog-name">{artworkControl(row)}<strong>{row.model.family}</strong></td><td><div className="model-catalog-buttons">{!installed && !active && !queued && !bytes && <button className="button secondary catalog-action-button" type="button" title={`Download ${row.model.label}`} disabled={!folder} onClick={() => void queueMotion([id])}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={motionTotal(id)} label={`${row.model.label} download progress`} action={active ? 'pause' : motionAssets.paused || !queued ? 'resume' : undefined} onAction={active ? () => motionAssetsManager.pause() : () => { if (folder) void queueMotion([id]); }}/>}</div></td><td>{row.model.version}</td><td>{row.model.quantization}</td><td>{(row.model.bytes / 1e6).toFixed(1)} MB</td><td>{id === 'pose' ? '33 joints' : id === 'vector' ? 'SVG' : id === 'tripo' ? '3D mesh' : 'Video'}</td><td className="model-catalog-capabilities"><span className="capability-icons"><span className="capability-icon" role="img" title={id === 'depth' ? 'Depth estimation' : id === 'rife' ? 'Frame interpolation' : id === 'pose' ? 'Pose detection' : id === 'vector' ? 'Raster to SVG' : 'Image to 3D'}>{id === 'pose' ? '🦴' : id === 'vector' ? '✒️' : id === 'tripo' ? '🧊' : '🎞️'}</span><button className="capability-info-button" type="button" title={`Details for ${row.model.label}`} onClick={() => showDetails(row)}>ⓘ</button>{installed && <button className="capability-test-button" type="button" title={`Open ${row.model.label}`} onClick={() => onOpenMotion(id)}>🧪</button>}</span></td></tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">{row.model.company} · {row.model.reason} <a href={row.model.source} target="_blank" rel="noreferrer">Model</a> · <a href={row.model.licenseUrl} target="_blank" rel="noreferrer">{row.model.license}</a></span></div></td></tr></tbody>;
      }
      if (row.kind === 'transcription') {
        const id = row.model.group;
        const checked = transcription.folder === folder && transcription.checked[id];
        const installed = transcription.folder === folder && transcription.installed[id];
        const active = transcription.folder === folder && transcription.active === id;
        const queued = transcription.folder === folder && transcription.queue.includes(id);
        const bytes = transcription.folder === folder ? transcription.saved[id] : 0;
        return <tbody key={row.model.id}><tr><td className="model-catalog-name">{artworkControl(row)}<strong>{row.model.label}</strong></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && id === 'sherpa' && !active && !transcription.sherpaArchiveReady && <SherpaArchiveImport folder={folder} compact/>}{checked && !installed && id !== 'sherpa' && !active && !queued && bytes === 0 && <button className="button secondary catalog-action-button" type="button" data-tooltip={`Download ${row.model.label}`} aria-label={`Download ${row.model.label}`} disabled={!folder} onClick={() => void queueTranscription([id])}>📥</button>}{!installed && (active || (id === 'sherpa' ? transcription.sherpaArchiveReady : queued || bytes > 0)) && <DownloadRing bytes={bytes} total={transcriptionTotal(id)} label={`${row.model.label} download progress`} action={active ? 'pause' : transcription.paused || !queued ? 'resume' : undefined} onAction={active ? () => transcriptionAssetsManager.pause() : () => void queueTranscription([id])}/>}</div></td><td>{row.model.version}</td><td>{row.model.quantization}</td><td>{(row.model.bytes / 1e9).toFixed(2)} GB</td><td>English</td><td className="model-catalog-capabilities"><span className="capability-icons"><span className="capability-icon" role="img" data-tooltip="Audio transcription" aria-label="Audio transcription">🎧</span><button className="capability-info-button" type="button" title="Model details" onClick={() => showDetails(row)}>ⓘ</button>{installed && <button className="capability-test-button" type="button" title="Open transcription" onClick={() => onOpenTranscription(id)}>🧪</button>}</span></td></tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">{row.model.reason} <a href={row.model.source} target="_blank" rel="noreferrer">Model files</a> · <a href={row.model.licenseUrl} target="_blank" rel="noreferrer">{row.model.license}</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{transcription.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{speechError && <p className="model-error" role="alert">{speechError}</p>}</td></tr></tbody>;
      }
      if (row.kind === 'speech') {
        const group = row.model.group;
        const checked = speech.folder === folder && speech.checked[group];
        const installed = speech.folder === folder && speech.installed[group];
        const active = speech.folder === folder && speech.active === group;
        const queued = speech.folder === folder && speech.queue.includes(group);
        const bytes = speech.folder === folder ? speech.saved[group] : 0;
        const resume = !active && (speech.paused && speech.queue[0] === group || !queued && bytes > 0);
        return <tbody key={row.model.id}><tr><td className="model-catalog-name">{artworkControl(row)}<strong>{row.model.label}</strong></td><td><div className="model-catalog-buttons">{!checked && !active && !queued && <span className="muted">Checking…</span>}{checked && !installed && !active && !queued && bytes === 0 && <button className="button secondary catalog-action-button" type="button" data-tooltip={`Download ${row.model.label}`} aria-label={`Download ${row.model.label}`} disabled={!folder} onClick={() => void queueSpeech([group])}>📥</button>}{!installed && (active || queued || bytes > 0) && <DownloadRing bytes={bytes} total={speechTotal(group)} label={`${row.model.label} download progress`} action={active ? 'pause' : resume ? 'resume' : undefined} onAction={active ? () => speechAssetsManager.pause() : resume ? () => void queueSpeech([group]) : undefined}/>}</div></td><td>{row.model.version}</td><td>{row.model.quantization}</td><td>{(row.model.bytes / 1e9).toFixed(2)} GB</td><td>{SPEECH_MODELS.find(item => item.id === group)?.language}</td><td className="model-catalog-capabilities"><span className="capability-icons">{group === 'openvoice_v2_q8' ? <span className="capability-icon" role="img" tabIndex={0} data-tooltip="Voice conversion" aria-label="Voice conversion">🔄</span> : <span className="capability-icon" role="img" tabIndex={0} data-tooltip="Text to speech" aria-label="Text to speech">🔊</span>}{group !== 'kokoro_q8' && <span className="capability-icon" role="img" tabIndex={0} data-tooltip="Voice cloning from a recording" aria-label="Voice cloning from a recording">🎙️</span>}{group !== 'openvoice_v2_q8' && <span className="capability-icon" role="img" tabIndex={0} data-tooltip={group === 'qwen3_tts_17b_q4' ? 'Plays completed passages while generating' : 'Plays audio chunks while generating'} aria-label={group === 'qwen3_tts_17b_q4' ? 'Passage playback during generation' : 'Chunk playback during generation'}>🌊</span>}<button className="capability-info-button" type="button" title={`Details for ${row.model.label}`} onClick={() => showDetails(row)}>ⓘ</button>{installed && <button className="capability-test-button" type="button" title={`Open ${row.model.label} speech test`} disabled={!folder} onClick={() => onOpenSpeech(group)}>🧪</button>}</span></td></tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">{row.model.reason} <a href={row.model.source} target="_blank" rel="noreferrer">Model files</a> · <a href={row.model.licenseUrl} target="_blank" rel="noreferrer">{row.model.license}</a></span><span className="model-catalog-detail-state">{queued && !active && <span>{speech.paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{(speech.checkErrors[group] || speechError) && <p className="model-error" role="alert">Could not check files: {speech.checkErrors[group] || speechError}</p>}</td></tr></tbody>;
      }
      if (row.kind === 'image') {
        const group = row.model.group;
        const installed = browserImage.folder === folder && browserImage.installed[group];
        const active = browserImage.folder === folder && browserImage.active === group;
        const queued = browserImage.folder === folder && browserImage.queue.includes(group);
        const bytes = browserImage.folder === folder ? browserImage.saved[group] : 0;
        const paused = browserImage.paused && queued;
        const resumeHere = paused && browserImage.queue[0] === group;
        const ringAction = active ? 'pause' : resumeHere || !queued && bytes > 0 ? 'resume' : undefined;
        return <tbody key={row.model.id}><tr>
          <td className="model-catalog-name image-model-name">{artworkControl(row)}<strong>{row.model.label}</strong></td>
          <td className="model-catalog-control"><div className="model-catalog-control-line"><div className="model-catalog-buttons">{browserImage.folder === folder && browserImage.checked[group] && !installed && !active && !queued && bytes === 0 && <button className="button secondary catalog-action-button" type="button" data-tooltip={`Download ${row.model.label}`} aria-label={`Download ${row.model.label}`} disabled={!folder} onClick={() => void startImageDownload(group)}>📥</button>}{queued && !resumeHere && <span className="muted">Queued</span>}{!installed && (active || bytes > 0 || resumeHere) && <DownloadRing bytes={bytes} total={row.model.bytes} label={`${row.model.label} download progress`} action={ringAction} onAction={ringAction === 'pause' ? () => browserImageAssetsManager.pause() : ringAction === 'resume' ? () => void startImageDownload(group) : undefined}/>}</div></div></td>
          <td>{row.model.version}</td><td><span data-tooltip="Output resolution used by this app" aria-label={`Output resolution ${browserImageOutputSize(group)} by ${browserImageOutputSize(group)} pixels`}>{browserImageOutputSize(group)}×{browserImageOutputSize(group)}</span></td><td>{(row.model.bytes / 1e9).toFixed(2)} GB</td><td><span data-tooltip={group === 'sdxs' || group === 'lcm' ? 'Fixed image steps' : 'Default denoising steps; adjustable in Image generator settings'} aria-label={`${browserImageDefaultSteps(group)} denoising steps`}>{browserImageDefaultSteps(group)} {group === 'sdxs' ? 'step' : 'default'}</span></td>
          <td className="model-catalog-capabilities"><span className="capability-icons"><span className="capability-icon" role="img" aria-label="Image generation" tabIndex={0} data-tooltip="Image generation">🎨</span><button className="capability-info-button" type="button" title={`Details for ${row.model.label}`} aria-label={`Details for ${row.model.label}`} onClick={() => showDetails(row)}>ⓘ</button>{installed && <button className="capability-test-button" type="button" disabled={!folder || busy} title="Load and inspect image generation" aria-label={`Inspect ${row.model.label} features`} onClick={() => onTestImage(group)}>🧪</button>}</span></td>
        </tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">{row.model.company} · {row.model.reason} <a href={row.model.source} target="_blank" rel="noreferrer">Model files</a> · <a href={row.model.licenseUrl} target="_blank" rel="noreferrer">{row.model.license}</a></span><span className="model-catalog-detail-state">{!installed && queued && !active && <span className="model-catalog-status">{paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{(imageError || paused && browserImage.error) && <p className="model-error" role="alert">{imageError || browserImage.error}</p>}</td></tr></tbody>;
      }
      if (row.kind === 'needle') return <NeedleAssetCard key={row.model.id} folder={folder} group={row.model.id} artworkControl={artworkControl(row)} inTable onDetails={() => showDetails(row)}/>;
      const model = row.model;
      const active = download.status === 'downloading' && download.url === model.url;
      const queueIndex = download.queue.findIndex(item => item.url === model.url);
      const partial = partialModels.find(item => item.name === model.name && item.url === model.url);
      const savedBytes = partial?.bytes || (fileSizes[model.name] && fileSizes[model.name] < model.bytes ? fileSizes[model.name] : 0);
      const currentBytes = active ? download.progress?.bytes ?? savedBytes : savedBytes;
      const percent = Math.min(100, currentBytes / model.bytes * 100);
      const done = installed(model);
      const waitingPosition = queueIndex + (download.status === 'downloading' && download.queue[0]?.url === download.url ? 0 : 1);
      const missingLicense = done && !licensedModels.has(model.name);
      const projector = model.visionProjector;
      const projectorUrl = projector ? visionProjectorDownloadUrl(model) : '';
      const visionDone = !!projector && fileSizes[projector.name] === projector.bytes && !partialNames.has(projector.name);
      const visionActive = !!projector && download.status === 'downloading' && download.url === projectorUrl;
      const visionQueued = !!projector && download.queue.some(item => item.url === projectorUrl);
      const visionPartial = !!projector && (partialNames.has(projector.name) || !!fileSizes[projector.name] && fileSizes[projector.name] < projector.bytes);
      const incompatible = isKnownIncompatibleGranite(model.name) || isBonsai2Q2BrowserUnsupported(model.name);
      const licenseQueued = done && missingLicense && queueIndex >= 0;
      const status = licenseQueued ? 'License queued' : done ? missingLicense ? 'License needed' : '' : active ? `${percent.toFixed(1)}%` : queueIndex >= 0 ? download.queuePaused ? 'Queued · paused' : `Queued #${waitingPosition}` : currentBytes > 0 ? `${percent.toFixed(1)}% saved` : '';
      const variant = hasMatchingVariant(model) || model.id.startsWith('bonsai2-');
      return <tbody key={model.id}><tr>
        <td className="model-catalog-name">{artworkControl(row)}<strong>{model.family}{variant && <span className="model-catalog-variant" title={model.runtime === 'local-server' ? 'This packing needs a compatible local server in this app' : `Packing: ${model.quantization}`}> · {model.quantization}</span>}</strong></td>
        <td className="model-catalog-control"><div className="model-catalog-control-line">
          <div className="model-catalog-buttons">{done ? missingLicense && <button className="button secondary compact" type="button" disabled={!folder || busy} onClick={() => repairLicense(model)}>{licenseQueued ? 'Save now' : 'Save license'}</button> : active ? null : queueIndex >= 0 ? <>{download.queuePaused && <button className="button secondary catalog-action-button" type="button" data-tooltip={`Resume ${model.label} download`} aria-label={`Resume ${model.label} download`} disabled={!folder || busy || download.status !== 'idle'} onClick={() => resumeQueued(model)}>🔄</button>}<button className="button danger compact" type="button" disabled={busy || download.status === 'discarding'} title="Remove this item from the queue; saved model bytes remain" onClick={() => onRemoveQueued(model.url)}>Remove</button></> : <><button className="button secondary catalog-action-button" type="button" data-tooltip={`${download.status === 'downloading' ? 'Queue' : currentBytes > 0 ? 'Resume' : 'Download'} ${model.label}`} aria-label={`${download.status === 'downloading' ? 'Queue' : currentBytes > 0 ? 'Resume' : 'Download'} ${model.label}`} disabled={!folder || busy || download.status === 'discarding'} onClick={() => queue([model])}>{download.status === 'downloading' || currentBytes === 0 ? '📥' : '🔄'}</button>{currentBytes > 0 && <button className="button danger compact" type="button" disabled={busy || download.status === 'discarding'} onClick={() => onDiscard(model.name)}>Discard</button>}</>}{projector && !visionDone && !visionActive && !visionQueued && model.runtime !== 'local-server' && <button className="button secondary catalog-action-button" type="button" disabled={!folder || busy || download.status === 'discarding'} data-tooltip={done ? `Download vision projector (${(projector.bytes / 1e6).toFixed(0)} MB)` : `Queue model and vision projector (${(projector.bytes / 1e6).toFixed(0)} MB)`} aria-label={done ? `Download vision projector for ${model.label}` : `Queue ${model.label} and vision projector`} onClick={() => queueVision(model)}>{visionPartial ? '🔄' : '🖼️'}</button>}</div></div>
        </td>
        <td>{model.version}</td><td>{model.parameters}B</td><td>{(model.bytes / 1e9).toFixed(2)} GB</td><td>{formatContext(model.contextTokens)}</td>
        <td className="model-catalog-capabilities"><span className="capability-icons" aria-label="Recorded browser capabilities">{capabilityBadges(ledger, `models/${model.name}`, fileSizes[model.name]).map(item => <span className="capability-icon" key={item.id} role="img" tabIndex={0} data-tooltip={item.title} aria-label={item.title}>{item.icon}</span>)}<button className={`capability-info-button${incompatible ? ' capability-warning-button' : ''}`} type="button" title={`Details for ${model.label}`} aria-label={`Details for ${model.label}${incompatible ? ' (browser incompatible)' : ''}`} onClick={() => showDetails(row)}>{incompatible ? '⚠️' : 'ⓘ'}</button>{pendingCapabilities(ledger, `models/${model.name}`, model, fileSizes[model.name]).length > 0 && model.runtime !== 'local-server' && !incompatible && <button className="capability-test-button" type="button" disabled={!folder || !done || missingLicense || busy} title={!done ? 'Download this model before testing' : missingLicense ? 'Save the license before testing' : 'Load model and run missing or outdated diagnostics'} aria-label={`Test capabilities for ${model.label}`} onClick={() => onTest(model)}>🧪</button>}</span></td>
      </tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text"><a href={model.companyUrl} target="_blank" rel="noreferrer" title="Model developer; the GGUF may be hosted by another organization">{model.company}</a> · {model.country} · {model.reason} <a href={model.source} target="_blank" rel="noreferrer">GGUF file</a> · <a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.license}</a></span><span className="model-catalog-detail-state">{status && <span className="model-catalog-status">{status}</span>}{(active || currentBytes > 0 && !done) && <progress value={currentBytes} max={model.bytes} aria-label={`${model.label} download progress`}/>}{(visionActive || visionQueued) && <span className="model-catalog-status">{visionActive ? 'Vision downloading' : download.queuePaused ? 'Vision queued · paused' : 'Vision queued'}</span>}{visionActive && projector && download.progress && <progress value={download.progress.bytes} max={projector.bytes} aria-label={`${model.label} vision download progress`}/>}</span></div></td></tr></tbody>;
    })}</table>{!visible.length && <p className="model-catalog-empty">No models match these filters.</p>}</div>
    <dialog ref={detailsDialog} className="model-limit-dialog model-details-dialog" aria-labelledby="model-details-title">
      {detailsRow && <><h2 id="model-details-title">{detailsRow.model.label}</h2><p>{detailsRow.model.reason}</p>
        {detailsRow.kind === 'image' ? <p>{detailsRow.model.company} · {browserImageOutputSize(detailsRow.model.group)}×{browserImageOutputSize(detailsRow.model.group)} output · {browserImageDefaultSteps(detailsRow.model.group)} denoising {browserImageDefaultSteps(detailsRow.model.group) === 1 ? 'step' : 'steps'} · {(detailsRow.model.bytes / 1e9).toFixed(2)} GB · {detailsRow.model.quantization}</p> : detailsRow.kind === 'transcription' ? <p>{detailsRow.model.company} · English · {(detailsRow.model.bytes / 1e6).toFixed(1)} MB · {detailsRow.model.quantization} · audio transcription</p> : detailsRow.kind === 'speech' ? <p>{detailsRow.model.company} · {SPEECH_MODELS.find(item => item.id === detailsRow.model.group)?.language} · {(detailsRow.model.bytes / 1e6).toFixed(1)} MB · {detailsRow.model.quantization} · {detailsRow.model.group === 'kokoro_q8' ? 'built-in voices' : 'voice samples supported'}</p> : <p>{detailsRow.model.company}{detailsRow.model.country !== '—' ? ` · ${detailsRow.model.country}` : ''} · {detailsRow.model.version} · {detailsRow.kind === 'needle' ? `${Math.round(detailsRow.model.parameters * 1000)}M` : `${detailsRow.model.parameters}B`} parameters · {detailsRow.model.quantization} · {detailsRow.kind === 'needle' ? `${(detailsRow.model.bytes / 1e6).toFixed(1)} MB` : `${(detailsRow.model.bytes / 1e9).toFixed(2)} GB`} · {formatContext(detailsRow.model.contextTokens)} published context</p>}
        {detailsRow.kind === 'image' && <p>Runs in the browser with the ONNX Image engine and a WebGPU adapter that supports shader-f16.</p>}
        {detailsRow.kind === 'speech' && <p>{detailsRow.model.group === 'openvoice_v2_q8' ? '🔄 Converts existing speech into a saved reference voice.' : '🔊 Text to speech ·'} {detailsRow.model.group === 'kokoro_q8' ? 'Built-in voices' : '🎙️ Voice cloning from a recording'}{detailsRow.model.group === 'openvoice_v2_q8' ? ' · Audio is available after processing.' : detailsRow.model.group === 'qwen3_tts_17b_q4' ? ' · 🌊 Completed passages can play while later passages generate.' : ' · 🌊 Audio can play in chunks while the rest is generated.'}{detailsRow.model.group === 'chatterbox_q4f16' ? ' Expression can be adjusted; listen to judge the result.' : detailsRow.model.group === 'chatterbox_turbo_q4f16' ? ' Supports sound tags such as [laugh].' : ''}</p>}
        {detailsRow.kind === 'image' && detailsRow.model.group === 'tiny-q4' && <p>This Q4 export has produced gray pattern artifacts in browser tests. Try Tiny-SD FP16 for better image quality.</p>}
        {detailWarnings?.length ? <section><h3>What to know</h3><ul>{detailWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section> : null}
        {detailsRow.kind !== 'image' && detailsRow.kind !== 'speech' && detailsRow.kind !== 'transcription' && <section><h3>Saved checks</h3>{detailTests.length ? <ul className="model-details-tests">{detailTests.map(([id, result]) => <li key={id}><strong>{result.result === 'passed' ? '✅' : result.result === 'failed' ? '❌' : '❔'} {ledger.capabilities.find(item => item.id === id)?.label || id}</strong><span>{result.detail}{result.source === 'catalog-seed' ? ' · Imported result; rerun due.' : ''}</span></li>)}</ul> : <p>No browser checks saved for this model.</p>}</section>}
        <p><a href={detailsRow.model.source} target="_blank" rel="noreferrer">Model file</a> · <a href={detailsRow.model.licenseUrl} target="_blank" rel="noreferrer">{detailsRow.model.license}</a> · <a href={detailsRow.model.companyUrl} target="_blank" rel="noreferrer">Developer</a></p>
        {detailsRow.kind === 'needle' && needleAssets.folder === folder && needleAssets.installed[detailsRow.model.id] && <button className="button danger compact" type="button" onClick={() => void removeNeedle()}>Remove model files</button>}
        {detailsError && <p className="model-error" role="alert">{detailsError}</p>}
      </>}
      <form method="dialog"><button className="button primary compact" type="submit">Close</button></form>
    </dialog>
    {artworkRow && store && onWrite && <HarnessSurfaceArtwork key={artworkKey(artworkRow)} store={store} surfaceKey={artworkKey(artworkRow)} title={artworkRow.model.label} kind={`${artworkRow.kind} model`} entry={surfaceMap.items[artworkKey(artworkRow)]} imageOptions={imageOptions} folder={folder} onWrite={onWrite} onSaved={setSurfaceMap} onClose={() => setArtworkRow(null)}/>}
  </section>;
}
