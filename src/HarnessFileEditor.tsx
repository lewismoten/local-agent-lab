import { useState } from 'react';
import type { SyntaxResult } from './harnessSyntax.ts';

type CheckState = { path: string; text: string; busy: boolean; result?: SyntaxResult; error?: string };

export default function HarnessFileEditor({ path, text, busy, onPathChange, onTextChange, onSave }: {
  path: string;
  text: string;
  busy: boolean;
  onPathChange: (path: string) => void;
  onTextChange: (text: string) => void;
  onSave: () => void;
}) {
  const [check, setCheck] = useState<CheckState | null>(null);
  const visible = check?.path === path && check.text === text ? check : null;
  const supported = /\.(?:js|jsx|mjs|cjs|ts|tsx|json)$/i.test(path);

  async function checkSyntax() {
    const current = { path, text };
    setCheck({ ...current, busy: true });
    try {
      const { syntaxDiagnostics } = await import('./harnessSyntax.ts');
      const result = await syntaxDiagnostics(path, text);
      setCheck({ ...current, busy: false, result });
    } catch (error) {
      setCheck({ ...current, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return <div className="harness-file-editor">
    <label>Path<input value={path} disabled={busy} onChange={event => onPathChange(event.target.value)} placeholder="src/example.ts"/></label>
    <label>Text content<textarea value={text} disabled={busy} onChange={event => onTextChange(event.target.value)} rows={16} placeholder="Open a text file or write a new one…"/></label>
    <div className="harness-file-editor-actions">
      <button className="harness-primary" onClick={onSave} disabled={!path.trim() || busy}>{busy ? 'Saving…' : 'Save file'}</button>
      <button className="harness-secondary" onClick={() => void checkSyntax()} disabled={busy || !supported || visible?.busy} title={supported ? 'Check the current unsaved text' : 'Available for JavaScript, TypeScript, JSX, TSX, and JSON'}>{visible?.busy ? 'Checking…' : 'Check syntax'}</button>
    </div>
    {visible && !visible.busy && <div className={`harness-syntax-result ${visible.result?.status === 'ok' ? 'ok' : 'errors'}`} role="status">
      {visible.error ? <p>{visible.error}</p> : visible.result?.status === 'ok' ? <p>Syntax looks valid. Imports, types, and tests are not checked.</p> : <><strong>{visible.result?.diagnostics.length} syntax issue{visible.result?.diagnostics.length === 1 ? '' : 's'}</strong><ul>{visible.result?.diagnostics.map((item, index) => <li key={index}><span>{item.line === null ? 'Line ?' : `Line ${item.line}`}{item.column === null ? '' : `:${item.column}`}</span> {item.message}</li>)}</ul>{visible.result?.moreErrors && <p>More issues remain in this file.</p>}</>}
    </div>}
  </div>;
}
