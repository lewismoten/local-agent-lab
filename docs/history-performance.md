# Large conversation checks

Back to [Local Agent Lab](../README.md) · [Workspace guide](workspace.md)

Run the repeatable local workload with Node 22 or newer:

```bash
node scripts/stress-harness.mjs --mb 100 --latency-ms 1
```

The script creates a temporary 180-day conversation with indexed message chunks, searches for a phrase in its oldest chunk, pages old and recent messages, compacts the latest exchange without a model, and copies the complete conversation to another project. It checks the results and deletes the temporary files. `--latency-ms` delays each simulated folder operation; it approximates slow removable storage but is not a measurement of a physical USB drive. Run it without that option to measure local filesystem throughput. The script is separate from the fast unit suite because it writes more than 200 MiB while testing a 100 MiB conversation and its copy.

On 2026-10-18, a 100.1 MiB run with 1 ms simulated operation latency covered 16,536 messages in 689 chunks. Search for a phrase in the oldest chunk took 0.38 seconds and read 12 files; browsing each 40-message page took 0.02 seconds. Copying took 25.84 seconds before the source chunk was reused for diagnostics inspection, 16.80 seconds afterward, and 5.29 seconds after caching directory handles for repeated reads and writes. The copy reads each chunk once (713 file reads) and now performs 1,432 lookups in the simulated folder. These are local measurements, not performance guarantees.

For an IndexedDB browser run, start Vite and a separate temporary Chrome profile with remote debugging, then run the browser workload:

```bash
npm start -- --host 127.0.0.1 --port 5194
# In another terminal, substitute your Chrome executable if needed:
chrome --headless=new --remote-debugging-port=9231 --user-data-dir=/tmp/local-agent-history-benchmark http://127.0.0.1:5194/
# In a third terminal:
node scripts/stress-browser-history.mjs --port 9231 --mb 100
```

The browser script uses a fresh benchmark workspace ID and varied code-like message text. It verifies search against an old message, 40-message pages at both ends, metadata compaction, full copy, copied search, and the last copied message. It measures the longest delay of a 50 ms main-thread timer. On 2026-10-18, headless Chrome processed 100.0 MiB across 15,648 messages and 652 chunks. Creation took 18.71 seconds; oldest-message search took 0.25 seconds; 40-message pages took 0.001 seconds; metadata compaction took 0.005 seconds; the full copy took 0.60 seconds. The source and copy added about 90 MiB to Chrome storage, and the largest measured timer delay was 19 ms. An earlier highly repetitive 100 MiB browser run used only about 8 MiB in storage, so the varied workload is the more useful storage measurement.

The current 24-message chunks create roughly 650 chunk records per 100 MiB conversation, plus search indexes and diagnostics. IndexedDB handled that count quickly here. A portable folder still pays per-file latency even with cached directory handles: the simulated USB copy took 5.29 seconds. SQLite or another packed format may reduce file count on slow drives, but it would need a migration and browser-compatible storage path. Measure a physical drive before changing the on-disk conversation format.

The Chat UI was also opened on the repetitive 16,536-message browser conversation. “Load older” exposed successive 48-message pages while keeping at most 144 messages rendered. A paging loop found and fixed an automatic-scroll reversal at that limit; a Chrome retest moved back from messages 16,488–16,535 to 16,296–16,439, then moved forward and returned to Latest.

Model-driven compaction was also exercised in Chrome against a local Ollama `llama3.2:1b` model. It processed an 18-message exchange in three ordered parts and preserved all 18 original messages. The model incorrectly described requested Unicode tests as completed work, so compaction now checks completed-work claims against the source exchange and keeps source excerpts when a claim is unsupported. This is a conservative guard for the observed failure, not a general proof that every generated summary is accurate.

The repeatable live check below creates a separate, temporary browser workspace with 40 varied synthetic messages. It compacts in two phases, verifies original messages and date/sequence boundaries, checks that a new part does not reuse the previous summary, and requires the initial removable-drive privacy rule to survive in model context. It deletes its test records afterward. Start Vite and Chrome in separate terminals, then run it with a locally installed Ollama model:

```bash
npm start -- --host 127.0.0.1 --port 5198
chrome --headless=new --remote-debugging-port=9234 --user-data-dir=/tmp/local-agent-compaction-check http://127.0.0.1:5198/
OLLAMA_MODEL=llama3.2:1b node scripts/check-model-compaction.mjs
```

`CAPTURE_MODEL_OUTPUT=1` includes the synthetic model responses in the report for diagnosing failures. On 2026-10-18, the two phases each used two model windows at a 1,536-token context and a 256-token output limit. All 40 source messages and both date ranges survived. The small model sometimes produced an unsupported completed-work claim, repeated an earlier part, returned a generic summary, or wrapped JSON in prose. The app now checks these cases and falls back to source excerpts when needed. A short, source-labeled list of explicit user constraints remains in the rolling context, even when the model omits the privacy rule. This check does not establish reliable summarization across months of varied real work.

Still to verify: actual USB latency and disconnects, months of real content, multiple conversations, UI scrolling while data is being written, browser heap use, and model-driven compaction over much longer varied exchanges.
