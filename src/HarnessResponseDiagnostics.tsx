import ReactMarkdown from 'react-markdown';
import { Download } from 'lucide-react';
import type { ResponseDiagnostic } from './harnessResponseDiagnostics.ts';
import { modelStampDetails } from './harnessModelStamp.ts';

export default function HarnessResponseDiagnostics({ report, loading, error, messageId, onClose }: {
  report: ResponseDiagnostic | null; loading: boolean; error: string; messageId: string; onClose: () => void;
}) {
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `response-${messageId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="harness-response-report">
    <div className="harness-response-report-head"><div><span className="harness-overline">RESPONSE TRACE</span><h2>Inspect response</h2></div><div><button className="harness-secondary" disabled={!report} onClick={download}><Download size={15}/> Download JSON</button><button className="harness-secondary" onClick={onClose}>Close</button></div></div>
    {loading && <p role="status">Opening saved diagnostics…</p>}
    {error && <p role="alert" className="harness-response-report-error">{error}</p>}
    {report && <>
      <div className="harness-response-report-stats"><span>Input <strong>{report.usage.inputTokens?.toLocaleString() ?? '—'}</strong></span><span>Output <strong>{report.usage.outputTokens?.toLocaleString() ?? '—'}</strong></span><span>Elapsed <strong>{(report.usage.elapsedMs / 1000).toFixed(1)}s</strong></span><span>Speed <strong>{report.usage.observedTokensPerSecond === null ? '—' : `${report.usage.observedTokensPerSecond} tok/s`}</strong></span><span>Seed <strong>{report.sampling.seed ?? 'Default'}</strong></span><span>Temperature <strong>{report.sampling.temperature ?? 'Default'}</strong></span></div>
      <p className="harness-muted">{report.sampling.note}</p>
      <section><h3>Model</h3><pre>{modelStampDetails(report.model)}</pre></section>
      <section><h3>System instructions</h3><pre>{report.input.system}</pre></section>
      <section><h3>Submitted conversation</h3><div className="harness-response-report-turns">{report.input.turns.map((turn, index) => <div key={index}><strong>{turn.role}</strong><pre>{turn.content}</pre></div>)}</div><small>{report.input.note}</small></section>
      {!!report.rounds?.length && <section><h3>Model rounds</h3>{report.rounds.map((round, index) => <article className="harness-response-round" key={index}>
        <h4>Round {index + 1}{round.response.finishReason ? ` · ${round.response.finishReason}` : ''}</h4>
        <strong>Request</strong><pre>{JSON.stringify(round.request, null, 2)}</pre>
        {!!round.response.thinking && <><strong>Thinking</strong><div className="harness-response-report-markdown"><ReactMarkdown>{round.response.thinking}</ReactMarkdown></div></>}
        {!!round.response.text && <><strong>Output</strong><div className="harness-response-report-markdown"><ReactMarkdown>{round.response.text}</ReactMarkdown></div></>}
        {!!round.response.toolCalls?.length && <><strong>Tool calls</strong><pre>{JSON.stringify(round.response.toolCalls, null, 2)}</pre></>}
        {!!round.toolResults?.length && <><strong>Tool results</strong><pre>{round.toolResults.map(item => `${item.name}: ${item.content}`).join('\n\n')}</pre></>}
        <small>Input {round.response.inputTokens?.toLocaleString() ?? '—'} · Output {round.response.outputTokens?.toLocaleString() ?? '—'} tokens</small>
      </article>)}</section>}
      <section><h3>Thinking</h3>{report.output.thinking ? <div className="harness-response-report-markdown"><ReactMarkdown>{report.output.thinking}</ReactMarkdown></div> : <p className="harness-muted">No thinking text was returned by this model or provider.</p>}</section>
      <section><h3>Answer</h3><div className="harness-response-report-markdown"><ReactMarkdown>{report.output.text}</ReactMarkdown></div></section>
      {report.output.toolEvents.length > 0 && <section><h3>Tool events</h3><pre>{report.output.toolEvents.join('\n\n')}</pre></section>}
    </>}
  </div>;
}
