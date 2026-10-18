import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleHelp } from 'lucide-react';
import MarkdownContent from './MarkdownContent';
import type { AIConfig } from './ai';
import { catalogModelForPath, assertModelLicenseFiles } from './modelLicenses';
import { getBrowserModelStatus, getLoadedBrowserMetadata, isBrowserModelLoadedFrom, loadBrowserModel, probeBrowserFeatures, subscribeBrowserModel, type BrowserProbeProgress, type BrowserProbeResult } from './browserModel';
import { ensureWritableFolder, readBlob } from './storage';
import { saveDiagnosticJson } from './diagnosticReports';
import { showToast } from './toastStore';
import { GRANITE_40_WARNING, isKnownIncompatibleGranite } from './modelCompatibility';
import { browserThinkingBudget } from './browserThinking';
import { detectThinkingSpillover } from './thinkingSpillover';
import DiagnosticTokenGraph from './DiagnosticTokenGraph';
import VisionDiagnostics from './VisionDiagnostics';
import { recordCapability } from './capabilityLedger';
import { NEEDLE_MODEL_PATHS, type NeedleVersion } from './needleAssets';
import NeedleModelDiagnostics from './NeedleModelDiagnostics';
import { GGUF_SCORING_VERSION } from './ggufReportRescore';
import { acquireModel } from './harnessLease.ts';

const DiagnosticDetail = lazy(() => import('./DiagnosticDetail'));

type Probe = Awaited<ReturnType<typeof probeBrowserFeatures>>;
type Report = {
  file: string; checkedAt: string; catalog: Record<string, unknown> | null;
  observed: { fileBytes?: number; licenseFiles?: string; loadedContextTokens?: number; loadedThinkingBudgetTokens?: number; trainingContextTokens?: number; metadataName?: string; metadataArchitecture?: string; metadataParameterCount?: string; metadataSizeLabel?: string };
  browserTests?: Probe; error?: string; scoringVersion?: number;
};

type Props = { config: AIConfig; folder: FileSystemDirectoryHandle | null; disabled?: boolean; openRequest?: { path: string; token: number; kind: 'text' | 'vision' } | null; onOpenRequestHandled?: () => void };
export default function ModelDiagnostics(props: Props) {
  const needle = (Object.entries(NEEDLE_MODEL_PATHS) as [NeedleVersion, string][]).find(([, path]) => path === props.config.model)?.[0];
  return needle ? <NeedleModelDiagnostics {...props} version={needle}/> : <GgufModelDiagnostics {...props}/>;
}

