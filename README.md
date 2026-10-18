# Rivers of Memory · Story Studio

A local-first React/TypeScript/Vite writing studio with a chat-first interface for a novel, short story, children's book, trilogy, or longer series. This first version focuses on prose. It keeps a structured story bible and moves each chapter through **outline → summary → full text**. Audio, screenplay, and film production can use the same canon later.

## Start

```bash
npm install
npm start
```

Open the Vite URL in Chrome or Edge. In **Story profile**, set the premise, format, reading level, audience, genres, and boundaries. Then choose **Connect folder** and select a folder such as `workspace/` (or a new empty folder). The app starts with an empty trilogy and writes it into an empty selected folder. The chosen folder handle is remembered by the browser, but access may need to be granted again after reopening.

If the folder picker is canceled, the current workspace remains in place. Browsers can also return the same `AbortError` when a selected folder is restricted or editing permission is denied. If selection repeatedly fails, choose a writable **subfolder** on the USB drive rather than the drive root, and grant read and edit access. The app shows this guidance beside Connect folder without treating a canceled picker as an application error.

The app caches edits in this browser automatically. **Sync folder** writes the records to disk. **Reload folder** picks up changes made in another editor and flags dependent chapter stages for review. Export/import a single JSON snapshot from Settings as an additional backup.

## Folder layout

```text
workspace/
  project.json                   # series profile, audience, genres, book order
  world/
    story-graph.json             # proposed and accepted books, arcs, mentions, events, ideas
    characters/<id>.json        # biography, relationships, visual instructions, image paths
    notes/<id>.json             # places, cultures, history, rules
    reviews/<id>.json           # saved continuity findings and decisions
    influences/<id>.json        # why a source resonates, factual overview, avoid list
  books/<id>/
    book.json                    # premise, position, reference books
    chapters/<id>.json          # outline, summary, prose, review flags
  sources/<id>.json             # extracted text from imported documents
  sources/originals/            # originals saved when a folder is connected
  assets/characters/<id>/       # uploaded reference images
  assets/chat/                  # images generated from chat
  chat/thread.json              # full transcript, active window, compact memories
  chat/archives/<id>.json       # full copy of each window before compaction
  models/<model>/               # one folder per optional browser model
  models/<model>/LICENSE.txt   # license beside its weights and source
  models/Needle-1/             # optional Needle 1 weights and vocabulary
  models/Needle-2/             # optional Needle 2 tool model
  models/Needle-3/             # optional Needle 3 tool model
  models/capabilities.json      # test definitions and per-model results
  engines/Wllama/               # optional GGUF browser runtime and license
  engines/PrismML/              # optional Bonsai 2 source, compiler, and notices
  engines/Needle/               # optional Needle browser runtime and notices
  engines/Pocket-TTS/            # optional speech runtime and licenses
  models/Pocket-TTS-<language>/  # speech weights, license, diagnostics
  engines/Kokoro/                # optional Kokoro runtime and licenses
  models/Kokoro-82M-Q8/         # Kokoro weights, voices, license, diagnostics
  engines/Chatterbox/            # optional Transformers.js and ONNX runtime
  models/Chatterbox-Turbo-Q4F16/ # Turbo weights, license, diagnostics
  engines/Qwen3-TTS/             # optional memory64 speech runtime
  models/Qwen3-TTS-1.7B-Q4/     # speech model, audio projector, license
  engines/OpenVoice/            # optional ONNX voice conversion runtime
  models/OpenVoice-V2-Q8/       # encoder, converter, license, provenance
  voices/samples/               # voice recordings and their reading text
  audio/generated/              # synthesized WAV files and metadata
  engines/Transformers-ASR/     # optional Whisper, Moonshine, and Wav2Vec2 runtime
  engines/Sherpa-ONNX-ASR/      # optional streaming transcription runtime
  models/<transcription-model>/ # pinned transcription weights and license
  transcripts/                  # saved audio transcripts and timed segments
```

The initial project has three empty books. Edit the JSON files directly if you like, then use **Reload folder**. Give a prequel position 0, and select the later book under **Reference other books** to give AI its established events. Link an imported outline PDF to a book under **Use these source documents** so its extracted text informs chapter outline generation.

