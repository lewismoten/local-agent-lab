import test from 'node:test';
import assert from 'node:assert/strict';
import { browserImageAssetsManager, getBrowserImageAssets } from '../src/browserImageAssets.ts';
import { speechAssetsManager, getSpeechAssets } from '../src/speechAssets.ts';
import { transcriptionAssetsManager, getTranscriptionAssets } from '../src/transcriptionAssets.ts';

function emptyFolder() {
  return {
    async getDirectoryHandle() { throw new DOMException('Missing directory', 'NotFoundError'); },
  };
}

for (const [name, manager, snapshot] of [
  ['image', browserImageAssetsManager, getBrowserImageAssets],
  ['speech', speechAssetsManager, getSpeechAssets],
  ['transcription', transcriptionAssetsManager, getTranscriptionAssets],
]) {
  test(`${name} downloads do not carry a paused queue onto another drive`, async () => {
    const first = emptyFolder();
    const second = emptyFolder();
    await manager.discover(first);
    manager.pause();
    manager.queue(first, 'engine');
    assert.deepEqual(snapshot().queue, ['engine']);
    assert.equal(snapshot().paused, true);

    await manager.discover(second);
    assert.equal(snapshot().folder, second);
    assert.deepEqual(snapshot().queue, []);
    assert.equal(snapshot().paused, false);
    assert.equal(snapshot().active, null);
  });
}

test('eject waits for an image asset scan to release its workspace handle', async () => {
  let release;
  let firstCall = true;
  const gate = new Promise(resolve => { release = resolve; });
  const folder = {
    async getDirectoryHandle() {
      if (firstCall) { firstCall = false; await gate; }
      throw new DOMException('Missing directory', 'NotFoundError');
    },
  };
  const scan = browserImageAssetsManager.discover(folder);
  let settled = false;
  const pause = browserImageAssetsManager.pauseAndWait().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await Promise.all([scan, pause]);
  assert.equal(settled, true);
});

test('a failed asset scan releases the workspace for eject', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const folder = {
    async getDirectoryHandle() { await gate; throw new Error('Drive read failed'); },
  };
  const scan = browserImageAssetsManager.discover(folder);
  const pause = browserImageAssetsManager.pauseAndWait();
  release();
  await assert.rejects(scan, /Drive read failed/);
  await pause;
});
