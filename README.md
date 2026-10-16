# Rivers of Memory · Story Studio

A local-first TypeScript/Vite writing studio for a novel, short story, children's book, trilogy, or longer series. This first version focuses on prose. It keeps a structured story bible and moves each chapter through **outline → summary → full text**. Audio, screenplay, and film production can use the same canon later.

## Start

```bash
npm install
npm start
```

Open the Vite URL in Chrome or Edge. In **Settings & AI**, set the premise, format, reading level, audience, genres, and boundaries. Then choose **Connect folder** and select a folder such as `workspace/` (or a new empty folder). The app starts with an empty trilogy and writes it into an empty selected folder. The chosen folder handle is remembered by the browser, but access may need to be granted again after reopening.

The app caches edits in this browser automatically. **Sync folder** writes the records to disk. **Reload folder** picks up changes made in another editor and flags dependent chapter stages for review. Export/import a single JSON snapshot from Settings as an additional backup.

## Folder layout

```text
workspace/
  project.json                   # series profile, audience, genres, book order
  world/
    characters/<id>.json        # biography, relationships, visual instructions, image paths
    notes/<id>.json             # places, cultures, history, rules
    influences/<id>.json        # why a source resonates, factual overview, avoid list
  books/<id>/
    book.json                    # premise, position, reference books
    chapters/<id>.json          # outline, summary, prose, review flags
  sources/<id>.json             # extracted text from imported documents
  sources/originals/            # originals saved when a folder is connected
  assets/characters/<id>/       # uploaded reference images
```

The initial project has three empty books. Edit the JSON files directly if you like, then use **Reload folder**. Give a prequel position 0, and select the later book under **Reference other books** to give AI its established events. Link an imported outline PDF to a book under **Use these source documents** so its extracted text informs chapter outline generation.

Imported PDF, TXT, and Markdown files are read locally. PDF text extraction does not include OCR for scanned pages. The **Extract worldbuilding** action uses your configured AI provider to turn document text into editable world notes. AI suggestions and influence overviews should be reviewed before use.

## AI setup

AI is optional and runs only after an explicit Generate, Extract, or Acquire action.

- **Ollama:** In Settings, choose Local Ollama and enter the installed model and API base URL (normally `http://localhost:11434`). Ollama must permit the app's browser origin. When using GitHub Pages, browser HTTPS/CORS restrictions may require a local HTTPS proxy.
- **OpenAI:** Choose OpenAI, enter a model and your own API key. The key remains in this tab's memory and is not put in project files, local storage, the build, or GitHub Actions. Requests go directly from your browser to the API; use only a key you are comfortable using in a browser session. The app has no server to hide secrets.

Character portraits can be uploaded, or generated with OpenAI's `gpt-image-1` when OpenAI is selected and a folder is connected. Generated images are saved beside uploaded references. Portrait generation makes a separate paid API request.

Generation uses the project profile, world bible, character visual descriptions and relationships, influence preferences, imported source excerpts, and selected reference books. Chapter edits and external file reloads flag later stages for review. AI never silently rewrites downstream work.

The influence lookup finds a public Wikipedia overview and asks your AI provider for a short factual paraphrase. It stores the source link. You can enter or edit the overview yourself. Prompts ask for original plots and prose and avoid imitating protected works; you remain responsible for reviewing the result.

## GitHub Pages

The [Pages workflow](.github/workflows/pages.yml) builds Vite on pushes to `main` and deploys `dist`. In the GitHub repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push this project to `main` to run the workflow. The Vite base path is configured for `/rivers-of-memory/`.

GitHub Pages hosts only the app. Story files are read from and written to a folder you explicitly open in your browser; there is no central account or server sync. `workspace/` is ignored by Git so local drafts and images are excluded from normal commits. Browser folder access requires a supporting browser on HTTPS or localhost.

## Validate

```bash
npm run build
```
