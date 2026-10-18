import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAgentTemplate } from '../src/harnessAgentTemplates.ts';

test('new agents use a least-used identity and a distinct name', () => {
  const agents = [{ name: 'Ada', identityId: 'ada' }, { name: 'Lumen', identityId: 'lumen' }];
  assert.equal(chooseAgentTemplate(agents, undefined, () => 0).template.id, 'trace');
  const next = chooseAgentTemplate([...agents, { name: 'Trace', identityId: 'trace' }], undefined, () => 0);
  assert.equal(next.template.id, 'ada');
  assert.equal(next.name, 'Ada 2');
});

test('an explicit template choice stays selected and avoids duplicate names', () => {
  const agents = [{ name: 'Lumen', identityId: 'lumen' }, { name: 'Lumen 2', identityId: 'lumen' }];
  const result = chooseAgentTemplate(agents, 1);
  assert.equal(result.template.id, 'lumen');
  assert.equal(result.name, 'Lumen 3');
});
