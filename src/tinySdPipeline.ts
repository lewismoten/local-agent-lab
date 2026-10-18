/** Tiny-SD's pinned export uses a DPM++ 2M scheduler with epsilon prediction. */
type TensorData = Uint16Array | Float32Array | ArrayLike<number>;
type Tensor = { data: TensorData; dims: readonly number[] };
type Session = { run: (feeds: Record<string, Tensor>) => Promise<Record<string, Tensor>> };
export type Ort = { Tensor: new (type: string, data: Uint16Array | BigInt64Array, dims: number[]) => Tensor };
export type TinyPipeline = {
  sessions: { text_encoder: Session; unet: Session; vae_decoder: Session };
  tokenizer: (text: string, options?: unknown) => Promise<{ input_ids: { data: Int32Array } }>;
  onPreview?: (value: { step: number; totalSteps: number; imageData: ImageData }) => void;
};

const LATENT_SIDE = 64;
const IMAGE_SIDE = 512;
const LATENT_COUNT = 4 * LATENT_SIDE * LATENT_SIDE;
const VAE_SCALE = 0.18215;

function half(value: number) {
  const f = new Float32Array([value]);
  const bits = new Int32Array(f.buffer)[0];
  let output = (bits >> 16) & 0x8000;
  let mantissa = (bits >> 12) & 0x07ff;
  const exponent = (bits >> 23) & 0xff;
  if (exponent < 103) return output;
  if (exponent > 142) return output | 0x7c00 | ((exponent === 255 ? 0 : 1) && bits & 0x007fffff);
  if (exponent < 113) {
    mantissa |= 0x0800;
    return output | ((mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1));
  }
  output |= ((exponent - 112) << 10) | (mantissa >> 1);
  return output + (mantissa & 1);
}

function fromHalf(bits: number) {
  const fraction = bits & 0x03ff;
  const exponent = (bits & 0x7c00) >> 10;
  const sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 31) return sign * (fraction ? NaN : Infinity);
  if (exponent === 0) return sign * 2 ** -14 * fraction / 1024;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function valueAt(data: TensorData, index: number) {
  if (data instanceof Float32Array || data.constructor.name === 'Float16Array') return data[index];
  return fromHalf(data[index]);
}

function float16(values: ArrayLike<number>) {
  const output = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) output[i] = half(values[i]);
  return output;
}

function normalRandom(seed: number) {
  let state = seed >>> 0;
  let spare: number | null = null;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return () => {
    if (spare !== null) { const next = spare; spare = null; return next; }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function tinySdSchedule(steps: number) {
  const alphas = new Float64Array(1000);
  let cumulative = 1;
  const start = Math.sqrt(0.00085);
  const end = Math.sqrt(0.012);
  for (let i = 0; i < 1000; i++) {
    const beta = (start + (end - start) * i / 999) ** 2;
    cumulative *= 1 - beta;
    alphas[i] = cumulative;
  }
  const schedule = Array.from({ length: steps }, (_, index) => {
    const timestep = Math.round(999 * (steps - index) / steps);
    const alpha = Math.sqrt(alphas[timestep]);
    const sigma = Math.sqrt(1 - alphas[timestep]);
    return { timestep, alpha, sigma, lambda: Math.log(alpha) - Math.log(sigma) };
  });
  return [...schedule, { timestep: 0, alpha: 1, sigma: 0, lambda: Infinity }];
}

function decodeImage(pixels: TensorData) {
  if (pixels.length !== 3 * IMAGE_SIDE * IMAGE_SIDE) throw new Error('Tiny-SD returned an unexpected image shape.');
  const image = new ImageData(IMAGE_SIDE, IMAGE_SIDE);
  const plane = IMAGE_SIDE * IMAGE_SIDE;
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = valueAt(pixels, channel * plane + i);
      image.data[4 * i + channel] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round((value + 1) * 127.5))) : 0;
    }
    image.data[4 * i + 3] = 255;
  }
  return image;
}

