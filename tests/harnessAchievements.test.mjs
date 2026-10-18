import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, createManifest } from '../src/harnessData.ts';
import { ACHIEVEMENTS, emptyAchievementCounts, emptyAchievementLedger, incrementAchievementLedger, mergeAchievementLedger, scanAchievementInventory, scanAchievements, visibleAchievements } from '../src/harnessAchievements.ts';
import { HarnessStore } from '../src/harnessStore.ts';

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
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

test('achievement scan counts saved messages in chunks, diagnostics, distinct models, and generated artwork', async () => {
  const manifest = createManifest();
  const meta = { id: 'session-1', projectId: 'home', messageCount: 30 };
  const messages = Array.from({ length: 30 }, (_, seq) => ({
    id: `m-${seq}`, seq, role: seq % 2 ? 'assistant' : 'user',
    ...(seq % 2 ? { inputTokens: 100, outputTokens: 40, model: { provider: seq < 15 ? 'browser' : 'openai', model: seq < 15 ? 'one' : 'two' }, toolEvents: seq === 1 ? ['tool completed'] : [], hasDiagnostics: seq === 1 } : {}),
  }));
  const reads = [];
  const store = {
    sessions: async () => [meta],
    avatarLibrary: async () => [{ source: 'generated' }, { source: 'uploaded' }, { source: 'generated' }],
    messages: async (_meta, from, to) => { reads.push([from, to]); return messages.slice(from, to); },
    responseDiagnostic: async () => ({ usage: { elapsedMs: 90_000 } }),
  };
  const progress = [];
  const counts = await scanAchievements(store, manifest, (done, total) => progress.push([done, total]));
  assert.deepEqual(reads, [[0, 24], [24, 30]]);
  assert.deepEqual(progress.at(-1), [2, 2]);
  assert.equal(counts.conversations, 1);
  assert.equal(counts.messagesSent, 15);
  assert.equal(counts.messagesReceived, 15);
  assert.equal(counts.inputTokens, 1500);
  assert.equal(counts.outputTokens, 600);
  assert.equal(counts.responseSeconds, 90);
  assert.equal(counts.models, 2);
  assert.equal(counts.modelTypes, 2);
  assert.equal(counts.generatedArtwork, 2);
  assert.equal(counts.toolCalls, 1);
  const inventory = await scanAchievementInventory(store, manifest);
  assert.deepEqual(inventory.modelsSeen.sort(), ['browser:one', 'openai:two']);
  assert.deepEqual(inventory.modelTypesSeen.sort(), ['browser', 'openai']);
});

test('milestones keep high-water marks and reveal chained hidden goals', () => {
  const counts = { ...emptyAchievementCounts(), conversations: 5, messagesSent: 1, generatedArtwork: 1 };
  const earned = mergeAchievementLedger(emptyAchievementLedger(), counts, '2026-10-18T00:00:00.000Z');
  assert.equal(earned.unlockedAt['first-conversation'], '2026-10-18T00:00:00.000Z');
  assert.equal(earned.unlockedAt['five-conversations'], '2026-10-18T00:00:00.000Z');
  assert.equal(earned.unlockedAt['first-image'], '2026-10-18T00:00:00.000Z');
  assert.equal(visibleAchievements(earned).find(item => item.achievement.id === 'twenty-five-conversations').hidden, false);
  assert.equal(visibleAchievements(emptyAchievementLedger()).find(item => item.achievement.id === 'twenty-five-conversations').hidden, true);
  const smaller = mergeAchievementLedger(earned, emptyAchievementCounts(), '2026-10-19T00:00:00.000Z');
  assert.equal(smaller.counts.conversations, 5);
  assert.equal(smaller.unlockedAt['first-conversation'], earned.unlockedAt['first-conversation']);
  assert.ok(ACHIEVEMENTS.every(item => Number.isFinite(item.target) && item.target > 0));
  const incremented = incrementAchievementLedger(smaller, { conversations: 1 }, '2026-10-20T00:00:00.000Z');
  assert.equal(incremented.counts.conversations, 6);
  assert.throws(() => incrementAchievementLedger(smaller, { conversations: -1 }), /Invalid achievement increment/);
});

