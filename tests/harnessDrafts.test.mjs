import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessDrafts } from '../src/harnessDrafts.ts';

test('switching conversations flushes the previous draft before loading the next', async () => {
  const saved = new Map();
  const store = {
    async draft(project, session) { return saved.get(`${project}:${session}`) || ''; },
    async saveDraft(project, session, text) { saved.set(`${project}:${session}`, text); },
  };
  const drafts = new HarnessDrafts(error => { throw error; }, 10_000);
  assert.equal(await drafts.open(store, 'home', 'first'), '');
  drafts.update('Draft for first');
  assert.equal(await drafts.open(store, 'home', 'second'), '');
  assert.equal(saved.get('home:first'), 'Draft for first');
  drafts.update('Draft for second');
  await drafts.flush();
  assert.equal(await drafts.open(store, 'home', 'first'), 'Draft for first');
  assert.equal(saved.get('home:second'), 'Draft for second');
});

test('rapid draft switches ignore a superseded load', async () => {
  const store = { async draft(_project, session) { return session; }, async saveDraft() {} };
  const drafts = new HarnessDrafts(error => { throw error; }, 10_000);
  const first = drafts.open(store, 'home', 'first');
  const second = drafts.open(store, 'home', 'second');
  assert.equal(await first, null);
  assert.equal(await second, 'second');
});

test('an async attachment only appends to the conversation that opened it', async () => {
  const saved = new Map();
  const store = { async draft(project, session) { return saved.get(`${project}:${session}`) || ''; }, async saveDraft(project, session, text) { saved.set(`${project}:${session}`, text); } };
  const drafts = new HarnessDrafts(error => { throw error; }, 10_000);
  await drafts.open(store, 'home', 'first');
  drafts.update('Review this code.');
  assert.equal(drafts.appendTo(store, 'home', 'first', 'Use library/design.md.'), 'Review this code.\n\nUse library/design.md.');
  await drafts.open(store, 'home', 'second');
  assert.equal(drafts.appendTo(store, 'home', 'first', 'Late upload'), null);
  assert.equal(saved.get('home:first'), 'Review this code.\n\nUse library/design.md.');
});

test('failed send restores its original draft after navigating to another conversation', async () => {
  const saved = new Map();
  const store = { async draft(project, session) { return saved.get(`${project}:${session}`) || ''; }, async saveDraft(project, session, text) { saved.set(`${project}:${session}`, text); } };
  const drafts = new HarnessDrafts(error => { throw error; }, 10_000);
  await drafts.open(store, 'home', 'first');
  drafts.update('');
  await drafts.open(store, 'home', 'second');
  drafts.update('Current second draft');
  assert.equal(await drafts.restoreTo(store, 'home', 'first', 'Unsent first prompt'), false);
  assert.equal(saved.get('home:first'), 'Unsent first prompt');
  assert.equal(await drafts.open(store, 'home', 'second'), 'Current second draft');
  assert.equal(await drafts.restoreTo(store, 'home', 'second', 'Restored second prompt'), true);
  assert.equal(saved.get('home:second'), 'Restored second prompt');
});

test('a workspace switch waits for edits made during an in-flight draft save', async () => {
  const saved = new Map();
  let releaseFirstSave;
  let firstSaveStarted;
  const started = new Promise(resolve => { firstSaveStarted = resolve; });
  const firstSave = new Promise(resolve => { releaseFirstSave = resolve; });
  let writes = 0;
  const store = {
    async draft(project, session) { return saved.get(`${project}:${session}`) || ''; },
    async saveDraft(project, session, text) {
      if (++writes === 1) { firstSaveStarted(); await firstSave; }
      saved.set(`${project}:${session}`, text);
    },
  };
  const drafts = new HarnessDrafts(error => { throw error; }, 10_000);
  await drafts.open(store, 'home', 'first');
  drafts.update('Earlier text');
  const switchToSecond = drafts.open(store, 'home', 'second');
  await started;
  drafts.update('Latest text');
  releaseFirstSave();
  assert.equal(await switchToSecond, '');
  assert.equal(saved.get('home:first'), 'Latest text');
  assert.equal(writes, 2);
});
