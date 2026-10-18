import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpLibraryQuery, isBriefFollowUp } from '../src/harnessFollowUp.ts';

test('a brief approval searches the library for the latest active task', () => {
  const turns = [
    { role: 'user', content: 'Review cache expiration in src/cache.ts.' },
    { role: 'assistant', content: 'I found the cause and can update the file.' },
  ];
  assert.equal(followUpLibraryQuery('Go ahead.', turns), 'Review cache expiration in src/cache.ts.');
  assert.ok(isBriefFollowUp('Go ahead.'));
});

test('a compacted approval uses the archived user task without source labels', () => {
  const hint = '[Recent archived exchange · message #32 · 2026-01-02 · user]\nFix the cache bug in src/cache.ts and update tests.\n\n[Recent archived exchange · message #33 · 2026-01-02 · assistant]\nI can patch it.';
  assert.equal(followUpLibraryQuery('Continue.', [], hint), 'Fix the cache bug in src/cache.ts and update tests.');
});

test('a chapter summary can guide retrieval when the last exchange has no user task', () => {
  const hint = '[Recent archived topic · Cache Repair]\nThe cache bug in src/cache.ts is still unresolved.\n\n[Recent archived exchange · message #50 · 2026-01-02 · assistant]\nNext step pending.';
  assert.equal(followUpLibraryQuery('Please do that.', [], hint), 'The cache bug in src/cache.ts is still unresolved.');
  assert.equal(followUpLibraryQuery('Continue.', [], ''), '');
});

test('a specific request searches for its own words', () => {
  assert.equal(followUpLibraryQuery('Find the API schema.', [{ role: 'user', content: 'Fix an unrelated bug.' }]), 'Find the API schema.');
});
