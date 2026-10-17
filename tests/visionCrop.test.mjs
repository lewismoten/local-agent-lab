import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCropCorners, CROP_TARGET_CORNERS, mapQuadToUnit, mapUnitToQuad, parseCropCorners } from '../src/visionCrop.ts';

test('projective mapping sends the four document corners to a rectangle and back', () => {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  corners.forEach(([u, v], index) => {
    const [x, y] = mapUnitToQuad(CROP_TARGET_CORNERS, u, v);
    assert.ok(Math.abs(x - CROP_TARGET_CORNERS[index][0]) < 1e-6);
    assert.ok(Math.abs(y - CROP_TARGET_CORNERS[index][1]) < 1e-6);
    const [roundTripU, roundTripV] = mapQuadToUnit(CROP_TARGET_CORNERS, x, y);
    assert.ok(Math.abs(roundTripU - u) < 1e-6);
    assert.ok(Math.abs(roundTripV - v) < 1e-6);
  });
});

test('crop analysis accepts plausible pixel or normalized corners and rejects unusable selections', () => {
  const answer = `Here are the corners:\n\`\`\`json\n${JSON.stringify({ corners: CROP_TARGET_CORNERS })}\n\`\`\``;
  assert.equal(analyzeCropCorners(answer).passed, true);
  assert.deepEqual(parseCropCorners(JSON.stringify({ corners: [[.2, .12], [.85, .23], [.76, .85], [.13, .74]] })).length, 4);
  assert.equal(analyzeCropCorners('{"corners":[[0,0],[511,0],[511,319],[0,319]]}').passed, false);
  assert.equal(parseCropCorners('{"corners":[[10,10],[20,10],[20,10],[10,10]]}'), null);
  const bonsaiAnswer = '[10, 10, 502, 318]\n[502, 10, 502, 318]\n[502, 318, 492, 502]\n[492, 318, 502, 502]';
  assert.equal(analyzeCropCorners(bonsaiAnswer).passed, false);
  assert.match(analyzeCropCorners(bonsaiAnswer).detail, /four-number boxes/);
  const bonsaiPointAnswer = '```json\n[{"point":[0,178],"bbox_2d":[0,178,51,288]},{"point":[51,178],"bbox_2d":[51,178,102,288]},{"point":[102,178],"bbox_2d":[102,178,153,288]},{"point":[153,178],"bbox_2d":[153,178,204,288]}]\n```';
  assert.equal(parseCropCorners(bonsaiPointAnswer), null);
  assert.match(analyzeCropCorners(bonsaiPointAnswer).detail, /same line/);
  const objectPointAnswer = JSON.stringify(CROP_TARGET_CORNERS.map(point => ({ point, label: 'corner' })));
  assert.equal(analyzeCropCorners(objectPointAnswer).passed, true);
  const revisedAnswer = '```json\n{"corners":[[1+2,3],[4,5],[6,7],[8,9]]}\n```\nCorrection:\n```json\n{"corners":[[263,159],[475,158],[511,277],[12,278]]}\n```';
  assert.deepEqual(parseCropCorners(revisedAnswer), [[263,159],[475,158],[511,277],[12,278]]);
  assert.match(analyzeCropCorners(revisedAnswer).detail, /Corners found/);
});
