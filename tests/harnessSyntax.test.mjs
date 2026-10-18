import test from 'node:test';
import assert from 'node:assert/strict';
import { syntaxDiagnostics } from '../src/harnessSyntax.ts';

test('offline syntax check accepts TypeScript and JSX without executing it', async () => {
  const tsx = await syntaxDiagnostics('src/Panel.tsx', 'export const Panel = ({ name }: { name: string }) => <h1>{name}</h1>;');
  assert.equal(tsx.status, 'ok');
  assert.deepEqual(tsx.diagnostics, []);
  assert.match(tsx.note, /types, and tests are not checked/);
});

test('syntax check reports code and JSON parse errors with locations', async () => {
  const code = await syntaxDiagnostics('src/broken.ts', 'const answer: = 42;');
  assert.equal(code.status, 'errors');
  assert.equal(code.diagnostics[0].line, 1);
  assert.ok(code.diagnostics[0].column > 0);
  const json = await syntaxDiagnostics('data/config.json', '{"name": }');
  assert.equal(json.status, 'errors');
  assert.match(json.diagnostics[0].message, /unexpected|expected/i);
});

test('syntax check limits source size and supported file types', async () => {
  await assert.rejects(syntaxDiagnostics('readme.md', '# hello'), /supports JavaScript/);
  await assert.rejects(syntaxDiagnostics('src/big.js', 'x'.repeat(200_001)), /200 KB/);
});
