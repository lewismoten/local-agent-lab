"""Optional local image API for Tiny/Small Stable Diffusion and PixArt-δ.

Install the packages described in docs/image-generation.md. Model weights are
loaded from a local folder; this file does not download models.
"""

import argparse
import base64
from io import BytesIO
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("tiny-sd", "small-sd", "pixart-delta", "bonsai-proxy"), required=True)
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--upstream", default="http://127.0.0.1:8000")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--allow-origin", action="append", default=["http://localhost:5173", "http://127.0.0.1:5173"])
    args = parser.parse_args()
    if args.kind != "bonsai-proxy":
        if not args.model_path or not args.model_path.is_dir():
            parser.error("--model-path must point to an existing local model folder")
        import torch
        from diffusers import PixArtAlphaPipeline, StableDiffusionPipeline

        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        dtype = torch.float16 if device != "cpu" else torch.float32
        pipeline_class = PixArtAlphaPipeline if args.kind == "pixart-delta" else StableDiffusionPipeline
        pipeline = pipeline_class.from_pretrained(str(args.model_path), torch_dtype=dtype, local_files_only=True)
        pipeline.to(device)
    else:
        pipeline = None
    generation_lock = Lock()
    model_id = {
        "pixart-delta": "PixArt-alpha/PixArt-LCM-XL-2-1024-MS",
        "small-sd": "OFA-Sys/small-stable-diffusion-v0",
        "tiny-sd": "diffusers/tiny-stable-diffusion-torch",
        "bonsai-proxy": "Bonsai Image 4B",
    }[args.kind]

    class Handler(BaseHTTPRequestHandler):
        def _headers(self, status: int, content_type: str, length: int) -> None:
            self.send_response(status)
            origin = self.headers.get("Origin", "")
            if origin in args.allow_origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.end_headers()

        def _json(self, status: int, value: dict) -> None:
            data = json.dumps(value).encode()
            self._headers(status, "application/json", len(data))
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:
            self._headers(204, "text/plain", 0)

        def do_POST(self) -> None:
            expected_path = "/generate" if args.kind == "bonsai-proxy" else "/v1/images/generations"
            if self.path != expected_path:
                self._json(404, {"error": "Unknown endpoint"})
                return
            origin = self.headers.get("Origin", "")
            if origin and origin not in args.allow_origin:
                self._json(403, {"error": "Origin is not allowed"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > 65536:
                    raise ValueError("Request is too large")
                request = json.loads(self.rfile.read(length))
                if args.kind == "bonsai-proxy":
                    upstream = Request(
                        args.upstream.rstrip("/") + "/generate",
                        data=json.dumps(request).encode(),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urlopen(upstream, timeout=600) as result:
                        image = result.read()
                    self._headers(200, "image/png", len(image))
                    self.wfile.write(image)
                    return
                if request.get("model") != model_id:
                    raise ValueError(f"This server only has {model_id} loaded")
                prompt = request.get("prompt", "")
                if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 10000:
                    raise ValueError("Prompt must be 1–10,000 characters")
                with generation_lock:
                    if args.kind == "pixart-delta":
                        image = pipeline(prompt, guidance_scale=0.0, num_inference_steps=4).images[0]
                    else:
                        image = pipeline(prompt, num_inference_steps=20).images[0]
                output = BytesIO()
                image.save(output, format="PNG")
                self._json(200, {"data": [{"b64_json": base64.b64encode(output.getvalue()).decode()}]})
            except (ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:
                self._json(500, {"error": str(exc)})

    print(f"Serving {model_id} on http://127.0.0.1:{args.port}{'' if args.kind == 'bonsai-proxy' else '/v1'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
