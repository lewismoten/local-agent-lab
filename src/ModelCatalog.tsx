import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MODEL_CATALOG, type CatalogModel } from './catalogModels';
import type { PartialModel } from './modelDownload';
import type { ModelDownloadState } from './modelDownloadSession';
import { hasGemmaConsent, hasQwenResearchConsent, visionProjectorDownloadUrl } from './modelLicenses';
import { compareModelNames } from './modelSort';
import { capabilityBadges, pendingCapabilities, type CapabilityLedger } from './capabilityLedger';
import NeedleAssetCard, { NEEDLE_CATALOG } from './NeedleAssetCard';
import { useConfirmDialog } from './ConfirmDialog';
import { getNeedleAssets, NEEDLE_LABELS, needleAssetsManager, subscribeNeedleAssets } from './needleAssets';
import { needleLoaded, unloadNeedle } from './needleRuntime';
import { ensureWritableFolder } from './storage';
import { isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } from './modelCompatibility';
import { BROWSER_IMAGE_MODEL_ASSETS, browserImageAssetsManager, browserImageTotal, getBrowserImageAssets, subscribeBrowserImageAssets } from './browserImageAssets';
import DownloadRing from './DownloadRing';

type Props = {
  folder: FileSystemDirectoryHandle | null;
  download: ModelDownloadState;
  fileSizes: Record<string, number>;
  licensedModels: Set<string>;
  partialNames: Set<string>;
  partialModels: PartialModel[];
  busy: boolean;
  ledger: CapabilityLedger;
  onTest: (model: CatalogModel) => void;
  onTestImage: () => void;
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
  { key: 'parameters', label: 'Params' }, { key: 'bytes', label: 'File' },
  { key: 'contextTokens', label: 'Context' }, { key: 'capabilities', label: 'Capabilities' },
];
const textTableModels = [
  ...MODEL_CATALOG.map(model => ({ kind: 'gguf' as const, model })),
  ...NEEDLE_CATALOG.map(model => ({ kind: 'needle' as const, model })),
];
const imageCatalogModel = {
  id: 'sd15-image', family: 'Stable Diffusion', label: 'Stable Diffusion', name: 'SD-1.5-ONNX',
  company: 'CompVis / Microsoft', country: '—', version: '1.5', parameters: 0,
  quantization: 'ONNX', bytes: browserImageTotal('model'), contextTokens: 0,
  license: 'Open RAIL-M', toolUse: 'not-applicable', thinking: 'not-applicable',
  reason: 'Generate story images directly in the browser with the optional ONNX engine.',
};
const tableModels = [...textTableModels, { kind: 'image' as const, model: imageCatalogModel }];
type TableModel = typeof textTableModels[number];
const unique = (key: 'family' | 'version' | 'parameters' | 'license' | 'company' | 'country') =>
  [...new Set(tableModels.map(row => String(row.model[key])))].filter(value => key !== 'parameters' || value !== '0').sort(compareModelNames);
const formatContext = (tokens: number) => `${Math.round(tokens / 1024)}K`;
const hasMatchingVariant = (model: CatalogModel) => MODEL_CATALOG.some(other => other.id !== model.id && other.family === model.family && other.version === model.version && other.parameters === model.parameters);

