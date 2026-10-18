# Browser video and motion

Find the optional models in **AI Profiles → Catalog → Video & motion**. Download one, select it in **Local Models**, and open **Inspect features**. Model and engine files stay in the connected workspace; the website bundles no model weights.

## What the current tools do

| Tool | Input | Motion in the result | Report method |
| --- | --- | --- | --- |
| Depth Anything | One image, or a prompt that first makes one image | A virtual camera moves over a depth estimate. The subject does not perform new actions. | `depth-camera` |
| RIFE | Two to six ordered images | New in-between pixels are estimated between each adjacent pair. The endpoint actions must already exist in the input images. | `frame-interpolation` |

Depth Anything can save a depth-map PNG. RIFE supports 2×, 4×, or 8× interpolation at 256 or 512 px and previews the frames as they arrive. Both tools can save WebM or MP4 under `media/videos/` and can also save numbered PNG frames in a ZIP under `media/frames/`. Depth clips have selectable frame rate; RIFE clips have a separate playback frame rate, independent of interpolation multiplier. Both offer Auto or 0.5–8 Mbps bitrate. The report saves requested bitrate and the rate reported by MediaRecorder; neither proves the achieved file bitrate. Auto prefers WebM, then MP4; if video encoding fails, the tools save the PNG ZIP. The inspector probes [MediaRecorder recording types](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static) and [WebCodecs encoder configurations](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static) on this browser. The current export uses MediaRecorder; a WebCodecs probe does not imply WebCodecs export. Reports include available formats, the selected format, actual encoded MIME type and byte size, plus measured WebM or MP4 frame timestamps, duration, and effective fps when the clip can be parsed. Both timing readers have a 50 MB input limit; a parsing failure is shown in the report. They free other local model runtimes before ONNX inference. Downloads resume when the source supports HTTP Range; required files and license texts must pass the pinned hash check.

These tools do **not** establish true image-to-video generation. A prompt used to make the first image still produces camera motion over that one image. The app currently lists no model verified to generate new subject motion from a single source image.

Frame pacing uses a fixed clock so rendering work does not add delay to every recorded frame. A Chrome check of a 24-frame, 12 fps depth clip saved all requested frames and measured a 2.018-second WebM, but its frame intervals ranged from 20 to 131 ms. Review the timing warning in the report; selected fps is a target, not a guarantee. A separate MP4 report measured 25 samples and 2.072 seconds with an uneven-interval warning.

## Acceptance test for a source-conditioned video model

Before labeling a candidate as generative image-to-video, save a repeatable browser run with:

1. **One source image** and a motion instruction. Do not provide a second endpoint frame or a pre-rendered motion sequence. Keep the camera fixed in the requested scene.
2. **At least eight ordered output frames** at 128–256 px plus a playable local clip or PNG sequence. Save the input, prompt, seed, model revision, engine revision, backend, frame count, dimensions, elapsed time, and exact package bytes in the report.
3. **Visible subject change** that cannot be explained by a whole-image translation, zoom, crop, or parallax warp. Use a fixture with an articulated subject that changes pose and a stationary background landmark. Review the first, middle, and last frames and the whole sequence.
4. **A second fixture with occlusion**: a subject moves past a fixed foreground edge, revealing or hiding background. Review whether the subject remains recognizable and whether the newly visible region is coherent. This is a manual quality check, not proof of ground-truth future frames.
5. **An offline repeat** using only files already in the workspace and no remote inference call. Check that the model and its required engine, license, notices, and other assets together fit below 2,000,000,000 bytes. Record actual browser memory or device-loss failures separately from download size.

A passing run must show actual inference in the browser and new scene motion in both fixtures. A successful file export alone does not pass. Keep the diagnostic JSON and the frame sequence so artifacts and temporal consistency can be reviewed. Report failures and inconclusive results as such; do not promote a model to the catalog on an unverified demo.

The [image and video inventory](image-video-inventory.md) records the present model paths and browser evidence. Sources: [Depth Anything V2 Small ONNX](https://huggingface.co/onnx-community/depth-anything-v2-small), [RIFE ONNX](https://huggingface.co/edgetools/rife), [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).
