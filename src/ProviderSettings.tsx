import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleHelp, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_PROFILES, type AIConfig, type Provider } from './ai';
import { getBrowserModelStatus, isBrowserModelLoadedFrom, loadBrowserModel, subscribeBrowserModel, unloadBrowserModel } from './browserModel';
import { hasOllamaModel, listOllamaModels } from './modelAvailability';
import { incompleteModels, listPartialModels, type PartialModel } from './modelDownload';
import { getModelDownload, modelDownloadManager, resumeQueuedModels, resumeRecoverableModel, subscribeModelDownload } from './modelDownloadSession';
import ModelCatalog from './ModelCatalog';
import EngineCatalog from './EngineCatalog';
import NeedleDownloadQueue from './NeedleDownloadQueue';
import BrowserImageDownloadQueue from './BrowserImageDownloadQueue';
import { BROWSER_IMAGE_GROUPS, BROWSER_IMAGE_MODEL_PATHS, browserImageAssetsManager, browserImageModelGroup, browserImageModelLabel, getBrowserImageAssets, imageModelAcceptsPreviousEngine, subscribeBrowserImageAssets, type BrowserImageModelGroup } from './browserImageAssets';
import { getBrowserImageStatus, isBrowserImageLoadedFrom, loadBrowserImageModel, setBrowserImageFolder, subscribeBrowserImage, unloadBrowserImageModel } from './browserImage';
import ImageModelDiagnostics from './ImageModelDiagnostics';
import { IMAGE_PRESETS, browserImagePresetForGroup, type ImageConfig } from './imageGeneration';
import { useConfirmDialog } from './ConfirmDialog';
import ModelDiagnostics from './ModelDiagnostics';
import BatchDiagnostics from './BatchDiagnostics';
import { getBatchDiagnostics, subscribeBatchDiagnostics } from './diagnosticBatchRunner';
import { MODEL_CATALOG, type CatalogModel } from './catalogModels';
import { capabilityBadges, getCapabilityLedger, loadCapabilityLedger, pendingCapabilities, subscribeCapabilityLedger } from './capabilityLedger';
import { getModelSession, isModelReady, modelFingerprint, subscribeModelSession, testModel } from './modelSession';
import { withModelLease } from './harnessLease.ts';
import { showCompletionToast, showToast } from './toastStore';
import { ensureWritableFolder, writeBlob } from './storage';
import { uid } from './model';
import { acceptGemmaConsent, acceptQwenResearchConsent, assertModelLicenseFiles, catalogModelForPath, ensureModelLicenseFiles, hasGemmaConsent, hasQwenResearchConsent, isCatalogVisionProjector, visionProjectorDownloadUrl } from './modelLicenses';
import { BONSAI_2_Q2_BROWSER_WARNING, GRANITE_40_WARNING, isBonsai2BrowserUnsupported, isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility';
import { browserOutputSliderExponent, browserThinkingBudget, browserThinkingMode, supportsBrowserThinking, type BrowserThinkingMode } from './browserThinking';
import { compareModelNames } from './modelSort';
import { getPrismEngineDownload, prismEngineManager, subscribePrismEngineDownload } from './prismEngine';
import { getWllamaEngineDownload, subscribeWllamaEngineDownload, wllamaEngineManager } from './wllamaEngine';
import { getNeedleAssets, listPresentNeedleModels, NEEDLE_CONTEXT_TOKENS, NEEDLE_LABELS, NEEDLE_LEGACY_MODEL_PATHS, NEEDLE_MODEL_ASSETS, NEEDLE_MODEL_PATHS, needleAssetsManager, subscribeNeedleAssets, type NeedleVersion } from './needleAssets';
import { modelFolderName } from './modelFolders';
import { getNeedleRuntimeStatus, loadNeedle, subscribeNeedleRuntime, unloadNeedle } from './needleRuntime';
import { rescoreSavedNeedleReports } from './needleReportRescore';
import { rescoreSavedGgufReports } from './ggufReportRescore';
import { BROWSER_ENGINE_CONTEXT_LIMIT, MIN_BROWSER_CONTEXT, browserContextLimit, browserContextWindow } from './browserContext';
import { matchesModelType, MODEL_TYPES, modelTypeForPath, type ModelTypeFilter } from './modelTypes';
import VoiceProfiles from './VoiceProfiles.tsx';
import SpeechModelDiagnostics from './SpeechModelDiagnostics.tsx';
import SpeechDownloadQueue from './SpeechDownloadQueue.tsx';
import { getSpeechAssets, speechAssetsManager, subscribeSpeechAssets } from './speechAssets.ts';
import { SPEECH_MODELS, speechModel, speechModelForPath, type SpeechModelId } from './speechManifest.ts';
import { getBrowserSpeechStatus, isBrowserSpeechLoadedFrom, loadBrowserSpeech, subscribeBrowserSpeech, unloadBrowserSpeech } from './browserSpeech.ts';
import { enableQwenIsolation } from './qwenIsolation.ts';
import { TRANSCRIPTION_MODELS, transcriptionModelForPath, type TranscriptionModelId } from './transcriptionManifest.ts';
import { getTranscriptionAssets, subscribeTranscriptionAssets, transcriptionAssetsManager } from './transcriptionAssets.ts';
import TranscriptionPanel from './TranscriptionPanel.tsx';
import TranscriptionDownloadQueue from './TranscriptionDownloadQueue.tsx';
import MotionModelDiagnostics from './MotionModelDiagnostics.tsx';
import MotionDownloadQueue from './MotionDownloadQueue.tsx';
import { getMotionAssets, MOTION_MODELS, motionAssetsManager, motionModelForPath, subscribeMotionAssets } from './motionAssets.ts';
import PoseModelDiagnostics from './PoseModelDiagnostics.tsx';
import VectorModelDiagnostics from './VectorModelDiagnostics.tsx';
import TripoModelDiagnostics from './TripoModelDiagnostics.tsx';
import type { HarnessStore } from './harnessStore.ts';

type Props = {
  store?: HarnessStore;
  imageOptions?: ImageConfig[];
  onWrite?: <T,>(action: () => Promise<T>) => Promise<T>;
  config: AIConfig; profiles: AIConfig[]; onSelect: (id: string) => void;
  onChange: (profile: AIConfig) => void; onAdd: (profile: AIConfig) => void; onDelete: (id: string) => void;
  onModelDownloaded: (profileId: string, path: string) => void;
  onConnectFolder: () => void;
  folder: FileSystemDirectoryHandle | null;
  imageConfig: ImageConfig; onImageConfigChange: (config: ImageConfig) => void;
};
const providers: { id: Provider; label: string }[] = [
  { id: 'browser', label: 'In browser · local models' },
  { id: 'ollama', label: 'Local Ollama' }, { id: 'openai', label: 'OpenAI Responses' },
  { id: 'codex', label: 'Codex model (OpenAI API)' }, { id: 'compatible', label: 'OpenAI-compatible' },
  { id: 'anthropic', label: 'Anthropic Messages' }, { id: 'gemini', label: 'Gemini' },
];
const bonsai2Model = MODEL_CATALOG.find(model => model.id === 'bonsai2-q2-server')!;
export default function ProviderSettings({ store, imageOptions, onWrite, config, profiles, onSelect, onChange, onAdd, onDelete, onModelDownloaded, onConnectFolder, folder, imageConfig, onImageConfigChange }: Props) {
  const confirmAction = useConfirmDialog();
  const limitDialogRef = useRef<HTMLDialogElement>(null);
  const modelHelpDialogRef = useRef<HTMLDialogElement>(null);
  const [models, setModels] = useState<string[]>([]);
  const [needleFiles, setNeedleFiles] = useState<string[]>([]);
  const capabilityLedger = useSyncExternalStore(subscribeCapabilityLedger, getCapabilityLedger);
  const batchDiagnostics = useSyncExternalStore(subscribeBatchDiagnostics, getBatchDiagnostics);
  const [diagnosticRequest, setDiagnosticRequest] = useState<{ path: string; token: number; kind: 'text' | 'vision' } | null>(null);
  const [browserTab, setBrowserTab] = useState<'loaded' | 'catalog' | 'downloads' | 'engines' | 'voices'>(() => { const saved = sessionStorage.getItem('browser-model-tab'); return saved === 'catalog' || saved === 'downloads' || saved === 'engines' || saved === 'voices' ? saved : 'loaded'; });
  const [modelTypeFilter, setModelTypeFilter] = useState<ModelTypeFilter>(() => { const saved = sessionStorage.getItem('browser-model-type'); return saved === 'text' || saved === 'image' || saved === 'speech' || saved === 'transcription' || saved === 'video' || saved === 'pose' || saved === 'vector' || saved === 'mesh' ? saved : 'all'; });
  const [requestedTranscriptionModel, setRequestedTranscriptionModel] = useState<TranscriptionModelId>('whisper');
  const [requestedSpeechModel, setRequestedSpeechModel] = useState<SpeechModelId | null>(() => { const saved = sessionStorage.getItem('selected-speech-model'); return SPEECH_MODELS.find(model => model.id === saved)?.id || null; });
  useEffect(() => { if (requestedSpeechModel) sessionStorage.setItem('selected-speech-model', requestedSpeechModel); }, [requestedSpeechModel]);
  const [speechLoadBusy, setSpeechLoadBusy] = useState(false);
  const [speechLoadError, setSpeechLoadError] = useState('');
  const speechRuntime = useSyncExternalStore(subscribeBrowserSpeech, getBrowserSpeechStatus);
  const engineDownload = useSyncExternalStore(subscribePrismEngineDownload, getPrismEngineDownload);
  const wllamaDownload = useSyncExternalStore(subscribeWllamaEngineDownload, getWllamaEngineDownload);
  const needleDownload = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const needlePending = !!folder && needleDownload.folder === folder && (!!needleDownload.active || needleDownload.queue.length > 0 || (['engine', 'needle', 'needle2', 'needle3'] as const).some(group => needleDownload.saved[group] > 0 && !needleDownload.installed[group]));
  const imageDownload = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const speechDownload = useSyncExternalStore(subscribeSpeechAssets, getSpeechAssets);
  const transcriptionDownload = useSyncExternalStore(subscribeTranscriptionAssets, getTranscriptionAssets);
  const motionDownload = useSyncExternalStore(subscribeMotionAssets, getMotionAssets);
  const motionPending = motionDownload.folder === folder && (!!motionDownload.active || motionDownload.queue.length > 0 || (['depth', 'rife', 'pose', 'pose_engine', 'vector', 'vector_engine', 'tripo'] as const).some(id => motionDownload.saved[id] > 0 && !motionDownload.installed[id]));
  const imageModelStatus = useSyncExternalStore(subscribeBrowserImage, getBrowserImageStatus);
  const imagePending = !!folder && imageDownload.folder === folder && (!!imageDownload.active || imageDownload.queue.length > 0 || (['engine', ...BROWSER_IMAGE_GROUPS] as const).some(group => imageDownload.saved[group] > 0 && !imageDownload.installed[group] && !(group === 'engine' && imageDownload.legacyInstalled)));
  const speechPending = !!folder && speechDownload.folder === folder && (!!speechDownload.active || speechDownload.queue.length > 0 || (['engine', 'kokoro_engine', 'chatterbox_engine', 'qwen_engine', 'openvoice_engine', ...SPEECH_MODELS.map(model => model.id)] as const).some(group => speechDownload.saved[group] > 0 && !speechDownload.installed[group]));
  const [fileSizes, setFileSizes] = useState<Record<string, number>>({});
  const [licensedModels, setLicensedModels] = useState<Set<string>>(new Set());
  const [modelUrl, setModelUrl] = useState(() => sessionStorage.getItem('model-download-url') || '');
  const [modelError, setModelError] = useState('');
  useEffect(() => {
    if (folder && imageDownload.folder !== folder) {
      void browserImageAssetsManager.discover(folder).catch(error => setModelError(error instanceof Error ? error.message : String(error)));
    }
  }, [folder, imageDownload.folder]);
  useEffect(() => { if (folder && speechDownload.folder !== folder) void speechAssetsManager.discover(folder).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }, [folder, speechDownload.folder]);
  useEffect(() => { if (folder && transcriptionDownload.folder !== folder) void transcriptionAssetsManager.discover(folder).catch((error: unknown) => setModelError(error instanceof Error ? error.message : String(error))); }, [folder, transcriptionDownload.folder]);
  useEffect(() => { if (folder && motionDownload.folder !== folder) void motionAssetsManager.discover(folder).catch((error: unknown) => setModelError(error instanceof Error ? error.message : String(error))); }, [folder, motionDownload.folder]);
  const [outputDraft, setOutputDraft] = useState<string | null>(null);
  const [contextDraft, setContextDraft] = useState<string | null>(null);
  const download = useSyncExternalStore(subscribeModelDownload, getModelDownload);
  const modelBusy = download.status === 'downloading';
  const discardBusy = download.status === 'discarding';
  const [partialNames, setPartialNames] = useState<Set<string>>(new Set());
  const [partialModels, setPartialModels] = useState<PartialModel[]>([]);
  const [testBusy, setTestBusy] = useState(false);
  const [loadTestBusy, setLoadTestBusy] = useState(false);
  const needleRuntime = useSyncExternalStore(subscribeNeedleRuntime, getNeedleRuntimeStatus);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [pendingLicense, setPendingLicense] = useState<{ kind: 'gemma' | 'qwen-research'; action: () => void } | null>(null);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const session = useSyncExternalStore(subscribeModelSession, getModelSession);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState('Not checked');
  const [ollamaRefresh, setOllamaRefresh] = useState(0);
  const modelStatus = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const update = (value: Partial<AIConfig>) => onChange({ ...config, ...(config.provider === 'browser' ? { browserThinkingMode: config.browserThinkingMode ?? browserThinkingMode(config) } : {}), ...value });
  const selectLocalModel = (path: string) => {
    setContextDraft(null);
    if (motionModelForPath(path)) setModelTypeFilter(motionModelForPath(path) === 'tripo' ? 'mesh' : motionModelForPath(path) === 'pose' ? 'pose' : motionModelForPath(path) === 'vector' ? 'vector' : 'video');
    const image = browserImageModelGroup(path);
    if (image) {
      const preset = browserImagePresetForGroup(image);
      if (imageConfig.preset !== preset) onImageConfigChange(IMAGE_PRESETS[preset]);
    }
    const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, value]) => value === path)?.[0];
    update({ model: path, contextWindow: needle ? NEEDLE_CONTEXT_TOKENS[needle] : path && !browserImageModelGroup(path) && !motionModelForPath(path) ? browserContextWindow(path, config.contextWindow) : config.contextWindow });
  };
  useEffect(() => {
    const image = config.provider === 'browser' && imageConfig.preset === 'none' ? browserImageModelGroup(config.model) : null;
    if (image) onImageConfigChange(IMAGE_PRESETS[browserImagePresetForGroup(image)]);
  }, [config.provider, config.model, imageConfig.preset, onImageConfigChange]);
  useEffect(() => {
    if (config.provider !== 'browser' || !config.model || browserImageModelGroup(config.model) || motionModelForPath(config.model)) return;
    const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === config.model)?.[0];
    const limited = needle ? NEEDLE_CONTEXT_TOKENS[needle] : browserContextWindow(config.model, config.contextWindow);
    if (limited !== config.contextWindow) onChange({ ...config, contextWindow: limited });
  }, [config, onChange]);
  useEffect(() => {
    const old = (Object.entries(NEEDLE_LEGACY_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === config.model)?.[0];
    if (old) onChange({ ...config, model: NEEDLE_MODEL_PATHS[old] });
  }, [config, onChange]);
  async function refreshModels() {
    if (!folder) { setModels([]); setFileSizes({}); setLicensedModels(new Set()); setPartialNames(new Set()); setPartialModels([]); return; }
    try {
      const dir = await folder.getDirectoryHandle('models', { create: true });
      const partial = await incompleteModels(folder);
      setPartialNames(partial);
      const partials = await listPartialModels(folder);
      setPartialModels(partials);
      modelDownloadManager.recordPartials(partials);
      const names: string[] = [];
      const sizes: Record<string, number> = {};
      for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.gguf')) {
          sizes[name] = (await (handle as FileSystemFileHandle).getFile()).size;
          if (!partial.has(name) && !isCatalogVisionProjector(name)) names.push(`models/${name}`);
        }
        if (handle.kind === 'directory') for await (const [child, entry] of (handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
          if (entry.kind === 'file' && child.toLowerCase().endsWith('.gguf')) {
            sizes[child] = (await (entry as FileSystemFileHandle).getFile()).size;
            if (!partial.has(child) && !isCatalogVisionProjector(child) && !names.includes(`models/${child}`)) names.push(`models/${child}`);
          }
        }
      }
      setFileSizes(sizes);
      setModels(names.sort((left, right) => compareModelNames(
        catalogModelForPath(left)?.label || left.slice('models/'.length),
        catalogModelForPath(right)?.label || right.slice('models/'.length),
      )));
      const licensed = new Set<string>();
      await Promise.all(MODEL_CATALOG.filter(model => names.includes(`models/${model.name}`)).map(async model => {
        try { await assertModelLicenseFiles(folder, `models/${model.name}`); licensed.add(model.name); }
        catch { /* The catalog offers a prioritized license repair. */ }
      }));
      setLicensedModels(licensed);
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
  }
  useEffect(() => { void refreshModels(); }, [folder, download.revision]);
  useEffect(() => { if (folder) void loadCapabilityLedger(folder).then(() => rescoreSavedNeedleReports(folder)).then(count => { if (count) showToast(`${count} saved Needle report${count === 1 ? '' : 's'} rescored without running models.`); }).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }, [folder]);
  useEffect(() => { if (folder && models.length) void rescoreSavedGgufReports(folder, models).then(count => { if (count) showToast(`${count} saved model report${count === 1 ? '' : 's'} rescored without running models.`); }).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }, [folder, models]);
  useEffect(() => { if (folder) void prismEngineManager.discover(folder); }, [folder]);
  useEffect(() => { if (folder) void wllamaEngineManager.discover(folder); }, [folder]);
  useEffect(() => { if (folder) void needleAssetsManager.discover(folder).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }, [folder]);
  useEffect(() => { setNeedleFiles([]); }, [folder]);
  useEffect(() => {
    let current = true;
    if (folder) void listPresentNeedleModels(folder).then(paths => { if (current) setNeedleFiles(paths); }).catch(error => { if (current) setModelError(error instanceof Error ? error.message : String(error)); });
    return () => { current = false; };
  }, [folder, needleDownload.revision]);
  useEffect(() => { sessionStorage.setItem('browser-model-tab', browserTab); }, [browserTab]);
  useEffect(() => { sessionStorage.setItem('browser-model-type', modelTypeFilter); }, [modelTypeFilter]);
  useEffect(() => { const openTab = () => setBrowserTab('engines'); window.addEventListener('open-browser-model-tab', openTab); return () => window.removeEventListener('open-browser-model-tab', openTab); }, []);
  useEffect(() => { const openTab = () => setBrowserTab('downloads'); window.addEventListener('open-browser-model-downloads', openTab); return () => window.removeEventListener('open-browser-model-downloads', openTab); }, []);
  useEffect(() => { const openTab = (event: Event) => { const version = (event as CustomEvent<NeedleVersion>).detail; setBrowserTab('loaded'); if (version && NEEDLE_MODEL_PATHS[version]) { const path = NEEDLE_MODEL_PATHS[version]; onChange({ ...config, model: path }); setDiagnosticRequest({ path, token: Date.now(), kind: 'text' }); } }; window.addEventListener('open-browser-tool-models', openTab); return () => window.removeEventListener('open-browser-tool-models', openTab); }, [config, onChange]);
  useEffect(() => { sessionStorage.setItem('model-download-url', modelUrl); }, [modelUrl]);
  useEffect(() => { setOutputDraft(null); }, [config.id]);
  useEffect(() => {
    if (config.provider !== 'ollama') return;
    const controller = new AbortController();
    setOllamaStatus('Checking installed models…');
    listOllamaModels(config.endpoint, controller.signal).then(names => { if (controller.signal.aborted) return;
      setOllamaModels(names);
      setOllamaStatus(names.length ? `${names.length} installed model${names.length === 1 ? '' : 's'} found` : 'Ollama is reachable, but no models are installed');
    }).catch(error => { if (!controller.signal.aborted) { setOllamaModels([]); setOllamaStatus(`Cannot check Ollama: ${error instanceof Error ? error.message : String(error)}`); } });
    return () => controller.abort();
  }, [config.provider, config.endpoint, ollamaRefresh]);
  async function startDownload(resumeUrl = modelUrl, profileId = config.id, requirePartial = false) {
    if (!folder) { setModelError('Connect the project folder containing models/ to resume.'); return; }
    if (permissionBusy) return;
    if (isKnownIncompatibleGranite(resumeUrl) && !await confirmAction(`${GRANITE_40_WARNING} Download anyway?`, { title: 'Incompatible model', confirmLabel: 'Download anyway' })) return;
    setPermissionBusy(true); setModelError('');
    try {
      if (requirePartial) {
        setModelUrl(resumeUrl);
        await resumeRecoverableModel(folder, path => onModelDownloaded(profileId, path));
        return;
      }
      if (!await ensureWritableFolder(folder)) {
        setModelError('Allow read and edit access to the project folder, or choose it again to resume the download.');
        return;
      }
      setModelUrl(resumeUrl);
      modelDownloadManager.start(folder, resumeUrl, path => onModelDownloaded(profileId, path));
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function queueCatalog(items: CatalogModel[]) {
    if (!folder || permissionBusy || !items.length) return;
    setPermissionBusy(true); setModelError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow read and edit access to the project folder to download models.');
      modelDownloadManager.enqueue(folder, items.map(({ name, url, bytes }) => ({ name, url, bytes })), () => {});
      showToast(`${items.length} model${items.length === 1 ? '' : 's'} added to the download queue.`);
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function queueCatalogVision(model: CatalogModel) {
    if (!folder || permissionBusy || !model.visionProjector) return;
    setPermissionBusy(true); setModelError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow read and edit access to the project folder to download vision files.');
      const baseReady = fileSizes[model.name] === model.bytes && !partialNames.has(model.name);
      if (baseReady) await ensureModelLicenseFiles(folder, model.url);
      const projector = model.visionProjector;
      const items = [
        ...(!baseReady ? [{ name: model.name, url: model.url, bytes: model.bytes }] : []),
        { name: projector.name, url: visionProjectorDownloadUrl(model), bytes: projector.bytes },
      ];
      modelDownloadManager.enqueue(folder, items, () => {});
      showToast(baseReady ? 'Vision projector added to Downloads.' : 'Model and vision projector added to Downloads.');
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function prioritizeLicense(model: CatalogModel) {
    if (!folder || permissionBusy) return;
    setPermissionBusy(true); setModelError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the model license files.');
      await ensureModelLicenseFiles(folder, model.url);
      await assertModelLicenseFiles(folder, `models/${model.name}`);
      modelDownloadManager.markLicenseReady(model.url);
      await refreshModels();
      showToast(`${model.name} license files are ready.`);
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function resumeCatalogQueue() {
    if (!folder || permissionBusy) return;
    setPermissionBusy(true); setModelError('');
    try {
      const recovery = modelDownloadManager.getSnapshot().recovery;
      if (recovery?.bytes && modelDownloadManager.getSnapshot().queue[0]?.url === recovery.url) await resumeRecoverableModel(folder, () => {});
      else await resumeQueuedModels(folder, () => {});
    }
    catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function resumeQueuedModel(model: CatalogModel) {
    if (!folder || permissionBusy) return;
    setPermissionBusy(true); setModelError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow read and edit access to the project folder to resume the queue.');
      const item = modelDownloadManager.getSnapshot().queue.find(queued => queued.url === model.url);
      if (!item) throw new Error('This model is no longer in the queue.');
      modelDownloadManager.prioritize(folder, item, () => {});
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setPermissionBusy(false); }
  }
  async function discardDownload(name: string) {
    if (!folder || discardBusy) return;
    const active = modelBusy && download.name === name;
    if (!await confirmAction(active
      ? `Stop downloading ${name} and permanently discard its downloaded bytes?`
      : `Permanently discard the partial download of ${name}?`, { title: 'Discard download', confirmLabel: 'Discard', destructive: true })) return;
    await modelDownloadManager.discard(folder, name);
  }
  async function runTest() {
    setTestBusy(true); setModelError('');
    const startedAt = performance.now();
    try { await withModelLease('setup:profile-test', () => testModel(config)); showCompletionToast(`${config.model} passed its model test.`, startedAt); }
    catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
    finally { setTestBusy(false); }
  }
  async function loadAndTest() {
    if (!folder) return;
    const selectedImageGroup = browserImageModelGroup(config.model);
    if (selectedImageGroup) {
      if (imageDownload.folder !== folder || !imageDownload.installed.engine && !(imageDownload.legacyInstalled && imageModelAcceptsPreviousEngine(selectedImageGroup))) { setBrowserTab('engines'); setModelError('Download the ONNX image engine before loading this image model.'); return; }
      setTestBusy(true); setLoadTestBusy(true); setModelError('');
      try { await withModelLease('setup:image-load', async () => { setBrowserImageFolder(folder); await loadBrowserImageModel(selectedImageGroup); }); showToast(`${browserImageModelLabel(selectedImageGroup)} loaded in this browser.`); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); setModelError(message); showToast(`Image model load failed: ${message}`, 'error'); }
      finally { setTestBusy(false); setLoadTestBusy(false); }
      return;
    }
    const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === config.model)?.[0];
    if (needle) {
      if (needleDownload.folder !== folder || !needleDownload.installed.engine) { setBrowserTab('engines'); setModelError('Download the Needle browser engine before loading this model.'); return; }
      if (!needleDownload.installed[needle]) { setModelError('Needle model files need verification or repair. Inspect features for details.'); return; }
      setTestBusy(true); setLoadTestBusy(true); setModelError('');
      try { await withModelLease('setup:needle-load', () => loadNeedle(folder, needle)); showToast(`${NEEDLE_LABELS[needle]} loaded in this browser.`); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); setModelError(message); showToast(`Model load failed: ${message}`, 'error'); }
      finally { setTestBusy(false); setLoadTestBusy(false); }
      return;
    }
    if (isKnownIncompatibleGranite(config.model)) { setModelError(GRANITE_40_WARNING); return; }
    if (isBonsai2Q2BrowserUnsupported(config.model)) { setModelError(BONSAI_2_Q2_BROWSER_WARNING); return; }
    if (isBonsai2BrowserUnsupported(config.model)) {
      if (getPrismEngineDownload().folder !== folder || !getPrismEngineDownload().installed) await prismEngineManager.discover(folder);
      const checked = getPrismEngineDownload();
      if (checked.folder !== folder || !checked.installed) { setBrowserTab('engines'); setModelError(checked.error || (checked.bytes ? 'PrismML engine files are incomplete. Open Engines to repair them.' : 'Download the PrismML WebGPU engine before loading Bonsai 2.')); return; }
    }
    if (!isBonsai2BrowserUnsupported(config.model) && !wllamaDownload.installed) { setBrowserTab('engines'); setModelError('Download Wllama before loading this browser model.'); return; }
    if (catalogModelForPath(config.model)?.id === 'gemma3-1b' && !hasGemmaConsent()) {
      setPendingLicense({ kind: 'gemma', action: () => { void loadAndTest(); } });
      return;
    }
    if (catalogModelForPath(config.model)?.id === 'qwen25-3b' && !hasQwenResearchConsent()) {
      setPendingLicense({ kind: 'qwen-research', action: () => { void loadAndTest(); } });
      return;
    }
    setTestBusy(true); setLoadTestBusy(true); setModelError('');
    try {
      await withModelLease('setup:gguf-load', async () => {
        const catalog = catalogModelForPath(config.model);
        if (catalog) {
          if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the model license files.');
          await ensureModelLicenseFiles(folder, catalog.url);
          await assertModelLicenseFiles(folder, config.model);
          modelDownloadManager.markLicenseReady(catalog.url);
          await refreshModels();
        }
        if (!isBrowserModelLoadedFrom(folder, config.model, config.contextWindow, browserThinkingBudget(config))) {
          await loadBrowserModel(folder, config.model, config.contextWindow, browserThinkingBudget(config));
        }
        await testModel(config);
      });
      showToast(`${config.model} is ready.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelError(message);
      showToast(`Model load or test failed: ${message}`, 'error');
    } finally { setTestBusy(false); setLoadTestBusy(false); }
  }
  const downloadName = (() => { try { return decodeURIComponent(new URL(modelUrl).pathname.split('/').pop() || ''); } catch { return ''; } })();
  async function saveCustomLicense(file: File | undefined) {
    if (!file || !folder) return;
    if (!/^[\w.()-]+\.gguf$/i.test(downloadName)) { setModelError('Enter a valid GGUF URL before adding its license.'); return; }
    if (!(await file.text()).trim()) { setModelError('Choose a nonempty license file.'); return; }
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the license file.');
      await writeBlob(folder, `models/${modelFolderName(downloadName)}/LICENSE.txt`, file);
      setModelError('');
      showToast(`Saved the license for ${downloadName}.`);
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
  }
  const partialHere = partialNames.has(downloadName);
  const add = () => {
    const copy = { ...config, id: uid(), label: config.label + ' copy', apiKey: '' };
    onAdd(copy);
  };
  const changeProvider = (provider: Provider) => {
    const preset = DEFAULT_PROFILES.find(x => x.provider === provider)!;
    update({ provider, label: preset.label, model: preset.model, endpoint: preset.endpoint, effort: preset.effort, thinkingTokens: preset.thinkingTokens, browserThinkingMode: preset.browserThinkingMode, maxOutputTokens: preset.maxOutputTokens, contextWindow: preset.contextWindow, runtimePreset: preset.runtimePreset, apiKey: '' });
  };
  async function queueSelectedEngine(path: string) {
    if (!folder) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the engine in your project folder.');
      if (isBonsai2BrowserUnsupported(path)) await prismEngineManager.queue(folder);
      else await wllamaEngineManager.queue(folder);
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
  }
  const thinkingAvailable = supportsBrowserThinking(config);
  const selectedThinkingMode = browserThinkingMode(config);
  const thinkingBudget = browserThinkingBudget(config);
  const browserModelUnsupported = isKnownIncompatibleGranite(config.model) || isBonsai2Q2BrowserUnsupported(config.model);
  const needleVersion = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === config.model)?.[0];
  const imageGroup = browserImageModelGroup(config.model);
  const imageSelected = !!imageGroup;
  const selectedMotionPath = motionModelForPath(config.model);
  const motionModel = selectedMotionPath && matchesModelType(modelTypeFilter, modelTypeForPath(config.model)) ? selectedMotionPath : null;
  const motionSelected = modelTypeFilter === 'video' || modelTypeFilter === 'pose' || modelTypeFilter === 'vector' || modelTypeFilter === 'mesh' || modelTypeFilter === 'all' && !!motionModel;
  const imageInstalledHere = !!folder && imageDownload.folder === folder && !!imageGroup && imageDownload.installed[imageGroup];
  const imageEngineHere = !!folder && imageDownload.folder === folder && (imageDownload.installed.engine || !!imageGroup && imageDownload.legacyInstalled && imageModelAcceptsPreviousEngine(imageGroup));
  const contextLimit = needleVersion ? NEEDLE_CONTEXT_TOKENS[needleVersion] : config.model ? browserContextLimit(config.model) : BROWSER_ENGINE_CONTEXT_LIMIT;
  const selectedContextWindow = needleVersion ? contextLimit : browserContextWindow(config.model, config.contextWindow);
  const needleModels = needleFiles;
  const imageModels = (Object.entries(BROWSER_IMAGE_MODEL_PATHS) as [BrowserImageModelGroup, string][]).filter(([group]) => imageDownload.folder === folder && imageDownload.installed[group]).map(([, path]) => path);
  const motionModels = (['depth', 'rife', 'pose', 'vector', 'tripo'] as const).filter(id => motionDownload.folder === folder && motionDownload.installed[id]).map(id => MOTION_MODELS[id].path);
  const speechModels = SPEECH_MODELS.filter(model => speechDownload.folder === folder && speechDownload.installed[model.id]).map(model => model.path);
  const speechSelected = modelTypeFilter === 'speech';
  const transcriptionSelected = modelTypeFilter === 'transcription';
  const selectedSpeechModel = requestedSpeechModel && speechModels.includes(speechModel(requestedSpeechModel).path) ? requestedSpeechModel : SPEECH_MODELS.find(model => speechModels.includes(model.path))?.id || null;
  const speechLoadPercent = selectedSpeechModel === 'qwen3_tts_17b_q4' && speechRuntime.model === selectedSpeechModel
    ? /^Loading model (\d+)%/.exec(speechRuntime.message)?.[1]
    : undefined;
  const selectedSpeechPath = selectedSpeechModel ? speechModel(selectedSpeechModel).path : '';
  const speechLoaded = !!folder && !!selectedSpeechModel && isBrowserSpeechLoadedFrom(folder, selectedSpeechModel);
  const selectedSpeechEngineInstalled = !!selectedSpeechModel && speechDownload.installed[speechModel(selectedSpeechModel).engine === 'kokoro' ? 'kokoro_engine' : speechModel(selectedSpeechModel).engine === 'chatterbox' ? 'chatterbox_engine' : speechModel(selectedSpeechModel).engine === 'qwen' ? 'qwen_engine' : speechModel(selectedSpeechModel).engine === 'openvoice' ? 'openvoice_engine' : 'engine'];
  const localModelLabel = (path: string) => { const motion = motionModelForPath(path); if (motion) return MOTION_MODELS[motion].label; const transcription = transcriptionModelForPath(path); if (transcription) return transcription.label; const image = browserImageModelGroup(path); return image ? browserImageModelLabel(image) : speechModelForPath(path)?.label || catalogModelForPath(path)?.label || (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, value]) => value === path)?.[0] || path; };
  const transcriptionModels = TRANSCRIPTION_MODELS.filter(model => transcriptionDownload.folder === folder && transcriptionDownload.installed[model.id]).map(model => model.path);
  const selectedTranscriptionPath = TRANSCRIPTION_MODELS.find(model => model.id === requestedTranscriptionModel)!.path;
  const selectedTranscriptionModel = transcriptionModels.includes(selectedTranscriptionPath) ? requestedTranscriptionModel : transcriptionModelForPath(transcriptionModels[0] || '')?.id || requestedTranscriptionModel;
  const selectableModels = [...models, ...needleModels, ...imageModels, ...motionModels, ...speechModels, ...transcriptionModels].sort((left, right) => compareModelNames(localModelLabel(left), localModelLabel(right)));
  const filteredSelectableModels = selectableModels.filter(path => matchesModelType(modelTypeFilter, modelTypeForPath(path)));
  const selectedLocalModelPath = transcriptionSelected ? transcriptionModels.includes(selectedTranscriptionPath) ? selectedTranscriptionPath : transcriptionModels[0] || '' : speechSelected ? selectedSpeechPath : filteredSelectableModels.includes(config.model) ? config.model : '';
  const loadedSelectedModel = modelStatus.state === 'ready' && modelStatus.path === config.model;
  const selectedSettingsApplied = !!folder && isBrowserModelLoadedFrom(folder, config.model, config.contextWindow, thinkingBudget);
  const needsBrowserReload = loadedSelectedModel && !selectedSettingsApplied;
  const browserReady = selectedSettingsApplied && isModelReady(config);
  const needleReady = !!folder && !!needleVersion && needleRuntime?.folder === folder && needleRuntime.version === needleVersion;
  const prismCheckedHere = !!folder && engineDownload.folder === folder && engineDownload.status !== 'checking';
  const prismInstalledHere = prismCheckedHere && engineDownload.installed;
  const prismDownloadingHere = prismCheckedHere && (engineDownload.status === 'downloading' || engineDownload.status === 'queued');
  const bonsai2Downloaded = fileSizes[bonsai2Model.name] === bonsai2Model.bytes && !partialNames.has(bonsai2Model.name);
  const bonsai2Queued = download.queue.some(item => item.url === bonsai2Model.url);
  function saveOutputDraft() {
    if (outputDraft === null) return;
    const parsed = Math.floor(Number(outputDraft));
    if (Number.isFinite(parsed) && parsed >= 128) update({ maxOutputTokens: parsed });
    setOutputDraft(null);
  }
  async function loadSelectedSpeech() {
    if (!folder || !selectedSpeechModel) return;
    setSpeechLoadBusy(true); setSpeechLoadError('');
    try { await loadBrowserSpeech(folder, selectedSpeechModel); }
    catch (error) { setSpeechLoadError(error instanceof Error ? error.message : String(error)); }
    finally { setSpeechLoadBusy(false); }
  }
  function saveContextDraft() {
    if (contextDraft === null) return;
    const parsed = Math.floor(Number(contextDraft));
    if (contextDraft.trim() && Number.isFinite(parsed)) update({ contextWindow: browserContextWindow(config.model, parsed) });
    setContextDraft(null);
  }
  return <div className="settings-card">
    <div className="provider-heading"><h2>Profiles and models</h2><button className="button secondary compact" onClick={add}><Plus size={15}/> Duplicate</button></div>
    <div className="provider-pills">{profiles.map(profile => <button key={profile.id} className={config.id === profile.id ? 'active' : ''} onClick={() => onSelect(profile.id)}>{profile.label}</button>)}</div>
    {download.recovery && !modelBusy && !(config.provider === 'browser' && download.queue[0]?.url === download.recovery.url) && <div className="resume-model-banner" role="status">
      <strong>Incomplete GGUF download</strong>
      <span>{download.recovery.name} · {download.recovery.total ? `${(download.recovery.bytes / download.recovery.total * 100).toFixed(1)}% ${download.recovery.verified ? 'saved' : 'last reported; saved bytes checked on resume'}` : 'checking saved bytes'}. {download.queue[0]?.licenseOnly ? `First in queue: save the license for ${download.queue[0].name}.` : 'Resume from the connected project folder.'}</span>
      <div className="resume-model-actions"><button className="button primary compact" type="button" disabled={!folder || discardBusy || permissionBusy} onClick={() => void startDownload(download.recovery!.url, 'browser', true)}>{download.queue[0]?.licenseOnly ? 'Save queued license' : 'Resume download'}</button><button className="button secondary compact" type="button" onClick={onConnectFolder}>{folder ? 'Choose another folder' : 'Connect project folder'}</button>{config.provider === 'browser' && <button className="button secondary compact" type="button" onClick={() => setBrowserTab('downloads')}>Open Downloads</button>}</div>
      {config.provider !== 'browser' && modelError && <p className="model-error" role="alert">{modelError}</p>}
    </div>}
    <div className="two-col">
      <label className="field"><span>Profile name</span><input value={config.label} onChange={e => update({ label: e.target.value })}/></label>
      <label className="field"><span>API type</span><select value={config.provider} onChange={e => changeProvider(e.target.value as Provider)}>{providers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    </div>
    {config.provider === 'browser' && <div className="browser-model-panel">
      <div className="browser-model-tabs" role="tablist" aria-label="Local models and engines">{([['loaded', 'Local Models'], ['catalog', 'Catalog'], ['voices', 'Voices'], ['engines', 'Engines'], ['downloads', 'Downloads']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={browserTab === id} className={browserTab === id ? 'active' : ''} onClick={() => setBrowserTab(id)}>{label}</button>)}</div>
      {browserTab === 'loaded' && <div role="tabpanel">
      <div className="browser-model-choice">
      <div className="field"><span>Model file in connected folder</span><div className="local-model-picker"><select aria-label="Model type" value={modelTypeFilter} onChange={e => setModelTypeFilter(e.target.value as ModelTypeFilter)}><option value="all">All types</option>{MODEL_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select><select aria-label="Model file" className={!speechSelected && !transcriptionSelected && browserModelUnsupported ? 'incompatible-model-select' : undefined} value={selectedLocalModelPath} onChange={e => { const speech = speechModelForPath(e.target.value); if (speech) { setRequestedSpeechModel(speech.id); setModelTypeFilter('speech'); setSpeechLoadError(''); } else if (transcriptionModelForPath(e.target.value)) { setRequestedTranscriptionModel(transcriptionModelForPath(e.target.value)!.id); setModelTypeFilter('transcription'); } else selectLocalModel(e.target.value); }}><option value="">{modelTypeFilter === 'pose' ? 'No pose model downloaded' : modelTypeFilter === 'vector' ? 'No vector tool downloaded' : modelTypeFilter === 'mesh' ? 'No 3D model downloaded' : motionSelected ? 'No video model downloaded' : transcriptionSelected ? 'No transcription model downloaded' : speechSelected ? 'No speech model downloaded' : 'No model selected'}</option>{filteredSelectableModels.map(path => { const catalog = catalogModelForPath(path); const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, value]) => value === path)?.[0]; const speech = speechModelForPath(path); const badges = speech || transcriptionModelForPath(path) ? '' : capabilityBadges(capabilityLedger, path, browserImageModelGroup(path) ? undefined : needle ? NEEDLE_MODEL_ASSETS[needle][1].bytes : fileSizes[path.slice('models/'.length)]).map(item => item.icon).join(' '); return <option key={path} value={path}>{motionModelForPath(path) ? `${localModelLabel(path)} ${motionModelForPath(path) === 'pose' ? '🦴' : motionModelForPath(path) === 'vector' ? '✒️' : motionModelForPath(path) === 'tripo' ? '🧊' : '🎞️'}` : transcriptionModelForPath(path) ? `${localModelLabel(path)} 🎧` : speech ? `${speech.label} ${speech.engine === 'openvoice' ? '🔄' : '🔊'}` : browserImageModelGroup(path) ? `${localModelLabel(path)} · image` : needle ? NEEDLE_LABELS[needle] : catalog?.label || path.slice('models/'.length)}{isKnownIncompatibleGranite(path) || isBonsai2Q2BrowserUnsupported(path) ? ' ⚠️' : badges ? ` ${badges}` : ''}</option>; })}</select></div></div>
        {motionSelected ? <><div className="field browser-output-slider"><label>Max output</label><div className="browser-output-control"><input type="text" value="Video model" disabled readOnly/></div></div><label className="field"><span>Thinking</span><select value="none" disabled><option value="none">None</option></select></label></> : transcriptionSelected ? <><div className="field browser-output-slider"><label>Max output</label><div className="browser-output-control"><input type="text" value="Engine controlled" disabled readOnly/></div></div><label className="field"><span>Thinking</span><select value="none" disabled><option value="none">None</option></select></label></> : speechSelected ? <><div className="field browser-output-slider"><label>Max output</label><div className="browser-output-control"><input type="text" value="Engine controlled" disabled readOnly/></div></div><label className="field"><span>Thinking</span><select value="none" disabled><option value="none">None</option></select></label></> : imageSelected ? <><div className="field browser-output-slider"><label>Max output</label><div className="browser-output-control"><input type="text" value="Image model" disabled readOnly/></div></div><label className="field"><span>Thinking</span><select value="none" disabled><option value="none">None</option></select></label></> : needleVersion ? <><div className="field browser-output-slider"><label htmlFor="needle-output-limit">Max output · tokens</label><div className="browser-output-control"><input id="needle-output-limit" type="text" value="Engine controlled" disabled readOnly/></div><small aria-hidden="true">&nbsp;</small></div><label className="field"><span>Thinking</span><select value={needleVersion === 'needle' ? 'none' : 'automatic'} disabled><option value="none">None</option><option value="automatic">Automatic</option></select></label></> : <><div className="field browser-output-slider"><label htmlFor="browser-output-range">Max output · tokens</label><div className="browser-output-control"><input id="browser-output-range" type="range" min={7} max={14} step={1} value={browserOutputSliderExponent(config.maxOutputTokens)} onChange={e => { setOutputDraft(null); update({ maxOutputTokens: 2 ** Number(e.target.value) }); }} aria-valuetext={`${(2 ** browserOutputSliderExponent(config.maxOutputTokens)).toLocaleString()} tokens`}/><input type="number" min={128} step={1} value={outputDraft ?? config.maxOutputTokens} aria-label="Exact maximum output tokens" onChange={e => setOutputDraft(e.target.value)} onBlur={saveOutputDraft} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></div><small><span>128</span><span>16,384</span></small></div>
        <label className="field"><span>Thinking</span><select value={selectedThinkingMode} disabled={!thinkingAvailable} onChange={e => update({ browserThinkingMode: e.target.value as BrowserThinkingMode })}><option value="none">None</option><option value="light">Light · 25%</option><option value="medium">Medium · 50%</option><option value="heavy">Heavy · 75%</option></select>{thinkingBudget > 0 && <small>Up to {thinkingBudget.toLocaleString()} thinking tokens</small>}</label></>}
      </div>
      {motionSelected || transcriptionSelected || speechSelected ? <div className="field browser-output-slider browser-context-slider"><label>Maximum context · tokens</label><div className="browser-output-control"><input type="text" value="Not applicable" disabled readOnly aria-label="Audio model context is not applicable"/></div></div> : !imageSelected && <div className="field browser-output-slider browser-context-slider"><label htmlFor="browser-context-range">Maximum context · tokens</label><div className="browser-output-control">
        <input id="browser-context-range" type="range" min={MIN_BROWSER_CONTEXT} max={contextLimit} step={MIN_BROWSER_CONTEXT} value={selectedContextWindow} disabled={!config.model || !!needleVersion} onChange={event => { setContextDraft(null); update({ contextWindow: browserContextWindow(config.model, Number(event.target.value)) }); }} aria-valuetext={`${selectedContextWindow.toLocaleString()} tokens`}/>
        {needleVersion ? <input type="text" value="Engine controlled" disabled readOnly aria-label="Needle context window is engine controlled"/> : <input type="number" min={MIN_BROWSER_CONTEXT} max={contextLimit} step={1} value={contextDraft ?? selectedContextWindow} disabled={!config.model} aria-label="Exact maximum context tokens" onChange={event => setContextDraft(event.target.value)} onBlur={saveContextDraft} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>}
      </div><small><span>{needleVersion ? 'Fixed by Needle' : MIN_BROWSER_CONTEXT.toLocaleString()}</span><span>{contextLimit.toLocaleString()} max</span></small></div>}
      {modelError && <p className="model-error" role="alert">{modelError}</p>}
      {!speechSelected && needleDownload.folder === folder && needleDownload.status === 'error' && needleDownload.error && <p className="model-error" role="alert">Could not verify Needle files: {needleDownload.error} <button className="button secondary compact" type="button" onClick={onConnectFolder}>Reconnect folder</button></p>}
      <div className="model-buttons"><button className="button secondary compact" type="button" onClick={() => { void refreshModels(); if (folder) { void needleAssetsManager.discover(folder); void browserImageAssetsManager.discover(folder).catch(error => setModelError(error instanceof Error ? error.message : String(error))); void speechAssetsManager.discover(folder).catch(error => setModelError(error instanceof Error ? error.message : String(error))); void transcriptionAssetsManager.discover(folder).catch((error: unknown) => setModelError(error instanceof Error ? error.message : String(error))); void motionAssetsManager.discover(folder).catch((error: unknown) => setModelError(error instanceof Error ? error.message : String(error))); } }} disabled={!folder}>Refresh files</button>{motionSelected ? motionModel && motionModels.includes(config.model) ? motionModel === 'tripo' ? <TripoModelDiagnostics folder={folder} disabled={imageDownload.folder !== folder || !imageDownload.installed.engine} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/> : motionModel === 'vector' ? <VectorModelDiagnostics folder={folder} disabled={motionDownload.folder !== folder || !motionDownload.installed.vector_engine} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/> : motionModel === 'pose' ? <PoseModelDiagnostics folder={folder} disabled={motionDownload.folder !== folder || !motionDownload.installed.pose_engine} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/> : <MotionModelDiagnostics folder={folder} model={motionModel} disabled={imageDownload.folder !== folder || !imageDownload.installed.engine} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/> : null : transcriptionSelected ? <TranscriptionPanel folder={folder} model={selectedTranscriptionModel}/> : speechSelected ? <>
        <button className="button primary compact" type="button" disabled={!folder || !selectedSpeechModel || speechLoadBusy || speechRuntime.state === 'loading' || speechLoaded || speechDownload.folder !== folder || !selectedSpeechEngineInstalled || selectedSpeechModel === 'qwen3_tts_17b_q4' && !crossOriginIsolated} onClick={() => void loadSelectedSpeech()}>{speechLoadBusy ? 'Loading…' : speechLoaded ? 'Loaded' : 'Load'}</button>
        {selectedSpeechModel && <SpeechModelDiagnostics folder={folder} model={selectedSpeechModel} disabled={speechLoadBusy || speechDownload.folder !== folder || !selectedSpeechEngineInstalled || selectedSpeechModel === 'qwen3_tts_17b_q4' && !crossOriginIsolated}/>}
        <button className="button secondary compact" type="button" disabled={!speechLoaded || speechLoadBusy} onClick={() => void unloadBrowserSpeech()}>Unload</button>
        <button className="model-limit-info" type="button" aria-label="About speech model settings" title="About speech model settings" onClick={() => modelHelpDialogRef.current?.showModal()}><CircleHelp size={17}/></button>
       </> : <> <button className="button primary compact" type="button" disabled={!folder || !config.model || (imageSelected ? !imageInstalledHere || !imageEngineHere || imageModelStatus.state === 'loading' || isBrowserImageLoadedFrom(folder, imageGroup || 'model') : needleVersion ? needleDownload.folder !== folder || !needleDownload.installed.engine || !needleDownload.installed[needleVersion] || needleReady : !models.includes(config.model) || browserModelUnsupported || modelStatus.state === 'loading' || browserReady) || testBusy || batchDiagnostics.running} onClick={() => void loadAndTest()}>{loadTestBusy ? 'Loading…' : imageSelected ? isBrowserImageLoadedFrom(folder, imageGroup || 'model') ? 'Loaded' : 'Load' : needleVersion ? needleReady ? 'Loaded' : 'Load' : browserReady ? 'Loaded' : needsBrowserReload ? 'Reload' : selectedSettingsApplied ? 'Check' : 'Load'}</button>{imageSelected ? <ImageModelDiagnostics group={imageGroup || 'model'} folder={folder} imageConfig={imageConfig} disabled={testBusy || batchDiagnostics.running || !imageInstalledHere} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/> : <ModelDiagnostics config={config} folder={folder} disabled={testBusy || batchDiagnostics.running || (needleVersion ? needleDownload.folder !== folder || !needleDownload.present[needleVersion] : modelStatus.state === 'loading' || !models.includes(config.model) || browserModelUnsupported)} openRequest={diagnosticRequest} onOpenRequestHandled={() => setDiagnosticRequest(null)}/>}<BatchDiagnostics folder={folder} models={selectableModels.filter(path => !browserImageModelGroup(path) && !speechModelForPath(path) && !transcriptionModelForPath(path))} config={config} disabled={testBusy || modelStatus.state === 'loading'}/><button className="button secondary compact" type="button" disabled={imageSelected ? !isBrowserImageLoadedFrom(folder, imageGroup || 'model') || testBusy || batchDiagnostics.running : needleVersion ? !needleReady || testBusy || batchDiagnostics.running : modelStatus.state !== 'ready' || testBusy || batchDiagnostics.running} onClick={() => { void withModelLease('setup:unload', async () => { if (imageSelected) await unloadBrowserImageModel(); else if (needleVersion) await unloadNeedle(); else await unloadBrowserModel(); }).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }}>Unload</button><button className="model-limit-info" type="button" aria-label="About model settings and badges" title="About model settings and badges" onClick={() => modelHelpDialogRef.current?.showModal()}><CircleHelp size={17}/></button> </>}</div>
      <dialog ref={modelHelpDialogRef} className="model-limit-dialog" aria-labelledby="model-help-title"><h2 id="model-help-title">Model settings</h2>{motionSelected ? <p>{motionModel === 'tripo' ? 'TripoSR uses the ONNX image engine to turn a cutout image into a static 3D mesh. Text context, output tokens, and thinking do not apply.' : motionModel === 'vector' ? 'VTracer converts a photo or image into editable SVG paths in this browser. Text context, output tokens, and thinking do not apply.' : motionModel === 'pose' ? 'Pose Landmarker uses MediaPipe Vision to find body joints in photos and videos. Inspect features saves timestamped landmarks. Text context, output tokens, and thinking do not apply.' : 'Video models use the ONNX engine. Inspect features opens the video controls and saves a report. Text context, output tokens, and thinking do not apply.'}</p> : transcriptionSelected ? <p>Transcription models can read an audio file or microphone recording in the browser. Sherpa also shows partial text while you speak. Open Transcribe to record or choose a file. Text context and thinking controls do not apply.</p> : speechSelected ? <p>Speech models have no thinking or text context setting. Load a model here, then use Inspect features to generate a speech test. Saved recordings work with Pocket TTS, Chatterbox, Chatterbox Turbo, Qwen3-TTS, and OpenVoice. OpenVoice also needs source speech audio; Kokoro uses built-in voices.</p> : imageSelected ? <p>{browserImageModelLabel(imageGroup || 'model')} creates images. Load prepares it in this browser; Inspect features generates a sample image and saves a report. Text context, output tokens, and thinking do not apply.</p> : needleVersion ? <><p>The pinned Needle browser engine accepts a query and tools, but has no max output token or thinking setting. Its context window and engine limit bound the response; an infinity symbol would be misleading.</p><p>Needle 1 has no documented thinking trace. Needle 2 can sometimes return one; Needle 3 normally returns one. Thinking is automatic when the engine emits it. Inspect features shows what this browser actually returned.</p></> : <><p>Load checks for a short response with thinking off. Inspect features runs the longer tests with your selected output and thinking limits.</p><p>When Thinking is None, changes to Max output apply on the next request. Changes to Thinking or the context window require Reload. With thinking enabled, changing Max output also requires Reload because it changes the thinking budget.</p><p>Long prompts leave less room for output in the context window.</p></>}{!motionSelected && !speechSelected && !transcriptionSelected && !imageSelected && <p>Dropdown badges show passed browser diagnostics: 💬 text, 🔧 structured tools, 🧩 reasoning answer, 💭 prompted steps, and 🧠 separate thinking. A missing badge means the feature is unconfirmed.</p>}<form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
      {motionSelected && !motionModel && <p className="muted" role="status">No {modelTypeFilter === 'pose' ? 'pose' : modelTypeFilter === 'vector' ? 'vector' : modelTypeFilter === 'mesh' ? '3D' : 'video'} model selected. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('catalog')}>Open Catalog</button></p>}
      {motionSelected && motionModel && (motionModel === 'pose' ? motionDownload.folder === folder && !motionDownload.installed.pose_engine : motionModel === 'vector' ? motionDownload.folder === folder && !motionDownload.installed.vector_engine : imageDownload.folder === folder && !imageDownload.installed.engine) && <p className="muted" role="status">{motionModel === 'pose' ? 'MediaPipe Vision' : motionModel === 'vector' ? 'VTracer' : 'ONNX'} engine needed. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button></p>}
      {speechSelected && !selectedSpeechModel && <p className="muted" role="status">No speech model saved. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('catalog')}>Open Catalog</button></p>}
      {speechSelected && selectedSpeechModel && speechDownload.folder === folder && !selectedSpeechEngineInstalled && <p className="muted" role="status">{speechModel(selectedSpeechModel).engine === 'chatterbox' ? 'Chatterbox' : speechModel(selectedSpeechModel).engine === 'qwen' ? 'Qwen3-TTS' : speechModel(selectedSpeechModel).engine === 'openvoice' ? 'OpenVoice' : speechModel(selectedSpeechModel).engine === 'kokoro' ? 'Kokoro' : 'Pocket TTS'} engine needed. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button></p>}
      {speechSelected && selectedSpeechModel === 'qwen3_tts_17b_q4' && !crossOriginIsolated && <p className="muted" role="status">Qwen3-TTS needs browser isolation for memory64. <button className="button secondary compact" type="button" onClick={() => void enableQwenIsolation().catch(error => setSpeechLoadError(error instanceof Error ? error.message : String(error)))}>Enable and reload</button></p>}
      {speechSelected && speechLoadBusy && <div className="model-test-progress" role="status"><span>{speechRuntime.message || 'Loading speech model…'}</span><progress aria-label="Loading speech model" max={100} value={speechLoadPercent === undefined ? undefined : Math.min(100, Math.max(0, Number(speechLoadPercent)))}/></div>}
      {speechSelected && (speechLoadError || speechRuntime.state === 'error' && speechRuntime.model === selectedSpeechModel && speechRuntime.message) && <p className="model-error" role="alert">{speechLoadError || speechRuntime.message}</p>}
      {!motionSelected && !speechSelected && !transcriptionSelected && <>
      {isKnownIncompatibleGranite(config.model) && <p className="model-error" role="alert">{GRANITE_40_WARNING}</p>}
      {isBonsai2Q2BrowserUnsupported(config.model) && <p className="model-error" role="alert">{BONSAI_2_Q2_BROWSER_WARNING} <button className="button secondary compact" type="button" onClick={() => setBrowserTab('catalog')}>Open model catalog</button></p>}
      {isBonsai2BrowserUnsupported(config.model) && !isBonsai2Q2BrowserUnsupported(config.model) && folder && !prismCheckedHere && <p className="muted" role="status">Checking saved PrismML engine…</p>}
      {isBonsai2BrowserUnsupported(config.model) && !isBonsai2Q2BrowserUnsupported(config.model) && prismDownloadingHere && <p className="muted" role="status">Downloading PrismML engine… <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button></p>}
      {isBonsai2BrowserUnsupported(config.model) && !isBonsai2Q2BrowserUnsupported(config.model) && prismCheckedHere && !prismInstalledHere && !prismDownloadingHere && <p className="model-error" role="alert">{engineDownload.error || (engineDownload.bytes ? 'PrismML engine files are incomplete.' : 'PrismML WebGPU engine needed.')} <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button> <button className="button secondary compact" type="button" disabled={!folder || permissionBusy} onClick={() => void queueSelectedEngine(config.model)}>{engineDownload.bytes ? 'Resume PrismML' : 'Download PrismML'}</button></p>}
      {imageSelected && imageInstalledHere && !imageEngineHere && <p className="model-error" role="alert">ONNX image engine needed. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button></p>}
      {config.model && !motionSelected && !imageSelected && !needleVersion && !isBonsai2BrowserUnsupported(config.model) && !wllamaDownload.installed && <p className="model-error" role="alert">Wllama needed. <button className="button secondary compact" type="button" onClick={() => setBrowserTab('engines')}>Open Engines</button> <button className="button secondary compact" type="button" disabled={!folder || wllamaDownload.status === 'downloading' || permissionBusy} onClick={() => void queueSelectedEngine(config.model)}>{wllamaDownload.status === 'downloading' ? 'Downloading…' : wllamaDownload.bytes ? 'Resume Wllama' : 'Download Wllama'}</button></p>}
      {imageSelected && imageModelStatus.state === 'loading' && imageModelStatus.folder === folder && <div className="model-test-progress" role="status"><span>{imageModelStatus.message}</span><progress aria-label="Loading image model"/></div>}
      {!motionSelected && !imageSelected && !needleVersion && (loadTestBusy || modelStatus.state === 'loading') && <div className="model-test-progress" role="status"><span>{modelStatus.state === 'loading' ? modelStatus.message : 'Step 3 of 3 · Quick response check…'}</span><progress aria-label="Loading model"/></div>}
      {!motionSelected && !imageSelected && !needleVersion && <p className="muted" role="status">{needsBrowserReload ? 'Settings changed · applies on the next request.' : browserReady ? 'Ready · output changes apply on the next request.' : selectedSettingsApplied ? 'Loaded · quick check needed.' : modelStatus.message}{modelStatus.state === 'ready' && modelStatus.path !== config.model ? ' (another file is selected)' : ''}</p>}
      </>}
      </div>}
      {browserTab === 'catalog' && <div role="tabpanel">
      <ModelCatalog store={store} imageOptions={imageOptions || []} onWrite={onWrite} folder={folder} modelTypeFilter={modelTypeFilter} onModelTypeFilterChange={setModelTypeFilter} download={download} fileSizes={fileSizes} licensedModels={licensedModels} partialNames={partialNames} partialModels={partialModels} busy={permissionBusy} ledger={capabilityLedger} onRefreshCapabilities={() => { if (folder) void loadCapabilityLedger(folder, true).catch(error => setModelError(error instanceof Error ? error.message : String(error))); }} onTestImage={group => { const path = BROWSER_IMAGE_MODEL_PATHS[group]; setModelTypeFilter('image'); setBrowserTab('loaded'); selectLocalModel(path); setDiagnosticRequest({ path, token: Date.now(), kind: 'text' }); }} onOpenTranscription={model => { setRequestedTranscriptionModel(model); setModelTypeFilter('transcription'); setBrowserTab('loaded'); }} onOpenSpeech={model => { setRequestedSpeechModel(model); setModelTypeFilter('speech'); setBrowserTab('loaded'); }} onOpenMotion={id => { const path = MOTION_MODELS[id].path; setModelTypeFilter(id === 'pose' ? 'pose' : id === 'vector' ? 'vector' : id === 'tripo' ? 'mesh' : 'video'); setBrowserTab('loaded'); selectLocalModel(path); setDiagnosticRequest({ path, token: Date.now(), kind: 'text' }); }} onTest={model => { setModelTypeFilter('text'); const path = `models/${model.name}`; const due = pendingCapabilities(capabilityLedger, path, model, fileSizes[model.name]); const kind = model.visionProjector && due.length > 0 && due.every(id => id.startsWith('vision.')) ? 'vision' : 'text'; setBrowserTab('loaded'); if (config.provider === 'browser') update({ model: path }); else { const profile = { ...DEFAULT_PROFILES.find(item => item.provider === 'browser')!, id: uid(), label: model.label, model: path }; onAdd(profile); } setDiagnosticRequest({ path, token: Date.now(), kind }); }} onQueue={items => void queueCatalog(items)} onQueueVision={model => void queueCatalogVision(model)} onPrioritizeLicense={model => void prioritizeLicense(model)} onResumeQueued={model => void resumeQueuedModel(model)} onRemoveQueued={url => modelDownloadManager.removeQueued(url)} onDiscard={name => void discardDownload(name)} onLicenseConsentNeeded={(kind, action) => setPendingLicense({ kind, action })}/>
      </div>}
      {browserTab === 'voices' && <div role="tabpanel"><VoiceProfiles folder={folder} store={store} imageOptions={imageOptions} onWrite={onWrite}/></div>}
      {browserTab === 'downloads' && <div role="tabpanel">
      <h3>Downloads</h3>
      {!download.queue.length && !modelBusy && !needlePending && !imagePending && !speechPending && !motionPending && !(transcriptionDownload.active || transcriptionDownload.queue.length) && <p className="muted">No downloads queued.</p>}
      {download.queue.length > 0 && <div className="model-queue-order" aria-label="Download queue"><strong>Queue order</strong>{download.queue.map((item, index) => { const firstPending = download.status === 'downloading' && download.queue[0]?.url === download.url ? 1 : 0; return <div className="model-queue-item" key={item.url}><span>{index + 1}. {MODEL_CATALOG.find(model => model.url === item.url)?.label || item.name}{item.licenseOnly ? ' · license' : ''}{index < firstPending ? ' · downloading' : ''}</span><div><button type="button" className="button secondary compact" aria-label={`Move ${item.name} up`} title="Move up" disabled={index <= firstPending} onClick={() => modelDownloadManager.moveQueued(item.url, -1)}>↑</button><button type="button" className="button secondary compact" aria-label={`Move ${item.name} down`} title="Move down" disabled={index < firstPending || index === download.queue.length - 1} onClick={() => modelDownloadManager.moveQueued(item.url, 1)}>↓</button><button type="button" className="button danger compact" aria-label={`Remove ${item.name} from queue`} title="Remove from queue; saved bytes remain" disabled={index < firstPending} onClick={() => modelDownloadManager.removeQueued(item.url)}>Remove</button></div></div>; })}</div>}
      <NeedleDownloadQueue folder={folder}/>
      <BrowserImageDownloadQueue folder={folder}/>
      <SpeechDownloadQueue folder={folder}/><TranscriptionDownloadQueue folder={folder}/>
      <MotionDownloadQueue folder={folder}/>
      {download.queue.length > 0 && download.queuePaused && <button className="button secondary compact" type="button" disabled={!folder || permissionBusy || download.status !== 'idle'} onClick={() => void resumeCatalogQueue()}>Resume queue</button>}
      <div className="model-download-controls"><label className="field"><span>Download speed (MiB/s) · models and engines</span><select value={download.speedLimit} onChange={e => modelDownloadManager.setSpeedLimit(Number(e.target.value))}><option value={0}>Unlimited</option><option value={0.25}>0.25</option><option value={0.5}>0.5</option><option value={1}>1</option><option value={2}>2</option><option value={5}>5</option></select></label>{modelBusy && <button className="button secondary compact" type="button" disabled={discardBusy} onClick={() => modelDownloadManager.pause()}>Pause</button>}{modelBusy && <button className="button danger compact" type="button" disabled={discardBusy} onClick={() => void discardDownload(download.name)}>{discardBusy ? 'Discarding…' : 'Discard download'}</button>}</div>
      {modelBusy && <p className="muted" role="status">Downloading {download.name} in the background. You can visit other pages while it continues.</p>}
      {download.progress && <div className="download-progress"><progress value={download.progress.bytes} max={download.progress.total}/><span>{(download.progress.bytes / download.progress.total * 100).toFixed(1)}% · {(download.progress.bytes / 1048576).toFixed(0)} / {(download.progress.total / 1048576).toFixed(0)} MiB{download.progress.resumed ? ' · resumed' : ''}</span></div>}
      <details className="custom-model-download"><summary>Download another GGUF by URL</summary><label className="field"><span>HTTPS GGUF URL</span><input type="url" value={modelBusy ? download.url : modelUrl} disabled={modelBusy || discardBusy} onChange={e => setModelUrl(e.target.value)}/></label>{isKnownIncompatibleGranite(modelUrl) && <p className="model-error" role="alert">{GRANITE_40_WARNING}</p>}<label className="field"><span>Model license file (required first)</span><input type="file" accept=".txt,text/plain" disabled={!folder || modelBusy || discardBusy} onChange={e => void saveCustomLicense(e.target.files?.[0])}/></label><p className="muted">Custom models need a matching LICENSE file before download or use. Check whether their terms also require a NOTICE or other restrictions.</p><button className="button secondary compact" type="button" disabled={!folder || !modelUrl || modelBusy || discardBusy || permissionBusy} onClick={() => void startDownload()}>{partialHere ? 'Resume download' : 'Download'}</button>{partialHere && !modelBusy && <button className="button danger compact" type="button" disabled={discardBusy} onClick={() => void discardDownload(downloadName)}>Discard partial</button>}{partialModels.filter(item => !MODEL_CATALOG.some(model => model.name === item.name)).length > 0 && <div className="partial-models"><strong>Incomplete files in this folder</strong>{partialModels.filter(item => !MODEL_CATALOG.some(model => model.name === item.name)).map(item => <div key={item.name}><span>{item.name} · {(item.bytes / 1048576).toFixed(0)} / {(item.total / 1048576).toFixed(0)} MiB</span><button className="button secondary compact" disabled={modelBusy || discardBusy || permissionBusy} onClick={() => void startDownload(item.url, 'browser')}>Resume</button></div>)}</div>}</details>
      <div className="model-limit-note"><span>Download and run a single GGUF up to 2 GB.</span><button className="model-limit-info" type="button" aria-label="About the browser model size limit" title="About the browser model size limit" onClick={() => limitDialogRef.current?.showModal()}><CircleHelp size={17}/></button></div>
      <dialog ref={limitDialogRef} className="model-limit-dialog" aria-labelledby="model-limit-title">
        <h2 id="model-limit-title">Browser model size</h2>
        <p>The 2 GB limit applies to both downloads and files copied into your project folder. This browser profile currently loads one GGUF file at a time.</p>
        <p>Wllama supports split GGUF models, but this app does not load splits yet. For a larger model, use a smaller quantization or an Ollama or API profile.</p>
        <form method="dialog"><button className="button primary compact" type="submit">Close</button></form>
      </dialog>
      </div>}
      {browserTab === 'engines' && <div role="tabpanel"><EngineCatalog folder={folder} store={store} imageOptions={imageOptions} onWrite={onWrite}/></div>}
      {(modelError || download.error) && <p className="model-error" role="alert">{modelError || download.error}</p>}
    </div>}
    {config.provider !== 'browser' && <div className="two-col">
      <label className="field"><span>Model ID</span><input value={config.model} onChange={e => update({ model: e.target.value })} placeholder="Enter a model available to your account or local server"/></label>
      <label className="field"><span>API base URL</span><input value={config.endpoint} onChange={e => update({ endpoint: e.target.value })}/></label>
    </div>}
    {config.runtimePreset === 'bonsai2' && <div className="bonsai2-setup">
      <strong>Bonsai 2 2B · local server</strong>
      <p>Download the GGUF to your project folder, then start a current Bonsai 2 compatible llama-server from that folder:</p>
      <div className="bonsai2-actions"><button className="button secondary compact" type="button" disabled={!folder || permissionBusy || bonsai2Downloaded || bonsai2Queued || download.status === 'downloading' && download.url === bonsai2Model.url} onClick={() => void queueCatalog([bonsai2Model])}>{bonsai2Downloaded ? 'GGUF downloaded' : bonsai2Queued ? 'GGUF queued' : 'Download GGUF · 0.55 GB'}</button>{download.queuePaused && bonsai2Queued && <button className="button secondary compact" type="button" disabled={!folder || permissionBusy} onClick={() => void resumeCatalogQueue()}>Resume queue</button>}</div>
      <code className="bonsai2-command">llama-server -m models/{bonsai2Model.name} --alias bonsai-2-2b --ctx-size {config.contextWindow} --port 8080</code>
      <p><a href="https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf" target="_blank" rel="noreferrer">Model and runtime instructions</a> · This local-server profile is an alternative to the browser’s optional PrismML engine.</p>
      <label className="field"><span><input type="checkbox" checked={config.thinkingTokens > 0} onChange={e => update({ thinkingTokens: e.target.checked ? 1 : 0, ...(e.target.checked ? { maxOutputTokens: Math.max(config.maxOutputTokens, 8192) } : {}) })}/> Thinking mode</span></label>
    </div>}
    {config.provider === 'ollama' && <div className="ollama-model-list"><span role="status">{ollamaStatus}{config.model && ollamaModels.length > 0 && !hasOllamaModel(ollamaModels, config.model) ? ` · “${config.model}” is not installed` : ''}</span><button className="button secondary compact" type="button" onClick={() => setOllamaRefresh(x => x + 1)}>Refresh installed models</button>{ollamaModels.length > 0 && <label className="field"><span>Choose an installed model</span><select value={ollamaModels.find(x => hasOllamaModel([x], config.model)) || ''} onChange={e => update({ model: e.target.value })}><option value="">Choose a model</option>{ollamaModels.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}</div>}
    {config.provider !== 'ollama' && config.provider !== 'browser' && <label className="field"><span>API key (memory only; cleared on refresh)</span><input type="password" autoComplete="off" value={config.apiKey} onChange={e => update({ apiKey: e.target.value })} placeholder={config.provider === 'compatible' ? 'Optional for local servers' : 'Required for this provider'}/></label>}
    {config.provider !== 'browser' && <div className="two-col">
      <label className="field"><span>Maximum context window (estimated tokens)</span><input type="number" min="1024" step="1024" value={config.contextWindow} onChange={e => update({ contextWindow: Math.max(1024, Number(e.target.value) || 1024) })}/></label>
      <label className="field"><span>Maximum output tokens</span><input type="number" min="128" step="128" value={config.maxOutputTokens} onChange={e => update({ maxOutputTokens: Math.max(128, Number(e.target.value) || 128) })}/></label>
    </div>}
    {(config.provider === 'openai' || config.provider === 'codex' || config.provider === 'compatible' && config.runtimePreset !== 'bonsai2') && <label className="field"><span>Reasoning effort (model support varies)</span><select value={config.effort} onChange={e => update({ effort: e.target.value as AIConfig['effort'] })}>{['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(x => <option key={x}>{x}</option>)}</select></label>}
    {(config.provider === 'anthropic' || config.provider === 'gemini') && <label className="field"><span>Thinking budget in tokens (0 uses provider default)</span><input type="number" min="0" step="256" value={config.thinkingTokens} onChange={e => update({ thinkingTokens: Math.max(0, Number(e.target.value) || 0) })}/></label>}
    {config.provider === 'ollama' && <label className="field"><span><input type="checkbox" checked={config.thinkingTokens > 0} onChange={e => update({ thinkingTokens: e.target.checked ? 1 : 0 })}/> Enable thinking when the model supports it</span></label>}
    {config.provider !== 'browser' && <div className="model-test-row"><button className="button primary compact" type="button" disabled={!config.model || testBusy || modelStatus.state === 'loading'} onClick={() => void runTest()}>{testBusy ? 'Testing…' : 'Test selected model'}</button><span role="status">{isModelReady(config) ? `${config.model} responded in this browser session.` : session.fingerprint === modelFingerprint(config) && session.state === 'testing' ? session.message : 'Model not confirmed for this browser session'}</span></div>}
    {config.provider !== 'browser' && testBusy && !loadTestBusy && <div className="model-test-progress" role="status"><span>Waiting for the model response…</span><progress aria-label="Testing model"/></div>}
    {config.provider !== 'browser' && <div className="info-banner compact"><CircleHelp size={18}/><span>API keys stay in this tab’s memory. OpenAI and Codex profiles use the Responses API with your own API key; Codex sign-in is separate. Browser CORS and HTTPS rules may block some local or third-party endpoints. The context limit is an estimate; each provider counts tokens differently.</span></div>}
    {!DEFAULT_PROFILES.some(x => x.id === config.id) && <button className="button danger compact" onClick={() => { void confirmAction(`Delete the ${config.label} AI profile?`, { title: 'Delete AI profile', confirmLabel: 'Delete', destructive: true }).then(accepted => { if (accepted) onDelete(config.id); }); }}><Trash2 size={16}/> Delete this profile</button>}
    {pendingLicense && <div className="modal-backdrop" onClick={() => { setPendingLicense(null); setLicenseChecked(false); }}><div className="modal model-license-dialog" role="dialog" aria-modal="true" aria-label="Model license terms" onClick={event => event.stopPropagation()}><h2>{pendingLicense.kind === 'gemma' ? 'Gemma terms' : 'Qwen Research License'}</h2>{pendingLicense.kind === 'gemma' ? <><p>Gemma 3 is governed by Google's terms and prohibited use policy. Copies are saved beside the model before download.</p><p><a href="https://ai.google.dev/gemma/terms/" target="_blank" rel="noreferrer">Read Gemma Terms</a> · <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noreferrer">Read prohibited use policy</a></p></> : <><p>Qwen2.5 3B's Research License grants noncommercial research or evaluation use. Commercial model use requires a separate license from Alibaba Cloud.</p><p><a href="https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE" target="_blank" rel="noreferrer">Read Qwen Research License</a></p></>}<label className="model-license-checkbox"><input type="checkbox" checked={licenseChecked} onChange={event => setLicenseChecked(event.target.checked)}/> {pendingLicense.kind === 'gemma' ? 'I agree to the Gemma Terms and use restrictions.' : 'I understand and will follow the Qwen Research License.'}</label><div className="settings-actions"><button className="button secondary" type="button" onClick={() => { setPendingLicense(null); setLicenseChecked(false); }}>Cancel</button><button className="button primary" type="button" disabled={!licenseChecked} onClick={() => { try { if (pendingLicense.kind === 'gemma') acceptGemmaConsent(); else acceptQwenResearchConsent(); const action = pendingLicense.action; setPendingLicense(null); setLicenseChecked(false); action(); } catch { setModelError('Could not save license acknowledgment in this browser.'); } }}>Accept and continue</button></div></div></div>}
  </div>;
}