test('achievement ledger persists in a portable folder and serializes updates', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('achievement-test', folder);
  const first = { ...emptyAchievementCounts(), conversations: 5 };
  const second = { ...emptyAchievementCounts(), generatedArtwork: 10 };
  await Promise.all([store.updateAchievementLedger(first), store.updateAchievementLedger(second)]);
  const reopened = new HarnessStore('achievement-test', folder);
  const ledger = await reopened.achievementLedger();
  assert.equal(ledger.counts.conversations, 5);
  assert.equal(ledger.counts.generatedArtwork, 10);
  assert.ok(ledger.unlockedAt['five-conversations']);
  assert.ok(ledger.unlockedAt['ten-images']);
});

test('saving a second project unlocks its milestone without a history scan', async () => {
  const store = new HarnessStore('achievement-projects', new MemoryDirectory());
  const manifest = createManifest('achievement-projects');
  await store.saveManifest({ ...manifest, projects: [...manifest.projects, { ...manifest.projects[0], id: 'second', name: 'Second' }] });
  await store.recordAchievementMetrics({}); // Wait for the background project observation.
  const ledger = await store.achievementLedger();
  assert.equal(ledger.counts.projects, 2);
  assert.ok(ledger.unlockedAt['two-projects']);
});

test('saved chat and diagnostics update milestones without rescanning, and repeated diagnostics do not count twice', async () => {
  const folder = new MemoryDirectory();
  const store = new HarnessStore('achievement-automatic', folder);
  const meta = createConversation('home');
  await store.updateSessions('home', sessions => [meta, ...sessions]);
  const user = await store.appendConversationMessage(meta, { id: 'user-1', role: 'user', content: 'Hi', createdAt: new Date().toISOString() });
  await store.appendConversationMessage(user.meta, { id: 'answer-1', role: 'assistant', content: 'Hello', createdAt: new Date().toISOString(), inputTokens: 1100, outputTokens: 1200, toolEvents: ['one tool'], model: { provider: 'browser', model: 'one', engine: 'Wllama' } });
  const report = { version: 2, usage: { elapsedMs: 63_000 } };
  await store.saveResponseDiagnostic('home', meta.id, 'answer-1', report);
  await store.saveResponseDiagnostic('home', meta.id, 'answer-1', report);
  await store.recordAchievementMetrics({}); // Wait for queued, nonblocking activity updates.
  const ledger = await new HarnessStore('achievement-automatic', folder).achievementLedger();
  assert.equal(ledger.counts.messagesSent, 1);
  assert.equal(ledger.counts.messagesReceived, 1);
  assert.equal(ledger.counts.inputTokens, 1100);
  assert.equal(ledger.counts.outputTokens, 1200);
  assert.equal(ledger.counts.toolCalls, 1);
  assert.equal(ledger.counts.responseSeconds, 63);
  assert.equal(ledger.counts.models, 1);
  assert.equal(ledger.counts.modelTypes, 1);
  assert.ok(ledger.unlockedAt['first-message']);
  assert.ok(ledger.unlockedAt['first-answer']);
  assert.ok(ledger.unlockedAt['response-minute']);
  await store.recordAchievementMetrics({}, { provider: 'openai', model: 'two', engine: 'API' });
  const explored = await store.achievementLedger();
  assert.equal(explored.counts.models, 2);
  assert.equal(explored.counts.modelTypes, 2);
  assert.ok(explored.unlockedAt['two-models']);
  assert.ok(explored.unlockedAt['two-model-types']);
});

test('successful image generation emits one achievement event; failed generation emits none', async () => {
  const { generateImage, setImageGeneratedRecorder } = await import('../src/imageGeneration.ts');
  const originalFetch = globalThis.fetch;
  let events = 0;
  const release = setImageGeneratedRecorder(async () => { events++; });
  const config = { preset: 'tiny-sd', provider: 'compatible', endpoint: 'https://image-test.invalid/v1', model: 'test', apiKey: '' };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const image = await generateImage(config, 'A leaf');
    assert.equal(image.size, 3);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(events, 1);
    globalThis.fetch = async () => new Response('failed', { status: 500 });
    await assert.rejects(generateImage(config, 'A leaf'), /Image request failed/);
    assert.equal(events, 1);
  } finally { release(); globalThis.fetch = originalFetch; }
});
