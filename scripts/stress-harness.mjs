/** Repeatable local history workload. Run: node scripts/stress-harness.mjs --mb 100 --latency-ms 1 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HarnessStore } from '../src/harnessStore.ts';
import { chunkSearchBits, createConversation, MESSAGE_CHUNK_SIZE } from '../src/harnessData.ts';
import { compactConversation } from '../src/harnessContext.ts';
import { readBlob, writeBlob } from '../src/storage.ts';

const numberArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
};
const targetBytes = Math.floor(numberArg('--mb', 100) * 1024 * 1024);
const latencyMs = numberArg('--latency-ms', 0);
if (targetBytes <= 0) throw new Error('--mb must be greater than zero.');
const pause = () => latencyMs ? new Promise(resolve => setTimeout(resolve, latencyMs)) : Promise.resolve();
const elapsed = async (label, action) => {
  const start = performance.now();
  const value = await action();
  console.log(`${label}: ${((performance.now() - start) / 1000).toFixed(2)} s`);
  return value;
};

class Directory {
  kind = 'directory';
  constructor(location, stats) { this.location = location; this.stats = stats; }
  async getDirectoryHandle(name, options = {}) {
    await pause(); this.stats.lookups++;
    const location = path.join(this.location, name);
    if (options.create) await mkdir(location, { recursive: true });
    else {
      try { if (!(await stat(location)).isDirectory()) throw new Error('Expected a directory'); }
      catch (error) { if (error.code === 'ENOENT') throw new DOMException('Missing directory', 'NotFoundError'); throw error; }
    }
    return new Directory(location, this.stats);
  }
  async getFileHandle(name, options = {}) {
    await pause(); this.stats.lookups++;
    const location = path.join(this.location, name);
    if (!options.create) {
      try { await stat(location); }
      catch (error) { if (error.code === 'ENOENT') throw new DOMException('Missing file', 'NotFoundError'); throw error; }
    }
    const stats = this.stats;
    return {
      kind: 'file', name,
      async getFile() { await pause(); stats.reads++; return new File([await readFile(location)], name); },
      async createWritable() {
        let data;
        return { async write(value) { data = value instanceof Blob ? value : new Blob([value]); },
          async close() { await pause(); stats.writes++; await writeFile(location, new Uint8Array(await data.arrayBuffer())); } };
      },
    };
  }
  async removeEntry(name, options = {}) { await rm(path.join(this.location, name), { recursive: !!options.recursive }); }
}

const directory = await mkdtemp(path.join(tmpdir(), 'local-agent-stress-'));
const stats = { lookups: 0, reads: 0, writes: 0 };
const folder = new Directory(directory, stats);
const store = new HarnessStore('stress-workspace', folder);
const source = createConversation('home');
const root = `harness/projects/home/sessions/${source.id}`;
const payload = 'Coding research decisions and file review. '.repeat(145);
let bytes = 0, count = 0, group = [], newest = [];
console.log(`Target: ${(targetBytes / 1048576).toFixed(1)} MiB · simulated lookup latency: ${latencyMs} ms`);
try {
  await elapsed('Create indexed history', async () => {
    while (bytes < targetBytes) {
      const chunk = Array.from({ length: MESSAGE_CHUNK_SIZE }, (_, offset) => {
        const seq = count + offset;
        const date = new Date(Date.UTC(2025, 0, 1) + Math.floor(seq / 100) * 86400000).toISOString();
        return { id: `m-${seq}`, seq, role: seq % 2 ? 'assistant' : 'user', createdAt: date,
          content: `${seq === 12 ? 'ancient_unique_marker ' : ''}${payload} Message ${seq}.` };
      });
      const blob = new Blob([JSON.stringify(chunk)]);
      const number = count / MESSAGE_CHUNK_SIZE;
      await writeBlob(folder, `${root}/chunks/${String(number).padStart(6, '0')}.json`, blob);
      group.push(chunkSearchBits(chunk));
      if (group.length === 64) {
        await writeBlob(folder, `${root}/search/${String(Math.floor(number / 64)).padStart(6, '0')}.json`, new Blob([JSON.stringify({ version: 1, chunks: group })]));
        group = [];
      }
      bytes += blob.size; count += chunk.length; newest = chunk;
    }
    if (group.length) await writeBlob(folder, `${root}/search/${String(Math.floor((count / MESSAGE_CHUNK_SIZE - 1) / 64)).padStart(6, '0')}.json`, new Blob([JSON.stringify({ version: 1, chunks: group })]));
  });
  const meta = { ...source, messageCount: count, activeFrom: count - MESSAGE_CHUNK_SIZE };
  const before = { ...stats };
  const hits = await elapsed('Search oldest indexed message', () => store.searchMessages(meta, 'ancient_unique_marker', 8));
  assert.deepEqual(hits.map(item => item.seq), [12]);
  console.log(`  Search I/O: ${stats.lookups - before.lookups} lookups, ${stats.reads - before.reads} reads`);
  const latest = await elapsed('Page recent messages', () => store.recentMessages(meta, 40));
  assert.equal(latest.length, 40);
  assert.equal(latest.at(-1).seq, count - 1);
  const archived = await elapsed('Page oldest messages', () => store.messages(meta, 0, 40));
  assert.equal(archived.length, 40);
  const compacted = await elapsed('Compact active exchange metadata without a model', () => compactConversation(meta, newest, null));
  assert.equal(compacted.segments.length, 1);
  assert.equal(compacted.activeFrom, count);
  const copyBefore = { ...stats };
  const copy = await elapsed('Copy full conversation', () => store.copyConversation(meta, 'copy'));
  assert.equal(copy.messageCount, count);
  assert.equal((await store.recentMessages(copy, 1))[0].seq, count - 1);
  assert.equal((await store.searchMessages(copy, 'ancient_unique_marker', 1))[0].seq, 12);
  const copyReads = stats.reads - copyBefore.reads;
  assert.ok(copyReads <= Math.ceil(count / MESSAGE_CHUNK_SIZE) + 2 * Math.ceil(count / MESSAGE_CHUNK_SIZE / 64) + 10, `Copy reread source chunks: ${copyReads} reads`);
  console.log(`  Copy I/O: ${stats.lookups - copyBefore.lookups} lookups, ${copyReads} reads, ${stats.writes - copyBefore.writes} writes`);
  console.log(`Verified ${(bytes / 1048576).toFixed(1)} MiB across ${count} messages and ${Math.ceil(count / MESSAGE_CHUNK_SIZE)} chunks.`);
} finally { await rm(directory, { recursive: true, force: true }); }
