import test from 'node:test';
import assert from 'node:assert/strict';
import { GRANITE_COUNT_LETTERS_GRAMMAR, GRANITE_TOOL_TEMPERATURE, graniteToolMessages, normalizeGraniteToolResponse, parseGraniteToolCalls } from '../src/graniteTools.ts';

const tools = [{ type: 'function', function: { name: 'count_letters', description: 'Count letters.', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } } }];

test('Granite tool request puts listed signatures and call format in the system turn', () => {
  assert.equal(GRANITE_TOOL_TEMPERATURE, 0.1);
  assert.match(GRANITE_COUNT_LETTERS_GRAMMAR, /^root ::= "<tool_call>"/);
  assert.match(GRANITE_COUNT_LETTERS_GRAMMAR, /count_letters/);
  const messages = graniteToolMessages([{ role: 'user', content: 'Count apple.' }], tools, 'required');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /<tools>[\s\S]*count_letters[\s\S]*<\/tools>/);
  assert.match(messages[0].content, /<tool_call>/);
  assert.equal(messages[1].content, 'Count apple.');
});

test('only complete tagged JSON calls to listed tools become executable', () => {
  const tagged = '<tool_call>\n{"name":"count_letters","arguments":{"word":"apple"}}\n</tool_call>';
  assert.deepEqual(parseGraniteToolCalls(tagged, tools), [{ id: 'granite-1', type: 'function', function: { name: 'count_letters', arguments: '{"word":"apple"}' } }]);
  assert.deepEqual(parseGraniteToolCalls('{"name":"count_letters","arguments":{"word":"apple"}}', tools), []);
  assert.deepEqual(parseGraniteToolCalls('<tool_call>{"name":"delete_file","arguments":{}}</tool_call>', tools), []);
  assert.deepEqual(parseGraniteToolCalls('<tool_call>{"name":"count_letters","arguments":{"word":"apple"}', tools), []);
  const response = { id: 'a', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: tagged }, finish_reason: 'stop', logprobs: null }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  const normalized = normalizeGraniteToolResponse(response, tools);
  assert.equal(normalized.choices[0].finish_reason, 'tool_calls');
  assert.equal(normalized.choices[0].message.content, '');
  assert.equal(normalized.choices[0].message.tool_calls[0].function.name, 'count_letters');
  assert.equal(normalizeGraniteToolResponse({ ...response, choices: [{ ...response.choices[0], message: { role: 'assistant', content: `Here is the call: ${tagged}` } }] }, tools).choices[0].message.tool_calls, undefined);
  assert.equal(normalizeGraniteToolResponse({ ...response, choices: [{ ...response.choices[0], finish_reason: 'length' }] }, tools).choices[0].message.tool_calls, undefined);
});

test('Granite follow-up wraps tool results in tool_response tags', () => {
  const messages = graniteToolMessages([
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'count_letters', arguments: '{"word":"apple"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: '5' },
  ], tools);
  assert.match(messages[1].content, /<tool_call>/);
  assert.equal(messages[2].role, 'user');
  assert.match(messages[2].content, /<tool_response>\n5\n<\/tool_response>/);
});
