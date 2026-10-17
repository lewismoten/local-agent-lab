import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProbeStream, splitInlineReasoning } from '../src/probeStream.ts';

test('live transcript separates inline thinking from the visible answer', () => {
  assert.deepEqual(splitInlineReasoning('<think>Working'), { reasoning: 'Working', response: '' });
  assert.deepEqual(splitInlineReasoning('<think>Working</think>5 minutes'), { reasoning: 'Working', response: '5 minutes' });
  assert.deepEqual(splitInlineReasoning('<|channel>thoughtWorking<|channel>text5 minutes'), { reasoning: 'Working', response: '5 minutes' });
});

test('inline thinking chunks contribute to the thinking graph', async () => {
  const updates = [];
  async function* chunks() {
    yield { id: 'think', created: 1, model: 'test', choices: [{ index: 0, delta: { content: '<think>Working' }, finish_reason: null }] };
    yield { id: 'think', created: 1, model: 'test', choices: [{ index: 0, delta: { content: ' through it' }, finish_reason: null }] };
    yield { id: 'think', created: 1, model: 'test', choices: [{ index: 0, delta: { content: '</think>5 minutes' }, finish_reason: 'stop' }] };
  }
  await collectProbeStream(chunks(), 256, update => updates.push(update));
  assert.equal(updates.at(-1).reasoningTokens, 2);
  assert.equal(updates.at(-1).responseTokens, 1);
  assert.equal(updates.at(-1).reasoningText, 'Working through it');
  assert.equal(updates.at(-1).responseText, '5 minutes');
});

test('diagnostic stream reports prompt and output progress and preserves final usage', async () => {
  const updates = [];
  async function* chunks() {
    yield { id: 'a', created: 1, model: 'test', prompt_progress: { total: 12, cache: 4, processed: 3, time_ms: 1 }, choices: [] };
    yield { id: 'a', created: 1, model: 'test', choices: [{ index: 0, delta: { content: '5' }, finish_reason: null, logprobs: null }] };
    yield { id: 'a', created: 1, model: 'test', choices: [{ index: 0, delta: { content: ' minutes' }, finish_reason: 'stop', logprobs: null }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } };
  }
  const response = await collectProbeStream(chunks(), 256, update => updates.push(update));
  assert.deepEqual(updates[0], { promptProcessed: 7, promptTotal: 12, outputTokens: 0, reasoningTokens: 0, responseTokens: 0, maxOutputTokens: 256, outputEstimated: true, outputTokensPerSecond: 0 });
  assert.equal(updates.at(-1).outputTokens, 3);
  assert.equal(updates.at(-1).outputEstimated, false);
  assert.equal(updates.at(-1).responseTokens, 2);
  assert.equal(updates.at(-1).responseText, '5 minutes');
  assert.ok(updates.at(-1).outputTokensPerSecond > 0);
  assert.equal(response.choices[0].message.content, '5 minutes');
  assert.equal(response.choices[0].finish_reason, 'stop');
  assert.equal(response.usage.total_tokens, 15);
});

test('diagnostic stream retains a structured tool call across chunks', async () => {
  const updates = [];
  async function* chunks() {
    yield { id: 'b', created: 1, model: 'test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'count_letters', arguments: '{"word":' } }] }, finish_reason: null, logprobs: null }] };
    yield { id: 'b', created: 1, model: 'test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"apple"}' } }] }, finish_reason: 'tool_calls', logprobs: null }] };
  }
  const response = await collectProbeStream(chunks(), 256, update => updates.push(update));
  assert.match(updates.at(-1).responseText, /Tool: count_letters/);
  assert.equal(response.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(response.choices[0].message.tool_calls, [{ id: 'call-1', type: 'function', function: { name: 'count_letters', arguments: '{"word":"apple"}' } }]);
});

test('diagnostic stream retains separate reasoning deltas and counts their progress', async () => {
  const updates = [];
  async function* chunks() {
    yield { id: 'c', created: 1, model: 'qwen3', choices: [{ index: 0, delta: { reasoning_content: 'Each machine makes one widget in five minutes.' }, finish_reason: null, logprobs: null }] };
    yield { id: 'c', created: 1, model: 'qwen3', choices: [{ index: 0, delta: { reasoning_content: ' So 100 machines make 100 widgets in five minutes.' }, finish_reason: null, logprobs: null }] };
    yield { id: 'c', created: 1, model: 'qwen3', choices: [{ index: 0, delta: { content: '5 minutes' }, finish_reason: 'stop', logprobs: null }], usage: { prompt_tokens: 30, completion_tokens: 0, total_tokens: 30 } };
  }
  const response = await collectProbeStream(chunks(), 1024, update => updates.push(update));
  assert.equal(response.choices[0].message.reasoning_content, 'Each machine makes one widget in five minutes. So 100 machines make 100 widgets in five minutes.');
  assert.equal(response.choices[0].message.content, '5 minutes');
  assert.equal(updates[1].outputTokens, 2);
  assert.equal(updates[1].reasoningTokens, 2);
  assert.match(updates[1].reasoningText, /100 machines/);
  assert.equal(updates[1].responseTokens, 0);
  assert.equal(updates.at(-1).outputEstimated, true);
  assert.equal(updates.at(-1).outputTokens, 3);
  assert.equal(updates.at(-1).responseTokens, 1);
  assert.equal(updates.at(-1).responseText, '5 minutes');
});
