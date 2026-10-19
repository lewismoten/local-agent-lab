# Image generation

The writing room's `/image` command and character portraits use the selected image generator. Choose a browser image model under **Local Models** and run **Inspect features**, or open **Image services** in AI profiles for an external provider and its test. Nothing is loaded by default. Test once per browser session before using it. Generated images are saved to the active workspace.

## Browser image models

Open **AI profiles → Engines** and download **ONNX image**, then open **Catalog** and choose an image model. The runtime, tokenizer, model components, and licenses are downloaded only on request to the active workspace. This can be browser storage or a connected drive. Downloads can be paused and resumed, and the existing download speed setting applies. Keep each model folder together when moving a drive to another computer.

| Model | Approximate download | Working drive folder | Use |
| --- | ---: | --- | --- |
| Stable Diffusion 1.5 | 2.07 GB | `models/SD-1.5-ONNX/` | Complete package exceeds the current 2 GB download cap; existing files are retained |
| Tiny-SD Q4 | 0.64 GB | `models/Tiny-SD-Q4-ONNX/` | Smallest download; may produce gray pattern artifacts |
| Tiny-SD FP16 | 1.00 GB | `models/Tiny-SD-FP16-ONNX/` | Higher precision variant; prefer when Q4 fails the image test |
| SDXS DreamShaper | 0.88 GB | `models/SDXS-DreamShaper-ONNX/` | One-step 512×512 story image drafts |
| DreamShaper 8 LCM INT8 | 1.04 GB | `models/DreamShaper-8-LCM-INT8-ONNX/` | Four-step 512×512 drafts |
| Supra2-IMG Mobile | 0.44 GB | `models/Supra2-IMG-Mobile-ONNX/` | Compact 256×256 drafts; English prompts |

All six share `engines/ONNX-Image/`. Previously downloaded ONNX Runtime Web 1.22 files continue to run the original four models. Update the engine to 1.30 before using DreamShaper 8 LCM or Supra2. The Tiny-SD exports come from [cursedhelm's ONNX conversion of Segmind Tiny-SD](https://huggingface.co/cursedhelm/aderpy-deepdreamer-onnx). [SDXS DreamShaper](https://huggingface.co/skillsafeai/sdxs-512-dreamshaper-onnx-webgpu) has a separate one-step sampler and an Open RAIL++-M license; the saved folder also includes its base model's Open RAIL-M and TAESD decoder's MIT license. [DreamShaper 8 LCM](https://huggingface.co/skillsafeai/dreamshaper-8-lcm-onnx-webgpu) uses four LCM steps with no guidance. [Supra2-IMG Mobile](https://huggingface.co/mikhsol/Supra2-IMG-mobile-onnx) uses a T5 tokenizer and rectified-flow sampler; its Apache 2.0 license and NOTICE are saved with the model. The app downloads only components needed for text-to-image generation. Tiny-SD uses the source model's DPM++ scheduler; Stable Diffusion 1.5 uses its existing Euler path. **Inspect features** and **Test image** start with an editable green-leaf prompt. That reference prompt gets a basic color check; custom prompts generate a preview for visual review. Prompts are remembered per model in this browser, and generated images can be downloaded.

See [visual model status](visual-model-status.md) for the current repeatable browser evidence and the complete-package limit, including the shared engine.

Then select the matching browser image model under **Local Models** and run **Inspect features**. The test uses seed 42 so comparisons of settings and variants are repeatable; normal generations use a random seed. A successful reference test or decoded custom generation unlocks image generation for that browser session. Custom prompts do not change the catalog's reference diagnostic result. No browser-model prompt is sent to a server. This option requires WebGPU with the `shader-f16` feature and enough GPU memory to load the ONNX components. Supra2 produces 256×256 images; the others produce 512×512. Stable Diffusion and Tiny-SD default to 20 denoising steps with prompt strength 7.5; both can be adjusted in **Image services**. SDXS is fixed at one step and DreamShaper LCM at four steps, both without guidance. Supra2 defaults to 20 steps and prompt strength 3. The catalog shows default steps, not a model limit. Browser support and GPU memory vary by computer; the test is the readiness check.

Before browser image generation or a request to a local image server, the app waits for active local inference and unloads its browser GGUF, PrismML, Needle, and locally used Ollama models. Loading one of those text or tool models later releases the browser image pipeline. Local OpenAI-compatible text servers do not provide a common unload API, so manage those servers separately.

The Stable Diffusion and Tiny-SD browser paths adapt the pinned [Scribbler WebNN Stable Diffusion pipeline](https://github.com/gopi-suvanam/scribbler-webnn) to read files from the connected folder; SDXS, DreamShaper LCM, and Supra2 have their own samplers. All use [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). The runtime uses one WebAssembly thread so GitHub Pages does not need cross-origin isolation headers for this path. The Stable Diffusion 1.5 model is Microsoft's [WebNN export](https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn), run through ONNX Runtime's WebGPU provider. Its CreativeML Open RAIL-M license is saved before the weights. The runtime and pipeline have MIT licenses saved beside them. All downloads are checked against pinned sizes and SHA-256 hashes.

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
