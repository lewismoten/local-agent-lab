import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExecutableToolCalls, completedMachineConclusion, gemmaBrowserMessages, isFiveMinutesAnswer, liveBrowserAnswer, machineConclusion, parsePromptedSteps, scorePromptedSteps, scoreStructuredToolUse, qwen35ChatOptions, qwen35LoadOptions, visibleBrowserText, visibleReasoningEnvelope } from '../src/browserInference.ts';

test('incomplete or cancelled model output cannot execute tool calls', () => {
  for (const reason of ['length', 'incomplete', 'max_tokens', 'MAX_TOKENS']) {
    assert.throws(() => assertExecutableToolCalls(1, reason), /stopped before finishing its tool calls/);
  }
  assert.doesNotThrow(() => assertExecutableToolCalls(1, 'tool_calls'));
  assert.doesNotThrow(() => assertExecutableToolCalls(1, 'stop'));
  assert.doesNotThrow(() => assertExecutableToolCalls(0, 'length'));
  const controller = new AbortController();
  controller.abort(new DOMException('Stopped by user.', 'AbortError'));
  assert.throws(() => assertExecutableToolCalls(1, 'tool_calls', controller.signal), /Stopped by user/);
});

test('Qwen3.5 browser load options follow the selected thinking mode', () => {
  assert.equal(qwen35LoadOptions(false).default_template_kwargs.enable_thinking, false);
  assert.equal(qwen35LoadOptions(false).reasoning, false);
  assert.equal(qwen35LoadOptions(false).reasoning_format, 'none');
  assert.equal(qwen35LoadOptions(true).default_template_kwargs.enable_thinking, true);
  assert.equal(qwen35LoadOptions(true).reasoning, true);
  assert.equal(qwen35LoadOptions(true).reasoning_format, 'deepseek');
  assert.equal(qwen35ChatOptions.chat_template_kwargs.enable_thinking, false);
});

test('visible browser text excludes Qwen thinking markers', () => {
  assert.equal(visibleBrowserText('<think>private work</think>\n\nready'), 'ready');
  assert.equal(visibleBrowserText('</think>\n\nready'), 'ready');
  assert.equal(visibleBrowserText('<think>unfinished work'), '');
  assert.equal(visibleBrowserText('<|channel>thought\nprivate work\n<|channel>text\nready'), 'ready');
  assert.equal(visibleBrowserText('<|channel>thought\nunfinished work'), '');
  assert.equal(visibleReasoningEnvelope('<think>private work</think>ready'), 'think-tags');
  assert.equal(visibleReasoningEnvelope('<|channel>thought\nprivate work\n<|channel>text\nready'), 'channel-tags');
  assert.equal(visibleReasoningEnvelope('Let me explain. The answer is ready.'), null);
  assert.equal(visibleBrowserText(null), '');
});

test('live chat preview hides unfinished thinking and tool calls', () => {
  assert.equal(liveBrowserAnswer('<thi'), '');
  assert.equal(liveBrowserAnswer('<think>private work'), '');
  assert.equal(liveBrowserAnswer('<think>private work</think>Public answer'), 'Public answer');
  assert.equal(liveBrowserAnswer('I will check this. <tool_call>{"name":"read_file"}</tool_call>'), 'I will check this.');
  assert.equal(liveBrowserAnswer('Visible answer'), 'Visible answer');
});

test('prompted steps require complete tags and a separate answer', () => {
  assert.deepEqual(parsePromptedSteps('<think>17 - 5 = 12; 12 * 2 - 3 = 21</think>21'), { steps: '17 - 5 = 12; 12 * 2 - 3 = 21', answer: '21' });
  assert.deepEqual(parsePromptedSteps('<think>Each machine makes one widget in five minutes.</think>\n<answer>\n5 minutes\n</answer>'), { steps: 'Each machine makes one widget in five minutes.', answer: '5 minutes' });
  assert.equal(machineConclusion(parsePromptedSteps('<think>Each machine makes one widget in five minutes.</think>100 machines would take 5 minutes to make 100 widgets.')?.answer)?.answer, '5');
  assert.equal(parsePromptedSteps('<think>unfinished work'), null);
  assert.equal(parsePromptedSteps('<think>work</think>'), null);
});

