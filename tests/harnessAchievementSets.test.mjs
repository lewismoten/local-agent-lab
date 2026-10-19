import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HarnessStore } from '../src/harnessStore.ts';
import { ACHIEVEMENTS } from '../src/harnessAchievements.ts';
import { generateAchievementSetDraft, parseAchievementRows } from '../src/harnessAchievementGeneration.ts';
import { iconStudioTargets } from '../src/harnessIconStudioPlan.ts';
import { emptySurfaceArtwork } from '../src/harnessSurfaceArtwork.ts';
import { exportAchievementSetPack, packedIconBlob, readAchievementSetPack } from '../src/harnessAchievementPack.ts';
import {
  activeAchievementSet,
  achievementArtworkKey,
  achievementWithCopy,
  createAchievementSet,
  emptyAchievementSetLibrary,
  validAchievementSet,
  validAchievementSetLibrary,
} from '../src/harnessAchievementSets.ts';

class FileHandle {
  kind = 'file';
  constructor(name) {
    this.name = name;
    this.blob = new Blob([]);
  }
  async getFile() {
    return new File([this.blob], this.name);
  }
  async createWritable() {
    return {
      write: async (value) => {
        this.blob = value instanceof Blob ? value : new Blob([value]);
      },
      close: async () => {},
    };
  }
}
class DirectoryHandle {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) {
      item = new DirectoryHandle();
      this.children.set(name, item);
    }
    if (!item || item.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return item;
  }
  async getFileHandle(name, options = {}) {
    let item = this.children.get(name);
    if (!item && options.create) {
      item = new FileHandle(name);
      this.children.set(name, item);
    }
    if (!item || item.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return item;
  }
}

test('achievement packs cover every milestone and change copy without changing its scoring', () => {
  const set = createAchievementSet('Playful', 'Make milestones witty.');
  assert.equal(Object.keys(set.entries).length, ACHIEVEMENTS.length);
  set.entries['first-conversation'].title = 'First spark';
  const rendered = achievementWithCopy(ACHIEVEMENTS[0], set);
  assert.equal(rendered.title, 'First spark');
  assert.equal(rendered.metric, 'conversations');
  assert.equal(rendered.target, 1);
  assert.equal(ACHIEVEMENTS[0].title, 'First contact');
  set.entries['first-conversation'].imagePrompt = 'A conversation starting at dawn.';
  assert.equal(
    iconStudioTargets(emptySurfaceArtwork(), [], set).find(
      (item) => item.id === achievementArtworkKey(set.id, 'first-conversation'),
    ).basePrompt,
    'A conversation starting at dawn.',
  );
  assert.equal(validAchievementSet(set), true);
  delete set.entries['five-projects'];
  assert.equal(validAchievementSet(set), false);
});

test('set packs carry scoped PNG artwork between workspaces', async () => {
  const source = new HarnessStore('achievement-pack-source', new DirectoryHandle());
  const set = createAchievementSet('Illustrated', 'Bright milestones.');
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xXcAAAAASUVORK5CYII=', 'base64'));
  const asset = await source.saveAvatarAsset(new Blob([png], { type: 'image/png' }), { title: 'Award icon', tags: ['Achievement'], source: 'uploaded' });
  await source.saveSurfaceArtwork(achievementArtworkKey(set.id, 'first-conversation'), asset.id, 'A bright spark.');
  const pack = await exportAchievementSetPack(source, set);
  assert.equal(pack.icons['first-conversation'].prompt, 'A bright spark.');
  assert.equal((await packedIconBlob(pack.icons['first-conversation']).arrayBuffer()).byteLength, png.length);
  const imported = readAchievementSetPack(JSON.parse(JSON.stringify(pack)));
  assert.equal(imported.set.id, set.id);
  assert.equal(Object.keys(imported.icons).length, 1);
  const destinationFolder = new DirectoryHandle();
  const destination = new HarnessStore('achievement-pack-destination', destinationFolder);
  const destinationSet = { ...imported.set, id: crypto.randomUUID() };
  const destinationAsset = await destination.saveAvatarAsset(packedIconBlob(imported.icons['first-conversation']), {
    title: 'Imported award icon', tags: ['Achievement'], source: 'uploaded',
  });
  await destination.saveSurfaceArtworkBatch({
    [achievementArtworkKey(destinationSet.id, 'first-conversation')]: {
      assetId: destinationAsset.id, prompt: imported.icons['first-conversation'].prompt,
    },
  });
  await destination.updateAchievementSets(() => ({ version: 1, activeId: destinationSet.id, sets: [destinationSet] }));
  const reopened = new HarnessStore('achievement-pack-destination', destinationFolder);
  assert.equal(activeAchievementSet(await reopened.achievementSets())?.name, 'Illustrated');
  const storedIcon = (await reopened.surfaceArtwork()).items[achievementArtworkKey(destinationSet.id, 'first-conversation')];
  assert.equal(storedIcon.prompt, 'A bright spark.');
  assert.equal((await reopened.avatarAsset(storedIcon.assetId)).size, png.length);
  assert.deepEqual(readAchievementSetPack(set).icons, {});
  assert.throws(() => readAchievementSetPack({ ...pack, icons: { 'first-conversation': { png: Buffer.from('bad').toString('base64'), prompt: 'X' } } }), /compact PNG/);
});

