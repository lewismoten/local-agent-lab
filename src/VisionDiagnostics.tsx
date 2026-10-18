import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import MarkdownContent from './MarkdownContent';
import type { AIConfig } from './ai';
import { catalogModelForPath, ensureVisionProjectorLicenseFiles, visionProjectorDownloadUrl } from './modelLicenses';
import { loadBrowserModel, probeBrowserVision, type VisionProbeResult } from './browserModel';
import { browserThinkingBudget } from './browserThinking';
import { createReferencePhotoFixture, createVisionFixtures, PUBLIC_REFERENCE_PHOTO_NAME, type VisionFixture } from './visionFixtures';
import { ensureWritableFolder, readBlob, writeBlob } from './storage';
import { showToast } from './toastStore';
import { recordCapability } from './capabilityLedger';
import { incompleteModels } from './modelDownload';
import { getModelDownload, modelDownloadManager, subscribeModelDownload } from './modelDownloadSession';
import CropPreview from './CropPreview';
import { CROP_IMAGE_SIZE, straightenCrop } from './visionCrop';
import { saveDiagnosticJson } from './diagnosticReports';
import { modelFolderName } from './modelFolders';

export default function VisionDiagnostics({ config, folder, disabled, openRequest, onOpenRequestHandled }: { config: AIConfig; folder: FileSystemDirectoryHandle | null; disabled: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [fixtures, setFixtures] = useState<VisionFixture[]>([]);
  const [results, setResults] = useState<VisionProbeResult[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState('');
  const [projectorPresent, setProjectorPresent] = useState(false);
  const [projectorPartial, setProjectorPartial] = useState(false);
  const [checkedAt, setCheckedAt] = useState('');
  const download = useSyncExternalStore(subscribeModelDownload, getModelDownload);
  const catalog = catalogModelForPath(config.model);
  const projector = catalog?.visionProjector;
  const projectorUrl = catalog ? visionProjectorDownloadUrl(catalog) : '';
  const projectorActive = !!projector && download.status === 'downloading' && download.url === projectorUrl;
  const projectorQueued = !!projector && download.queue.some(item => item.url === projectorUrl);
  useEffect(() => {
    if (!openRequest || openRequest.path !== config.model || disabled || !folder) return;
    if (!projector) { onOpenRequestHandled?.(); return; }
    const timer = window.setTimeout(() => { onOpenRequestHandled?.(); void open(); }, 0);
    return () => window.clearTimeout(timer);
  }, [openRequest?.token, config.model, disabled, folder, projector?.name]);
  useEffect(() => () => { fixtures.forEach(item => URL.revokeObjectURL(item.url)); controller.current?.abort(); }, [fixtures]);

  useEffect(() => {
    if (!folder || !projector) { setProjectorPresent(false); setProjectorPartial(false); return; }
    let current = true;
    void Promise.all([readBlob(folder, `models/${projector.name}`), incompleteModels(folder)]).then(([file, partial]) => {
      if (current) { setProjectorPresent(file.size === projector.bytes && !partial.has(projector.name)); setProjectorPartial(partial.has(projector.name) || file.size > 0 && file.size < projector.bytes); }
    }).catch(() => { if (current) { setProjectorPresent(false); setProjectorPartial(false); } });
    return () => { current = false; };
  }, [folder, projector?.name, projector?.bytes, download.revision]);

  async function open() {
    setMessage('Preparing images…');
    setPreparing(true);
    setResults([]);
    setActive(-1);
    dialog.current?.showModal();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${PUBLIC_REFERENCE_PHOTO_NAME}`);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('The included reference photo could not be loaded.');
      const photo = await response.blob();
      setFixtures([createReferencePhotoFixture(photo)]);
      const next = await createVisionFixtures();
      setFixtures([createReferencePhotoFixture(photo), ...next]);
      if (folder && projector) {
        try { const file = await readBlob(folder, `models/${projector.name}`); const partial = (await incompleteModels(folder)).has(projector.name); setProjectorPresent(file.size === projector.bytes && !partial); setProjectorPartial(partial || file.size > 0 && file.size < projector.bytes); }
        catch { setProjectorPresent(false); setProjectorPartial(false); }
      } else { setProjectorPresent(false); setProjectorPartial(false); }
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPreparing(false); }
  }

  async function queueProjector() {
    if (!folder || !catalog?.visionProjector || !projectorUrl) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      await ensureVisionProjectorLicenseFiles(folder, catalog);
      const item = { name: catalog.visionProjector.name, url: projectorUrl, bytes: catalog.visionProjector.bytes };
      if (projectorQueued && download.queuePaused) modelDownloadManager.resumeQueue(folder, path => { if (path === `models/${item.name}`) setProjectorPresent(true); });
      else modelDownloadManager.enqueue(folder, [item], path => { if (path === `models/${item.name}`) setProjectorPresent(true); });
      setMessage('Projector added to Downloads.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function importProjector(file?: File) {
    if (!file || !folder || !catalog?.visionProjector) return;
    if (file.name !== catalog.visionProjector.name || file.size !== catalog.visionProjector.bytes) {
      setMessage(`Select ${catalog.visionProjector.name} (${(catalog.visionProjector.bytes / 1e9).toFixed(2)} GB).`);
      return;
    }
    setBusy(true);
    setMessage('Saving projector to models/…');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      await ensureVisionProjectorLicenseFiles(folder, catalog);
      await writeBlob(folder, `models/${modelFolderName(file.name)}/${file.name}`, file);
      setProjectorPresent(true);
      setMessage('Projector saved.');
      showToast('Vision projector saved to the workspace.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!folder || !projector || !fixtures.length || busy) return;
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setResults([]);
    setActive(0);
    setCheckedAt(new Date().toISOString());
    setMessage('Loading model with vision projector…');
    const started = performance.now();
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      if (catalog) await ensureVisionProjectorLicenseFiles(folder, catalog);
      await loadBrowserModel(folder, config.model, config.contextWindow, browserThinkingBudget(config), true);
      setMessage('Running vision tests…');
      const tested = await probeBrowserVision(config.model, fixtures, config.maxOutputTokens, (result, index) => {
        setResults(current => [...current, result]);
        setActive(index);
        setMessage(`${index + 1}/${fixtures.length} vision tests finished`);
        void recordCapability(folder, config.model, catalog?.label || config.model, `vision.${result.id}`, result.status, `${result.detail} Answer: ${result.answer}`, catalog?.bytes).catch(error => setMessage(`Could not save capability result: ${error}`));
      }, next.signal);
      if (!next.signal.aborted) showToast(`Vision tests finished: ${tested.filter(item => item.status === 'passed').length}/${tested.length} passed (${Math.round((performance.now() - started) / 1000)}s).`);
    } catch (error) { setMessage(next.signal.aborted ? 'Vision tests stopped.' : error instanceof Error ? error.message : String(error)); }
    finally { controller.current = null; setBusy(false); }
  }

  function report(withImages = false) {
    return { file: config.model, checkedAt, projector: projector?.name, tests: results.map(result => ({ ...result, exploratory: ['faint', 'micro', 'lsb', 'photo'].includes(result.id), ...(withImages ? { image: result.id === 'photo' ? 'photo.jpg' : `${result.id}.png`, ...(result.id === 'crop' && result.cropCorners ? { straightenedImage: 'crop-straightened.png' } : {}) } : {}) })) };
  }
  async function copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(report(), null, 2)); setMessage('Vision report copied.'); }
    catch { setMessage('Clipboard unavailable.'); }
  }
  async function saveJson() {
    if (!folder || !results.length) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      const path = await saveDiagnosticJson(folder, config.model, checkedAt, 'vision', report());
      setMessage(`Saved to ${path}`);
      showToast('Vision diagnostic JSON saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function save() {
    if (!folder || !results.length) return;
    setMessage('Saving vision report…');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      const stamp = checkedAt.replace(/[:.]/g, '-');
      const directory = `models/diagnostics/${config.model.split('/').pop()?.replace(/\.gguf$/i, '')}-${stamp}`;
      for (const item of fixtures) await writeBlob(folder, `${directory}/${item.id === 'photo' ? 'photo.jpg' : `${item.id}.png`}`, item.blob);
      const cropResult = results.find(item => item.id === 'crop' && item.cropCorners);
      const cropFixture = fixtures.find(item => item.id === 'crop');
      if (cropResult?.cropCorners && cropFixture) await writeBlob(folder, `${directory}/crop-straightened.png`, await straightenCrop(cropFixture.blob, cropResult.cropCorners));
      await writeBlob(folder, `${directory}/report.json`, new Blob([JSON.stringify(report(true), null, 2)], { type: 'application/json' }));
      setMessage(`Saved to ${directory}/`);
      showToast('Vision report and test images saved to the workspace.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <>
    <button className="button secondary compact" type="button" disabled={disabled || !folder || !config.model || !projector} title={!projector ? 'No vision projector is configured for this model.' : undefined} onClick={() => void open()}>Vision tests</button>
    <dialog ref={dialog} className="model-diagnostics-dialog vision-diagnostics-dialog" aria-label="Vision diagnostics">
      <div className="diagnostic-heading"><h2>Vision tests</h2><span>{fixtures.length} images</span></div>
      {projector ? <div className="vision-projector"><span>{projectorPresent ? 'Projector ready' : projectorActive ? 'Downloading projector' : projectorQueued ? download.queuePaused ? 'Projector paused' : 'Projector queued' : projectorPartial ? 'Projector paused' : 'Projector needed'} · {(projector.bytes / 1e9).toFixed(2)} GB</span>{!projectorPresent && !projectorActive && <button className="button secondary compact" type="button" disabled={busy || projectorQueued && !download.queuePaused} onClick={() => void queueProjector()}>{projectorQueued ? download.queuePaused ? 'Resume' : 'Queued' : projectorPartial ? 'Resume' : 'Download'}</button>}{!projectorPresent && <label className="button secondary compact">Add from device<input type="file" accept=".gguf" hidden disabled={busy || projectorActive} onChange={event => { void importProjector(event.target.files?.[0]); event.target.value = ''; }}/></label>}<a href={projector.source} target="_blank" rel="noreferrer">Source</a>{projectorActive && download.progress && <progress value={download.progress.bytes} max={download.progress.total} aria-label="Vision projector download progress"/>}</div>
        : <p className="muted">No matching vision projector is configured for this model. Image recognition cannot be tested with the text GGUF alone.</p>}
      <div className="model-diagnostics-actions"><button className="button primary compact" type="button" disabled={busy || preparing || !projectorPresent || !fixtures.length} onClick={() => void run()}>{busy ? 'Working…' : 'Run vision tests'}</button>{busy && controller.current && <button className="button danger compact" type="button" disabled={controller.current.signal.aborted} onClick={() => controller.current?.abort()}>Stop</button>}<button className="button secondary compact" type="button" disabled={!results.length} onClick={() => void copy()}>Copy JSON</button><button className="button secondary compact" type="button" disabled={!results.length || busy} onClick={() => void saveJson()}>Save JSON</button><button className="button secondary compact" type="button" disabled={!results.length || busy} onClick={() => void save()}>Save with images</button><button className="button secondary compact" type="button" onClick={() => dialog.current?.close()}>Close</button></div>
      {message && <p role="status" className="vision-status">{message}</p>}
      {busy && <progress aria-label="Vision tests finished" value={results.length} max={fixtures.length || 1}/>}
      <div className="vision-results">{fixtures.map((fixture, index) => { const result = results.find(item => item.id === fixture.id); const exploratory = ['faint', 'micro', 'lsb', 'photo'].includes(fixture.id); return <section key={fixture.id} className={`vision-result ${active === index ? 'active' : ''}`}><div className="vision-image-wrap"><img src={fixture.url} alt={`${fixture.title} test image`}/>{result?.cropCorners && <svg viewBox={`0 0 ${CROP_IMAGE_SIZE.width} ${CROP_IMAGE_SIZE.height}`} aria-label="Model selected crop corners"><polygon points={result.cropCorners.map(point => point.join(',')).join(' ')}/>{result.cropCorners.map(([x, y], corner) => <circle key={corner} cx={x} cy={y} r="5"/>)}</svg>}</div><div><h3>{result?.status === 'passed' ? '✅' : result?.status === 'failed' ? '❌' : result ? '❔' : '○'} {fixture.title}{exploratory && <small> · exploratory</small>}</h3><p><strong>Ask:</strong> {fixture.prompt}</p><p><strong>Expected:</strong> {fixture.expected}</p><div className="vision-output"><strong>Output:</strong><div className="diagnostic-rendered"><MarkdownContent>{result?.answer || (result ? result.detail : '—')}</MarkdownContent></div></div>{result?.cropCorners && <CropPreview image={fixture.blob} corners={result.cropCorners}/>}{result?.sizeResults && <div className="vision-size-results" aria-label="Words read at each font size">{result.sizeResults.map(row => <span key={row.sizePx} title={`${row.words.join(', ')} · read: ${row.matched.join(', ') || 'none'}`}>{row.sizePx}px <strong>{row.matched.length}/2</strong></span>)}</div>}{result?.keywordResults && <div className="vision-keywords" aria-label="Photo details mentioned">{(['Obvious', 'Detailed', 'Subtle'] as const).map(level => <div key={level}><strong>{level}</strong><span>{result.keywordResults!.filter(item => item.difficulty === level).map(item => <span key={item.label} title={item.matched ? 'Mentioned' : 'Not mentioned'}>{item.matched ? '✅' : '○'} {item.label}</span>)}</span></div>)}</div>}{result && <p className="muted">{result.detail}{result.outputTokens !== undefined && ` · ${result.outputTokens} output tokens`}</p>}</div></section>; })}</div>
    </dialog>
  </>;
}
