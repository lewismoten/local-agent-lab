# Large conversation checks

Back to [Local Agent Lab](../README.md) · [Workspace guide](workspace.md)

Run the repeatable local workload with Node 22 or newer:

```bash
node scripts/stress-harness.mjs --mb 100 --latency-ms 1
# Compare portable chunk packing with the same workload:
node scripts/stress-harness.mjs --mb 100 --latency-ms 1 --pack
# Use deterministic, varied code-like messages instead of repeated prose:
node scripts/stress-harness.mjs --mb 300 --latency-ms 1 --pack --varied
```

The script creates a temporary date-stamped conversation with indexed message chunks, searches for a phrase in its oldest chunk, pages old and recent messages, compacts the latest exchange without a model, and copies the complete conversation to another project. It then publishes that copy as a move, verifies the source folder was removed, reopens the destination, and checks its oldest and latest messages and oldest search result. It deletes the temporary files. `--latency-ms` delays each simulated folder operation; it approximates slow removable storage but is not a measurement of a physical USB drive. Run it without that option to measure local filesystem throughput. The script is separate from the fast unit suite because it writes more than 200 MiB while testing a 100 MiB conversation and its copy.

On 2026-10-18, a 100.1 MiB run with 1 ms simulated operation latency covered 16,536 messages in 689 chunks. Search for a phrase in the oldest chunk took 0.38 seconds and read 12 files; browsing each 40-message page took 0.02 seconds. Copying took 25.84 seconds before the source chunk was reused for diagnostics inspection, 16.80 seconds afterward, and 5.29 seconds after caching directory handles for repeated reads and writes. At that stage, the copy read each chunk once and performed 1,432 lookups. These are local measurements, not performance guarantees.

For an IndexedDB browser run, start Vite and a separate temporary Chrome profile with remote debugging, then run the browser workload:

```bash
npm start -- --host 127.0.0.1 --port 5194
# In another terminal, substitute your Chrome executable if needed:
chrome --headless=new --remote-debugging-port=9231 --user-data-dir=/tmp/local-agent-history-benchmark http://127.0.0.1:5194/
# In a third terminal:
node scripts/stress-browser-history.mjs --port 9231 --mb 100
```

The browser script uses a fresh benchmark workspace ID and varied code-like message text. It verifies search against an old message, 40-message pages at both ends, metadata compaction, full copy, copied search, and the last copied message. It measures the longest delay of a 50 ms main-thread timer. On 2026-10-18, headless Chrome processed 100.0 MiB across 15,648 messages and 652 chunks. Creation took 18.71 seconds; oldest-message search took 0.25 seconds; 40-message pages took 0.001 seconds; metadata compaction took 0.005 seconds; the full copy took 0.60 seconds. The source and copy added about 90 MiB to Chrome storage, and the largest measured timer delay was 19 ms. An earlier highly repetitive 100 MiB browser run used only about 8 MiB in storage, so the varied workload is the more useful storage measurement.

The current 24-message chunks create roughly 650 chunk records per 100 MiB conversation, plus search indexes and diagnostics. IndexedDB handled that count quickly here. Portable workspaces now pack each completed group of 16 immutable chunks into one verified file. New conversations do this at each group boundary; **Conversation → Optimize files** migrates older completed groups and can stop between groups. Loose chunks remain authoritative until a pack is written and read back. Interrupted cleanup can resume, and a loose chunk that differs from its pack is kept for review.

In a fresh 100.1 MiB run with 1 ms simulated folder latency, 689 loose chunks copied in 3.38 seconds with 1,353 lookups and 55 writes. Packing 688 completed chunks into 43 files took 3.19 seconds, leaving one loose tail chunk. Search for the oldest phrase took 0.31 seconds afterward; copying the packed conversation took 0.82 seconds with 238 lookups and 55 writes. These are simulated drive measurements. A physical removable-drive test is still needed before deciding whether this format is enough or SQLite would help further.

The move extension passed on 2026-10-18 with the 100.1 MiB packed workload: publishing the destination and removing the source took 0.09 seconds. A reopened destination still returned the first and last messages and found the old search phrase, while the source index and folder were gone. An 8.1 MiB loose-chunk run passed the same checks. The move timing covers index update and cleanup after copying, not the copy itself or physical USB behavior.