Imported PDF, TXT, and Markdown files are read locally. PDF text extraction does not include OCR for scanned pages. The **Extract worldbuilding** action uses your configured AI provider to turn document text into editable world notes. AI suggestions and influence overviews should be reviewed before use.

Each imported document is also scanned in a Web Worker for book, part, story, chapter, outline, theme, arc, character, place, event, age, health, and time clues. Open its **Story map** under Source documents to accept or dismiss candidates. Repeated names share a normalized link key across documents; create a character file to bind those mentions to a canonical character. Accept book and chapter headings, then click **Apply accepted books and chapters** to copy their titles into the writing plan. Edits to a source can be analyzed again, and accepted findings are marked for review when their evidence changes. The local scan uses patterns and can miss implicit relationships or suggest false matches. **Find more with AI** is an optional, explicit model request that adds further candidates with excerpts from the document. Parsing pauses while you type or wait for a chat response.

## Writing room

The writing room is the default screen. Choose an AI profile at the top, then chat with the selected model. Its prompt includes a bounded view of the story bible and relevant memory shards. The toolbar provides these explicit tools:

- **Import:** add PDF, TXT, or Markdown files to Source documents.
- **Read:** type `/read search terms` to retrieve matching documents, world notes, characters, and chapters. Type `/files` to list project paths, then `/read path:relative/file.json` to read a text, Markdown, PDF, or JSON file from the connected folder. Results are visible in the conversation.
- **Image:** choose a browser image model under **Local Models** and run **Inspect features**, or configure an external service through **Image services** in AI profiles. Then type `/image description`. Connect a folder to save the result.

With the browser GGUF profile, the model can also call bounded read tools to list project files, search project records, and read a text, Markdown, JSON, or PDF file in the connected folder. Tool results appear in chat. The model can discuss and suggest file edits, but chat replies do not silently change story JSON. The structured editors remain the place to approve those changes.

### Writing modes

Switch modes above the conversation at any time. The choice and conversation are saved in `chat/thread.json` when a folder is connected.

The current page and open Help or AI test dialog are reflected in the URL hash, so Back/Forward navigation and Vite reloads return to them. The selected book, chapter, character, note, influence, source, and unsent chat draft stay in this tab's session storage.

- **Chat:** discuss the story and use the import, read, and image commands.
- **Interviewer:** click **Ask the first question**. With a ready AI model, the next question draws on project metadata and collected canon. Without one, starter questions let you begin. Each answer becomes a world note in `world/notes/`; the interviewer then asks another question. Edit the note later in the World Bible or its JSON file.
- **Free writing:** enter a title and category if useful, write freely, and save. Each entry becomes an editable world note. When folder access is available, its JSON file is written immediately; otherwise it remains in the browser until you connect and sync a folder.
- **Suggestions:** browse optional ideas based on imported structure, or ask a configured model for more. Click **Add to world bible** to create an editable note; dismissed ideas remain out of canon.
- **Continuity check:** run structural checks with no model, or add AI review with a ready model. The review looks for possible contradictions, paradoxes, plot holes, anachronisms, narrator discrepancies, and retcons. It records evidence, paths, and questions rather than changing canon. Review each issue, set its status, and save your decision. Reports are stored in `world/reviews/` when a folder is connected, so they can be reopened from a USB drive without an AI connection. AI review is bounded by the selected model’s context window and may miss problems across distant files.

### Context and archives

Each profile has an editable maximum context window and output limit. The context meter uses a rough character-to-token estimate; the provider's actual count may differ. When the active prompt approaches the limit, the app saves the **entire uncompacted window** to IndexedDB and, when connected, `chat/archives/` in your folder. It then creates a short ongoing summary and small searchable memory shards. The context panel lets you search and pin shards, inspect full archives, or compact manually. The full conversation also remains in `chat/thread.json` and IndexedDB.

For a small local model, set a modest context window in Settings. Only the active window, compact summary, and a few relevant or pinned shards go into each request. Old raw turns stay retrievable without consuming every prompt. Connect a folder for a copy that survives browser storage clearing.

## AI setup

AI is optional and runs only after you send a chat message or click a Generate, Extract, or Acquire action. Settings includes separate profiles for an in-browser GGUF model, Ollama, OpenAI Responses, a Codex-oriented OpenAI API profile, local OpenAI-compatible endpoints, Anthropic, and Gemini. Duplicate a profile to configure more accounts or local servers; switch profiles or models from the writing room. A new installation selects the browser profile, but **no model is selected or loaded by default**.

