import test from 'node:test';
import assert from 'node:assert/strict';
import { detectThinkingSpillover } from '../src/thinkingSpillover.ts';

test('detects reasoning continuing into the visible answer at the thinking cap', () => {
  const spillover = detectThinkingSpillover({
    reasoning: 'I should check the rate again.',
    visible: ': 5 machines take 5 minutes. Wait, let me double-check the math.',
    reasoningTokens: 2049, thinkingBudgetTokens: 2048, finishReason: 'length',
  });
  assert.ok(spillover);
  assert.match(spillover.detail, /visible answer/);
});

test('a normal final answer or a thinking stream below its cap is not spillover', () => {
  const base = { reasoning: 'Each machine makes one widget in five minutes.', reasoningTokens: 2048, thinkingBudgetTokens: 2048, finishReason: 'stop' };
  assert.equal(detectThinkingSpillover({ ...base, visible: 'The answer is 5 minutes.' }), null);
  assert.equal(detectThinkingSpillover({ ...base, visible: ': But let me check.', reasoningTokens: 500 }), null);
  assert.equal(detectThinkingSpillover({ ...base, visible: ': But let me check.', reasoning: '' }), null);
});
