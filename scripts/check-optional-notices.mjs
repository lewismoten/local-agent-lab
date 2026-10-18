import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// EngineCatalog gives every downloadable engine an artwork ID. The notices
// registry uses the same ID, so a new catalog row must gain a notice entry.
function callIds(path, functionName) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length, 0, `${path} could not be parsed`);
  const ids = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === functionName) {
      const first = node.arguments[0];
      assert(ts.isStringLiteral(first), `${path}: ${functionName} must use a literal ID`);
      ids.push(first.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(ids.length, `${path}: no ${functionName} calls found`);
  assert.equal(new Set(ids).size, ids.length, `${path}: duplicate ${functionName} IDs`);
  return ids.sort();
}

const catalog = callIds('src/EngineCatalog.tsx', 'artworkControl');
const notices = callIds('src/optionalNotices.ts', 'engine');
const catalogSource = readFileSync('src/EngineCatalog.tsx', 'utf8');
const rowCount = (catalogSource.match(/<td className="model-catalog-name">/g) || []).length +
  (catalogSource.match(/<NeedleAssetCard[^>]*group="engine"/g) || []).length;
assert.equal(catalog.length, rowCount, 'An engine catalog row is missing an artwork ID for notice coverage');
assert.deepEqual(notices, catalog, `Optional engine notices differ from the engine catalog.
Missing notices: ${catalog.filter(id => !notices.includes(id)).join(', ') || 'none'}
Unknown notices: ${notices.filter(id => !catalog.includes(id)).join(', ') || 'none'}`);
console.log(`Optional notices cover all ${catalog.length} catalog engines.`);
