import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, imageConfigured, IMAGE_PRESETS } from '../src/imageGeneration.ts';

test('no image generator is selected by default', () => {
  assert.equal(imageConfigured(IMAGE_PRESETS.none), false);
  assert.equal(imageConfigured(IMAGE_PRESETS.bonsai), true);
  assert.equal(imageConfigured(IMAGE_PRESETS.openai), false);
  assert.equal(imageConfigured(IMAGE_PRESETS['browser-sd15']), true);
});

test('Bonsai Image uses its native endpoint and accepts PNG bytes', async () => {
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { status: 200 });
  };
  try {
    const image = await generateImage(IMAGE_PRESETS.bonsai, 'A red bird');
    assert.equal(request.url, 'http://localhost:8003/generate');
    assert.equal(request.body.backend, 'bonsai-ternary-mlx');
    assert.equal(request.body.prompt, 'A red bird');
    assert.equal(image.type, 'image/png');
  } finally { globalThis.fetch = previous; }
});

test('local Diffusers bridge returns an OpenAI-compatible base64 image', async () => {
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return Response.json({ data: [{ b64_json: 'iVBORw==' }] });
  };
  try {
    const image = await generateImage(IMAGE_PRESETS['small-sd'], 'A red bird');
    assert.equal(request.url, 'http://localhost:8001/v1/images/generations');
    assert.equal(request.body.model, 'OFA-Sys/small-stable-diffusion-v0');
    assert.equal(image.size, 4);
  } finally { globalThis.fetch = previous; }
});
