# Browser model performance baseline

The app asks Wllama to reuse matching prompt prefixes and records the runtime's cached input-token count with each response. The optional benchmark below measures that behavior with a real local GGUF. It does not download a model or engine.

Run Vite at `http://127.0.0.1:5198/` and open it in a disposable Chrome profile with remote debugging on port 9239. Install Wllama and a supported catalog GGUF in that profile first. MiniCPM5 1B is the default; choose another installed model by catalog ID:

```bash
node scripts/benchmark-browser-gguf.mjs > browser-model-benchmark.json
BENCHMARK_MODEL_ID=sailor2-1b node scripts/benchmark-browser-gguf.mjs > sailor-browser-benchmark.json
# Also measure the whole browser, including model workers (may take minutes):
MEASURE_BROWSER_MEMORY=1 node scripts/benchmark-browser-gguf.mjs > browser-model-memory.json
# Compare growing history with a moving window of the latest eight exchange pairs:
BENCHMARK_ROLLING_PAIRS=8 node scripts/benchmark-browser-gguf.mjs > rolling-window-benchmark.json
```

The report includes the browser version, model, context limit, cold and repeated prompts, a changed prompt tail, a longer output, 48 growing turns, and memory measurements. The browser-memory option unloads the model afterward. The default run leaves it loaded so it can be inspected. Run this on the target device before tuning defaults: headless Chrome on a desktop is not a proxy for a phone or library computer.

On 2026-10-18, headless Chrome 155 on a Mac ran MiniCPM5 1B Q4_K_M at a 2,048-token context. Loading took 2,252 ms. A 31-token cold prompt took 631 ms with zero cached input tokens. Repeating it took 76 ms with 30 cached tokens. Changing the last word took 278 ms with 20 cached tokens. A 68-token answer took 2,896 ms end to end, with about 31 output tokens per second during streaming. In the 48-turn growing conversation, the first eight requests averaged 599 ms and the last eight averaged 1,394 ms; the final request had 1,021 input tokens, 996 reported as cached. These are one-run observations, not general throughput claims.

The JavaScript heap after forced collection was about 54 MB in that run. A separate `measureUserAgentSpecificMemory()` run measured about 1.89 GB while the model was loaded, mostly in Wllama workers, and about 33 MB after unloading it. Heap size alone therefore misses the model's main memory cost. Browser memory accounting and hardware vary; compare the same browser and device before and after an implementation change.

The same Chrome profile also ran Sailor2 1B Chat Q4_K_M at a 2,048-token context. Its 739 MB GGUF loaded in 2,810 ms. The 26-token cold prompt took 1,387 ms with zero cached tokens; an identical repeat took 136 ms with 25 cached; changing its last word took 505 ms with 19 cached. A longer response reached the 160-token output cap in 12,029 ms, streaming at about 15 tokens per second. The first eight growing-conversation turns averaged 1,305 ms and the last eight 3,437 ms; the final request had 1,494 input tokens, 1,473 cached. Browser-wide memory was about 2.05 GB with Sailor2 loaded and 45 MB after unloading the active Wllama instance. The same prompts tokenize differently and the models produced different answer lengths, so these observations compare this particular workload, not model quality or general speed.

Both models reused nearly all matching prompt tokens on repeat, yet later turns slowed as active context grew. The next experiment is actual model-driven compaction with a check that useful details survive, followed by runs on physical devices. These measurements do not justify adding a vector database or SQLite to browser inference.

### Moving-window check

On the same disposable Chrome profile, MiniCPM5 1B ran another 48-turn conversation twice at the same 2,048-token context and 32-token output cap. The growing-history run took 47.9 seconds total, with 1,021 input tokens and 996 cached tokens on its final turn. After unloading and reloading the model, a second run kept only the latest eight exchange pairs in each prompt. That moving window took 151.9 seconds, despite ending at just 202 input tokens: Wllama reported zero cached tokens after the window began shifting. Its last eight turns averaged 3,723 ms, versus 1,388 ms for growing history. The output was one token in each final turn.

This synthetic window discards earlier messages without summarizing them. It tests prompt-cache behavior, not answer quality or the cost of real compaction. Frequent shifting can erase the reusable prefix and make a short prompt slower. Keep compaction tied to the actual context limit, preserve useful facts in its summary, and measure quality before changing the default threshold. A real compaction would cause a cache miss when it replaces history; later stable turns may reuse its new prefix.
