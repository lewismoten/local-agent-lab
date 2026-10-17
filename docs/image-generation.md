# Image generation

The writing room's `/image` command and character portraits use the separate **Image generator** setting in AI profiles. Nothing is loaded by default. Generate a test image once per browser session before using it. Generated images are saved to the connected project folder.

## Browser Stable Diffusion 1.5

Open **AI profiles → Engines** and download **ONNX image · WebGPU**, then open **Catalog** and download **Stable Diffusion 1.5**. The runtime, tokenizer, model components, and their licenses are downloaded only on request and saved in `engines/ONNX-Image/` and `models/SD-1.5-ONNX/` on the connected working drive. The model is about 2.07 GB across several files. Downloads can be paused and resumed, and the existing download speed setting applies. Keep the full folders together when moving the drive to another computer.

Then select **Stable Diffusion 1.5 · browser** as the image generator and click **Test image**. A passing test unlocks image generation for that browser session. No image prompt is sent to a server. This option requires WebGPU with the `shader-f16` feature and enough GPU memory to load the ONNX components. It runs the 512×512 pipeline with 20 denoising steps. Browser support and GPU memory vary by computer; the test is the readiness check.

Before browser image generation or a request to a local image server, the app waits for active local inference and unloads its browser GGUF, PrismML, Needle, and locally used Ollama models. Loading one of those text or tool models later releases the browser image pipeline. Local OpenAI-compatible text servers do not provide a common unload API, so manage those servers separately.

The browser path adapts the pinned [Scribbler WebNN Stable Diffusion pipeline](https://github.com/gopi-suvanam/scribbler-webnn) to read files from the connected folder and uses [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). It uses one WebAssembly thread so GitHub Pages does not need cross-origin isolation headers for this path. The pinned model is Microsoft's [Stable Diffusion 1.5 WebNN export](https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn), run through ONNX Runtime's WebGPU provider. Its CreativeML Open RAIL-M license is saved before the weights. The runtime and pipeline have MIT licenses saved beside them. All downloads are checked against pinned sizes and SHA-256 hashes.

## Bonsai Image

Use the [official Bonsai Image Demo](https://github.com/PrismML-Eng/Bonsai-Image-Demo) to install the model and start its local image server on port 8000. Then run `python scripts/image_server.py --kind bonsai-proxy --port 8003`. The relay forwards `/generate` and allows requests from the writing app's browser origin. Set the URL to `http://localhost:8003`, choose the backend matching the weights you installed, and click **Test image**. Bonsai Image's browser page is a front end for a local Python backend; its image model does not run inside this app's browser runtime.

## Tiny/Small Stable Diffusion and PixArt-δ

The included optional `scripts/image_server.py` provides an OpenAI-compatible image endpoint for these models. It loads model files from a local folder. The web app does not package or download their weights or Python dependencies. [Tiny Stable Diffusion](https://huggingface.co/diffusers/tiny-stable-diffusion-torch) is a development test model; use [Small Stable Diffusion](https://huggingface.co/OFA-Sys/small-stable-diffusion-v0) for more useful story images.

1. Get the model files and terms from the selected model page above or [PixArt-δ LCM](https://huggingface.co/PixArt-alpha/PixArt-LCM-XL-2-1024-MS). Put each complete Diffusers model folder on your working drive, including its license and required tokenizer, encoder, and VAE files. These models have multiple files and are not subject to the app's single GGUF size limit.
2. Install Python dependencies in a virtual environment on the machine running the server: `pip install torch diffusers transformers accelerate safetensors sentencepiece pillow`.
3. Run one server for each model you want to use:

   ```sh
   python scripts/image_server.py --kind tiny-sd --model-path /path/to/drive/models/image/tiny-sd --port 8001
   python scripts/image_server.py --kind small-sd --model-path /path/to/drive/models/image/small-sd --port 8001
   python scripts/image_server.py --kind pixart-delta --model-path /path/to/drive/models/image/pixart-delta --port 8002
   ```

4. Select the matching preset in AI profiles, check the URL and model ID, and click **Test image**.

For a GitHub Pages origin, append `--allow-origin https://YOUR-NAME.github.io` to the server command. Browsers may restrict HTTPS pages from reaching a local HTTP service; if that happens, use a local HTTPS proxy or run the app locally. A public library computer may not permit installing or running Python services.

The local server binds to `127.0.0.1` and only accepts the configured browser origins. It never downloads weights. API keys for image services stay in the current tab's memory; endpoint and model settings are copied to `settings/image-generator.json` when a project folder is connected.
