import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_VISION_TAG_PROMPT, applyAvatarTagReviews, mergeAvatarVisionTags, parseAvatarVisionTags, scanAvatarLibraryTags } from '../src/harnessAvatarVision.ts';

test('vision tag parser accepts a short JSON answer and keeps labels searchable', () => {
  const answer = '<think>Inspecting the picture.</think>```json\n{"tags":["robot","blue eyes","robot","circuit traces","Spark"]}\n```';
  assert.deepEqual(parseAvatarVisionTags(answer), ['Robot', 'Blue Eyes', 'Circuit Traces', 'Spark']);
  assert.equal(mergeAvatarVisionTags('Cyberpunk, Robot', parseAvatarVisionTags(answer)), 'Cyberpunk, Robot, Blue Eyes, Circuit Traces, Spark');
  assert.match(AVATAR_VISION_TAG_PROMPT, /Do not guess identity/);
});

test('vision tag parser rejects prose and malformed responses instead of turning them into labels', () => {
  assert.deepEqual(parseAvatarVisionTags('This looks like a blue robot.'), []);
  assert.deepEqual(parseAvatarVisionTags('{"tags":"blue robot"}'), []);
  assert.deepEqual(parseAvatarVisionTags('{"tags":["Robot", 42, "Blue"]}'), ['Robot', 'Blue']);
  assert.equal(mergeAvatarVisionTags('Existing', []), 'Existing');
});

test('library scan reports each review and retains completed suggestions after Stop', async () => {
  const controller = new AbortController();
  const reviews = [];
  const assets = ['one', 'two', 'three'].map(id => ({ id, title: id }));
  const completed = await scanAvatarLibraryTags(assets, controller.signal,
    async asset => ({ answer: `{"tags":["${asset.title}"]}`, tags: [asset.title] }),
    (review, count) => { reviews.push(review); if (count === 2) controller.abort(); });
  assert.equal(completed, 2);
  assert.deepEqual(reviews.map(item => item.assetId), ['one', 'two']);
  assert.ok(reviews.every(item => item.selected && !item.applied));
});

test('batch apply uses latest saved tags and stops after completed writes', async () => {
  const controller = new AbortController();
  const records = new Map([
    ['one', { id: 'one', title: 'One', tags: ['Existing', 'From Another Tab'] }],
    ['two', { id: 'two', title: 'Two', tags: [] }],
    ['three', { id: 'three', title: 'Three', tags: [] }],
  ]);
  const reviews = ['one', 'two', 'three'].map(id => ({ assetId: id, title: id, suggestions: ['Robot'], draft: 'Robot', answer: '{}', selected: id !== 'three' }));
  const applied = [];
  const completed = await applyAvatarTagReviews(reviews, controller.signal,
    async id => records.get(id) || null,
    async (asset, tags) => { const next = { ...asset, tags }; records.set(asset.id, next); return next; },
    (asset, _review, count) => { applied.push(asset.id); if (count === 1) controller.abort(); });
  assert.equal(completed, 1);
  assert.deepEqual(applied, ['one']);
  assert.deepEqual(records.get('one').tags, ['Existing', 'From Another Tab', 'Robot']);
  assert.deepEqual(records.get('two').tags, []);
  assert.deepEqual(records.get('three').tags, []);
});
