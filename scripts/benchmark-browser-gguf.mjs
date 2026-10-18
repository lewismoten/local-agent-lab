/** Optional benchmark. Requires the selected catalog GGUF and Wllama in disposable Chrome on CDP 9239, with Vite on 5198. */
const base = process.env.APP_URL || 'http://127.0.0.1:5198/';
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9239);
const modelId = process.env.BENCHMARK_MODEL_ID || 'minicpm5-1b';
const rollingPairs = Number(process.env.BENCHMARK_ROLLING_PAIRS || 0);
if (!Number.isInteger(rollingPairs) || rollingPairs < 0 || rollingPairs > 24) throw new Error('BENCHMARK_ROLLING_PAIRS must be an integer from 0 to 24.');
const pages = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith(base));
if (!page) throw new Error(`Open ${base} in the disposable Chrome profile first.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled') {
    const progress = message.params?.args?.map(item => item.value).find(value => typeof value === 'string' && value.startsWith('[benchmark]'));
    if (progress) console.error(progress);
  }
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeoutMs = method === 'Runtime.evaluate' && rollingPairs ? 600_000 : 180_000;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs} ms.`)); }, timeoutMs);
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
};
try {
  await call('Runtime.enable');
  await call('HeapProfiler.enable');
  await call('HeapProfiler.collectGarbage');
  const result = await evaluate(`(async () => {
    const { browserFiles } = await import('/src/storage.ts');
    const { maybeModelFile } = await import('/src/modelFolders.ts');
    const { MODEL_CATALOG } = await import('/src/catalogModels.ts');
    const { assertModelLicenseFiles } = await import('/src/modelLicenses.ts');
    const { assertWllamaEngineFiles } = await import('/src/wllamaEngine.ts');
    const { isBonsai2BrowserUnsupported, isBonsai2Q2BrowserUnsupported, isKnownIncompatibleGranite } = await import('/src/modelCompatibility.ts');
    const folder = await browserFiles();
    const model = MODEL_CATALOG.find(item => item.id === ${JSON.stringify(modelId)});
    if (!model || model.runtime === 'local-server' || isBonsai2BrowserUnsupported(model.name) || isBonsai2Q2BrowserUnsupported(model.name) || isKnownIncompatibleGranite(model.name)) throw new Error('Choose a catalog GGUF supported by Wllama.');
    if (!folder || (await maybeModelFile(folder, model.name))?.size !== model.bytes) throw new Error(model.name + ' is missing or incomplete in disposable browser files.');
    await assertModelLicenseFiles(folder, 'models/' + model.name);
    await assertWllamaEngineFiles(folder);
    const source = performance.getEntriesByType('resource').filter(item => item.name.includes('/src/browserModel.ts?t=')).at(-1)?.name || '/src/browserModel.ts';
    const { loadBrowserModel, browserComplete, unloadBrowserModel } = await import(source);
    const config = { id: 'browser', label: model.label + ' benchmark', provider: 'browser', model: 'models/' + model.name, endpoint: '', apiKey: '', effort: 'default', thinkingTokens: 0, browserThinkingMode: 'none', maxOutputTokens: 32, contextWindow: 2048 };
    const heap = () => performance.memory?.usedJSHeapSize ?? null;
    const beforeLoadHeap = heap();
    await unloadBrowserModel();
    const loadStarted = performance.now();
    await loadBrowserModel(folder, config.model, config.contextWindow);
    const loadMs = Math.round(performance.now() - loadStarted);
    const afterLoadHeap = heap();
    const system = 'Answer using one short word.';
    const measure = async (turns, activeConfig = config, activeSystem = system) => {
      let last = null;
      const started = performance.now();
      const answer = await browserComplete(activeConfig, turns, activeSystem, undefined, undefined, value => { last = value; });
      const ms = Math.round(performance.now() - started);
      return { ms, inputTokens: answer.inputTokens ?? null, cachedInputTokens: answer.rounds?.[0]?.response.cachedInputTokens ?? null,
        outputTokens: answer.outputTokens ?? null, endToEndOutputTokensPerSecond: answer.outputTokens && ms ? Math.round(answer.outputTokens * 1000 / ms * 10) / 10 : null,
        streamingTokensPerSecond: last?.outputTokensPerSecond ?? null,
        progressCachedTokens: last?.promptCachedTokens ?? null, response: answer.text.slice(0, 100) };
    };
    const cold = await measure([{ role: 'user', content: 'Reply with one word: alpha.' }]);
    const repeated = await measure([{ role: 'user', content: 'Reply with one word: alpha.' }]);
    const changedTail = await measure([{ role: 'user', content: 'Reply with one word: beta.' }]);
    const longOutput = await measure([{ role: 'user', content: 'Describe a quiet riverside sunrise in one paragraph of about eighty words.' }], { ...config, maxOutputTokens: 160 }, 'Write one descriptive paragraph.');
    const turns = [];
    const conversation = [];
    for (let index = 0; index < 48; index++) {
      turns.push({ role: 'user', content: 'Step ' + index + ': reply with the word ok.' });
      const run = await measure(turns);
      turns.push({ role: 'assistant', content: run.response });
      conversation.push({ step: index + 1, ms: run.ms, inputTokens: run.inputTokens, cachedInputTokens: run.cachedInputTokens, outputTokens: run.outputTokens });
      if ((index + 1) % 8 === 0) console.info('[benchmark] full history ' + (index + 1) + '/48');
    }
    let rollingConversation = null;
    if (${rollingPairs} > 0) {
      // Reset the runtime cache before comparing a moving recent-message window.
      await unloadBrowserModel();
      await loadBrowserModel(folder, config.model, config.contextWindow);
      const rollingTurns = [];
      rollingConversation = [];
      for (let index = 0; index < 48; index++) {
        rollingTurns.push({ role: 'user', content: 'Step ' + index + ': reply with the word ok.' });
        const run = await measure(rollingTurns.slice(-(${rollingPairs} * 2 + 1)));
        rollingTurns.push({ role: 'assistant', content: run.response });
        rollingConversation.push({ step: index + 1, ms: run.ms, inputTokens: run.inputTokens, cachedInputTokens: run.cachedInputTokens, outputTokens: run.outputTokens });
        if ((index + 1) % 8 === 0) console.info('[benchmark] rolling window ' + (index + 1) + '/48');
      }
    }
    return { modelId: model.id, model: config.model, contextWindow: config.contextWindow, browser: navigator.userAgent, checkedAt: new Date().toISOString(),
      beforeLoadHeap, afterLoadHeap, loadMs, cold, repeated, changedTail, longOutput, conversation, rollingPairs: ${rollingPairs}, rollingConversation, heapBeforeGc: heap() };
  })()`);
  await call('HeapProfiler.collectGarbage');
  result.heapAfterGc = await evaluate('performance.memory?.usedJSHeapSize ?? null');
  if (process.env.MEASURE_BROWSER_MEMORY === '1') {
    result.browserMemoryLoaded = await evaluate('performance.measureUserAgentSpecificMemory()');
    await evaluate(`(async () => {
      const source = performance.getEntriesByType('resource').filter(item => item.name.includes('/src/browserModel.ts?t=')).at(-1)?.name || '/src/browserModel.ts';
      await (await import(source)).unloadBrowserModel();
      return true;
    })()`);
    result.browserMemoryUnloaded = await evaluate('performance.measureUserAgentSpecificMemory()');
  }
  const summarize = conversation => {
    const values = conversation.map(item => item.ms);
    return { turns: values.length,
      firstEightMeanMs: Math.round(values.slice(0, 8).reduce((sum, value) => sum + value, 0) / 8),
      lastEightMeanMs: Math.round(values.slice(-8).reduce((sum, value) => sum + value, 0) / 8),
      totalMs: values.reduce((sum, value) => sum + value, 0),
      finalInputTokens: conversation.at(-1)?.inputTokens,
      finalCachedInputTokens: conversation.at(-1)?.cachedInputTokens };
  };
  result.conversationSummary = summarize(result.conversation);
  if (result.rollingConversation) result.rollingSummary = summarize(result.rollingConversation);
  console.log(JSON.stringify(result, null, 2));
} finally { socket.close(); }