Each selected model must answer a short connection check in the current browser session before AI actions run. The browser profile runs that check with thinking off when you click **Load**. Untested AI actions open a test dialog; local file, free-writing, starter interviewer, and structural continuity features remain available. Changing a profile's model, endpoint, key, or runtime settings creates an untested selection. API provider checks may incur a charge.

- **In browser:** Connect a folder, place a GGUF file under `models/`, choose it in AI profiles, then click **Load**. The model requires its license files in `models/` before it can load or answer. Suggested models receive those files before the first GGUF request. For a custom model, add `LICENSE.txt` in its model folder yourself or use the license upload beside the custom URL. Interrupted downloads keep a `.download.json` record, including the URL, and committed bytes in its model folder. After a page refresh, **Resume model download** appears in the top bar and AI profiles; click it to restore folder permission if needed and continue. The list of incomplete files also supports moving the folder to another computer. The speed limit is saved in this browser and reused for resumed downloads; a new browser defaults to 0.25 MiB/s (about 2 Mbps) for shared networks. You can change it while downloading. **Pause** commits the latest bytes. Resume requires an HTTPS server that supports byte ranges and exposes the needed response headers to the browser. The old downloader's partial `.gguf` files can also resume when their prefix matches the URL. For a library computer, download the GGUF elsewhere and copy it to your USB drive ahead of time. The **Local Models** context slider stops at the smaller of the browser engine limit (32K) and the selected catalog model’s published limit; changing it requires reloading the model. Needle context is engine controlled. The model is loaded again on each new browser session, but its file remains on the drive. Most browser GGUF models use Wllama downloaded into `engines/Wllama/`; Bonsai 2 uses the optional PrismML WebGPU engine. Neither sends prompts, files, or model weights to an LLM service. Browser performance varies by hardware; these small models are best for focused tasks and may be weak at long prose. If an in-app download is blocked by cross-origin rules, download through the model page and copy the file to its folder under `models/`.

  **Browser GGUF size limit:** This app accepts one GGUF file of at most 2,000,000,000 bytes (2 GB) for both in-app downloading and browser loading. The same loading limit applies if you copy a larger file into `models/` yourself. Wllama supports models split across smaller GGUF files, but this app does not yet load split models. Use a smaller quantization or an Ollama/API profile for larger models. The limit does not apply to files used by those other profiles.

  **Suggested models:** AI profiles has **Loaded models**, **Model catalog**, and **Engines** tabs. The catalog shows GGUF choices with sizes, licenses, and download progress. Choose **Download** for one model or **Queue remaining** to download models sequentially. Pending items can be moved up or down; the active transfer stays in place. A GGUF already on your drive shows **Downloaded**, and **Save license** moves any missing catalog license files to the front of the pending queue. The queue continues while you navigate the app and is saved in `models/download-queue.json` on your project drive; after a page refresh, reconnect the folder and resume it. Nothing is downloaded or loaded until you choose it. See [Model license handling](docs/model-licenses.md) for the catalog license sources and review scope.

  **Capability results:** The connected workspace keeps `models/capabilities.json`, with the current test definitions and results keyed by GGUF filename. Diagnostics update it as each check finishes. The catalog and model selector read their confirmed feature icons from this file; 💭 means the model followed a prompted `<think>` format, 🧠 means a separate thinking segment was observed, and 🖼️ means the shapes-and-colors vision test passed. A correct answer is scored separately from the tool-call or thinking format. 🧪 opens diagnostics for an installed model when checks are missing or older than the current test version. Use **Refresh results** after editing or copying the file on the drive. Previous catalog confirmations are imported as version 0 and remain due for retesting.
