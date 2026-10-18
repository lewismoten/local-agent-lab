import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleHelp } from 'lucide-react';
import MarkdownContent from './MarkdownContent';
import type { AIConfig } from './ai';
import { getNeedleAssets, NEEDLE_LABELS, NEEDLE_LEGACY_MODEL_PATHS, NEEDLE_MODEL_ASSETS, NEEDLE_MODEL_PATHS, subscribeNeedleAssets, type NeedleVersion } from './needleAssets';
import { loadNeedle, needleLoaded, runNeedle } from './needleRuntime';
import { acquireModel, withModelLease } from './harnessLease.ts';
import { NEEDLE_TESTS, needleToolCalls, rescoreNeedleReport, runNeedleDiagnostics, type NeedleReport, type NeedleTestKey } from './needleDiagnostics';
import { loadLatestDiagnosticJson, saveDiagnosticJson } from './diagnosticReports';
import { ensureWritableFolder } from './storage';
import { showToast } from './toastStore';

const DiagnosticDetail = lazy(() => import('./DiagnosticDetail'));
const labels: Record<NeedleTestKey, string> = {
  fileSize: 'File size', license: 'License', text: 'Text', tools: 'Tools', reasoningTask: 'Reasoning task', thinking: 'Thinking mode',
};
const defaultTool = JSON.stringify([{ name: 'save_character', description: 'Save a named character.', parameters: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } }, required: ['name', 'role'] } }], null, 2);
type Props = {
  config: AIConfig;
  folder: FileSystemDirectoryHandle | null;
  version: NeedleVersion;
  disabled?: boolean;
  openRequest?: { path: string; token: number; kind: 'text' | 'vision' } | null;
  onOpenRequestHandled?: () => void;
};

function responseParts(output: string) {
  const tagged = output.match(/<think>([\s\S]*?)<\/think>/i);
  if (tagged) {
    const remaining = output.replace(tagged[0], '').trim();
    const call = remaining.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (call) {
      try { return { thinking: tagged[1].trim(), visible: JSON.stringify(JSON.parse(call[1]), null, 2), json: true }; }
      catch { return { thinking: tagged[1].trim(), visible: call[1].trim(), json: false }; }
    }
    return { thinking: tagged[1].trim(), visible: remaining, json: false };
  }
  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    const thinking = data.reasoning || data.thinking || data.reasoning_content;
    const visible = { ...data };
    delete visible.reasoning; delete visible.thinking; delete visible.reasoning_content;
    return { thinking: typeof thinking === 'string' ? thinking : '', visible: JSON.stringify(visible, null, 2), json: true };
  } catch { return { thinking: '', visible: output, json: false }; }
}