test('prompted step formatting is recognized even when the answer is wrong', () => {
  const wrong = scorePromptedSteps('<think>Each machine makes a widget.</think>100 minutes', 'stop');
  assert.equal(wrong.result, 'passed');
  assert.equal(wrong.answerAccuracy, 'failed');
  const correct = scorePromptedSteps('<think>Each machine needs five minutes.</think><answer>5 minutes</answer>', 'stop');
  assert.equal(correct.result, 'passed');
  assert.equal(correct.answerAccuracy, 'passed');
  assert.equal(scorePromptedSteps('<think>Complete explanation.</think>5 minutes', 'length').result, 'passed');
  assert.equal(scorePromptedSteps('<think>unfinished', 'length').result, 'inconclusive');
});

test('structured tool use is recognized even when the argument value is wrong', () => {
  const call = word => [{ function: { name: 'count_letters', arguments: JSON.stringify({ word }) } }];
  assert.deepEqual(scoreStructuredToolUse(call('apple'), 'count_letters', { word: 'apple' }), { observed: true, argumentAccuracy: 'passed' });
  assert.deepEqual(scoreStructuredToolUse(call('pear'), 'count_letters', { word: 'apple' }), { observed: true, argumentAccuracy: 'failed' });
  assert.deepEqual(scoreStructuredToolUse([{ function: { name: 'count_letters', arguments: '{bad' } }], 'count_letters', { word: 'apple' }), { observed: false });
});

test('Gemma puts system instructions in its first user turn', () => {
  assert.deepEqual(gemmaBrowserMessages('Write original prose.', [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]), [
    { role: 'user', content: 'Write original prose.\n\nHello' },
    { role: 'assistant', content: 'Hi' },
  ]);
});

test('machine reasoning answer accepts the correct number and unit', () => {
  assert.equal(isFiveMinutesAnswer('5'), true);
  assert.equal(isFiveMinutesAnswer('5 minutes.'), true);
  assert.equal(isFiveMinutesAnswer('10'), false);
});

test('thinking probe scores the final answer instead of an earlier calculation', () => {
  assert.deepEqual(machineConclusion('It would take 5 minutes.\nFinal Answer: The answer is $\\boxed{100}$'), { answer: '100', source: 'boxed' });
  assert.deepEqual(machineConclusion('The final answer is 5 minutes.'), { answer: '5', source: 'final-answer' });
  assert.deepEqual(machineConclusion('An earlier estimate was 4 minutes.\nTherefore, it takes **40** minutes.\n\n40'), { answer: '40', source: 'last-line' });
  assert.deepEqual(machineConclusion('An earlier estimate was 4 minutes.\nTherefore, it takes **40** minutes.'), { answer: '40', source: 'time-phrase' });
  assert.deepEqual(machineConclusion('It would take 5 minutes for 100 machines to make 100 widgets.'), { answer: '5', source: 'time-phrase' });
  assert.deepEqual(machineConclusion('Explanation: Each machine makes one widget in 5 minutes. Final answer: 5 minutes.'), { answer: '5', source: 'final-answer' });
  assert.deepEqual(machineConclusion('So, it would take 10,000 minutes for 100 machines to make 100 widgets.'), { answer: '10000', source: 'time-phrase' });
  assert.deepEqual(machineConclusion('Final answer: 8.33 minutes.'), { answer: '8.33', source: 'final-answer' });
  assert.deepEqual(machineConclusion('Final Answer: The answer is $\\boxed{8.33}$'), { answer: '8.33', source: 'boxed' });
  assert.equal(machineConclusion('<think>Still working'), null);
  assert.equal(completedMachineConclusion('100 minutes, but wait...', 'length'), null);
  assert.deepEqual(completedMachineConclusion('Final answer: 5 minutes.', 'stop'), { answer: '5', source: 'final-answer' });
});
