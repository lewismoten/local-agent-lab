import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrismToolCalls } from '../src/prismTools.ts';

const tools = [{ type: 'function', function: { name: 'count_letters', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } } }];

test('Prism XML tool calls become executable calls', () => {
  const input = '<tool_call>\n<function=count_letters>\n<parameter=word>\napple\n</parameter>\n</function>\n</tool_call>';
  const calls = parsePrismToolCalls(input, tools);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'count_letters');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { word: 'apple' });
});

test('Prism tool parsing rejects malformed or unavailable calls and accepts JSON tags', () => {
  assert.equal(parsePrismToolCalls('<tool_call><function=delete_file></function></tool_call>', tools).length, 0);
  assert.equal(parsePrismToolCalls('<tool_call><function=count_letters></function></tool_call>', tools).length, 0);
  assert.equal(parsePrismToolCalls('<tool_call><function=count_letters><parameter=other>apple</parameter></function></tool_call>', tools).length, 0);
  assert.equal(parsePrismToolCalls('<tool_call><function=count_letters><parameter=other>apple</parameter></function></tool_call>', [{ type: 'function', function: { name: 'count_letters', parameters: { type: 'object', properties: { word: { type: 'string' } } } } }]).length, 0);
  assert.equal(parsePrismToolCalls('<tool_call>{"name":"count_letters","arguments":{"word":"apple"}}</tool_call>', tools).length, 1);
});