async function decodeLatents(pipeline: TinyPipeline, ort: Ort, latents: Float32Array) {
  const scaled = new Float32Array(LATENT_COUNT);
  for (let i = 0; i < LATENT_COUNT; i++) scaled[i] = latents[i] / VAE_SCALE;
  const result = await pipeline.sessions.vae_decoder.run({ latent_sample: new ort.Tensor('float16', float16(scaled), [1, 4, LATENT_SIDE, LATENT_SIDE]) });
  const sample = result.sample || Object.values(result)[0];
  return decodeImage(sample.data);
}

export async function generateTinySd(pipeline: TinyPipeline, ort: Ort, prompt: string, steps: number, onProgress?: (value: { step: number; totalSteps: number }) => void, seed = Math.floor(Math.random() * 2 ** 32), guidanceScale = 7.5) {
  const positive = (await pipeline.tokenizer(prompt)).input_ids.data;
  const negative = (await pipeline.tokenizer('')).input_ids.data;
  const ids = new BigInt64Array([...positive, ...negative].map(BigInt));
  const encoded = await pipeline.sessions.text_encoder.run({ input_ids: new ort.Tensor('int64', ids, [2, 77]) });
  const hidden = encoded.last_hidden_state || Object.values(encoded)[0];
  if (hidden.data.length !== 2 * 77 * 768) throw new Error('Tiny-SD returned unexpected text embeddings.');
  const embeddings = new ort.Tensor('float16', float16(Array.from(hidden.data, (_, index) => valueAt(hidden.data, index))), [2, 77, 768]);
  const schedule = tinySdSchedule(steps);
  const random = normalRandom(seed);
  let latents = new Float32Array(LATENT_COUNT);
  for (let i = 0; i < LATENT_COUNT; i++) latents[i] = random();
  let previousX0: Float32Array | null = null;

  for (let step = 0; step < steps; step++) {
    const current = schedule[step];
    const next = schedule[step + 1];
    const sample = float16(latents);
    const batch = new Uint16Array(LATENT_COUNT * 2);
    batch.set(sample); batch.set(sample, LATENT_COUNT);
    const output = await pipeline.sessions.unet.run({
      sample: new ort.Tensor('float16', batch, [2, 4, LATENT_SIDE, LATENT_SIDE]),
      timestep: new ort.Tensor('float16', new Uint16Array([half(current.timestep)]), []),
      encoder_hidden_states: embeddings,
    });
    const noise = (output.out_sample || Object.values(output)[0]).data;
    if (noise.length !== LATENT_COUNT * 2) throw new Error('Tiny-SD returned an unexpected denoiser shape.');
    const x0 = new Float32Array(LATENT_COUNT);
    const updated = new Float32Array(LATENT_COUNT);
    const h = next.lambda - current.lambda;
    const coefficient = next.sigma / current.sigma;
    const predicted = next.alpha * (1 - Math.exp(-h));
    const previousH = step ? current.lambda - schedule[step - 1].lambda : 0;
    const correction = previousX0 && step < steps - 1 ? 0.5 * h / previousH : 0;
    for (let i = 0; i < LATENT_COUNT; i++) {
      const guidedNoise = valueAt(noise, LATENT_COUNT + i) + guidanceScale * (valueAt(noise, i) - valueAt(noise, LATENT_COUNT + i));
      x0[i] = (latents[i] - current.sigma * guidedNoise) / current.alpha;
      updated[i] = coefficient * latents[i] + predicted * (x0[i] + correction * (x0[i] - (previousX0?.[i] ?? x0[i])));
      if (!Number.isFinite(updated[i])) throw new Error(`Tiny-SD produced invalid latent values at step ${step + 1}.`);
    }
    previousX0 = x0;
    latents = updated;
    onProgress?.({ step: step + 1, totalSteps: steps });
    if (pipeline.onPreview && step < steps - 1 && (step === 0 || (step + 1) % 4 === 0)) {
      try { pipeline.onPreview({ step: step + 1, totalSteps: steps, imageData: await decodeLatents(pipeline, ort, latents) }); }
      catch (error) { pipeline.onPreview = undefined; console.warn('Live image preview unavailable; continuing generation.', error); }
    }
  }
  return { imageData: await decodeLatents(pipeline, ort, latents) };
}