export default function NeedleModelDiagnostics({ folder, version, disabled = false, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const followCurrent = useRef(true);
  const [report, setReport] = useState<NeedleReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [customQuery, setCustomQuery] = useState('Save a character named Mira as the protagonist.');
  const [customTools, setCustomTools] = useState(defaultTool);
  const [customOutput, setCustomOutput] = useState('');
  const [customError, setCustomError] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const assets = useSyncExternalStore(subscribeNeedleAssets, getNeedleAssets);
  const path = NEEDLE_MODEL_PATHS[version];
  const weight = NEEDLE_MODEL_ASSETS[version][1];
  const available = !!folder && assets.folder === folder && assets.present[version];
  const selectedKey = NEEDLE_TESTS[selectedIndex - 1];
  const selected = selectedKey ? report?.tests[selectedKey] : undefined;
  const response = responseParts(selected?.output || '');

  useEffect(() => {
    let current = true;
    setReport(null); setProgress(0); setSelectedIndex(0); setMessage('');
    if (folder) void loadLatestDiagnosticJson<NeedleReport>(folder, path, 'text').then(saved => {
      if (current && !controller.current && (saved?.file === path || saved?.file === NEEDLE_LEGACY_MODEL_PATHS[version])) { setReport(rescoreNeedleReport(saved)); setProgress(Object.keys(saved.tests).length); }
    }).catch(() => {});
    return () => { current = false; };
  }, [folder, path]);

  async function run() {
    if (!folder || controller.current) return;
    const nextController = new AbortController();
    controller.current = nextController;
    followCurrent.current = true;
    setBusy(true); setProgress(0); setReport(null); setSelectedIndex(0); setMessage('Checking files…');
    let release: (() => void) | undefined;
    try {
      setMessage('Waiting for model…');
      release = await acquireModel(`diagnostics:needle:${version}`, nextController.signal);
      if (!await ensureWritableFolder(folder)) throw new Error('Allow workspace access to save diagnostics.');
      const result = await runNeedleDiagnostics(folder, version, (finished, total, key, partial) => {
        setProgress(finished); setReport(partial); setMessage(`${finished}/${total} checks finished`);
        if (followCurrent.current) setSelectedIndex(NEEDLE_TESTS.indexOf(key) + 1);
      }, nextController.signal);
      setReport(result);
      setMessage(result.error || `Diagnostics saved to ${result.savedPath}.`);
      showToast(result.error ? `${NEEDLE_LABELS[version]} diagnostics failed: ${result.error}` : `${NEEDLE_LABELS[version]} diagnostics complete.`, result.error ? 'error' : 'success');
    } catch (error) { setMessage(nextController.signal.aborted ? 'Tests stopped.' : error instanceof Error ? error.message : String(error)); }
    finally { release?.(); controller.current = null; setBusy(false); }
  }

  useEffect(() => {
    if (!openRequest || openRequest.path !== path || openRequest.kind !== 'text' || !folder || disabled || dialog.current?.open) return;
    dialog.current?.showModal();
    onOpenRequestHandled?.();
    void run();
  }, [openRequest?.token, path, folder, disabled]);

  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setMessage('Report copied.'); }
    catch { setMessage('Clipboard unavailable. Open the report to select its contents.'); }
  }
  async function save() {
    if (!folder || !report) return;
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow workspace access to save the report.');
      const savedPath = await saveDiagnosticJson(folder, path, report.checkedAt, 'text', report);
      setMessage(`Saved to ${savedPath}.`);
      showToast('Model diagnostic report saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function tryTool() {
    if (!folder) return;
    setCustomBusy(true); setCustomOutput(''); setCustomError('');
    try {
      const tools = JSON.parse(customTools) as unknown;
      if (!Array.isArray(tools) || !tools.length || tools.some(item => !item || typeof item.name !== 'string')) throw new Error('Tools must be a JSON array with named functions.');
      const output = await withModelLease(`diagnostics:needle-tool:${version}`, async () => {
        await loadNeedle(folder, version);
        return runNeedle(folder, version, customQuery, JSON.stringify(tools));
      });
      const calls = needleToolCalls(output);
      setCustomOutput(JSON.stringify({ calls, raw: (() => { try { return JSON.parse(output); } catch { return output; } })() }, null, 2));
    } catch (error) { setCustomError(error instanceof Error ? error.message : String(error)); }
    finally { setCustomBusy(false); }
  }

  return <>
    <button className="button secondary compact" type="button" disabled={!available || busy || disabled} onClick={() => { followCurrent.current = true; setSelectedIndex(0); dialog.current?.showModal(); }}>Inspect features</button>
    <dialog ref={dialog} className="model-diagnostics-dialog" aria-labelledby="model-diagnostics-title">
      <div className="diagnostic-heading"><h2 id="model-diagnostics-title">Model diagnostics</h2><button className="model-limit-info" type="button" aria-label="About model diagnostics" title="About model diagnostics" onClick={() => helpDialog.current?.showModal()}><CircleHelp size={17}/></button></div>
      <dialog ref={helpDialog} className="model-limit-dialog" aria-label="About Needle diagnostics"><h2>About diagnostics</h2><p>Needle uses a browser engine built for tool routing. These checks test text, structured tool calls, a reasoning answer, and a separate thinking segment. A failed or inconclusive check remains visible in the report.</p><p>The Needle engine returns each answer at once, so token streaming is unavailable.</p><form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
      <div className="model-diagnostics-actions"><button className="button primary compact" type="button" disabled={!available || busy} onClick={() => void run()}>{busy ? 'Testing…' : 'Run tests'}</button>{busy && <button className="button danger compact" type="button" disabled={controller.current?.signal.aborted} onClick={() => { controller.current?.abort(); setMessage('Stopping after the current check…'); }}>Stop tests</button>}<button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => setShowReport(true)}>View report</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copy()}>Copy JSON</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void save()}>Save JSON</button><button className="button secondary compact" type="button" onClick={() => dialog.current?.close()}>Close</button></div>
      {busy && <div className="diagnostic-progress" role="status"><div className="diagnostic-progress-row"><strong>Tests</strong><progress aria-label="Overall diagnostic tests finished" value={progress} max={NEEDLE_TESTS.length}/><span className="diagnostic-count">{progress}/{NEEDLE_TESTS.length}</span></div></div>}
      {message && <p className="muted" role="status">{message}</p>}
      <div className="diagnostic-tabs" role="tablist" aria-label="Model diagnostic tests"><button id="diagnostic-tab-main" type="button" role="tab" aria-selected={selectedIndex === 0} aria-controls="diagnostic-test-panel" className={selectedIndex === 0 ? 'active' : ''} onClick={() => { followCurrent.current = false; setSelectedIndex(0); }}>Overview</button>{NEEDLE_TESTS.map((key, index) => {
        const result = report?.tests[key];
        if (!result && (!busy || index > progress)) return null;
        const icon = result?.result === 'passed' ? '✅' : result?.result === 'failed' ? '❌' : result ? '❔' : '⏳';
        return <button key={key} id={`diagnostic-tab-${index + 1}`} type="button" role="tab" aria-selected={selectedIndex === index + 1} aria-controls="diagnostic-test-panel" className={selectedIndex === index + 1 ? 'active' : ''} onClick={() => { followCurrent.current = false; setSelectedIndex(index + 1); }}><span aria-hidden="true">{icon}</span> {labels[key]}</button>;
      })}</div>
      <div id="diagnostic-test-panel" className="diagnostic-tab-panel" role="tabpanel" aria-labelledby={selectedIndex === 0 ? 'diagnostic-tab-main' : `diagnostic-tab-${selectedIndex}`}>
        {selectedIndex === 0 ? <div className="diagnostic-overview"><strong>{path}</strong><dl><dt>File</dt><dd>{report?.tests.fileSize?.detail || `${(weight.bytes / 1e6).toFixed(1)} MB listed`}</dd><dt>Model</dt><dd>{NEEDLE_LABELS[version]} · {version === 'needle' ? '26M' : version === 'needle2' ? '45M' : '121M'} parameters</dd><dt>Engine</dt><dd>Needle browser engine · {folder && needleLoaded(folder, version) ? 'Loaded' : 'Not loaded'}</dd><dt>License</dt><dd>{report?.tests.license?.detail || 'Not checked'}</dd><dt>Context</dt><dd>{version === 'needle' ? '1,024' : version === 'needle2' ? '2,048' : '8,192'} published tokens</dd></dl><h3>Tests</h3><div className="diagnostic-overview-tests">{NEEDLE_TESTS.map(key => { const result = report?.tests[key]; return <div key={key}><span>{labels[key]}</span><strong>{result?.result === 'passed' ? result.argumentAccuracy === 'failed' ? '✅ Tool call · ⚠️ Arguments' : '✅ Passed' : result?.result === 'failed' ? '❌ Failed' : result ? '❔ Inconclusive' : busy ? '⏳ Pending' : '○ Not run'}</strong></div>; })}</div></div>
          : selected ? <><p className="diagnostic-test-outcome">{selected.detail}</p><div className="diagnostic-live-transcript"><section className="diagnostic-live-part"><h3>Prompt</h3><div className="diagnostic-live-prompt">{selected.input ? <><div className="diagnostic-rendered"><MarkdownContent>{selected.input.query}</MarkdownContent></div><pre>{JSON.stringify(selected.input.tools, null, 2)}</pre></> : 'No prompt for this file check.'}</div></section><section className="diagnostic-live-part"><h3>Thinking</h3><div className="diagnostic-live-scroll"><div className="diagnostic-rendered"><MarkdownContent>{response.thinking || 'No separate thinking output.'}</MarkdownContent></div></div></section><section className="diagnostic-live-part"><h3>Output</h3><div className="diagnostic-live-scroll">{response.json ? <pre>{response.visible}</pre> : <div className="diagnostic-rendered"><MarkdownContent>{response.visible || selected.error || 'No visible output.'}</MarkdownContent></div>}</div></section></div>{selectedKey === 'tools' && <details className="needle-custom-tool"><summary>Try another tool call</summary><label className="field"><span>Request</span><input value={customQuery} onChange={event => setCustomQuery(event.target.value)}/></label><label className="field"><span>Tools JSON</span><textarea rows={7} value={customTools} onChange={event => setCustomTools(event.target.value)} spellCheck={false}/></label><button className="button secondary compact" type="button" disabled={customBusy || busy || !assets.installed.engine || !assets.installed[version]} onClick={() => void tryTool()}>{customBusy ? 'Running…' : 'Run tool call'}</button>{customError && <p className="model-error" role="alert">{customError}</p>}{customOutput && <pre>{customOutput}</pre>}</details>}</> : <p className="muted">Waiting to run.</p>}
      </div>
      {report?.error && <p className="model-error" role="alert">{report.error}</p>}
    </dialog>
    {showReport && report && <Suspense fallback={null}><DiagnosticDetail title={`${NEEDLE_LABELS[version]} report`} value={report} onClose={() => setShowReport(false)}/></Suspense>}
  </>;
}
