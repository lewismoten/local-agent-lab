import { useEffect, useRef } from 'react';
import MarkdownContent from './MarkdownContent';
import { splitInlineReasoning } from './probeStream';
import DiagnosticTokenGraph from './DiagnosticTokenGraph';

type Props = { title: string; value: unknown; onClose: () => void };
type Data = Record<string, unknown>;
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '';

function Prompt({ input }: { input: unknown }) {
  const data = record(input);
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const tools = Array.isArray(data.tools) ? data.tools : [];
  return <section className="diagnostic-transcript-part"><h3>Prompt</h3>
    {messages.map((item, index) => { const message = record(item); return <div className="diagnostic-message" key={index}><strong>{string(message.role) || 'Message'}</strong><pre>{string(message.content) || 'Empty'}</pre></div>; })}
    {tools.length > 0 && <div className="diagnostic-message"><strong>Available tools</strong>{tools.map((item, index) => { const tool = record(record(item).function); return <pre key={index}>{string(tool.name)}{tool.description ? ` — ${string(tool.description)}` : ''}{tool.parameters ? `\n${JSON.stringify(tool.parameters, null, 2)}` : ''}</pre>; })}</div>}
    <p className="diagnostic-transcript-meta">{[
      data.max_tokens ? `Max output ${number(data.max_tokens)}` : '',
      data.tool_choice ? `Tool choice ${String(data.tool_choice)}` : '',
      record(data.chat_template_kwargs).enable_thinking ? 'Thinking requested' : '',
    ].filter(Boolean).join(' · ')}</p>
  </section>;
}

function Transcript({ trace }: { trace: unknown }) {
  const data = record(trace);
  const output = record(data.output);
  const message = record(output.message);
  const usage = record(output.usage);
  const rawContent = string(message.content);
  const inline = splitInlineReasoning(rawContent);
  const reasoning = string(message.reasoning_content) || inline.reasoning;
  const content = string(message.reasoning_content) ? rawContent : inline.response;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return <div className="diagnostic-transcript">
    <Prompt input={data.input}/>
    {reasoning && <section className="diagnostic-transcript-part"><h3>Thinking</h3><div className="diagnostic-rendered"><MarkdownContent>{reasoning}</MarkdownContent></div></section>}
    <section className="diagnostic-transcript-part"><h3>Output</h3><div className="diagnostic-rendered">{content ? <MarkdownContent>{content}</MarkdownContent> : calls.length ? null : <p>No visible output.</p>}{calls.map((call, index) => { const fn = record(record(call).function); return <div key={index} className="diagnostic-tool-call"><strong>Tool call: {string(fn.name)}</strong><pre>{string(fn.arguments)}</pre></div>; })}</div>
      <p className="diagnostic-transcript-meta">{[
        output.finishReason ? `Finish: ${String(output.finishReason)}` : '',
        usage.prompt_tokens !== undefined ? `Prompt ${number(usage.prompt_tokens)} tokens` : '',
        usage.completion_tokens !== undefined ? `Output ${number(usage.completion_tokens)} tokens` : '',
      ].filter(Boolean).join(' · ')}</p>
    </section>
    {string(data.error) && <p className="model-error">{string(data.error)}</p>}
  </div>;
}

function Test({ label, value, thinkingBudget = 0 }: { label: string; value: unknown; thinkingBudget?: number }) {
  const data = record(value);
  const conclusion = record(data.conclusion);
  const result = string(data.result || data.status);
  const usage = record(record(data.trace).tokenUsage);
  const counts = Number(usage.maxOutputTokens) > 0 ? {
    outputTokens: Number(usage.outputTokens) || 0,
    reasoningTokens: Number(usage.reasoningTokens) || 0,
    responseTokens: Number(usage.responseTokens) || 0,
    maxOutputTokens: Number(usage.maxOutputTokens),
    outputEstimated: usage.outputEstimated !== false,
  } : null;
  return <section className="diagnostic-report-test"><div className="diagnostic-report-test-heading"><h3>{label}</h3><strong>{result === 'confirmed' || result === 'observed' || result === 'passed' || result === 'correct' ? '✅' : result === 'not-passed' || result === 'incorrect' || result === 'failed' ? '❌' : '❔'} {result || 'Not tested'}</strong></div>
    {counts && <DiagnosticTokenGraph counts={counts} thinkingBudget={thinkingBudget}/>}
    {string(data.detail) && <p>{string(data.detail)}</p>}
    {string(conclusion.detail) && <p><strong>Answer:</strong> {string(conclusion.detail)}</p>}
    {data.trace ? <Transcript trace={data.trace}/> : <p>No transcript available.</p>}
  </section>;
}

