import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedPatch } from '../src/harnessPatch.ts';

test('unified patch applies multiple hunks while preserving the original line endings', () => {
  const input = 'alpha\r\nbeta\r\ngamma\r\ndelta\r\n';
  const patch = '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+bravo\n@@ -3,2 +3,3 @@\n gamma\n+new\n delta\n';
  assert.equal(applyUnifiedPatch(input, patch), 'alpha\r\nbravo\r\ngamma\r\nnew\r\ndelta\r\n');
});

test('stale line numbers can resolve only to unique matching context', () => {
  assert.equal(applyUnifiedPatch('a\nb\nc\n', '@@ -99,2 +99,2 @@\n b\n-c\n+C\n'), 'a\nb\nC\n');
  assert.throws(() => applyUnifiedPatch('a\nb\na\nb\n', '@@ -99,2 +99,2 @@\n a\n-b\n+B\n'), /more than once/);
});

test('malformed or stale patches never produce a partial result', () => {
  assert.throws(() => applyUnifiedPatch('a\nb\n', '@@ -1,1 +1,2 @@\n-a\n+A\n'), /line counts/);
  assert.throws(() => applyUnifiedPatch('a\nb\n', '@@ -1,1 +1,1 @@\n-z\n+Z\n'), /no longer matches/);
  assert.throws(() => applyUnifiedPatch('a\nb\n', '@@ -1,1 +1,1 @@\n-a\n+A\n--- other\n+++ other\n'), /line counts|Invalid patch/);
  assert.throws(() => applyUnifiedPatch('a\nb\n', '@@ -1,0 +1,1 @@\n+x\n'), /unchanged context/);
});
