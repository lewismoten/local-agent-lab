import test from 'node:test';
import assert from 'node:assert/strict';
import { interruptedResponseContent } from '../src/harnessInterrupted.ts';

test('visible partial output is saved with an explicit incomplete marker', () => {
  assert.equal(interruptedResponseContent('A partial answer\n', true), '[Stopped response — incomplete and unverified]\n\nA partial answer\n');
  assert.equal(interruptedResponseContent('```ts\nconst a =', false), '[Failed response — incomplete and unverified]\n\n```ts\nconst a =');
});

test('no assistant message is created when generation returned no visible text', () => {
  assert.equal(interruptedResponseContent(' \n ', true), null);
});