function Report({ value }: { value: Data }) {
  const catalog = record(value.catalog);
  const observed = record(value.observed);
  const tests = record(value.browserTests);
  const entries = [
    ['text', 'Text'], ['tools', 'Tools'], ['reasoningTask', 'Reasoning task'],
    ['promptedSteps', 'Prompted steps'], ['thinking', 'Thinking mode'],
  ] as const;
  return <div className="diagnostic-report">
    <div className="diagnostic-report-summary"><strong>{string(value.file)}</strong><p>{[
      catalog.model && `${catalog.model} ${catalog.version || ''}`,
      catalog.parametersB && `${catalog.parametersB}B parameters`,
      catalog.quantization,
      observed.fileBytes && `${(Number(observed.fileBytes) / 1e9).toFixed(2)} GB`,
    ].filter(Boolean).join(' · ')}</p><p>{[
      catalog.company && `${catalog.company}${catalog.country ? ` (${catalog.country})` : ''}`,
      catalog.license && `License: ${catalog.license}`,
      observed.metadataArchitecture && `Architecture: ${observed.metadataArchitecture}`,
    ].filter(Boolean).join(' · ')}</p><p>{[
      observed.licenseFiles && `License: ${observed.licenseFiles}`,
      observed.loadedContextTokens && `Loaded context: ${number(observed.loadedContextTokens)}`,
      observed.trainingContextTokens && `GGUF context: ${number(observed.trainingContextTokens)}`,
      catalog.publishedContextTokens && `Published context: ${number(catalog.publishedContextTokens)}`,
    ].filter(Boolean).join(' · ')}</p></div>
    {entries.filter(([key]) => tests[key]).map(([key, label]) => <Test key={key} label={label} value={tests[key]} thinkingBudget={key === 'thinking' ? Number(observed.loadedThinkingBudgetTokens) || 0 : 0}/>)}
    {string(value.error) && <p className="model-error">{string(value.error)}</p>}
  </div>;
}

function NeedleReport({ value }: { value: Data }) {
  const tests = record(value.tests);
  const labels: Record<string, string> = { fileSize: 'File size', license: 'License', text: 'Text', tools: 'Tools', reasoningTask: 'Reasoning task', thinking: 'Thinking mode' };
  return <div className="diagnostic-report"><div className="diagnostic-report-summary"><strong>{string(value.file)}</strong><p>{string(value.runtime)} · {string(value.checkedAt)}</p>{string(value.savedPath) && <p>Saved to {string(value.savedPath)}</p>}</div>
    {Object.entries(labels).map(([key, label]) => {
      const result = record(tests[key]);
      if (!tests[key]) return null;
      const input = record(result.input);
      const output = string(result.output);
      let formatted = output;
      try { formatted = JSON.stringify(JSON.parse(output), null, 2); } catch { /* Prose is shown as Markdown. */ }
      return <section className="diagnostic-report-test" key={key}><div className="diagnostic-report-test-heading"><h3>{label}</h3><strong>{result.result === 'passed' ? '✅ Passed' : result.result === 'failed' ? '❌ Failed' : '❔ Inconclusive'}</strong></div><p>{string(result.detail)}</p>
        {Boolean(result.input) && <div className="diagnostic-transcript"><section className="diagnostic-transcript-part"><h3>Prompt</h3><div className="diagnostic-rendered"><MarkdownContent>{string(input.query)}</MarkdownContent></div>{input.tools !== undefined && <pre>{JSON.stringify(input.tools, null, 2)}</pre>}</section><section className="diagnostic-transcript-part"><h3>Output</h3>{formatted !== output ? <pre>{formatted}</pre> : <div className="diagnostic-rendered"><MarkdownContent>{output || 'No visible output.'}</MarkdownContent></div>}</section></div>}
        {string(result.error) && <p className="model-error">{string(result.error)}</p>}
      </section>;
    })}
    {string(value.error) && <p className="model-error">{string(value.error)}</p>}
  </div>;
}

export default function DiagnosticDetail({ title, value, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { dialogRef.current?.close(); }; }, []);
  const data = record(value);
  return <dialog ref={dialogRef} className="diagnostic-detail-dialog" aria-label={title} onClose={onClose}>
    <div className="diagnostic-detail-heading"><h2>{title}</h2><button className="button primary compact" type="button" onClick={onClose}>Close</button></div>
    {('observed' in data || 'browserTests' in data) ? <Report value={data}/> : 'tests' in data && data.runtime === 'Needle browser engine' ? <NeedleReport value={data}/> : <Test label={title} value={data}/>}
  </dialog>;
}
