import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadModelToFolder } from '../src/modelDownload.ts';
import { createModelDownloadManager, DEFAULT_DOWNLOAD_SPEED_MIBPS, modelDownloadManager, readSavedSpeed, resumeRecoverableModel } from '../src/modelDownloadSession.ts';
import { getToasts } from '../src/toastStore.ts';
import { MODEL_CATALOG } from '../src/catalogModels.ts';
import { assertModelLicenseFiles, assertVisionProjectorLicenseFiles, ensureModelLicenseFiles, ensureVisionProjectorLicenseFiles, visionProjectorDownloadUrl } from '../src/modelLicenses.ts';
import { modelFolderName } from '../src/modelFolders.ts';

const licenseConsent = new Map([
  ['gemma-terms-accepted-2026-04-01', 'yes'],
  ['qwen-research-accepted-2024-09-19', 'yes'],
]);
globalThis.localStorage = { getItem: key => licenseConsent.get(key) ?? null, setItem: (key, value) => licenseConsent.set(key, value), removeItem: key => licenseConsent.delete(key) };

class MemoryFileHandle {
  constructor(name, files) { this.name = name; this.files = files; }
  async getFile() { return new File([this.files.get(this.name) || new Uint8Array()], this.name); }
  async createWritable({ keepExistingData = false } = {}) {
    let bytes = keepExistingData ? new Uint8Array(this.files.get(this.name) || []) : new Uint8Array();
    let position = 0;
    const files = this.files;
    const name = this.name;
    return {
      async seek(value) { position = value; },
      async write(value) {
        const incoming = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
        const next = new Uint8Array(Math.max(bytes.length, position + incoming.length));
        next.set(bytes); next.set(incoming, position); bytes = next; position += incoming.length;
      },
      async close() { files.set(name, bytes); },
    };
  }
}
class MemoryDirectory {
  constructor(files = new Map()) {
    this.files = files;
    this.kind = 'directory';
    this.directories = new Map();
    // Fictional GGUF fixtures have an explicit license before their network request.
    for (const name of ['model.gguf', 'a.gguf', 'b.gguf', 'first.gguf', 'second.gguf'])
      this.files.set(`${name}.LICENSE.txt`, new TextEncoder().encode('Test model license\n'));
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (name === 'models') return this;
    if (!this.directories.has(name)) {
      if (!create) throw new DOMException('Missing', 'NotFoundError');
      this.directories.set(name, new MemoryDirectory(new Map()));
    }
    return this.directories.get(name);
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
    for (const [name, dir] of this.directories) yield [name, dir];
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name) && !create) throw new DOMException('Missing', 'NotFoundError');
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    return new MemoryFileHandle(name, this.files);
  }
  async removeEntry(name) { if (!this.files.delete(name)) throw new DOMException('Missing', 'NotFoundError'); }
}
const sidecarBytes = (folder, model, name) => folder.directories.get(modelFolderName(model.name)).files.get(name);
const full = new TextEncoder().encode('GGUF123456');
const rangeResponse = (start, end) => new Response(full.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${full.length}`, 'Content-Length': String(end - start + 1), ETag: '"test-model"' } });
test('interrupted GGUF download resumes from committed byte offset', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  let interrupted = false;
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    const range = options.headers?.Range;
    requests.push(range || 'full');
    if (range === 'bytes=0-0') return rangeResponse(0, 0);
    if (range === 'bytes=0-3') return rangeResponse(0, 3);
    if (range === 'bytes=4-') return rangeResponse(4, full.length - 1);
    if (!range && !interrupted) {
      interrupted = true;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(full.slice(0, 4)); setTimeout(() => controller.error(new Error('network interrupted')), 0); } }), { status: 200, headers: { 'Content-Length': String(full.length) } });
    }
    throw new Error(`Unexpected range: ${range}`);
  };
  try {
    await assert.rejects(downloadModelToFolder(folder, 'https://example.test/model.gguf', 0, () => {}), /network interrupted/);
    assert.deepEqual(folder.files.get('model.gguf'), full.slice(0, 4));
    assert.ok(folder.files.has('model.gguf.download.json'));
    const path = await downloadModelToFolder(folder, 'https://example.test/model.gguf', 0, () => {});
    assert.equal(path, 'models/model.gguf');
    assert.deepEqual(folder.files.get('model.gguf'), full);
    assert.ok(!folder.files.has('model.gguf.download.json'));
    assert.ok(requests.includes('bytes=4-'));
  } finally { globalThis.fetch = originalFetch; }
});
test('Qwen Research downloads save the agreement and required notice beside the GGUF', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  const model = MODEL_CATALOG.find(item => item.id === 'qwen25-3b');
  globalThis.fetch = async (_url, options = {}) => {
    assert.ok(!!sidecarBytes(folder, model, "LICENSE.txt"), 'license is saved before the first network request');
    assert.ok(!!sidecarBytes(folder, model, "NOTICE.txt"), 'notice is saved before the first network request');
    return options.headers?.Range === 'bytes=0-0'
      ? rangeResponse(0, 0)
      : new Response(full, { status: 200, headers: { 'Content-Length': String(full.length) } });
  };
  try {
    await downloadModelToFolder(folder, model.url, 0, () => {});
    const license = new TextDecoder().decode(sidecarBytes(folder, model, "LICENSE.txt"));
    const notice = new TextDecoder().decode(sidecarBytes(folder, model, "NOTICE.txt"));
    assert.match(license, /^Qwen RESEARCH LICENSE AGREEMENT/);
    assert.equal(notice.trim(), 'Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT, Copyright (c) Alibaba Cloud. All Rights Reserved.');
    assert.ok(!folder.directories.get(modelFolderName(model.name)).files.has(`${model.name}.download.json`));
    assert.deepEqual(folder.directories.get(modelFolderName(model.name)).files.get(model.name), full);
  } finally { globalThis.fetch = originalFetch; }
});
test('Bonsai catalog entry uses the 1-bit file and saves PrismML notice before download', async () => {
  const model = MODEL_CATALOG.find(item => item.id === 'bonsai-8b');
  assert.equal(model.name, 'Bonsai-8B-Q1_0.gguf');
  assert.equal(model.bytes, 1158654496);
  const folder = new MemoryDirectory();
  await ensureModelLicenseFiles(folder, model.url);
  await assertModelLicenseFiles(folder, `models/${model.name}`);
  const notice = new TextDecoder().decode(sidecarBytes(folder, model, "NOTICE.txt"));
  assert.match(notice, /Prism ML/);
  assert.match(notice, /Qwen3-8B/);
});
test('Bonsai 2 browser GGUF saves the matching license and Qwen3.5 notice', async () => {
  const model = MODEL_CATALOG.find(item => item.id === 'bonsai2-2b');
  assert.equal(model.name, 'Ternary-Bonsai-2-2B-PTQ1_0.gguf');
  assert.equal(model.bytes, 429183456);
  assert.equal(model.runtime, 'browser');
  const folder = new MemoryDirectory();
  await ensureModelLicenseFiles(folder, model.url);
  await assertModelLicenseFiles(folder, `models/${model.name}`);
  const notice = new TextDecoder().decode(sidecarBytes(folder, model, "NOTICE.txt"));
  assert.match(notice, /Qwen3\.5-2B/);
  const serverModel = MODEL_CATALOG.find(item => item.id === 'bonsai2-q2-server');
  assert.equal(serverModel.name, 'Ternary-Bonsai-2-2B-Q2_0.gguf');
  assert.equal(serverModel.runtime, 'local-server');
});
test('Bonsai 2 browser catalog includes the supported packs below 2 GB with matching notices', async () => {
  const variants = [
    ['bonsai2-2b-pq2', 517312992, '2B'],
    ['bonsai2-4b-ptq', 949549920, '4B'],
    ['bonsai2-4b-pq2', 1146465120, '4B'],
    ['bonsai2-9b-ptq', 1997486976, '9B'],
  ];
  const folder = new MemoryDirectory();
  for (const [id, bytes, size] of variants) {
    const model = MODEL_CATALOG.find(item => item.id === id);
    assert.equal(model.bytes, bytes);
    assert.equal(model.runtime, 'browser');
    assert.ok(model.bytes < 2_000_000_000);
    await ensureModelLicenseFiles(folder, model.url);
    await assertModelLicenseFiles(folder, `models/${model.name}`);
    const notice = new TextDecoder().decode(sidecarBytes(folder, model, "NOTICE.txt"));
    assert.match(notice, new RegExp(`Qwen3\\.5-${size}`));
  }
});
test('every catalog model needs its matching license files before use', async () => {
  const folder = new MemoryDirectory();
  for (const model of MODEL_CATALOG) {
    const path = `models/${model.name}`;
    await assert.rejects(assertModelLicenseFiles(folder, path), /Required model license file/);
    await ensureModelLicenseFiles(folder, model.url);
    await assertModelLicenseFiles(folder, path);
  }
  const gemma = MODEL_CATALOG.find(model => model.id === 'gemma3-1b');
  assert.ok(!!sidecarBytes(folder, gemma, "LICENSE.html"));
  assert.ok(!!sidecarBytes(folder, gemma, "PROHIBITED-USE.html"));
  assert.ok(!!sidecarBytes(folder, gemma, "NOTICE.txt"));
  folder.directories.get(modelFolderName(gemma.name)).files.delete("NOTICE.txt");
  await assert.rejects(assertModelLicenseFiles(folder, `models/${gemma.name}`), /NOTICE.txt/);
  await assert.rejects(assertModelLicenseFiles(folder, 'models/custom.gguf'), /Add LICENSE.txt/);
  licenseConsent.delete('qwen-research-accepted-2024-09-19');
  await assert.rejects(ensureModelLicenseFiles(folder, MODEL_CATALOG.find(model => model.id === 'qwen25-3b').url), /Acknowledge the Qwen Research License/);
  licenseConsent.set('qwen-research-accepted-2024-09-19', 'yes');
});
test('a vision projector needs matching license and source files', async () => {
  const model = MODEL_CATALOG.find(item => item.id === 'ministral3-3b');
  const folder = new MemoryDirectory();
  await ensureModelLicenseFiles(folder, model.url);
  await assert.rejects(assertVisionProjectorLicenseFiles(folder, model), /Missing/);
  await ensureVisionProjectorLicenseFiles(folder, model);
  await assertVisionProjectorLicenseFiles(folder, model);
  folder.directories.get(modelFolderName(model.visionProjector.name)).files.delete("PROJECTOR-SOURCE.txt");
  await assert.rejects(assertVisionProjectorLicenseFiles(folder, model), /Missing/);
});
test('a shared Bonsai projector can use a licensed packing already in the workspace', async () => {
  const model = MODEL_CATALOG.find(item => item.id === 'bonsai2-2b-pq2');
  const folder = new MemoryDirectory();
  await ensureModelLicenseFiles(folder, model.url);
  await ensureModelLicenseFiles(folder, visionProjectorDownloadUrl(model));
  await assertVisionProjectorLicenseFiles(folder, model);
});
test('a custom GGUF cannot begin downloading without its license', async () => {
  const folder = new MemoryDirectory();
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('Network should not be reached'); };
  try {
    await assert.rejects(downloadModelToFolder(folder, 'https://example.test/custom.gguf', 0, () => {}), /LICENSE.txt/);
    assert.equal(fetched, false);
  } finally { globalThis.fetch = originalFetch; }
});
test('a server that ignores Range cannot overwrite a partial GGUF', async () => {
  const originalFetch = globalThis.fetch;
  const files = new Map([['model.gguf', full.slice(0, 4)], ['model.gguf.download.json', new TextEncoder().encode(JSON.stringify({ url: 'https://example.test/model.gguf', total: full.length }))]]);
  const folder = new MemoryDirectory(files);
  globalThis.fetch = async () => new Response(full, { status: 200, headers: { 'Content-Length': String(full.length) } });
  try {
    await assert.rejects(downloadModelToFolder(folder, 'https://example.test/model.gguf', 0, () => {}), /does not support byte ranges/);
    assert.deepEqual(files.get('model.gguf'), full.slice(0, 4));
  } finally { globalThis.fetch = originalFetch; }
});
test('an incomplete GGUF from the previous downloader can be resumed', async () => {
  const originalFetch = globalThis.fetch;
  const files = new Map([['model.gguf', full.slice(0, 4)]]);
  const folder = new MemoryDirectory(files);
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    const range = options.headers?.Range;
    requests.push(range);
    if (range === 'bytes=0-0') return rangeResponse(0, 0);
    if (range === 'bytes=0-3') return rangeResponse(0, 3);
    if (range === 'bytes=4-') return rangeResponse(4, full.length - 1);
    throw new Error(`Unexpected range: ${range}`);
  };
  try {
    await downloadModelToFolder(folder, 'https://example.test/model.gguf', 0, () => {});
    assert.deepEqual(files.get('model.gguf'), full);
    assert.deepEqual(requests, ['bytes=0-0', 'bytes=0-3', 'bytes=4-']);
  } finally { globalThis.fetch = originalFetch; }
});
test('changing the speed limit releases an active throttled download', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  let speedLimit = 0.00001;
  globalThis.fetch = async (_url, options = {}) => options.headers?.Range === 'bytes=0-0'
    ? rangeResponse(0, 0)
    : new Response(full, { status: 200, headers: { 'Content-Length': String(full.length) } });
  try {
    const started = performance.now();
    const download = downloadModelToFolder(folder, 'https://example.test/model.gguf', () => speedLimit, () => {});
    setTimeout(() => { speedLimit = 0; }, 20);
    await download;
    assert.ok(performance.now() - started < 400, 'the current download should stop throttling after switching to Unlimited');
    assert.deepEqual(folder.files.get('model.gguf'), full);
  } finally { globalThis.fetch = originalFetch; }
});
test('download continues after its view unsubscribes and can be observed again', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  let releaseStream;
  let streamReady;
  const ready = new Promise(resolve => { streamReady = resolve; });
  globalThis.fetch = async (_url, options = {}) => options.headers?.Range === 'bytes=0-0'
    ? rangeResponse(0, 0)
    : new Response(new ReadableStream({ start(controller) {
      controller.enqueue(full.slice(0, 4));
      releaseStream = () => { controller.enqueue(full.slice(4)); controller.close(); };
      streamReady();
    } }), { status: 200, headers: { 'Content-Length': String(full.length) } });
  try {
    const manager = createModelDownloadManager();
    const unsubscribe = manager.subscribe(() => {});
    const complete = new Promise(resolve => {
      assert.equal(manager.start(folder, 'https://example.test/model.gguf', resolve), true);
    });
    await ready;
    unsubscribe(); // The AI profiles view has unmounted.
    releaseStream();
    assert.equal(await complete, 'models/model.gguf');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(manager.getSnapshot().status, 'idle');
    assert.equal(manager.getSnapshot().progress.bytes, full.length);
    assert.deepEqual(folder.files.get('model.gguf'), full);
    assert.ok(getToasts().some(toast => toast.message === 'model.gguf finished downloading.'));
  } finally { globalThis.fetch = originalFetch; }
});
test('refresh recovery retains the partial model and uses the chosen browser speed', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const makeStorage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  };
  globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
  const folder = new MemoryDirectory();
  globalThis.fetch = async (_url, options = {}) => options.headers?.Range === 'bytes=0-0'
    ? rangeResponse(0, 0)
    : new Response(full, { status: 200, headers: { 'Content-Length': String(full.length) } });
  try {
    assert.equal(readSavedSpeed(), DEFAULT_DOWNLOAD_SPEED_MIBPS);
    const first = createModelDownloadManager(0.00001, null);
    const progressed = new Promise(resolve => {
      const unsubscribe = first.subscribe(() => {
        if (first.getSnapshot().progress?.bytes === full.length) { unsubscribe(); resolve(); }
      });
    });
    assert.equal(first.start(folder, 'https://example.test/model.gguf', () => {}), true);
    await progressed;
    const afterRefresh = createModelDownloadManager(readSavedSpeed());
    assert.equal(afterRefresh.getSnapshot().recovery.name, 'model.gguf');
    assert.equal(afterRefresh.getSnapshot().recovery.bytes, full.length);
    assert.equal(afterRefresh.getSnapshot().recovery.verified, false);
    first.pause();
    await new Promise(resolve => {
      if (first.getSnapshot().status === 'idle') return resolve();
      const unsubscribe = first.subscribe(() => { if (first.getSnapshot().status === 'idle') { unsubscribe(); resolve(); } });
    });
    const resumed = createModelDownloadManager(readSavedSpeed());
    assert.equal(resumed.getSnapshot().recovery.total, full.length);
    assert.equal(resumed.getSnapshot().recovery.verified, true);
    const completed = new Promise(resolve => resumed.start(folder, 'https://example.test/model.gguf', resolve));
    assert.equal(await completed, 'models/model.gguf');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(resumed.getSnapshot().recovery, null);
    resumed.setSpeedLimit(0.5);
    assert.equal(readSavedSpeed(), 0.5);
    resumed.setSpeedLimit(0);
    assert.equal(readSavedSpeed(), 0);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
test('saved download resumes directly from its connected folder', async () => {
  const originalFetch = globalThis.fetch;
  const url = 'https://example.test/model.gguf';
  const files = new Map([['model.gguf', full.slice(0, 4)], ['model.gguf.download.json', new TextEncoder().encode(JSON.stringify({ url, total: full.length }))]]);
  const folder = new MemoryDirectory(files);
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    const range = options.headers?.Range;
    requests.push(range);
    if (range === 'bytes=0-0') return rangeResponse(0, 0);
    if (range === 'bytes=0-3') return rangeResponse(0, 3);
    if (range === 'bytes=4-') return rangeResponse(4, full.length - 1);
    throw new Error(`Unexpected range: ${range}`);
  };
  try {
    modelDownloadManager.recordPartials([{ name: 'model.gguf', url, bytes: 4, total: full.length }]);
    let resolveComplete;
    const completed = new Promise(resolve => { resolveComplete = resolve; });
    assert.equal(await resumeRecoverableModel(folder, resolveComplete), true);
    assert.equal(await completed, 'models/model.gguf');
    assert.ok(requests.includes('bytes=4-'));
    assert.deepEqual(files.get('model.gguf'), full);
  } finally { globalThis.fetch = originalFetch; }
});

test('catalog downloads run one at a time in queue order', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  const a = new TextEncoder().encode('GGUFAAAA');
  const b = new TextEncoder().encode('GGUFBBBB');
  const urls = ['https://example.test/a.gguf', 'https://example.test/b.gguf'];
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const data = String(url).endsWith('/a.gguf') ? a : b;
    requests.push(`${String(url).split('/').pop()}:${options.headers?.Range || 'full'}`);
    const range = options.headers?.Range;
    if (range) {
      const [, from, through] = range.match(/^bytes=(\d+)-(\d*)$/) || [];
      const start = Number(from);
      const end = through ? Number(through) : data.length - 1;
      return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(data, { status: 200, headers: { 'Content-Length': String(data.length) } });
  };
  try {
    const manager = createModelDownloadManager(0, null);
    const completed = [];
    const allDone = new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        const state = manager.getSnapshot();
        if (state.status === 'idle' && state.queue.length === 0 && completed.length === 2) { unsubscribe(); resolve(); }
      });
    });
    manager.enqueue(folder, urls.map((url, index) => ({ url, name: index ? 'b.gguf' : 'a.gguf', bytes: a.length })), path => completed.push(path));
    await allDone;
    assert.deepEqual(completed, ['models/a.gguf', 'models/b.gguf']);
    assert.deepEqual(requests.filter(x => x.endsWith(':full')), ['a.gguf:full', 'b.gguf:full']);
    assert.deepEqual(folder.files.get('a.gguf'), a);
    assert.deepEqual(folder.files.get('b.gguf'), b);
  } finally { globalThis.fetch = originalFetch; }
});

test('pausing a queued transfer keeps the queue until explicitly resumed', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  const data = new TextEncoder().encode('GGUF123456');
  const urls = ['https://example.test/first.gguf', 'https://example.test/second.gguf'];
  let secondRequested = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/second.gguf')) secondRequested = true;
    const range = options.headers?.Range;
    if (range) {
      const [, from, through] = range.match(/^bytes=(\d+)-(\d*)$/) || [];
      const start = Number(from);
      const end = through ? Number(through) : data.length - 1;
      return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(data, { status: 200, headers: { 'Content-Length': String(data.length) } });
  };
  try {
    const manager = createModelDownloadManager(0.00001, null);
    manager.enqueue(folder, urls.map(url => ({ url, name: url.split('/').pop(), bytes: data.length })), () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().progress?.bytes === data.length) { unsubscribe(); resolve(); }
      });
    });
    manager.pause();
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'idle') { unsubscribe(); resolve(); }
      });
    });
    assert.equal(manager.getSnapshot().queue.length, 2);
    assert.equal(manager.getSnapshot().queuePaused, true);
    assert.equal(secondRequested, false);
    await new Promise(resolve => setTimeout(resolve, 0));
    const queueFile = await (await folder.getFileHandle('download-queue.json')).getFile();
    assert.equal(JSON.parse(await queueFile.text()).length, 2);
    const restored = createModelDownloadManager(0, null);
    await restored.discover(folder);
    assert.equal(restored.getSnapshot().queue.length, 2);
    assert.equal(restored.getSnapshot().queuePaused, true);
    restored.resumeQueue(folder, () => {});
    await new Promise(resolve => {
      const unsubscribe = restored.subscribe(() => {
        if (restored.getSnapshot().status === 'idle' && !restored.getSnapshot().queue.length) { unsubscribe(); resolve(); }
      });
    });
    assert.equal(secondRequested, true);
    assert.deepEqual(folder.files.get('second.gguf'), data);
  } finally { globalThis.fetch = originalFetch; }
});

test('the queue skips a model already present at its expected size', async () => {
  const originalFetch = globalThis.fetch;
  const data = new TextEncoder().encode('GGUFREADY');
  const folder = new MemoryDirectory(new Map([['first.gguf', data]]));
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push(String(url));
    if (options.headers?.Range === 'bytes=0-0') return new Response(data.slice(0, 1), { status: 206, headers: { 'Content-Range': `bytes 0-0/${data.length}`, 'Content-Length': '1' } });
    return new Response(data, { status: 200, headers: { 'Content-Length': String(data.length) } });
  };
  try {
    const manager = createModelDownloadManager(0, null);
    const completed = [];
    manager.enqueue(folder, [
      { name: 'first.gguf', url: 'https://example.test/first.gguf', bytes: data.length },
      { name: 'second.gguf', url: 'https://example.test/second.gguf', bytes: data.length },
    ], path => completed.push(path));
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'idle' && !manager.getSnapshot().queue.length && completed.length) { unsubscribe(); resolve(); }
      });
    });
    assert.deepEqual(completed, ['models/second.gguf']);
    assert.ok(requests.every(url => url.endsWith('/second.gguf')));
  } finally { globalThis.fetch = originalFetch; }
});

test('an existing catalog GGUF gets its missing license before queued downloads', async () => {
  const originalFetch = globalThis.fetch;
  const model = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
  const folder = new MemoryDirectory(new Map([[model.name, full]]));
  const requests = [];
  globalThis.fetch = async url => { requests.push(String(url)); throw new Error('Network should not be needed for license repair'); };
  try {
    const manager = createModelDownloadManager(0, null);
    manager.prioritize(folder, { name: model.name, url: model.url, bytes: model.bytes, licenseOnly: true }, () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().revision > 0) { unsubscribe(); resolve(); }
      });
    });
    assert.deepEqual(requests, []);
    assert.equal(manager.getSnapshot().queue.length, 0);
    await assertModelLicenseFiles(folder, `models/${model.name}`);
  } finally { globalThis.fetch = originalFetch; }
});

test('a license repaired by Load & test is cleared from the saved queue', () => {
  const originalWindow = globalThis.window;
  const qwen = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
  const saved = new Map([['model-download-queue', JSON.stringify([{ name: qwen.name, url: qwen.url, bytes: qwen.bytes, licenseOnly: true }])]]);
  globalThis.window = { localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, sessionStorage: { getItem: () => null } };
  try {
    const manager = createModelDownloadManager(0, null);
    assert.equal(manager.getSnapshot().queue.length, 1);
    manager.markLicenseReady(qwen.url);
    assert.equal(manager.getSnapshot().queue.length, 0);
    assert.equal(manager.getSnapshot().revision, 1);
    assert.deepEqual(JSON.parse(saved.get('model-download-queue')), []);
  } finally { globalThis.window = originalWindow; }
});

test('a prioritized license is saved while another GGUF is still downloading', async () => {
  const originalFetch = globalThis.fetch;
  const qwen = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
  const granite = MODEL_CATALOG.find(item => item.id === 'granite41-3b');
  const folder = new MemoryDirectory(new Map([[qwen.name, full]]));
  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Paused', 'AbortError')); return; }
    options.signal?.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
  });
  try {
    const manager = createModelDownloadManager(0, null);
    assert.equal(manager.start(folder, granite.url, () => {}), true);
    manager.prioritize(folder, { name: qwen.name, url: qwen.url, bytes: qwen.bytes, licenseOnly: true }, () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().revision > 0) { unsubscribe(); resolve(); }
      });
    });
    await assertModelLicenseFiles(folder, `models/${qwen.name}`);
    assert.equal(manager.getSnapshot().status, 'downloading');
    assert.equal(manager.getSnapshot().queue.some(item => item.url === qwen.url), false);
    manager.pause();
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'idle') { unsubscribe(); resolve(); }
      });
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('an already queued license is processed during an active GGUF transfer', async () => {
  const originalFetch = globalThis.fetch;
  const qwen = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
  const granite = MODEL_CATALOG.find(item => item.id === 'granite41-3b');
  const folder = new MemoryDirectory(new Map([[qwen.name, full]]));
  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Paused', 'AbortError')); return; }
    options.signal?.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
  });
  try {
    const manager = createModelDownloadManager(0, null);
    manager.enqueue(folder, [
      { name: granite.name, url: granite.url, bytes: granite.bytes },
      { name: qwen.name, url: qwen.url, bytes: qwen.bytes, licenseOnly: true },
    ], () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        const state = manager.getSnapshot();
        if (state.status === 'downloading' && state.revision > 0) { unsubscribe(); resolve(); }
      });
    });
    await assertModelLicenseFiles(folder, `models/${qwen.name}`);
    assert.deepEqual(manager.getSnapshot().queue.map(item => item.name), [granite.name]);
    manager.pause();
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'idle') { unsubscribe(); resolve(); }
      });
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('a queued license runs before resuming a different incomplete GGUF', async () => {
  const originalFetch = globalThis.fetch;
  const qwen = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
  const granite = MODEL_CATALOG.find(item => item.id === 'granite41-3b');
  const savedQueue = [
    { name: qwen.name, url: qwen.url, bytes: qwen.bytes, licenseOnly: true },
    { name: granite.name, url: granite.url, bytes: granite.bytes },
  ];
  const folder = new MemoryDirectory(new Map([
    [qwen.name, full],
    [granite.name, full.slice(0, 4)],
    [`${granite.name}.download.json`, new TextEncoder().encode(JSON.stringify({ url: granite.url, total: full.length }))],
    ['download-queue.json', new TextEncoder().encode(JSON.stringify(savedQueue))],
  ]));
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    await assertModelLicenseFiles(folder, `models/${qwen.name}`);
    const range = options.headers?.Range;
    requests.push(range);
    if (range === 'bytes=0-0') return rangeResponse(0, 0);
    if (range === 'bytes=0-3') return rangeResponse(0, 3);
    if (range === 'bytes=4-') return rangeResponse(4, full.length - 1);
    throw new Error(`Unexpected range: ${range}`);
  };
  try {
    const manager = createModelDownloadManager(0, null);
    await manager.discover(folder);
    assert.equal(manager.getSnapshot().recovery.name, granite.name);
    assert.equal(manager.getSnapshot().queue[0].name, qwen.name);
    const finished = new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        const state = manager.getSnapshot();
        if (state.status === 'idle' && !state.queue.length && state.revision > 0) { unsubscribe(); resolve(); }
      });
    });
    manager.resumeQueue(folder, () => {});
    await finished;
    assert.deepEqual(requests, ['bytes=0-0', 'bytes=0-3', 'bytes=4-']);
    assert.deepEqual(folder.files.get(granite.name), full);
  } finally { globalThis.fetch = originalFetch; }
});

test('a paused queued model can run while another GGUF partial stays saved', async () => {
  const originalFetch = globalThis.fetch;
  const queued = { name: 'first.gguf', url: 'https://example.test/first.gguf', bytes: full.length };
  const partialUrl = 'https://example.test/model.gguf';
  const folder = new MemoryDirectory(new Map([
    ['model.gguf', full.slice(0, 4)],
    ['model.gguf.download.json', new TextEncoder().encode(JSON.stringify({ url: partialUrl, total: full.length }))],
    ['download-queue.json', new TextEncoder().encode(JSON.stringify([queued]))],
  ]));
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push(String(url));
    const range = options.headers?.Range;
    if (range === 'bytes=0-0') return rangeResponse(0, 0);
    if (!range) return new Response(full, { status: 200, headers: { 'Content-Length': String(full.length) } });
    throw new Error(`Unexpected range: ${range}`);
  };
  try {
    const manager = createModelDownloadManager(0, null);
    await manager.discover(folder);
    assert.equal(manager.getSnapshot().recovery.name, 'model.gguf');
    const finished = new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        const state = manager.getSnapshot();
        if (state.status === 'idle' && !state.queue.length && state.revision > 0) { unsubscribe(); resolve(); }
      });
    });
    manager.resumeQueue(folder, () => {});
    await finished;
    assert.ok(requests.every(url => url === queued.url));
    assert.deepEqual(folder.files.get('first.gguf'), full);
    assert.deepEqual(folder.files.get('model.gguf'), full.slice(0, 4));
    assert.equal(manager.getSnapshot().recovery.name, 'model.gguf');
  } finally { globalThis.fetch = originalFetch; }
});

test('pending models can be reprioritized without moving the active download', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Paused', 'AbortError')); return; }
    options.signal?.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
  });
  try {
    const manager = createModelDownloadManager(0, null);
    const items = ['a', 'b', 'first'].map(name => ({ name: `${name}.gguf`, url: `https://example.test/${name}.gguf`, bytes: 10 }));
    manager.enqueue(folder, items, () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'downloading') { unsubscribe(); resolve(); }
      });
    });
    assert.equal(manager.moveQueued(items[2].url, -1), true);
    assert.deepEqual(manager.getSnapshot().queue.map(item => item.name), ['a.gguf', 'first.gguf', 'b.gguf']);
    assert.equal(manager.moveQueued(items[0].url, 1), false);
    const repair = MODEL_CATALOG.find(item => item.id === 'qwen35-2b');
    manager.prioritize(folder, { name: repair.name, url: repair.url, bytes: repair.bytes, licenseOnly: true }, () => {});
    assert.deepEqual(manager.getSnapshot().queue.map(item => item.name), ['a.gguf', repair.name, 'first.gguf', 'b.gguf']);
    manager.pause();
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().status === 'idle') { unsubscribe(); resolve(); }
      });
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('a failed queued model stops before the next model', async () => {
  const originalFetch = globalThis.fetch;
  const folder = new MemoryDirectory();
  const requests = [];
  globalThis.fetch = async url => { requests.push(String(url)); return new Response(null, { status: 404 }); };
  try {
    const manager = createModelDownloadManager(0, null);
    manager.enqueue(folder, [
      { name: 'first.gguf', url: 'https://example.test/first.gguf', bytes: 8 },
      { name: 'second.gguf', url: 'https://example.test/second.gguf', bytes: 8 },
    ], () => {});
    await new Promise(resolve => {
      const unsubscribe = manager.subscribe(() => {
        const state = manager.getSnapshot();
        if (state.status === 'idle' && state.queuePaused && state.error) { unsubscribe(); resolve(); }
      });
    });
    assert.equal(manager.getSnapshot().queue.length, 2);
    assert.deepEqual(requests, ['https://example.test/first.gguf']);
  } finally { globalThis.fetch = originalFetch; }
});
