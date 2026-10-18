/** One-step SDXS DreamShaper sampling contract from the pinned ONNX export. */
type Tensor = { data: ArrayLike<number>; dims: readonly number[] };
type Session = { run: (feeds: Record<string, Tensor>) => Promise<Record<string, Tensor>>; release: () => Promise<void> };
export type SdxsOrt = {
  InferenceSession: { create: (url: string, options: { executionProviders: string[]; logSeverityLevel?: 0 | 1 | 2 | 3 | 4 }) => Promise<Session> };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => Tensor;
};

const SIDE = 64;
const PIXELS = 512;
const LATENTS = 4 * SIDE * SIDE;
const SIGMA = 14.614646911621094;

function gaussian(seed: number) {
  let state = seed >>> 0;
  let spare: number | null = null;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function createSdxsPipeline(ort: SdxsOrt, files: readonly File[], tokenizer: (text: string) => Promise<{ input_ids: { data: Int32Array } }>, keepUrl: (url: string) => void) {
  let textEncoder: Session | null = null;
  let unet: Session | null = null;
  let vaeDecoder: Session | null = null;
  const sessions = () => {
    if (!textEncoder || !unet || !vaeDecoder) throw new Error('The SDXS model is not loaded.');
    return { textEncoder, unet, vaeDecoder };
  };
  return {
    async loadModels(progress?: (value: { stage: string; model: string; index: number; total: number }) => void) {
      const names = ['text encoder', 'UNet', 'VAE decoder'];
      for (let index = 0; index < files.length; index++) {
        progress?.({ stage: 'loading', model: names[index], index, total: files.length });
        const url = URL.createObjectURL(files[index]); keepUrl(url);
        const session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], logSeverityLevel: 3 });
        if (index === 0) textEncoder = session;
        else if (index === 1) unet = session;
        else vaeDecoder = session;
      }
    },
    async generate(prompt: string, options: { seed?: number; steps?: number; onProgress?: (value: { step: number; totalSteps: number }) => void } = {}) {
      if (options.steps !== undefined && options.steps !== 1) throw new Error('SDXS supports one generation step.');
      const { textEncoder, unet, vaeDecoder } = sessions();
      const ids = (await tokenizer(prompt)).input_ids.data;
      const encoded = await textEncoder.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, 77]) });
      const hidden = encoded.last_hidden_state || Object.values(encoded)[0];
      if (hidden.data.length !== 77 * 768) throw new Error('SDXS returned unexpected text embeddings.');
      const random = gaussian(options.seed ?? Math.floor(Math.random() * 2 ** 32));
      const latents = new Float32Array(LATENTS);
      const scaled = new Float32Array(LATENTS);
      for (let index = 0; index < LATENTS; index++) {
        latents[index] = random() * SIGMA;
        scaled[index] = latents[index] / Math.sqrt(SIGMA * SIGMA + 1);
      }
      const denoised = await unet.run({
        sample: new ort.Tensor('float32', scaled, [1, 4, SIDE, SIDE]),
        timestep: new ort.Tensor('float32', new Float32Array([999]), [1]),
        encoder_hidden_states: new ort.Tensor('float32', Float32Array.from(hidden.data), [1, 77, 768]),
      });
      const noise = (denoised.out_sample || Object.values(denoised)[0]).data;
      if (noise.length !== LATENTS) throw new Error('SDXS returned an unexpected denoiser shape.');
      const x0 = new Float32Array(LATENTS);
      for (let index = 0; index < LATENTS; index++) {
        x0[index] = latents[index] - SIGMA * noise[index];
        if (!Number.isFinite(x0[index])) throw new Error('SDXS produced invalid latent values.');
      }
      options.onProgress?.({ step: 1, totalSteps: 1 });
      const decoded = await vaeDecoder.run({ latent: new ort.Tensor('float32', x0, [1, 4, SIDE, SIDE]) });
      const pixels = (decoded.image || Object.values(decoded)[0]).data;
      if (pixels.length !== 3 * PIXELS * PIXELS) throw new Error('SDXS returned an unexpected image shape.');
      const imageData = new ImageData(PIXELS, PIXELS);
      const plane = PIXELS * PIXELS;
      for (let index = 0; index < plane; index++) {
        for (let channel = 0; channel < 3; channel++) {
          const value = pixels[channel * plane + index];
          imageData.data[4 * index + channel] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round((value + 1) * 127.5))) : 0;
        }
        imageData.data[4 * index + 3] = 255;
      }
      return { imageData };
    },
    async release() {
      await Promise.all([textEncoder?.release(), unet?.release(), vaeDecoder?.release()]);
      textEncoder = null; unet = null; vaeDecoder = null;
    },
  };
}
