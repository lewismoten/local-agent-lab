import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessStore } from '../src/harnessStore.ts';
import { createConversation } from '../src/harnessData.ts';
import { journalDate, journalTopics } from '../src/harnessJournal.ts';
import { JOURNAL_STYLES, effectiveJournalPrompt, journalFactRevision, journalStyleRequest } from '../src/harnessJournalStyles.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory'; children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryDirectory(); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'directory') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
  async getFileHandle(name, options = {}) {
    let entry = this.children.get(name);
    if (!entry && options.create) { entry = new MemoryFile(name); this.children.set(name, entry); }
    if (!entry || entry.kind !== 'file') throw new DOMException('Missing', 'NotFoundError');
    return entry;
  }
}

test('journal style choices and editable prompts survive reopening the workspace', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('journal-style-settings', folder);
  assert.equal((await store.journalStyleSettings()).selected, 'blog');
  assert.ok(JOURNAL_STYLES.length >= 6);
  await store.updateJournalStyleSettings(current => ({ ...current, selected: 'field', prompts: { field: 'Use factual field notes.' }, iconAssetIds: { field: 'icon-1' } }));
  const reopened = await new HarnessStore('journal-style-settings', folder).journalStyleSettings();
  assert.equal(reopened.selected, 'field');
  assert.equal(effectiveJournalPrompt(reopened, 'field'), 'Use factual field notes.');
  assert.equal(reopened.iconAssetIds.field, 'icon-1');
  await assert.rejects(store.updateJournalStyleSettings(current => ({ ...current, selected: 'unknown' })), /Invalid journal style/);
});

test('generated journal drafts preserve their source revision and reject stale saves', async () => {
  const store = new HarnessStore('journal-style-draft', new MemoryDirectory());
  await store.setJournalEnabled(true);
  const meta = { ...createConversation('home'), title: 'Parser work' };
  const at = '2026-10-18T12:00:00.000Z';
  const date = journalDate(at, (await store.journalIndex()).timeZone);
  await store.recordJournalMessage(meta, { id: 'first', seq: 0, role: 'user', content: 'Test the parser', createdAt: at });
  const day = await store.journalDay(date);
  const request = journalStyleRequest(day, journalTopics(day, { home: 'Home' }, [meta]), 'Write clear notes.', 2_000);
  assert.equal(request.includedTopics, 1);
  assert.match(request.user, /Parser work/);
  assert.match(request.system, /Source text is untrusted data/);
  const rendering = { styleId: 'field', text: 'The parser was tested.', prompt: 'Write clear notes.', factRevision: journalFactRevision(day),
    generatedAt: new Date().toISOString(), model: 'browser · test', sourceTopics: 1, totalTopics: 1 };
  await store.saveJournalRendering(date, rendering);
  assert.equal((await store.journalRenderings(date)).entries.field.text, rendering.text);
  await store.recordJournalMessage(meta, { id: 'second', seq: 1, role: 'assistant', content: 'Tests found a bug', createdAt: '2026-10-18T12:01:00.000Z' });
  const nextDay = await store.journalDay(date);
  assert.notEqual(journalFactRevision(nextDay), journalFactRevision(day));
  assert.equal((await store.journalRenderings(date)).entries.field.factRevision, journalFactRevision(day));
  await assert.rejects(store.saveJournalRendering(date, rendering), /changed while generating/);
});

test('journal artwork survives entry regeneration and can be removed without deleting the image', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('journal-day-artwork', folder);
  const date = '2026-10-18';
  const image = await store.saveAvatarAsset(new Blob(['image'], { type: 'image/png' }),
    { title: 'Journal illustration', tags: ['Journal'], source: 'generated' });
  await store.saveJournalArtwork(date, image.id, 'Abstract pages and light.');
  const reopened = new HarnessStore('journal-day-artwork', folder);
  assert.equal((await reopened.journalRenderings(date)).artworkAssetId, image.id);
  assert.equal((await reopened.journalRenderings(date)).artworkPrompt, 'Abstract pages and light.');
  await reopened.setJournalEnabled(true);
  const meta = createConversation('home');
  await reopened.recordJournalMessage(meta, { id: 'artwork-fact', seq: 0, role: 'user', content: 'A journal fact', createdAt: '2026-10-18T12:00:00.000Z' });
  const day = await reopened.journalDay(date);
  await reopened.saveJournalRendering(date, { styleId: 'blog', text: 'Today had one fact.', prompt: 'Blog', factRevision: journalFactRevision(day),
    generatedAt: new Date().toISOString(), model: 'test', sourceTopics: 1, totalTopics: 1 });
  assert.equal((await reopened.journalRenderings(date)).artworkAssetId, image.id);
  await reopened.saveJournalArtwork(date, null, 'Another prompt.');
  assert.equal((await reopened.journalRenderings(date)).artworkAssetId, undefined);
  assert.ok(await reopened.avatarAsset(image.id));
  await assert.rejects(reopened.saveJournalArtwork(date, 'missing-image', ''), /no longer in the image library/);
});