test('achievement set selection and edits persist on a reopened workspace', async () => {
  const folder = new DirectoryHandle();
  const store = new HarnessStore('achievement-packs', folder);
  assert.deepEqual(await store.achievementSets(), emptyAchievementSetLibrary());
  const first = createAchievementSet('Awards', 'Celebrate each milestone.');
  const second = createAchievementSet('Funny', 'Write concise comic titles.');
  await Promise.all([
    store.updateAchievementSets((current) => ({ ...current, sets: [...current.sets, first] })),
    store.updateAchievementSets((current) => ({
      ...current,
      sets: [...current.sets, second],
      activeId: second.id,
    })),
  ]);
  const reopened = new HarnessStore('achievement-packs', folder);
  const saved = await reopened.achievementSets();
  assert.equal(saved.sets.length, 2);
  assert.equal(activeAchievementSet(saved)?.name, 'Funny');
  await assert.rejects(
    reopened.updateAchievementSets((current) => ({ ...current, activeId: 'missing' })),
    /incomplete/,
  );
  assert.equal((await reopened.achievementSets()).activeId, second.id);
  assert.equal(validAchievementSetLibrary({ ...saved, sets: [first, first] }), false);
});

test('model drafts require the requested IDs and usable icon subjects', () => {
  const ids = ['first-conversation', 'five-conversations'];
  const rows = [
    {
      id: ids[0],
      title: 'Hello world',
      description: 'Start your first conversation.',
      imagePrompt: 'A glowing speech bubble opening.',
    },
    {
      id: ids[1],
      title: 'Five signals',
      description: 'Start five conversations.',
      imagePrompt: 'Five linked speech bubbles.',
    },
  ];
  assert.equal(
    parseAchievementRows(`\`\`\`json\n${JSON.stringify(rows)}\n\`\`\``, ids)[ids[1]].title,
    'Five signals',
  );
  assert.throws(() => parseAchievementRows(JSON.stringify([...rows, rows[1]]), ids), /wrong number/);
  assert.throws(
    () => parseAchievementRows(JSON.stringify([{ ...rows[0], id: 'unknown' }, rows[1]]), ids),
    /changed an achievement ID/,
  );
  assert.throws(
    () => parseAchievementRows(JSON.stringify([{ ...rows[0], imagePrompt: '' }, rows[1]]), ids),
    /incomplete copy/,
  );
});

test('small-model batch generation covers hidden goals without changing milestones', async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const prompt = input.messages.at(-1).content;
    const facts = JSON.parse(prompt.slice(prompt.indexOf('[{')));
    requests++;
    const rows = facts.map(({ id, target }) => ({
      id,
      title: `Award ${id}`,
      description: `Reach ${target} for this goal.`,
      imagePrompt: `A symbol for ${id}.`,
    }));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rows) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = {
      id: 'test',
      label: 'Test',
      provider: 'compatible',
      model: 'mock',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      apiKey: '',
      effort: 'default',
      thinkingTokens: 0,
      maxOutputTokens: 512,
      contextWindow: 4096,
    };
    const progress = [];
    const set = await generateAchievementSetDraft(
      config,
      'Space awards',
      'Optimistic future.',
      new AbortController().signal,
      (done, total) => progress.push([done, total]),
    );
    assert.equal(Object.keys(set.entries).length, ACHIEVEMENTS.length);
    assert.equal(set.entries['twenty-five-conversations'].title, 'Award twenty-five-conversations');
    assert.deepEqual(progress.at(-1), [ACHIEVEMENTS.length, ACHIEVEMENTS.length]);
    assert.equal(requests, Math.ceil(ACHIEVEMENTS.length / 2));
    assert.equal(ACHIEVEMENTS[0].target, 1);
  } finally {
    server.close();
  }
});
