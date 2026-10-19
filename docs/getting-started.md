# Getting started

Back to [Local Agent Lab](../README.md) · [Workspace guide](workspace.md) · [Privacy and hosting](privacy-and-hosting.md)

## Run locally

```bash
npm install
npm start
```

Open the Vite URL in a browser with File System Access support, such as desktop Chrome or Edge. File tools and model downloads can also use browser storage without a connected folder; connect a drive when the workspace must travel to another computer. Under **Models**, choose a browser model from the catalog, download its engine and weights to the active workspace, then load and test it. Chat becomes available after the selected model or a configured fallback responds in that browser session. You can then change output, context, and thinking limits without repeating the connection test; a browser model reloads with the new limits on the next request. Ollama and other API profiles are optional.

For a first offline chat, open **Models** and use the **Start offline** card. Choose browser storage or connect a portable folder; the setup then downloads the Wllama engine and the browser-tested [Qwen3 1.7B Q4 GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/tree/main) in sequence and offers **Load & test**. The model is optional and nothing is downloaded on page load. The download queue can be paused or resumed under **Downloads**; the full catalog remains available for other choices. Qwen3 1.7B is [Apache 2.0 licensed](https://huggingface.co/Qwen/Qwen3-1.7B) and its license files are saved before its weights.

## Mobile and browser limits

- The interface has been checked at narrow viewport sizes, but the image, video, mesh, and model runs recorded so far used desktop Chrome. Mobile viewport emulation does not establish phone performance, thermal behavior, or playback support. Physical iPhone and Android checks remain open.
- A mobile browser may not offer a writable folder picker. Browser storage can hold local files and models on that device, but it does not move with a USB drive. Connecting the same drive on another machine requires a browser that grants folder access there.
- Image generation and TripoSR require WebGPU features; Pose Landmarker and VTracer use CPU WebAssembly. Depth Anything and RIFE can try WebAssembly when their WebGPU session cannot start. The catalog checks available browser APIs, but a successful API check does not guarantee enough memory to run a model.
- The mobile RIFE path accepts at most three ordered images. Large model files and output clips can still exceed browser memory or storage, even when their download fits the catalog's size limit.
- Visit the site once online so its app files can be cached. Download optional model and engine files before going offline. A browser may require fresh drive permission after a restart; use **Reconnect drive** if the workspace is not open.

## Validate

```bash
npm run build
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview
```

Preview a Pages build with `GITHUB_PAGES=true` for both commands so its `/local-agent-lab/` assets resolve. Open the preview URL once online, wait for the service worker to control the page, then switch the browser offline and reload. The Models screen should still open from the cached app shell.
