import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Gauge, X } from 'lucide-react';
import type { AIConfig } from './ai.ts';
import { browserContextLimit, browserContextWindow } from './browserContext.ts';
import { promptForConversation, systemPromptCharBudget } from './harnessContext.ts';
import { chatIdentity, createConversation, estimatedTokens, type ConversationMeta, type HarnessManifest, type HarnessMessage, type HarnessProject, type MemoryRecord } from './harnessData.ts';
import { projectWithGuide } from './harnessProjectGuide.ts';
import type { HarnessStore } from './harnessStore.ts';

export default function HarnessContextInspector({ store, meta, project, manifest, memories, config, selectedConfig, profiles, onSelectProfile, onUpdateProfile, compactionAt, onCompactionAtChange, draft, folder }: {
  store: HarnessStore;
  meta: ConversationMeta | null;
  project: HarnessProject;
  manifest: HarnessManifest;
  memories: MemoryRecord[];
  config: AIConfig;
  selectedConfig: AIConfig;
  profiles: AIConfig[];
  onSelectProfile: (id: string) => void;
  onUpdateProfile: (next: AIConfig) => void;
  compactionAt: number;
  onCompactionAtChange: (value: number) => void;
  draft: string;
  folder: FileSystemDirectoryHandle | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [active, setActive] = useState<HarnessMessage[]>([]);
  const [activeLoaded, setActiveLoaded] = useState(!meta);
  const [guidedProject, setGuidedProject] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currentMeta = meta || createConversation(project.id);

  useEffect(() => {
    let current = true;
    if (!meta) { setActive([]); setActiveLoaded(true); return; }
    setActiveLoaded(false);
    void store.messages(meta, meta.activeFrom).then(messages => {
      if (current) { setActive(messages); setActiveLoaded(true); }
    }).catch(() => { if (current) setActiveLoaded(false); });
    return () => { current = false; };
  }, [store, meta?.id, meta?.messageCount, meta?.activeFrom]);

  async function open() {
    const current = ++request.current;
    setError('');
    setBusy(true);
    dialog.current?.showModal();
    try {
      const [messages, guide] = await Promise.all([
        meta ? store.messages(meta, meta.activeFrom) : Promise.resolve([]),
        projectWithGuide(folder, project),
      ]);
      if (current === request.current && dialog.current?.open) { setActive(messages); setActiveLoaded(true); setGuidedProject(guide); }
    } catch (cause) {
      if (current === request.current && dialog.current?.open) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  function close() { request.current++; dialog.current?.close(); setBusy(false); }

  const contextWindow = config.provider === 'browser' ? browserContextWindow(config.model, config.contextWindow) : config.contextWindow;
  const outputReserve = Math.min(config.maxOutputTokens, contextWindow);
  const inputBudget = Math.max(1, contextWindow - outputReserve - 384);
  const system = promptForConversation(guidedProject, currentMeta, memories, draft, chatIdentity(manifest, project), '', true, '', systemPromptCharBudget(config));
  const promptTokens = estimatedTokens(system);
  const turnTokens = active.reduce((total, message) => total + estimatedTokens(message.content), 0);
  const used = promptTokens + turnTokens + estimatedTokens(draft);
  const percent = Math.round(used / inputBudget * 100);
  const compactionPoint = Math.floor(inputBudget * compactionAt / 100);
  const selectedContext = selectedConfig.provider === 'browser' ? browserContextWindow(selectedConfig.model, selectedConfig.contextWindow) : selectedConfig.contextWindow;
  const maximumOutput = Math.max(128, Math.min(16384, selectedContext - 512));
  function updateContext(value: number) {
    const next = selectedConfig.provider === 'browser'
      ? browserContextWindow(selectedConfig.model, value)
      : Math.max(1024, Math.min(1_048_576, Math.floor(value)));
    onUpdateProfile({ ...selectedConfig, contextWindow: next, maxOutputTokens: Math.min(selectedConfig.maxOutputTokens, Math.max(128, next - 512)) });
  }
  function updateOutput(value: number) {
    onUpdateProfile({ ...selectedConfig, maxOutputTokens: Math.max(128, Math.min(maximumOutput, Math.floor(value))) });
  }
  return <>
    <button type="button" className="harness-compose-context" onClick={() => void open()} aria-label="Model and context settings" title="Model and context settings" style={{ '--context-fill': `${activeLoaded ? Math.min(100, Math.max(0, percent)) : 0}%` } as CSSProperties}>
      <Gauge size={14} aria-hidden="true"/><span>{activeLoaded ? `${percent}%` : '…'}</span>
    </button>
    <dialog ref={dialog} className="harness-dialog harness-context-dialog" aria-label="Model and context settings" onCancel={() => { request.current++; setBusy(false); }}>
      <div className="harness-chapter-dialog-head"><div><span className="harness-overline">CHAT SETTINGS</span><h2>Model & context</h2></div><button className="harness-icon" onClick={close} aria-label="Close model and context settings"><X size={17}/></button></div>
      {error && <p role="alert" className="harness-git-error">{error}</p>}
      <div className="harness-context-controls">
        <label>Model<select aria-label="Chat model profile" value={selectedConfig.id} onChange={event => onSelectProfile(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label>Thinking<select aria-label="Chat thinking mode" value={selectedConfig.provider === 'browser' ? selectedConfig.browserThinkingMode || 'none' : selectedConfig.effort} onChange={event => onUpdateProfile(selectedConfig.provider === 'browser' ? { ...selectedConfig, browserThinkingMode: event.target.value as AIConfig['browserThinkingMode'] } : { ...selectedConfig, effort: event.target.value as AIConfig['effort'] })}><option value="none">None</option>{selectedConfig.provider === 'browser' ? <><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option></> : <><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option><option value="default">Default</option></>}</select></label>
        <label>Max output <span>{selectedConfig.maxOutputTokens.toLocaleString()} tokens</span><input type="range" min={7} max={Math.max(7, Math.floor(Math.log2(maximumOutput)))} step={1} value={Math.min(Math.floor(Math.log2(maximumOutput)), Math.max(7, Math.round(Math.log2(selectedConfig.maxOutputTokens))))} onChange={event => updateOutput(2 ** Number(event.target.value))}/></label>
        <label>Context <span>{selectedContext.toLocaleString()} tokens</span><input type="range" min={1024} max={selectedConfig.provider === 'browser' ? browserContextLimit(selectedConfig.model) : Math.max(32768, selectedContext)} step={1024} value={selectedContext} onChange={event => updateContext(Number(event.target.value))}/></label>
        <label>Compact at <span>{compactionAt}% of input budget</span><input type="range" min={60} max={95} step={1} value={compactionAt} onChange={event => onCompactionAtChange(Number(event.target.value))}/></label>
      </div>
      {busy ? <p className="harness-muted" role="status">Reading active turns…</p> : <>
        <div className="harness-context-meter"><div><strong>{used.toLocaleString()} estimated input tokens</strong><span>{inputBudget.toLocaleString()} available · {outputReserve.toLocaleString()} reserved for output</span></div><progress value={Math.min(used, inputBudget)} max={inputBudget}/></div>
        <div className="harness-context-stats"><span><strong>{active.length}</strong> active turns</span><span><strong>{currentMeta.activeFrom}</strong> archived turns</span><span><strong>{currentMeta.segments.length}</strong> saved parts</span></div>
        <p className="harness-muted">Compaction starts near {compactionPoint.toLocaleString()} input tokens. File excerpts, history recall, and tools use more room; estimates can differ from the model's tokenizer.</p>
        {currentMeta.contextSummary && <section className="harness-context-summary"><h3>Carried forward</h3><p>{currentMeta.contextSummary}</p></section>}
        <details className="harness-context-prompt"><summary>Base instructions sent to the model</summary><pre>{system}</pre></details>
      </>}
      <div className="harness-chapter-dialog-actions"><button className="harness-secondary" onClick={close}>Close</button></div>
    </dialog>
  </>;
}
