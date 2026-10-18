import { gaussian, imageFromPlanes, type ImageOrt, type ImageSession } from './imagePipelineUtils';

const LATENTS = 4 * 64 * 64;
const TIMESTEPS = [999, 759, 499, 259];
const alphas = (() => {
  const values = new Float32Array(1000);
  let product = 1;
  for (let i = 0; i < values.length; i++) {
    const beta = (Math.sqrt(0.00085) + i / 999 * (Math.sqrt(0.012) - Math.sqrt(0.00085))) ** 2;
    product *= 1 - beta;
    values[i] = product;
  }
  return values;
})();

export function createLcmPipeline(ort: ImageOrt, files: readonly File[], tokenizer: (text: string) => Promise<{ input_ids: { data: Int32Array } }>, keepUrl: (url: string) => void) {
  const sessions: ImageSession[] = [];
  return {
    onPreview: undefined as undefined | ((value: { step: number; totalSteps: number; imageData: ImageData }) => void),
    async loadModels(progress?: (value: { stage: string; model: string; index: number; total: number }) => void) {
      const names = ['text encoder', 'UNet', 'VAE decoder'];
      for (let index = 0; index < files.length; index++) {
        progress?.({ stage: 'loading', model: names[index], index, total: files.length });
        const url = URL.createObjectURL(files[index]); keepUrl(url);
        sessions.push(await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], logSeverityLevel: 3 }));
      }
    },
    async generate(prompt: string, options: { seed?: number; steps?: number; onProgress?: (value: { step: number; totalSteps: number }) => void } = {}) {
      if (options.steps !== undefined && options.steps !== 4) throw new Error('DreamShaper LCM uses four steps.');
      if (sessions.length !== 3) throw new Error('DreamShaper LCM is not loaded.');
      const ids = (await tokenizer(prompt)).input_ids.data;
      const encoded = await sessions[0].run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, 77]) });
      const hidden = encoded.last_hidden_state || Object.values(encoded)[0];
      if (hidden.data.length !== 77 * 768) throw new Error('DreamShaper LCM returned unexpected text embeddings.');
      const context = new ort.Tensor('float32', Float32Array.from(hidden.data), [1, 77, 768]);
      const random = gaussian(options.seed ?? Math.floor(Math.random() * 2 ** 32));
      let sample = Float32Array.from({ length: LATENTS }, () => random());
      for (let step = 0; step < TIMESTEPS.length; step++) {
        const time = TIMESTEPS[step];
        const result = await sessions[1].run({ sample: new ort.Tensor('float32', sample, [1, 4, 64, 64]), timestep: new ort.Tensor('float32', new Float32Array([time]), [1]), encoder_hidden_states: context });
        const noise = (result.out_sample || Object.values(result)[0]).data;
        if (noise.length !== LATENTS) throw new Error('DreamShaper LCM returned an unexpected denoiser shape.');
        const alpha = alphas[time];
        const scaledTime = time * 10;
        const skip = 0.25 / (scaledTime * scaledTime + 0.25);
        const out = scaledTime / Math.sqrt(scaledTime * scaledTime + 0.25);
        const next = new Float32Array(LATENTS);
        const nextAlpha = step < TIMESTEPS.length - 1 ? alphas[TIMESTEPS[step + 1]] : 1;
        for (let i = 0; i < LATENTS; i++) {
          const x0 = (sample[i] - Math.sqrt(1 - alpha) * noise[i]) / Math.sqrt(alpha);
          const denoised = out * x0 + skip * sample[i];
          next[i] = step < TIMESTEPS.length - 1 ? Math.sqrt(nextAlpha) * denoised + Math.sqrt(1 - nextAlpha) * random() : denoised;
          if (!Number.isFinite(next[i])) throw new Error('DreamShaper LCM produced invalid latents.');
        }
        sample = next;
        options.onProgress?.({ step: step + 1, totalSteps: 4 });
        if (this.onPreview && step < TIMESTEPS.length - 1) {
          try {
            const preview = await sessions[2].run({ latent: new ort.Tensor('float32', sample, [1, 4, 64, 64]) });
            this.onPreview({ step: step + 1, totalSteps: 4, imageData: imageFromPlanes((preview.image || Object.values(preview)[0]).data, 512) });
          } catch (error) { console.warn('DreamShaper preview unavailable; continuing generation.', error); this.onPreview = undefined; }
        }
      }
      const decoded = await sessions[2].run({ latent: new ort.Tensor('float32', sample, [1, 4, 64, 64]) });
      return { imageData: imageFromPlanes((decoded.image || Object.values(decoded)[0]).data, 512) };
    },
    async release() { await Promise.all(sessions.map(session => session.release())); sessions.length = 0; },
  };
}