export default function ModelCatalog({ folder, download, fileSizes, licensedModels, partialNames, partialModels, busy, ledger, onTest, onTestImage, onRefreshCapabilities, onQueue, onQueueVision, onPrioritizeLicense, onResumeQueued, onRemoveQueued, onDiscard, onLicenseConsentNeeded }: Props) {
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const [detailsRow, setDetailsRow] = useState<TableModel | null>(null);
  const [detailsError, setDetailsError] = useState('');
  const needleAssets = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const browserImage = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const [imageError, setImageError] = useState('');
  const confirmAction = useConfirmDialog();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ family: '', company: '', country: '', version: '', parameters: '', license: '', toolUse: '', thinking: '', maxBytes: '', minContext: '' });
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: 'family', direction: 1 });
  const installed = (model: CatalogModel) => !!fileSizes[model.name] && !partialNames.has(model.name);
  const available = MODEL_CATALOG.filter(model => model.runtime !== 'local-server' && !installed(model) && !download.queue.some(item => item.url === model.url) && !(download.status === 'downloading' && download.url === model.url));
  const visible = useMemo(() => tableModels.filter(({ model }) => {
    const search = `${model.family} ${model.company} ${model.country} ${model.version} ${model.parameters} ${model.quantization} ${model.license} ${model.reason}`.toLowerCase();
    return (!query || search.includes(query.toLowerCase().trim()))
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
  }), [query, filters, sort, ledger]);
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
  const startImageDownload = async () => {
    if (!folder) return;
    setImageError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the image model.');
      if (browserImage.folder !== folder || !browserImage.installed.engine) browserImageAssetsManager.queue(folder, 'engine');
      browserImageAssetsManager.queue(folder, 'model');
      if (browserImage.paused && browserImage.folder === folder) browserImageAssetsManager.resume(folder);
    } catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
  };
  const detailRecord = detailsRow && ledger.models[`models/${detailsRow.model.name}`];
  const detailTests = detailRecord ? Object.entries(detailRecord.tests).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const detailWarnings = detailsRow?.kind === 'gguf' ? detailsRow.model.warnings : undefined;

  return <section className="model-catalog" aria-label="Model catalog">
    <div className="model-catalog-toolbar"><div className="model-catalog-filterbar">
      <label><input type="search" aria-label="Search models" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" /></label>
      <details><summary>Filters</summary><div className="model-catalog-filters">
      {(['family', 'company', 'country', 'version', 'parameters', 'license'] as const).map(key => <label key={key}><span>{{ family: 'Model', company: 'Company', country: 'Country', version: 'Version', parameters: 'Params', license: 'License' }[key]}</span><select value={filters[key]} onChange={event => changeFilter(key, event.target.value)}><option value="">All</option>{unique(key).map(value => <option key={value} value={value}>{key === 'parameters' ? `${value}B` : value}</option>)}</select></label>)}
      <label><span>Tools</span><select value={filters.toolUse} onChange={event => changeFilter('toolUse', event.target.value)}><option value="">All</option><option value="documented">Documented</option><option value="confirmed-browser-test">Passed browser test</option><option value="confirmed-constrained">Constrained browser test</option><option value="unconfirmed">Unconfirmed</option><option value="failed-browser-test">Failed browser test</option></select></label>
      <label><span>Thinking</span><select value={filters.thinking} onChange={event => changeFilter('thinking', event.target.value)}><option value="">All</option><option value="documented">Mode documented</option><option value="no-mode">No dedicated mode</option><option value="unconfirmed">Unconfirmed</option></select></label>
      <label><span>Max file</span><select value={filters.maxBytes} onChange={event => changeFilter('maxBytes', event.target.value)}><option value="">All</option><option value="1">1 GB</option><option value="1.5">1.5 GB</option><option value="2">2 GB</option></select></label>
      <label><span>Min context</span><select value={filters.minContext} onChange={event => changeFilter('minContext', event.target.value)}><option value="">All</option><option value="65536">64K</option><option value="131072">128K</option></select></label>
      </div></details>
    </div><div className="model-catalog-actions">
      <button className="button secondary compact" type="button" disabled={!folder} title="Reload models/capabilities.json from the connected folder" onClick={onRefreshCapabilities}>Refresh results</button>
      <button className="button secondary compact" type="button" disabled={!folder || busy || !available.length} onClick={() => queue(available)}>Queue models</button>
    </div></div>
    <div className="model-catalog-scroll"><table className="model-catalog-table"><thead><tr><th scope="col" aria-sort={sort.key === 'family' ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort('family')}>Model{sort.key === 'family' ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th><th scope="col">Download</th>{columns.slice(1).map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort(column.key)}>{column.label}{sort.key === column.key ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>{visible.map(row => {
      if (row.kind === 'image') {
        const installed = browserImage.folder === folder && browserImage.installed.model;
        const active = browserImage.folder === folder && browserImage.active === 'model';
        const queued = browserImage.folder === folder && browserImage.queue.includes('model');
        const bytes = browserImage.folder === folder ? browserImage.saved.model : 0;
        const paused = browserImage.paused && queued;
        const resumeHere = paused && browserImage.queue[0] === 'model';
        const ringAction = active ? 'pause' : resumeHere || !queued && bytes > 0 ? 'resume' : undefined;
        return <tbody key={row.model.id}><tr>
          <td className="model-catalog-name image-model-name"><strong>Stable Diffusion</strong></td>
          <td className="model-catalog-control"><div className="model-catalog-control-line"><div className="model-catalog-buttons">{!installed && !active && !queued && bytes === 0 && <button className="button secondary catalog-action-button" type="button" data-tooltip="Download Stable Diffusion" aria-label="Download Stable Diffusion" disabled={!folder} onClick={() => void startImageDownload()}>📥</button>}{queued && !resumeHere && <span className="muted">Queued</span>}{!installed && (active || bytes > 0 || resumeHere) && <DownloadRing bytes={bytes} total={row.model.bytes} label="Stable Diffusion download progress" action={ringAction} onAction={ringAction === 'pause' ? () => browserImageAssetsManager.pause() : ringAction === 'resume' ? () => void startImageDownload() : undefined}/>}</div></div></td>
          <td>1.5</td><td>—</td><td>{(row.model.bytes / 1e9).toFixed(2)} GB</td><td>—</td>
          <td className="model-catalog-capabilities"><span className="capability-icons"><span className="capability-icon" role="img" aria-label="Image generation" tabIndex={0} data-tooltip="Image generation">🎨</span>{installed && <button className="capability-test-button" type="button" disabled={!folder || busy} title="Load and inspect image generation" aria-label="Inspect Stable Diffusion features" onClick={onTestImage}>🧪</button>}</span></td>
        </tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">{row.model.reason} <a href="https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn" target="_blank" rel="noreferrer">Model files</a> · <a href={BROWSER_IMAGE_MODEL_ASSETS[0].url} target="_blank" rel="noreferrer">{row.model.license}</a></span><span className="model-catalog-detail-state">{!installed && queued && !active && <span className="model-catalog-status">{paused ? 'Queued · paused' : 'Queued'}</span>}</span></div>{(imageError || paused && browserImage.error) && <p className="model-error" role="alert">{imageError || browserImage.error}</p>}</td></tr></tbody>;
      }
      if (row.kind === 'needle') return <NeedleAssetCard key={row.model.id} folder={folder} group={row.model.id} inTable onDetails={() => showDetails(row)}/>;
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
        <td className="model-catalog-name"><strong>{model.family}{variant && <span className="model-catalog-variant" title={model.runtime === 'local-server' ? 'This packing needs a compatible local server in this app' : `Packing: ${model.quantization}`}> · {model.quantization}</span>}</strong></td>
        <td className="model-catalog-control"><div className="model-catalog-control-line">
          <div className="model-catalog-buttons">{done ? missingLicense && <button className="button secondary compact" type="button" disabled={!folder || busy} onClick={() => repairLicense(model)}>{licenseQueued ? 'Save now' : 'Save license'}</button> : active ? null : queueIndex >= 0 ? <>{download.queuePaused && <button className="button secondary catalog-action-button" type="button" data-tooltip={`Resume ${model.label} download`} aria-label={`Resume ${model.label} download`} disabled={!folder || busy || download.status !== 'idle'} onClick={() => resumeQueued(model)}>🔄</button>}<button className="button danger compact" type="button" disabled={busy || download.status === 'discarding'} title="Remove this item from the queue; saved model bytes remain" onClick={() => onRemoveQueued(model.url)}>Remove</button></> : <><button className="button secondary catalog-action-button" type="button" data-tooltip={`${download.status === 'downloading' ? 'Queue' : currentBytes > 0 ? 'Resume' : 'Download'} ${model.label}`} aria-label={`${download.status === 'downloading' ? 'Queue' : currentBytes > 0 ? 'Resume' : 'Download'} ${model.label}`} disabled={!folder || busy || download.status === 'discarding'} onClick={() => queue([model])}>{download.status === 'downloading' || currentBytes === 0 ? '📥' : '🔄'}</button>{currentBytes > 0 && <button className="button danger compact" type="button" disabled={busy || download.status === 'discarding'} onClick={() => onDiscard(model.name)}>Discard</button>}</>}{projector && !visionDone && !visionActive && !visionQueued && model.runtime !== 'local-server' && <button className="button secondary catalog-action-button" type="button" disabled={!folder || busy || download.status === 'discarding'} data-tooltip={done ? `Download vision projector (${(projector.bytes / 1e6).toFixed(0)} MB)` : `Queue model and vision projector (${(projector.bytes / 1e6).toFixed(0)} MB)`} aria-label={done ? `Download vision projector for ${model.label}` : `Queue ${model.label} and vision projector`} onClick={() => queueVision(model)}>{visionPartial ? '🔄' : '🖼️'}</button>}</div></div>
        </td>
        <td>{model.version}</td><td>{model.parameters}B</td><td>{(model.bytes / 1e9).toFixed(2)} GB</td><td>{formatContext(model.contextTokens)}</td>
        <td className="model-catalog-capabilities"><span className="capability-icons" aria-label="Recorded browser capabilities">{capabilityBadges(ledger, `models/${model.name}`, fileSizes[model.name]).map(item => <span className="capability-icon" key={item.id} role="img" tabIndex={0} data-tooltip={item.title} aria-label={item.title}>{item.icon}</span>)}<button className={`capability-info-button${incompatible ? ' capability-warning-button' : ''}`} type="button" title={`Details for ${model.label}`} aria-label={`Details for ${model.label}${incompatible ? ' (browser incompatible)' : ''}`} onClick={() => showDetails(row)}>{incompatible ? '⚠️' : 'ⓘ'}</button>{pendingCapabilities(ledger, `models/${model.name}`, model, fileSizes[model.name]).length > 0 && model.runtime !== 'local-server' && !incompatible && <button className="capability-test-button" type="button" disabled={!folder || !done || missingLicense || busy} title={!done ? 'Download this model before testing' : missingLicense ? 'Save the license before testing' : 'Load model and run missing or outdated diagnostics'} aria-label={`Test capabilities for ${model.label}`} onClick={() => onTest(model)}>🧪</button>}</span></td>
      </tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text"><a href={model.companyUrl} target="_blank" rel="noreferrer" title="Model developer; the GGUF may be hosted by another organization">{model.company}</a> · {model.country} · {model.reason} <a href={model.source} target="_blank" rel="noreferrer">GGUF file</a> · <a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.license}</a></span><span className="model-catalog-detail-state">{status && <span className="model-catalog-status">{status}</span>}{(active || currentBytes > 0 && !done) && <progress value={currentBytes} max={model.bytes} aria-label={`${model.label} download progress`}/>}{(visionActive || visionQueued) && <span className="model-catalog-status">{visionActive ? 'Vision downloading' : download.queuePaused ? 'Vision queued · paused' : 'Vision queued'}</span>}{visionActive && projector && download.progress && <progress value={download.progress.bytes} max={projector.bytes} aria-label={`${model.label} vision download progress`}/>}</span></div></td></tr></tbody>;
    })}</table>{!visible.length && <p className="model-catalog-empty">No models match these filters.</p>}</div>
    <dialog ref={detailsDialog} className="model-limit-dialog model-details-dialog" aria-labelledby="model-details-title">
      {detailsRow && <><h2 id="model-details-title">{detailsRow.model.label}</h2><p>{detailsRow.model.reason}</p>
        <p>{detailsRow.model.company}{detailsRow.model.country !== '—' ? ` · ${detailsRow.model.country}` : ''} · {detailsRow.model.version} · {detailsRow.kind === 'needle' ? `${Math.round(detailsRow.model.parameters * 1000)}M` : `${detailsRow.model.parameters}B`} parameters · {detailsRow.model.quantization} · {detailsRow.kind === 'needle' ? `${(detailsRow.model.bytes / 1e6).toFixed(1)} MB` : `${(detailsRow.model.bytes / 1e9).toFixed(2)} GB`} · {formatContext(detailsRow.model.contextTokens)} published context</p>
        {detailWarnings?.length ? <section><h3>What to know</h3><ul>{detailWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section> : null}
        <section><h3>Saved checks</h3>{detailTests.length ? <ul className="model-details-tests">{detailTests.map(([id, result]) => <li key={id}><strong>{result.result === 'passed' ? '✅' : result.result === 'failed' ? '❌' : '❔'} {ledger.capabilities.find(item => item.id === id)?.label || id}</strong><span>{result.detail}{result.source === 'catalog-seed' ? ' · Imported result; rerun due.' : ''}</span></li>)}</ul> : <p>No browser checks saved for this model.</p>}</section>
        <p><a href={detailsRow.model.source} target="_blank" rel="noreferrer">Model file</a> · <a href={detailsRow.model.licenseUrl} target="_blank" rel="noreferrer">{detailsRow.model.license}</a> · <a href={detailsRow.model.companyUrl} target="_blank" rel="noreferrer">Developer</a></p>
        {detailsRow.kind === 'needle' && needleAssets.folder === folder && needleAssets.installed[detailsRow.model.id] && <button className="button danger compact" type="button" onClick={() => void removeNeedle()}>Remove model files</button>}
        {detailsError && <p className="model-error" role="alert">{detailsError}</p>}
      </>}
      <form method="dialog"><button className="button primary compact" type="submit">Close</button></form>
    </dialog>
  </section>;
}