A larger 300.1 MiB packed run covered 49,584 messages across 496 synthetic days and 2,066 chunks at 1 ms simulated folder latency. Packing 2,064 completed chunks into 129 files took 9.58 seconds; the oldest indexed search took 0.91 seconds; recent and oldest 40-message pages took 0.01 seconds or less each; copy took 2.35 seconds; and publishing the move plus removing the source took 0.12 seconds. Reopening the destination preserved both ends of the history and the oldest search result. The generated message bodies are repetitive, so this does not represent the search selectivity, storage use, or compaction quality of a real 16-month conversation.

With `--varied`, each message instead contains deterministic code-like paths, actions, and notes. A 300.1 MiB packed run covered 44,040 messages across 441 synthetic days and 1,835 chunks. Packing 1,824 chunks into 114 files took 9.19 seconds. The oldest indexed search took 0.80 seconds and read 30 files; old and recent 40-message pages took 0.01 seconds or less; copy took 2.72 seconds; and the published move plus source cleanup took 0.10 seconds. Reopening again preserved both ends and the oldest search result. This provides a less repetitive folder workload, but its generated content still cannot establish real-world search quality or model-driven compaction accuracy.

The Chat UI was also opened on the repetitive 16,536-message browser conversation. “Load older” exposed successive 48-message pages while keeping at most 144 messages rendered. A paging loop found and fixed an automatic-scroll reversal at that limit; a Chrome retest moved back from messages 16,488–16,535 to 16,296–16,439, then moved forward and returned to Latest.

Model-driven compaction was also exercised in Chrome against a local Ollama `llama3.2:1b` model. It processed an 18-message exchange in three ordered parts and preserved all 18 original messages. The model incorrectly described requested Unicode tests as completed work, so compaction now checks completed-work claims against the source exchange and keeps source excerpts when a claim is unsupported. This is a conservative guard for the observed failure, not a general proof that every generated summary is accurate.

The repeatable live check below creates a separate, temporary browser workspace with 40 varied synthetic messages. It compacts in two phases, verifies original messages and date/sequence boundaries, checks that a new part does not reuse the previous summary, and requires the initial removable-drive privacy rule to survive in model context. It deletes its test records afterward. Start Vite and Chrome in separate terminals, then run it with a locally installed Ollama model:

```bash
npm start -- --host 127.0.0.1 --port 5198
chrome --headless=new --remote-debugging-port=9234 --user-data-dir=/tmp/local-agent-compaction-check http://127.0.0.1:5198/
OLLAMA_MODEL=llama3.2:1b node scripts/check-model-compaction.mjs
# Add four more ten-exchange phases (120 messages across 120 synthetic days):
EXTRA_COMPACTION_PHASES=4 OLLAMA_MODEL=llama3.2:1b node scripts/check-model-compaction.mjs
```

`CAPTURE_MODEL_OUTPUT=1` includes the synthetic model responses in the report for diagnosing failures. On 2026-10-18, the two phases each used two model windows at a 1,536-token context and a 256-token output limit. All 40 source messages and both date ranges survived. The small model sometimes produced an unsupported completed-work claim, repeated an earlier part, returned a generic summary, or wrapped JSON in prose. The app now checks these cases and falls back to source excerpts when needed. A short, source-labeled list of explicit user constraints remains in the rolling context, even when the model omits the privacy rule. This check does not establish reliable summarization across months of varied real work.

A longer local Ollama run used four additional phases, reaching 120 messages over 120 synthetic days and six compacted parts. The original messages, sequential date and message ranges, distinct part summaries, and initial no-upload rule all survived. The six model phases took roughly 28 seconds together. One observed summary reduced ten new topics to a generic statement that no changes were made; multi-topic compaction now requires at least one less-repeated source detail or uses source excerpts. This is a conservative relevance check, not proof that a plausible model summary is complete or accurate. The live model often fell back to excerpts at this small context size. The check harness now counts successful Ollama chat requests, so an uninstalled model cannot pass merely because deterministic fallback preserves the archive; an intentional missing-model run failed with 0/2 requests. It restores its fetch hook and clears its temporary IndexedDB workspace even if the run fails; a browser query found zero remaining check records after that negative run.

Still to verify: actual USB latency and disconnects, months of real content, multiple conversations, UI scrolling while data is being written, browser heap use, and model-driven compaction over much longer varied exchanges.
