# Visual model status

Back to [Local Agent Lab](../README.md) · [Full package inventory](image-video-inventory.md)

Open **Models → Catalog** to filter and download models. Each package includes its model files and license; the required engine is downloaded separately and can be shared. The table below distinguishes a saved, repeatable browser run from a catalog entry. A passing test proves that the stated path ran in the tested browser, not that image quality or phone performance is guaranteed.

| Model | Task | Complete package | Browser status |
| --- | --- | ---: | --- |
| Supra2-IMG Mobile | Text to 256 × 256 image | 471 MB | **Tested:** a pinned WebGPU run made and saved an image in Chrome, including an offline repeat. The fixture checks dimensions and green content, not whether it depicts a leaf. |
| Depth Anything V2 Small | Image to depth map and camera motion | 54 MB | **Tested:** Chrome saved a depth result and 24-frame clip from a synthetic image, including an offline run. Natural-scene depth quality remains unscored. |
| RIFE 4.9 | Interpolate ordered image frames | 48 MB | **Tested:** Chrome saved three different ordered frames and a WebM from two synthetic images, including an offline run. Natural-scene artifacts and frame timing remain open. |
| Pose Landmarker Full | Detect pose landmarks | 36 MB | **Tested:** Chrome processed a synthetic image offline and correctly returned no person. Accuracy on a real person is not established by that fixture. |
| VTracer | Raster image to SVG | <1 MB | **Tested:** Chrome generated SVG with the saved WebAssembly engine, including an offline run. |
| TripoSR Q8 | Image to colored mesh | 512 MB | **Tested:** Chrome exported GLB and PLY meshes, with a separate run blocking HTTPS requests. Mesh appearance and decoder backend need further review. |
| Tiny-SD Q4 / FP16 | Text to 512 × 512 image | 663 MB / 1.02 GB | **Catalog path:** model and engine are available for optional download. No repeatable quality or offline run is recorded in this inventory. Q4 has shown gray-pattern artifacts in manual use. |
| SDXS DreamShaper | Text to 512 × 512 image | 909 MB | **Catalog path:** one-step generator is wired in; repeatable output and offline quality evidence is still needed. |
| DreamShaper 8 LCM | Text to 512 × 512 image | 1.06 GB | **Catalog path:** four-step generator is wired in; repeatable output and offline quality evidence is still needed. |
| Stable Diffusion 1.5 | Text to 512 × 512 image | 2.09 GB | **Over cap:** the complete package exceeds the 2,000,000,000-byte catalog limit, so a new download is blocked. Existing files are not deleted. |

Package sizes are rounded here. The [inventory](image-video-inventory.md) gives exact declared bytes, source URLs, license links, engine requirements, and the browser-run evidence. The repeatable runs used headless Chrome 155 on macOS. A narrow viewport check verifies layout only; physical phone, USB-drive, and second-machine inference remain untested. Catalog detail dialogs show the latest diagnostics saved in **your** workspace, which may differ from the evidence summarized here.
