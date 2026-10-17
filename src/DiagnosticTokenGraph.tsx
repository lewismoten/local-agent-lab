type Counts = {
  outputTokens: number;
  reasoningTokens: number;
  responseTokens: number;
  maxOutputTokens: number;
  outputEstimated: boolean;
};

export default function DiagnosticTokenGraph({ counts, thinkingBudget = 0 }: { counts: Counts; thinkingBudget?: number }) {
  const max = Math.max(1, counts.maxOutputTokens);
  const thinking = Math.min(max, counts.reasoningTokens);
  const answer = Math.min(max - thinking, counts.responseTokens);
  const other = Math.min(max - thinking - answer, Math.max(0, counts.outputTokens - thinking - answer));
  const prefix = counts.outputEstimated ? '~' : '';
  return <div className="diagnostic-token-graph" aria-label="Thinking and output token use">
    <div className="diagnostic-token-graph-heading"><strong>Output tokens</strong><span>{prefix}{counts.outputTokens.toLocaleString()} / {max.toLocaleString()}</span></div>
    <div className="model-output-progress" role="progressbar" aria-label="Output tokens generated" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(counts.outputTokens, max)} aria-valuetext={`${counts.reasoningTokens} thinking tokens, ${counts.responseTokens} answer tokens, ${counts.outputTokens} of ${max} total`}>
      <span className="model-output-thinking" style={{ width: `${thinking / max * 100}%` }}/>
      <span className="model-output-response" style={{ width: `${answer / max * 100}%` }}/>
      <span className="model-output-other" style={{ width: `${other / max * 100}%` }}/>
      {thinkingBudget > 0 && <span className="model-output-thinking-cap" style={{ left: `${Math.min(100, thinkingBudget / max * 100)}%` }} title={`Thinking cap: ${thinkingBudget.toLocaleString()} tokens`}/>}
    </div>
    <div className="diagnostic-token-legend"><span><i className="diagnostic-legend-thinking"/>Thinking {prefix}{counts.reasoningTokens.toLocaleString()}</span><span><i className="diagnostic-legend-answer"/>Answer {prefix}{counts.responseTokens.toLocaleString()}</span>{other > 0 && <span>Other {prefix}{other.toLocaleString()}</span>}</div>
  </div>;
}
