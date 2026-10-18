export type SyntaxDiagnostic = { line: number | null; column: number | null; message: string };
export type SyntaxResult = {
  path: string;
  status: 'ok' | 'errors';
  bytes: number;
  diagnostics: SyntaxDiagnostic[];
  moreErrors: boolean;
  note: string;
};

export const MAX_SYNTAX_BYTES = 200_000;
const MAX_DIAGNOSTICS = 20;
const SUPPORTED = /\.(?:js|jsx|mjs|cjs|ts|tsx|json)$/i;
const NOTE = 'Syntax only; imports, types, and tests are not checked.';

function location(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: index - lastBreak };
}

function diagnostic(error: unknown, text: string): SyntaxDiagnostic {
  const issue = error as { message?: string; loc?: { line?: number; column?: number }; pos?: number };
  const position = typeof issue.pos === 'number' ? location(text, issue.pos) : null;
  return {
    line: issue.loc?.line ?? position?.line ?? null,
    column: issue.loc?.column !== undefined ? issue.loc.column + 1 : position?.column ?? null,
    message: issue.message || String(error),
  };
}

export async function syntaxDiagnostics(path: string, content: string): Promise<SyntaxResult> {
  if (!SUPPORTED.test(path)) throw new Error('Syntax checking supports JavaScript, TypeScript, JSX, TSX, and JSON files.');
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > MAX_SYNTAX_BYTES) throw new Error('Syntax checking is limited to files of 200 KB or less.');
  const issues: SyntaxDiagnostic[] = [];
  if (/\.json$/i.test(path)) {
    try { JSON.parse(content); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offset = /(?:at position|position) (\d+)/i.exec(message);
      const lineColumn = /line (\d+) column (\d+)/i.exec(message);
      const point = offset ? location(content, Number(offset[1])) : null;
      issues.push({ line: lineColumn ? Number(lineColumn[1]) : point?.line ?? null, column: lineColumn ? Number(lineColumn[2]) : point?.column ?? null, message });
    }
  } else {
    const { parse } = await import('@babel/parser');
    const typescript = /\.tsx?$/i.test(path);
    const jsx = /\.jsx$|\.tsx$/i.test(path);
    try {
      const ast = parse(content, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        plugins: [...(typescript ? ['typescript' as const] : []), ...(jsx ? ['jsx' as const] : [])],
      });
      issues.push(...(ast.errors || []).map(error => diagnostic(error, content)));
    } catch (error) {
      issues.push(diagnostic(error, content));
    }
  }
  return {
    path,
    status: issues.length ? 'errors' : 'ok',
    bytes,
    diagnostics: issues.slice(0, MAX_DIAGNOSTICS),
    moreErrors: issues.length > MAX_DIAGNOSTICS,
    note: NOTE,
  };
}