function GgufModelDiagnostics({ config, folder, disabled = false, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const reasoningPane = useRef<HTMLDivElement>(null);
  const followReasoning = useRef(true);
  const outputPane = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const testController = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tokenProgress, setTokenProgress] = useState<BrowserProbeProgress | null>(null);
  const [testRuns, setTestRuns] = useState<BrowserProbeProgress[]>([]);
  const [selectedTestIndex, setSelectedTestIndex] = useState(0);
  const latestTestIndex = useRef(0);
  const [testResults, setTestResults] = useState<BrowserProbeResult[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [detail, setDetail] = useState<{ title: string; value: unknown } | null>(null);
  const [following, setFollowing] = useState(true);
  const modelStatus = useSyncExternalStore(subscribeBrowserModel, getBrowserModelStatus);
  const catalog = catalogModelForPath(config.model);
  const thinkingBudget = browserThinkingBudget(config);
  const selectedProgress = testRuns[selectedTestIndex - 1];
  useEffect(() => {
    if (!openRequest || openRequest.path !== config.model || !folder || disabled || testController.current) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    if (openRequest.kind === 'text') { onOpenRequestHandled?.(); void inspect(); }
  }, [openRequest?.token, config.model, folder, disabled]);
  useEffect(() => {
    if (!busy || !tokenProgress?.testIndex) return;
    const started = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy, tokenProgress?.testIndex]);
  useLayoutEffect(() => {
    if (followReasoning.current && reasoningPane.current) reasoningPane.current.scrollTop = reasoningPane.current.scrollHeight;
  }, [selectedProgress?.reasoningText, selectedTestIndex]);
  useLayoutEffect(() => {
    if (followOutput.current && outputPane.current) outputPane.current.scrollTop = outputPane.current.scrollHeight;
  }, [selectedProgress?.responseText, selectedTestIndex]);
  function onReasoningScroll() {
    const pane = reasoningPane.current;
    if (!pane) return;
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
    followReasoning.current = atBottom;
    setFollowing(atBottom);
  }
  function onOutputScroll() {
    const pane = outputPane.current;
    if (pane) followOutput.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
  }
  async function inspect() {
    if (!folder || !config.model || testController.current) return;
    if (isKnownIncompatibleGranite(config.model)) return;
    const controller = new AbortController();
    testController.current = controller;
    setBusy(true);
    setStep('Checking files…');
    setTokenProgress(null);
    setTestRuns([]);
    setSelectedTestIndex(0);
    latestTestIndex.current = 0;
    setTestResults([]);
    followReasoning.current = true;
    followOutput.current = true;
    setFollowing(true);
    const next: Report = {
      file: config.model, checkedAt: new Date().toISOString(), scoringVersion: GGUF_SCORING_VERSION,
      catalog: catalog ? { model: catalog.family, company: catalog.company, country: catalog.country, companyUrl: catalog.companyUrl, version: catalog.version, parametersB: catalog.parameters, quantization: catalog.quantization, fileBytes: catalog.bytes, publishedContextTokens: catalog.contextTokens, tools: catalog.toolUse, thinking: catalog.thinking, license: catalog.license, source: catalog.source, licenseUrl: catalog.licenseUrl } : null,
      observed: {},
    };
    setReport(next);
    let release: (() => void) | undefined;
    try {
      setStep('Waiting for model…');
      release = await acquireModel(`diagnostics:text:${config.model}`, controller.signal);
      next.observed.fileBytes = (await readBlob(folder, config.model)).size;
      void recordCapability(folder, config.model, catalog?.label || config.model, 'fileSize', catalog && next.observed.fileBytes !== catalog.bytes ? 'failed' : 'passed', `${next.observed.fileBytes} bytes measured${catalog ? `; ${catalog.bytes} bytes listed` : ''}`, next.observed.fileBytes).catch(error => setStep(`Could not save capability result: ${error}`));
      try { await assertModelLicenseFiles(folder, config.model); next.observed.licenseFiles = 'Present and matched'; }
      catch (error) { next.observed.licenseFiles = error instanceof Error ? error.message : String(error); }
      void recordCapability(folder, config.model, catalog?.label || config.model, 'license', next.observed.licenseFiles === 'Present and matched' ? 'passed' : 'failed', next.observed.licenseFiles, next.observed.fileBytes).catch(error => setStep(`Could not save capability result: ${error}`));
      if (!isBrowserModelLoadedFrom(folder, config.model, config.contextWindow, thinkingBudget)) {
        setStep('Loading the model…');
        await loadBrowserModel(folder, config.model, config.contextWindow, thinkingBudget);
      }
      const loaded = getBrowserModelStatus();
      const metadata = getLoadedBrowserMetadata();
      next.observed.loadedContextTokens = loaded.contextWindow;
      next.observed.loadedThinkingBudgetTokens = loaded.thinkingBudgetTokens;
      next.observed.trainingContextTokens = metadata?.hparams.nCtxTrain;
      next.observed.metadataName = metadata?.meta['general.name'];
      next.observed.metadataArchitecture = metadata?.meta['general.architecture'];
      next.observed.metadataParameterCount = metadata?.meta['general.parameter_count'];
      next.observed.metadataSizeLabel = metadata?.meta['general.size_label'];
      void recordCapability(folder, config.model, catalog?.label || config.model, 'metadata', metadata?.meta['general.architecture'] ? 'passed' : 'inconclusive', `${next.observed.metadataName || 'Name unavailable'} · ${next.observed.metadataArchitecture || 'Architecture unavailable'}`, next.observed.fileBytes).catch(error => setStep(`Could not save capability result: ${error}`));
      void recordCapability(folder, config.model, catalog?.label || config.model, 'context', (loaded.contextWindow || 0) > 0 ? 'passed' : 'inconclusive', `${loaded.contextWindow || 0} tokens loaded; ${metadata?.hparams.nCtxTrain || 0} training tokens`, next.observed.fileBytes).catch(error => setStep(`Could not save capability result: ${error}`));
      setReport({ ...next, observed: { ...next.observed } });
      if (controller.signal.aborted) throw new DOMException('Tests stopped.', 'AbortError');
      next.browserTests = await probeBrowserFeatures(config.model, progress => {
        setStep(progress.step);
        setTokenProgress(progress);
        setTestRuns(current => { const updated = [...current]; updated[progress.testIndex - 1] = progress; return updated; });
        if (latestTestIndex.current !== progress.testIndex) {
          latestTestIndex.current = progress.testIndex;
          followReasoning.current = true;
          followOutput.current = true;
          setFollowing(true);
          setSelectedTestIndex(progress.testIndex);
        }
      }, config.maxOutputTokens, result => {
        setTestResults(current => [...current.filter(item => item.key !== result.key), result]);
        void recordCapability(folder, config.model, catalog?.label || config.model, result.key, result.status, result.detail, next.observed.fileBytes).catch(error => setStep(`Could not save capability result: ${error}`));
      }, controller.signal);
    } catch (error) { next.error = controller.signal.aborted ? 'Tests stopped.' : error instanceof Error ? error.message : String(error); }
    finally { release?.(); testController.current = null; setReport({ ...next, observed: { ...next.observed } }); setStep(''); setBusy(false); }
  }
  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setStep('Report copied.'); }
    catch { setStep('Clipboard unavailable. Select the report below to copy it.'); }
  }
  async function save() {
    if (!folder || !report) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('The workspace folder is not writable.');
      const path = await saveDiagnosticJson(folder, report.file, report.checkedAt, 'text', report);
      setStep(`Saved to ${path}`);
      showToast('Model diagnostic report saved.');
    } catch (error) { setStep(error instanceof Error ? error.message : String(error)); }
  }
  const testLabels: { key: BrowserProbeResult['key']; label: string }[] = [
    { key: 'text', label: 'Text' }, { key: 'tools', label: 'Tools' }, { key: 'reasoningTask', label: 'Reasoning task' },
    ...(catalog?.thinking === 'documented' ? [] : [{ key: 'promptedSteps' as const, label: 'Prompted steps' }]),
    { key: 'thinking', label: 'Thinking mode' },
  ];
  const selectedTest = testLabels[selectedTestIndex - 1];
  const selectedResult = testResults.find(item => item.key === selectedTest?.key);
  const selectedTrace = selectedResult?.trace;
  const finalMessage = (selectedTrace?.output as { message?: { content?: string | null; reasoning_content?: string | null } } | undefined)?.message;
  const selectedReasoning = selectedProgress?.reasoningText || finalMessage?.reasoning_content || '';
  const selectedOutput = selectedProgress?.responseText || finalMessage?.content || '';
  const selectedCounts = selectedTrace?.tokenUsage || selectedProgress;
  const selectedRunning = busy && tokenProgress?.testIndex === selectedTestIndex && !selectedResult;
  const thinkingAnswer = testResults.find(item => item.key === 'thinkingAnswer');
  const displayStep = step === 'Loading the model…' && modelStatus.state === 'loading' ? modelStatus.message : step;
  const liveSpillover = selectedTest?.key === 'thinking' && selectedRunning ? detectThinkingSpillover({
    reasoning: selectedReasoning, visible: selectedOutput,
    reasoningTokens: selectedCounts?.reasoningTokens || 0, thinkingBudgetTokens: thinkingBudget,
  }) : null;
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || !config.model || busy || disabled || isKnownIncompatibleGranite(config.model)} onClick={() => { if (report?.file !== config.model) { setReport(null); setTestRuns([]); setTestResults([]); setTokenProgress(null); setStep(''); } setSelectedTestIndex(0); dialog.current?.showModal(); }}>Inspect features</button>
    <dialog ref={dialog} className="model-diagnostics-dialog" aria-labelledby="model-diagnostics-title">
      <div className="diagnostic-heading"><h2 id="model-diagnostics-title">Model diagnostics</h2><button className="model-limit-info" type="button" aria-label="About model diagnostics" title="About model diagnostics" onClick={() => helpDialog.current?.showModal()}><CircleHelp size={17}/></button></div>
      <dialog ref={helpDialog} className="model-limit-dialog" aria-label="About model diagnostics"><h2>About diagnostics</h2><p>Catalog details include publisher claims and past browser tests. File details and test results are checked on this device. An inconclusive test does not prove a feature is absent.</p><p>Tests use the profile's output limit. Select Light, Medium, or Heavy in the profile to test a thinking budget. The output bar shows thinking in purple and visible response in green; its marker shows the selected thinking cap.</p><p>A spillover warning means the model appears to have continued reasoning in its visible answer after reaching the thinking cap. That answer is not scored.</p><p>Live token counts are estimates until the model returns final usage. Token speed measures generated output after the first streamed token.</p><form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
      {isKnownIncompatibleGranite(config.model) && <p className="model-error" role="alert">{GRANITE_40_WARNING}</p>}
      <div className="model-diagnostics-actions"><button className="button primary compact" type="button" disabled={busy || !folder} onClick={() => void inspect()}>{busy ? 'Testing…' : 'Run tests'}</button><VisionDiagnostics config={config} folder={folder} disabled={busy} openRequest={openRequest?.kind === 'vision' ? openRequest : null} onOpenRequestHandled={onOpenRequestHandled}/>{busy && <button className="button danger compact" type="button" disabled={testController.current?.signal.aborted} onClick={() => { testController.current?.abort(); setStep('Stopping tests…'); }}>Stop tests</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => setDetail({ title: 'Report', value: report })}>View report</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copy()}>Copy JSON</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void save()}>Save JSON</button><button className="button secondary compact" type="button" onClick={() => dialog.current?.close()}>Close</button></div>
      {busy && (displayStep || tokenProgress) && <div className="diagnostic-progress" role="status">
        {tokenProgress ? <div className="diagnostic-progress-row"><strong>Tests</strong><progress aria-label="Overall diagnostic tests finished" value={tokenProgress.finishedTests} max={tokenProgress.testCount}/><span className="diagnostic-count">{tokenProgress.finishedTests}/{tokenProgress.testCount}</span></div>
          : <div className="diagnostic-progress-meta"><span>{displayStep}</span><progress aria-label="Model diagnostics in progress"/></div>}
        {tokenProgress && <div className="diagnostic-progress-meta"><span>{displayStep || 'Tests finished'}</span><span>{busy ? `${tokenProgress.outputTokensPerSecond.toFixed(1)} tok/s · ${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}` : 'Finished'}</span></div>}
      </div>}
      {!busy && step && <p className="muted" role="status">{step}</p>}
      <div className="diagnostic-tabs" role="tablist" aria-label="Model diagnostic tests"><button id="diagnostic-tab-main" type="button" role="tab" aria-selected={selectedTestIndex === 0} aria-controls="diagnostic-test-panel" className={selectedTestIndex === 0 ? 'active' : ''} onClick={() => setSelectedTestIndex(0)}>Overview</button>{testLabels.map(({ key, label }, index) => {
        if (!testRuns[index]) return null;
        const result = testResults.find(item => item.key === key);
        const running = busy && tokenProgress?.testIndex === index + 1 && !result;
        const mark = result?.warning === 'thinking-spillover' ? '⚠️' : result?.status === 'passed' ? '✅' : result?.status === 'failed' ? '❌' : result?.status === 'inconclusive' ? '❔' : running ? '⏳' : '○';
        return <button key={key} id={`diagnostic-tab-${index + 1}`} type="button" role="tab" aria-selected={selectedTestIndex === index + 1} aria-controls="diagnostic-test-panel" className={selectedTestIndex === index + 1 ? 'active' : ''} onClick={() => { const current = tokenProgress?.testIndex === index + 1 && busy; followReasoning.current = current; followOutput.current = current; setFollowing(current); setSelectedTestIndex(index + 1); }}><span aria-hidden="true">{mark}</span> {label}</button>;
      })}</div>
      <div id="diagnostic-test-panel" className="diagnostic-tab-panel" role="tabpanel" aria-labelledby={selectedTestIndex === 0 ? 'diagnostic-tab-main' : `diagnostic-tab-${selectedTestIndex}`}>
        {selectedTestIndex === 0 ? <div className="diagnostic-overview">
          <strong>{config.model || 'No GGUF selected'}</strong>
          <dl>
            <dt>File</dt><dd>{report?.observed.fileBytes === undefined ? 'Not checked' : `${(report.observed.fileBytes / 1e9).toFixed(2)} GB measured`}{catalog && ` · ${catalog.quantization} · ${(catalog.bytes / 1e9).toFixed(2)} GB listed`}</dd>
            <dt>Model</dt><dd>{catalog ? `${catalog.family} ${catalog.version} · ${catalog.parameters}B parameters` : 'Custom GGUF'}</dd>
            <dt>Developer</dt><dd>{catalog ? <><a href={catalog.companyUrl} target="_blank" rel="noreferrer">{catalog.company}</a> · {catalog.country}</> : 'Unknown'}</dd>
            <dt>License</dt><dd>{catalog?.license || 'Custom license'} · {report?.observed.licenseFiles || 'Not checked'}{catalog && <> · <a href={catalog.licenseUrl} target="_blank" rel="noreferrer">Terms</a></>}</dd>
            <dt>Context</dt><dd>{report?.observed.loadedContextTokens ? `${report.observed.loadedContextTokens.toLocaleString()} loaded` : 'Not loaded'}{report?.observed.trainingContextTokens ? ` · ${report.observed.trainingContextTokens.toLocaleString()} GGUF` : ''}{catalog && ` · ${catalog.contextTokens.toLocaleString()} published`}</dd>
            <dt>Thinking cap</dt><dd>{report?.observed.loadedThinkingBudgetTokens ? `${report.observed.loadedThinkingBudgetTokens.toLocaleString()} loaded` : thinkingBudget ? `${thinkingBudget.toLocaleString()} selected` : 'None selected'}</dd>
            <dt>GGUF</dt><dd>{report?.observed.metadataName || 'Not checked'}{report?.observed.metadataArchitecture && ` · ${report.observed.metadataArchitecture}`}{report?.observed.metadataParameterCount && ` · ${report.observed.metadataParameterCount} parameters`}{!report?.observed.metadataParameterCount && report?.observed.metadataSizeLabel && ` · ${report.observed.metadataSizeLabel}`}</dd>
          </dl>
          <h3>Tests</h3><div className="diagnostic-overview-tests">{testLabels.map(({ key, label }, index) => { const result = testResults.find(item => item.key === key); return <div key={key}><span>{label}</span><strong>{result?.warning === 'thinking-spillover' ? '⚠️ Reasoning spillover' : result?.status === 'passed' ? result.argumentAccuracy === 'failed' ? '✅ Tool call · ⚠️ Arguments' : result.answerAccuracy === 'failed' ? '✅ Format · ⚠️ Answer' : '✅ Passed' : result?.status === 'failed' ? '❌ Failed' : result?.status === 'inconclusive' ? '❔ Inconclusive' : testRuns[index] ? busy ? '⏳ Running' : '○ Stopped' : '○ Not run'}</strong></div>; })}</div>
        </div> : selectedProgress && selectedCounts ? <>
          <DiagnosticTokenGraph counts={selectedCounts} thinkingBudget={selectedTest?.key === 'thinking' ? thinkingBudget : 0}/>
          <div className="diagnostic-progress-row"><strong>Prompt</strong><progress aria-label="Prompt tokens processed" value={selectedProgress.promptProcessed} max={selectedProgress.promptTotal || undefined}/><span className="diagnostic-count diagnostic-prompt-count"><span>{selectedProgress.promptProcessed.toLocaleString()}/{selectedProgress.promptTotal ? selectedProgress.promptTotal.toLocaleString() : '—'}</span>{selectedProgress.promptCachedTokens ? <span>{selectedProgress.promptCachedTokens.toLocaleString()} cached</span> : null}</span></div>
          <p className="diagnostic-test-outcome" aria-live="polite">{selectedResult?.detail || liveSpillover && `⚠️ ${liveSpillover.detail}` || (selectedRunning ? 'Running…' : 'Waiting to run.')}{selectedTest?.key === 'thinking' && thinkingAnswer?.detail && <> <strong>{thinkingAnswer.warning === 'thinking-spillover' ? '⚠️' : thinkingAnswer.status === 'passed' ? '✅' : thinkingAnswer.status === 'failed' ? '❌' : '❔'} Thinking answer:</strong> {thinkingAnswer.detail}</>}</p>
          <div className="diagnostic-live-transcript">
            <section className="diagnostic-live-part"><h3>Prompt</h3><div className="diagnostic-live-prompt">{selectedProgress.input.messages.map((message, index) => <div className="diagnostic-prompt-message" key={index}><strong>{message.role}</strong><div className="diagnostic-rendered"><MarkdownContent>{typeof message.content === 'string' ? message.content : (message.content || []).map(part => part.type === 'text' ? part.text : '[image]').join('\n')}</MarkdownContent></div></div>)}{selectedProgress.input.tools?.map((tool, index) => <div className="diagnostic-prompt-message" key={`tool-${index}`}><strong>Tool: {tool.function.name}</strong><pre>{JSON.stringify(tool.function.parameters, null, 2)}</pre></div>)}<p className="diagnostic-live-options">Max output {selectedProgress.input.max_tokens.toLocaleString()}{selectedProgress.input.chat_template_kwargs?.enable_thinking ? ' · Thinking on' : ''}</p></div></section>
            <section className="diagnostic-live-part"><div className="diagnostic-live-heading"><h3>Thinking</h3>{!following && selectedRunning && <button className="button secondary compact" type="button" onClick={() => { followReasoning.current = true; setFollowing(true); if (reasoningPane.current) reasoningPane.current.scrollTop = reasoningPane.current.scrollHeight; }}>Latest ↓</button>}</div><div ref={reasoningPane} className="diagnostic-live-scroll" onScroll={onReasoningScroll}><div className="diagnostic-rendered"><MarkdownContent>{selectedReasoning || (selectedRunning ? 'Waiting for thinking output…' : 'No separate thinking output.')}</MarkdownContent></div></div></section>
            <section className="diagnostic-live-part"><h3>Output</h3><div ref={outputPane} className="diagnostic-live-scroll" onScroll={onOutputScroll}><div className="diagnostic-rendered"><MarkdownContent>{selectedOutput || (selectedRunning ? 'Waiting for output…' : 'No visible output.')}</MarkdownContent></div></div></section>
          </div>
        </> : <p className="muted">{busy && !tokenProgress ? step : 'Waiting to run.'}</p>}
      </div>
      {report?.error && <p className="model-error" role="alert">{report.error}</p>}
    </dialog>
    {detail && <Suspense fallback={null}><DiagnosticDetail title={detail.title} value={detail.value} onClose={() => setDetail(null)}/></Suspense>}
  </>;
}
