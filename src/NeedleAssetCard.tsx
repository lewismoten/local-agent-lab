import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useConfirmDialog } from './ConfirmDialog';
import { getNeedleAssets, NEEDLE_ENGINE_ASSETS, NEEDLE_LABELS, NEEDLE_MODEL_ASSETS, needleAssetsManager, subscribeNeedleAssets } from './needleAssets';
import { unloadNeedle } from './needleRuntime';
import { ensureWritableFolder } from './storage';
import { capabilityBadges, getCapabilityLedger, pendingCapabilities, subscribeCapabilityLedger } from './capabilityLedger';
import { NEEDLE_MODEL_PATHS } from './needleAssets';
import { NEEDLE_CATALOG, NEEDLE_DETAILS, type NeedleAssetGroup } from './needleCatalog';

type Group = NeedleAssetGroup;

export default function NeedleAssetCard({ folder, group, inTable = false, onDetails, artworkControl, disabled = false }: { folder: FileSystemDirectoryHandle | null; group: Group; inTable?: boolean; onDetails?: () => void; artworkControl?: ReactNode; disabled?: boolean }) {
  const state = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const ledger = useSyncExternalStore(subscribeCapabilityLedger, getCapabilityLedger);
  const confirmAction = useConfirmDialog();
  const [error, setError] = useState('');
  const item = NEEDLE_DETAILS[group];
  const checking = !!folder && (state.folder !== folder || !state.checked[group]) && state.active !== group && !state.queue.includes(group);
  const installed = !checking && state.folder === folder && state.installed[group];
  const saved = state.folder === folder ? state.saved[group] : 0;
  const active = state.folder === folder && state.active === group && state.status === 'downloading';
  const queueIndex = state.folder === folder ? state.queue.indexOf(group) : -1;
  const queued = queueIndex >= 0;
  const pausedHere = queued && queueIndex === 0 && state.queuePaused;
  const total = (group === 'engine' ? NEEDLE_ENGINE_ASSETS : NEEDLE_MODEL_ASSETS[group]).reduce((sum, asset) => sum + asset.bytes, 0);
  const download = async () => {
    if (!folder) return;
    setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save Needle files.');
      await needleAssetsManager.download(folder, group);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const resume = async () => {
    if (!folder) return;
    setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to resume Needle downloads.');
      needleAssetsManager.resume(folder);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const remove = async () => {
    if (!folder || !await confirmAction(`Remove ${group === 'engine' ? 'the Needle browser engine' : NEEDLE_LABELS[group]} from this workspace?`, { title: 'Remove Needle files', confirmLabel: 'Remove', destructive: true })) return;
    try { if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to remove Needle files.'); await unloadNeedle(); await needleAssetsManager.remove(folder, group); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const iconAction = inTable;
  const actionClass = iconAction ? group === 'engine' ? 'engine-action-button' : 'catalog-action-button' : 'compact';
  const startLabel = `${state.active || state.queuePaused ? 'Queue' : saved >= total ? 'Retry' : saved ? 'Resume' : 'Download'} ${group === 'engine' ? 'Needle engine' : item.label}`;
  const resumeLabel = `${state.errorGroup === group ? 'Retry' : 'Resume'} ${group === 'engine' ? 'Needle engine' : item.label} download`;
  const pauseLabel = `Pause ${group === 'engine' ? 'Needle engine' : item.label} download`;
  const controls = <div className="model-catalog-buttons">
    {!checking && !installed && !active && !queued && <button className={`button secondary ${actionClass}`} type="button" data-tooltip={iconAction ? startLabel : undefined} aria-label={iconAction ? startLabel : undefined} disabled={!folder || disabled} onClick={() => void download()}>{iconAction ? saved && !state.active && !state.queuePaused ? '🔄' : '📥' : state.active || state.queuePaused ? 'Queue' : saved >= total ? 'Retry' : saved ? 'Resume' : 'Download'}</button>}
    {pausedHere && <button className={`button secondary ${actionClass}`} type="button" data-tooltip={iconAction ? resumeLabel : undefined} aria-label={iconAction ? resumeLabel : undefined} disabled={!folder || disabled} onClick={() => void resume()}>{iconAction ? '🔄' : state.errorGroup === group ? 'Retry' : 'Resume'}</button>}
    {active && <button className={`button secondary ${actionClass}`} type="button" data-tooltip={iconAction ? pauseLabel : undefined} aria-label={iconAction ? pauseLabel : undefined} disabled={disabled} onClick={() => needleAssetsManager.pause()}>{iconAction ? '⏸' : 'Pause'}</button>}
    {group !== 'engine' && (installed || saved > 0 || queued) && !active && !(inTable && installed) && <button className="button danger compact" type="button" disabled={!folder || disabled} onClick={() => void remove()}>Remove</button>}
  </div>;
  if (inTable && group === 'engine') {
    const status = checking ? 'Checking files…' : active ? `${(state.currentBytes / total * 100).toFixed(1)}%` : queued ? state.queuePaused ? state.errorGroup === group ? 'Needs retry' : 'Paused' : `Queued #${queueIndex + 1}` : saved && !installed ? 'Needs repair' : '';
    return <tbody><tr><td className="model-catalog-name">{artworkControl}<strong>Needle</strong></td><td>Geekgineer</td><td>0.3.1</td><td>{(total / 1e6).toFixed(1)} MB</td><td><a href="https://cdn.jsdelivr.net/npm/needle-rs@0.3.1/LICENSE" target="_blank" rel="noreferrer">MIT</a></td><td>{controls}</td></tr>
      <tr className="model-catalog-detail"><td colSpan={6}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text">Needle 1–3 tool routing · 1K–8K context by model. <a href={item.source} target="_blank" rel="noreferrer">Source</a>{!checking && !installed && state.verification.engine && <span title={state.verification.engine}> · ⚠️ {state.verification.engine}</span>}</span><span className="model-catalog-detail-state">{status && <span>{status}</span>}{active && <progress value={state.currentBytes} max={total} aria-label="Needle engine download progress"/>}</span></div>{(error || state.folder === folder && state.errorGroup === group) && <p className="model-error" role="alert">{error || state.error}</p>}</td></tr></tbody>;
  }
  if (inTable && group !== 'engine') {
    const model = NEEDLE_CATALOG.find(item => item.id === group)!;
    const path = NEEDLE_MODEL_PATHS[group];
    const status = checking ? 'Checking files…' : active ? `${(state.currentBytes / total * 100).toFixed(1)}%` : queued ? state.queuePaused ? queueIndex === 0 ? state.errorGroup === group ? 'Needs retry' : 'Paused' : 'Queued · paused' : `Queued #${queueIndex + 1}` : saved && !installed ? state.present[group] ? 'Needs repair' : `${(saved / total * 100).toFixed(1)}% saved` : '';
    return <tbody className="needle-model-rows"><tr>
      <td className="model-catalog-name">{artworkControl}<strong>{item.label}</strong></td>
      <td className="model-catalog-control"><div className="model-catalog-control-line">{controls}</div></td>
      <td>{model.version}</td><td>{Math.round(model.parameters * 1000)}M</td><td>{(model.bytes / 1e6).toFixed(1)} MB</td><td>{Math.round(model.contextTokens / 1024)}K</td>
      <td className="model-catalog-capabilities"><span className="capability-icons" aria-label="Recorded browser capabilities">{capabilityBadges(ledger, path, NEEDLE_MODEL_ASSETS[group][1].bytes).map(badge => <span className="capability-icon" key={badge.id} role="img" tabIndex={0} data-tooltip={badge.title} aria-label={badge.title}>{badge.icon}</span>)}{onDetails && <button className="capability-info-button" type="button" title={`Details for ${item.label}`} aria-label={`Details for ${item.label}`} onClick={onDetails}>ⓘ</button>}{pendingCapabilities(ledger, path, undefined, NEEDLE_MODEL_ASSETS[group][1].bytes).length > 0 && <button className="capability-test-button" type="button" disabled={!folder || !installed || !state.installed.engine} title="Load this tool model and run its browser tests" aria-label={`Test ${item.label}`} onClick={() => { sessionStorage.setItem('needle-selected-model', group); window.dispatchEvent(new CustomEvent('open-browser-tool-models', { detail: group })); }}>🧪</button>}</span></td>
    </tr><tr className="model-catalog-detail"><td colSpan={7}><div className="model-catalog-detail-content"><span className="model-catalog-detail-text"><a href={model.companyUrl} target="_blank" rel="noreferrer">{model.company}</a> · {model.reason} <a href={model.source} target="_blank" rel="noreferrer">Model file</a> · <a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.license}</a>{!installed && state.folder === folder && state.verification[group] && <span title={state.verification[group]}> · ⚠️ {state.verification[group]}</span>}</span><span className="model-catalog-detail-state">{status && <span className="model-catalog-status">{status}</span>}{active && <progress value={state.currentBytes} max={total} aria-label={`${item.label} download progress`}/>}</span></div>{(error || state.folder === folder && state.errorGroup === group) && <p className="model-error" role="alert">{error || state.error}</p>}</td></tr></tbody>;
  }
  return <div className="engine-card">
    <div><strong>{item.label}</strong><span className="model-catalog-status">{checking ? 'Checking files…' : installed ? 'Downloaded' : active ? 'Downloading' : queued ? state.queuePaused ? state.errorGroup === group ? 'Needs retry' : 'Queued · paused' : `Queued #${queueIndex + 1}` : saved >= total ? 'Needs repair' : saved ? 'Partial' : ''}</span></div>
    <p>{item.description} · <a href={item.source} target="_blank" rel="noreferrer">Source</a></p>
    <div className="engine-actions">{controls}</div>
    {active && <div className="download-progress"><progress value={state.currentBytes} max={total} aria-label={`${item.label} download progress`}/><span>{(state.currentBytes / total * 100).toFixed(1)}% · {state.currentAsset}</span></div>}
    {error && <p className="model-error" role="alert">{error}</p>}
    {state.folder === folder && state.errorGroup === group && <p className="model-error" role="alert">{state.error}</p>}
  </div>;
}
