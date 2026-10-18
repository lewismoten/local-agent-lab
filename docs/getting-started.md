# Getting started

Back to [Local Agent Lab](../README.md) · [Workspace guide](workspace.md) · [Privacy and hosting](privacy-and-hosting.md)

## Run locally

```bash
npm install
npm start
```

Open the Vite URL in a browser with File System Access support, such as desktop Chrome or Edge. The app also works in browser storage without a connected folder, but file tools and portable model downloads require one. Under **Models**, choose a browser model from the catalog, download its engine and weights to your folder, then load and test it. Chat becomes available after the selected model or a configured fallback responds in that browser session. You can then change output, context, and thinking limits without repeating the connection test; a browser model reloads with the new limits on the next request. Ollama and other API profiles are optional.

For a first offline chat, open **Models** and use the **Start offline** card. It connects a portable folder, downloads the Wllama engine and the browser-tested [Qwen3 1.7B Q4 GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/tree/main) in sequence, then offers **Load & test**. The model is optional and nothing is downloaded on page load. The download queue can be paused or resumed under **Downloads**; the full catalog remains available for other choices. Qwen3 1.7B is [Apache 2.0 licensed](https://huggingface.co/Qwen/Qwen3-1.7B) and its license files are saved before its weights.

## Validate

```bash
npm run build
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview
```

Preview a Pages build with `GITHUB_PAGES=true` for both commands so its `/local-agent-lab/` assets resolve. Open the preview URL once online, wait for the service worker to control the page, then switch the browser offline and reload. The Models screen should still open from the cached app shell.
