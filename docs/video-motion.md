# Browser video and motion experiment

Find the two optional ONNX models in **AI Profiles → Catalog** under **Video & motion**. Download one, select it in **Local Models**, then open **Inspect features** for the video controls. Models and their licenses are saved in separate folders under `models/`. They use the existing ONNX image engine under `engines/`. No model or engine weights are bundled with the website.

**Text to video** generates a single keyframe with one of the existing image models, estimates relative depth with Depth Anything V2 Small, then makes a short looping camera-motion clip. It does not generate new actions, poses, or scene changes. You can supply an image instead of generating a keyframe. The depth map is shown for inspection.

**Frame interpolation** takes two uploaded images and uses RIFE 4.9 to synthesize one intermediate frame. It records a three-frame WebM clip. The frames are resized and center-cropped to 512 × 512 to meet the model's shape requirement.

The app saves clips in `media/videos/` in the connected workspace and offers a WebM download. It releases other local model runtimes before ONNX inference. Downloads are resumable when the source supports HTTP Range; model bytes and license files are checked against pinned SHA-256 values before inference.

Sources: [Depth Anything V2 Small ONNX](https://huggingface.co/onnx-community/depth-anything-v2-small), [RIFE ONNX](https://huggingface.co/edgetools/rife), [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).