- **Reference photo test:** Vision tests include the photo from `public/` as the first test, including on GitHub Pages. The test sends the photo only to the selected browser vision model. The report records which obvious, detailed, and subtle photo details appeared in the response; these keyword matches are exploratory, not proof that every visual claim is correct.
- **Perspective crop test:** One barcode probe remains. Its former UPC-A companion is a tilted document test: the model selects four corners, and the app overlays that selection and shows a straightened crop. Saved vision diagnostics include the selected coordinates and straightened PNG when a valid selection is returned.
- **MiniCPM5 and Needle:** MiniCPM5 1B and 2B appear in the GGUF catalog and use the optional Wllama engine. Needle 1, 2, and 3 appear in **Model catalog** and, once downloaded, in the same **Loaded models** picker as GGUFs. Their shared WebAssembly runtime appears in **Engines**. Select a Needle model to run its file, license, text, tool, reasoning, and thinking probes; results join the shared capability ledger and batch reports. Needle models specialize in tool routing and cannot replace a general chat model. Downloads can pause and resume, and the engine and weights are verified against pinned hashes before use. No Needle engine or weights are shipped in the website.
- **Bonsai 2 in browser:** Bonsai 2 uses the optional PrismML WebGPU engine. The **Engines** tab downloads PrismML’s pinned TypeScript source, its license and notice, and the esbuild browser compiler from pinned upstream URLs into `engines/PrismML/` (about 17 MB total). Downloads can pause and resume. When you choose **Load**, your browser compiles the saved source and runs it locally; the website does not include the engine source or a precompiled copy. Every downloaded file is checked against a pinned SHA-256. A WebGPU browser and adequate GPU memory are required. The browser catalog uses the 0.43 GB PTQ1_0 packing in `models/`; this engine does not load the Q2_0 packing. Already downloaded Q2_0 files can be used with a compatible local server. For image recognition, use **Get vision** in the Catalog to queue the matching projector in `models/`; the vision tests also allow a file already on your device to be added. The app does not include model or projector weights. The engine source is [PrismML Talk](https://github.com/PrismML-Eng/Talk), licensed under Apache 2.0.
- **Ollama:** In Settings, choose Local Ollama and select a model from the installed model list (normally at `http://localhost:11434`). The app does not assume `llama3.2` exists. It checks `/api/tags` before sending a request and shows when a saved model name is missing; use the exact installed tag, such as `llama3.2:1b` or `llama3.2:3b`. Ollama must permit the app's browser origin. When using GitHub Pages, browser HTTPS/CORS restrictions may require a local HTTPS proxy.
- **OpenAI and Codex-oriented profile:** These use the [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) with your own API key. Codex sign-in is separate and is not reused by this browser app. Model access and supported reasoning efforts depend on your account and chosen model.
- **Other providers:** Enter the model ID and endpoint supported by your account or local server. Thinking effort or token budget controls are sent only where the corresponding API supports them; incompatible model/provider combinations return the provider's error.

API keys remain in this tab's memory and are not put in project files, local storage, the build, or GitHub Actions. Requests go directly from your browser to the selected endpoint; use only keys you are comfortable using in a browser session. There is no server to hide secrets. Some endpoints block browser CORS requests; a local HTTPS proxy may be needed, especially from GitHub Pages.

### Browser speech

The **Catalog** offers three Pocket TTS INT8 bundles (English, German, and Spanish), Kokoro 82M Q8 with four built-in English voices, Chatterbox Q4F16, Chatterbox Turbo Q4F16, Qwen3-TTS 1.7B Q4, and OpenVoice V2 Q8. Download a model and its matching engine to your project folder, then choose **Speech & voice** under **Local Models** to load it. The app checks pinned file hashes and the saved license before loading. Engine code and weights are downloaded only on request; neither is included in the site build. Loading speech unloads any active text, tool, or image model.

**Voices** keeps reading passages with names, dates, numbers, and contrasting sounds. Record or upload a short reference clip there; its audio and reading text are stored together in `voices/samples/`. Kokoro uses built-in voices and does not clone recordings. Under **Local Models**, choose a speech model and use **Load** and **Inspect features** in the usual control row. The speech test lets you choose a voice, generate and listen to a WAV, and save a diagnostic report. Both Chatterbox models require a saved English voice. The original Chatterbox has an expression slider; Turbo test passages include supported sound tags such as `[chuckle]` and `[laugh]`. The pinned Turbo ONNX model has no exaggeration input. Its ONNX export runs in WebAssembly in this browser engine; generation can take longer than loading. Qwen3-TTS uses a separate memory64 WebGPU bridge and needs a cross-origin-isolated page. Its bridge returns audio at the end of each request, so the app generates short passages in sequence and can play each completed passage while the next one generates. OpenVoice converts existing source speech to a saved reference voice; it does not synthesize text by itself. Source recordings up to ten minutes are split into roughly twenty-second parts, with a choice of pause-aware or even cuts. The converted parts are joined with short crossfades. Reference clips remain limited to thirty seconds. **Stop** ends generation and live playback; load the model again afterward. The WAV and its prompt or source and voice metadata stay in the workspace. Pocket TTS voice cloning uses up to the first ten seconds of a clip. English, German, and Spanish are separate Pocket bundles; select the matching language for best results.

### Browser transcription

Choose **Transcription** in the Catalog for Whisper Tiny English, Moonshine Tiny, Moonshine Base, Wav2Vec2 Base 960h, or Sherpa Zipformer Streaming. The first four use the Transformers ASR engine and can transcribe files or microphone passages. Sherpa uses its own engine and updates microphone text as speech is decoded. Model files and licenses are hash checked in the connected workspace. Sherpa's official release archive must be downloaded from the link in **Import Sherpa**, then imported into the workspace; the browser cannot fetch that GitHub release directly because its download endpoint does not permit cross-origin requests. The app verifies and unpacks the archive. Under **Local Models**, select a downloaded model, click **Load**, then **Transcribe**. Stopping a microphone session saves its recording in `audio/recordings/` and transcript in `transcripts/`. These models recognize English; they do not translate or separate speakers. Loading transcription unloads other local models to limit memory use.

Character portraits can be uploaded or generated with a selected image model. Browser options include Stable Diffusion 1.5, Tiny-SD Q4 and FP16, SDXS DreamShaper, DreamShaper 8 LCM, and Supra2-IMG Mobile through optional ONNX Runtime Web downloads. Select one under **Local Models** and run **Inspect features** to test it. The **Image services** dialog holds external options such as OpenAI, Bonsai Image through its local server, and Tiny/Small Stable Diffusion or PixArt-δ through the optional local image server. Generated images are saved beside uploaded references. See [Image generation setup](docs/image-generation.md). A text GGUF model cannot generate images by itself.

The Catalog also offers VTracer for raster-to-SVG tracing, MediaPipe Pose Landmarker for photo/video skeleton data, and an experimental browser TripoSR export for static 3D meshes. Each uses optional files saved to the connected workspace. See [Browser graphics and pose tools](docs/graphics-and-pose.md) for inputs, outputs, licensing, and limits.

Generation uses the project profile, world bible, character visual descriptions and relationships, influence preferences, imported source excerpts, and selected reference books. Chapter edits and external file reloads flag later stages for review. AI never silently rewrites downstream work.

The influence lookup finds a public Wikipedia overview and asks your AI provider for a short factual paraphrase. It stores the source link. You can enter or edit the overview yourself. Prompts ask for original plots and prose and avoid imitating protected works; you remain responsible for reviewing the result.

## GitHub Pages

The [Pages workflow](.github/workflows/pages.yml) builds Vite on pushes to `main` and deploys `dist`. In the GitHub repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push this project to `main` to run the workflow. The Vite base path is configured for `/rivers-of-memory/`.

GitHub Pages hosts the app. It does not host Wllama, PrismML’s source, the browser compiler, or GGUF weights. Those optional files are downloaded from pinned upstream URLs into a folder you explicitly open in your browser; there is no central account or server sync. `workspace/`, `models/`, `engines/`, and `*.gguf` are ignored by Git so local drafts, images, and model weights are excluded from normal commits. Browser folder access requires a supporting browser on HTTPS or localhost. A new machine needs access to the hosted app (or a local Vite copy), but does not need to download model weights or the optional source and compiler again when they are already on your USB drive.

## Validate

```bash
npm run build
```

**Model folders:** New browser model downloads save each weight, license, notice, source, and diagnostics under `models/<model>/`. A vision projector shares its parent model folder. Old flat files and partial downloads remain readable and resumable. Needle browser output and thinking limits are controlled by its pinned engine; Needle 1 has no documented thinking trace, while Needle 2 and 3 may return automatic traces.

**Engine folders:** Wllama, PrismML with its browser compiler, and Needle keep their runtime and license files in separate folders under `engines/`. The Engines tab can move existing flat files and paused download records into these folders without downloading them again. It does this automatically when the connected folder already grants write access; otherwise, an **Organize engines** button appears until the move is complete.
