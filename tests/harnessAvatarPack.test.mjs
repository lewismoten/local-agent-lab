import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarPackPlan, runAvatarPack } from '../src/harnessAvatarPack.ts';

test('mixed avatar packs include people, robots, and symbols', () => {
  const plan = avatarPackPlan('mixed', 8, 'cyberpunk, cartoon');
  assert.equal(plan.length, 8);
  assert.ok(plan.some(item => item.tags.includes('Person')));
  assert.ok(plan.some(item => item.tags.includes('Robot')));
  assert.ok(plan.some(item => item.tags.includes('Symbol')));
  assert.ok(plan.every(item => item.prompt.includes('no recognizable existing characters')));
});

test('pack limits and filters keep one subject family with custom direction', () => {
  const plan = avatarPackPlan('people', 30, 'watercolor', 'adult women');
  assert.equal(plan.length, 12);
  assert.ok(plan.every(item => item.tags.includes('Person')));
  assert.ok(plan.every(item => item.prompt.includes('adult women')));
  assert.ok(!plan.some(item => item.tags.includes('Robot')));
});

test('structured people filters constrain age and gender while keeping distinct subjects', () => {
  const women = avatarPackPlan('people', 8, 'watercolor', '', { age: 'older-adult', gender: 'women' });
  assert.equal(women.length, 8);
  assert.equal(new Set(women.map(item => item.title)).size, 8);
  assert.ok(women.every(item => item.tags.includes('Person') && item.tags.includes('Older Adult') && item.tags.includes('Woman')));
  assert.ok(women.every(item => item.prompt.includes('older adult') && item.prompt.includes('a woman')));
  assert.ok(women.every(item => !item.tags.includes('Robot')));

  const mixed = avatarPackPlan('mixed', 10, '', '', { age: 'young-adult', gender: 'men' });
  const people = mixed.filter(item => item.tags.includes('Person'));
  assert.ok(people.length > 0);
  assert.ok(people.every(item => item.tags.includes('Young Adult') && item.tags.includes('Man')));
  assert.ok(mixed.some(item => item.tags.includes('Robot')));
  assert.ok(mixed.some(item => item.tags.includes('Symbol')));
  assert.ok(mixed.filter(item => !item.tags.includes('Person')).every(item => !item.tags.includes('Man')));
});

test('pack generation saves sequentially and keeps images completed before Stop', async () => {
  const plan = avatarPackPlan('mixed', 4);
  const controller = new AbortController();
  const events = [];
  const completed = await runAvatarPack(plan, controller.signal,
    async (item, index) => { events.push(`generate ${index}`); return new Blob([item.title]); },
    async (image, _item, index) => { events.push(`save ${index}`); return image.text(); },
    (asset, count) => { events.push(`saved ${count}: ${asset}`); if (count === 2) controller.abort(); });
  assert.equal(completed, 2);
  assert.deepEqual(events, [
    'generate 0', 'save 0', `saved 1: ${plan[0].title}`,
    'generate 1', 'save 1', `saved 2: ${plan[1].title}`,
  ]);
});
