import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS } from '../src/harnessAchievements.ts';
import {
  iconStudioPrompt,
  iconStudioTargets,
  modelIconStudioTargets,
  plannedIconStudioTargets,
} from '../src/harnessIconStudioPlan.ts';
import { emptySurfaceArtwork } from '../src/harnessSurfaceArtwork.ts';
import { createAchievementSet, achievementArtworkKey } from '../src/harnessAchievementSets.ts';

test('batch model icons target families and preserve older variant icons', () => {
  const artwork = emptySurfaceArtwork();
  artwork.items['model:gguf:qwen25-15b'] = { assetId: 'older-icon', prompt: 'Old Qwen icon' };
  const targets = modelIconStudioTargets(artwork);
  const qwen = targets.find((item) => item.id === 'model-family:gguf:qwen');
  assert.ok(qwen);
  assert.equal(targets.filter((item) => item.id === qwen.id).length, 1);
  assert.ok(qwen.legacyKeys.length >= 3);
  assert.equal(qwen.currentAssetId, 'older-icon');
  assert.ok(!plannedIconStudioTargets(targets, ['models'], 'missing', []).includes(qwen));
});

test('batch plans include hidden achievements and respect uploaded icons', () => {
  const artwork = emptySurfaceArtwork();
  artwork.items['achievement:first-conversation'] = { assetId: 'uploaded-icon', prompt: '' };
  const identity = {
    id: 'mira',
    name: 'Mira',
    focus: 'general',
    icon: 'person',
    instructions: 'Helps with plots',
    avatarAssetId: 'generated-icon',
  };
  const targets = iconStudioTargets(artwork, [identity]);
  assert.equal(targets.filter((item) => item.kind === 'achievements').length, ACHIEVEMENTS.length);
  assert.ok(
    ACHIEVEMENTS.some(
      (item) => item.secret && targets.some((target) => target.id === `achievement:${item.id}`),
    ),
  );
  const assets = [
    { id: 'uploaded-icon', source: 'uploaded' },
    { id: 'generated-icon', source: 'generated' },
  ];
  const planned = plannedIconStudioTargets(
    targets,
    ['achievements', 'identities'],
    'preserve-uploads',
    assets,
  );
  assert.ok(!planned.some((item) => item.id === 'achievement:first-conversation'));
  assert.ok(planned.some((item) => item.id === 'mira'));
  assert.ok(
    !plannedIconStudioTargets(targets, ['identities'], 'missing', assets).some((item) => item.id === 'mira'),
  );
  assert.ok(
    plannedIconStudioTargets(targets, ['identities'], 'all', assets).some((item) => item.id === 'mira'),
  );
});

test('batch prompt applies editable style and text policy globally', () => {
  const target = {
    kind: 'models',
    id: 'model-family:gguf:qwen',
    label: 'Qwen',
    basePrompt: 'An original symbol representing the Qwen model family.',
  };
  assert.equal(
    iconStudioPrompt(target, 'Readable pixel art', 'No letters or logos.'),
    'An original symbol representing the Qwen model family. Style: Readable pixel art. No letters or logos.',
  );
  assert.ok(!target.basePrompt.includes('pixel'));
});

test('custom achievement sets generate and replace only their own icons', () => {
  const first = createAchievementSet('First', 'Bright icons.');
  const second = createAchievementSet('Second', 'Quiet icons.');
  first.entries['first-conversation'].imagePrompt = 'A rising spark.';
  const artwork = emptySurfaceArtwork();
  artwork.items['achievement:first-conversation'] = { assetId: 'original-icon', prompt: '' };
  artwork.items[achievementArtworkKey(second.id, 'first-conversation')] = { assetId: 'second-icon', prompt: '' };
  const target = iconStudioTargets(artwork, [], first).find(item => item.kind === 'achievements' && item.id.endsWith(':first-conversation'));
  assert.equal(target.id, achievementArtworkKey(first.id, 'first-conversation'));
  assert.equal(target.basePrompt, 'A rising spark.');
  assert.equal(target.currentAssetId, undefined);
  assert.ok(plannedIconStudioTargets([target], ['achievements'], 'missing', []).includes(target));
});
