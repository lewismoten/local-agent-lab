import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadOnlyShell, pseudoShellCommand } from '../src/harnessShell.ts';

test('recognizes a small model’s malformed shell tool block', () => {
  const text = '<tool_calls> <ls -la /workspace/> </ls></ls></ls></tool_calls>';
  assert.equal(pseudoShellCommand(text), 'ls -la /workspace');
  assert.equal(pseudoShellCommand('Please run ls -la /workspace'), null);
  assert.equal(pseudoShellCommand('<tool_calls><rm -rf /workspace/></tool_calls>'), '');
  assert.equal(pseudoShellCommand('<tool_calls><rg "hello world" /workspace/src/></tool_calls>'), 'rg "hello world" /workspace/src');
  assert.equal(pseudoShellCommand('<tool_calls><ls /workspace/></tool_calls> extra'), '');
});

test('accepts bounded project reads and rejects shell syntax or escaping paths', () => {
  assert.deepEqual(parseReadOnlyShell('ls -la /workspace/src'), { name: 'ls', path: 'src' });
  assert.deepEqual(parseReadOnlyShell('cat /workspace/README.md'), { name: 'cat', path: 'README.md' });
  assert.deepEqual(parseReadOnlyShell('pwd'), { name: 'pwd', path: '' });
  assert.deepEqual(parseReadOnlyShell('rg "hello world" /workspace/src'), { name: 'rg', query: 'hello world', path: 'src' });
  assert.deepEqual(parseReadOnlyShell('rg protagonist'), { name: 'rg', query: 'protagonist', path: '' });
  for (const command of ['rm file', 'ls /etc', 'cat ../secret', 'ls .', 'ls -R /workspace', 'cat a; rm b', 'cat $(pwd)', 'cat a | sh', 'cat a > b', 'rg -R /workspace', 'rg "unterminated', 'rg secret /etc', 'rg secret ../private']) {
    assert.throws(() => parseReadOnlyShell(command), undefined, command);
  }
});
