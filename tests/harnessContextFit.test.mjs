import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRecentTurns } from '../src/harnessContextFit.ts';

const turns = Array.from({ length: 13 }, (_, index) => ({
  role: index % 2 ? 'assistant' : 'user',
  content: `Exchange ${index}: ` + 'context '.repeat(130),
}));

test('a smaller fallback keeps recent complete turns and points to saved originals', () => {
  const fitted = fitRecentTurns(turns, 'Project instructions.', 2048, 512, 200, true);
  assert.ok(fitted);
  assert.ok(fitted.omitted > 0);
  assert.equal(fitted.turns[0].role, 'user');
  assert.deepEqual(fitted.turns, turns.slice(fitted.omitted));
  assert.match(fitted.system, /search_history and read_history/);
  assert.match(fitted.system, /original messages are still saved/);
});

test('fallback does not omit turns without retrieval or cut a too-large latest request', () => {
  assert.equal(fitRecentTurns(turns, 'Project instructions.', 2048, 512, 200, false), null);
  assert.equal(fitRecentTurns([{ role: 'user', content: 'x'.repeat(10000) }], 'Instructions.', 2048, 512, 200, true), null);
});

test('a conversation that fits is unchanged', () => {
  const short = [{ role: 'user', content: 'Please inspect the file.' }];
  const fitted = fitRecentTurns(short, 'Instructions.', 4096, 512, 200, true);
  assert.deepEqual(fitted, { system: 'Instructions.', turns: short, omitted: 0 });
});
