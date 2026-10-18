import assert from 'node:assert/strict';
import { registerResidentModel, withLocalModelMemory } from '../src/localModelMemory.ts';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let loaded = true;
let unloads = 0;
registerResidentModel('idle-check', () => loaded, async () => { loaded = false; unloads++; }, 40);

await withLocalModelMemory(async () => {});
await wait(15);
await withLocalModelMemory(async () => {
  await wait(65);
  assert.equal(loaded, true, 'an active operation must retain its model');
});
assert.equal(loaded, true, 'the idle period starts after the operation');
await wait(90);
assert.equal(loaded, false, 'the idle model should be unloaded');
assert.equal(unloads, 1, 'the model should be unloaded once');
console.log('Idle model unload: active work retained; idle model released.');
