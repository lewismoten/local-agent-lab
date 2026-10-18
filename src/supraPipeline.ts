import { fromFloat16, gaussian, imageFromPlanes, type ImageOrt, type ImageSession } from './imagePipelineUtils';

type Vocab = { model: { vocab: [string, number][] } };
const CONTEXT = 128;
const LATENTS = 4 * 32 * 32;

/** SentencePiece Unigram path for the English prompts supported by this export. */
export function supraTokenizer(json: Vocab) {
  const words = new Map<string, { id: number; score: number }[]>();
  json.model.vocab.forEach(([piece, score], id) => {
    if (piece.startsWith('<') && piece.endsWith('>')) return;
    const first = piece[0];
    const list = words.get(first) || [];
    list.push({ id, score });
    words.set(first, list);
  });
  // Index pieces by ID separately so the DP only compares pieces sharing a first character.
  const pieces = json.model.vocab.map(([piece]) => piece);
  return (prompt: string) => {
    const normalized = prompt.normalize('NFKC').trim().replace(/\s+/g, '▁');
    const value = normalized ? `▁${normalized}` : '';
    const best = new Float64Array(value.length + 1).fill(-Infinity);
    const prev = new Int32Array(value.length + 1).fill(-1);
    const token = new Int32Array(value.length + 1).fill(2);
    best[0] = 0;
    for (let i = 0; i < value.length; i++) {
      if (!Number.isFinite(best[i])) continue;
      for (const candidate of words.get(value[i]) || []) {
        const piece = pieces[candidate.id];
        if (!value.startsWith(piece, i)) continue;
        const end = i + piece.length;
        const score = best[i] + candidate.score;
        if (score > best[end]) { best[end] = score; prev[end] = i; token[end] = candidate.id; }
      }
      if (!Number.isFinite(best[i + 1])) { best[i + 1] = best[i] - 100; prev[i + 1] = i; token[i + 1] = 2; }
    }
    const ids: number[] = [];
    for (let at = value.length; at > 0 && prev[at] >= 0; at = prev[at]) ids.push(token[at]);
    ids.reverse(); ids.splice(CONTEXT - 1); ids.push(1);
    const mask = new Float32Array(CONTEXT);
    const padded = new BigInt64Array(CONTEXT);
    ids.forEach((id, i) => { padded[i] = BigInt(id); mask[i] = 1; });
    return { ids: padded, mask };
  };
}

function floats(data: ArrayLike<number>) {
  return data instanceof Uint16Array ? Float32Array.from(data, fromFloat16) : Float32Array.from(data);
}

export function createSupraPipeline(ort: ImageOrt, files: readonly File[], tokenize: ReturnType<typeof supraTokenizer>, keepUrl: (url: string) => void) {
  const sessions: ImageSession[] = [];
  return {
    guidanceScale: 3,
    onPreview: undefined as undefined | ((value: { step: number; totalSteps: number; imageData: ImageData }) => void),
    async loadModels(progress?: (value: { stage: string; model: string; index: number; total: number }) => void) {
      const names = ['text encoder', 'transformer', 'VAE decoder'];
      for (let index = 0; index < files.length; index++) {
        progress?.({ stage: 'loading', model: names[index], index, total: files.length });
        const url = URL.createObjectURL(files[index]); keepUrl(url);
        sessions.push(await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], logSeverityLevel: 3 }));
      }
    },
    async generate(prompt: string, options: { seed?: number; steps?: number; onProgress?: (value: { step: number; totalSteps: number }) => void } = {}) {
      if (sessions.length !== 3) throw new Error('Supra2-IMG Mobile is not loaded.');
      const steps = options.steps ?? 20;
      const encode = async (text: string) => {
        const { ids, mask } = tokenize(text);
        const result = await sessions[0].run({ input_ids: new ort.Tensor('int64', ids, [1, CONTEXT]), attention_mask: new ort.Tensor('int64', BigInt64Array.from(mask, BigInt), [1, CONTEXT]) });
        const values = floats(Object.values(result)[0].data);
        if (values.length !== CONTEXT * 768 || values.some(value => !Number.isFinite(value))) throw new Error('Supra2 returned invalid text embeddings.');
        return { values, mask };
      };
      const cond = await encode(prompt);
      const uncond = await encode('');
      const random = gaussian(options.seed ?? Math.floor(Math.random() * 2 ** 32));
      let latents = Float32Array.from({ length: LATENTS }, () => random());
      for (let step = 0; step < steps; step++) {
        const velocity = [] as Float32Array[];
        for (const context of [cond, uncond]) {
          const result = await sessions[1].run({
            z: new ort.Tensor('float32', latents, [1, 4, 32, 32]),
            t: new ort.Tensor('float32', new Float32Array([step / steps]), [1]),
            ctx: new ort.Tensor('float32', context.values, [1, CONTEXT, 768]),
            ctx_mask: new ort.Tensor('float32', context.mask, [1, CONTEXT]),
          });
          velocity.push(floats(Object.values(result)[0].data));
        }
        if (velocity.some(item => item.length !== LATENTS)) throw new Error('Supra2 returned an unexpected transformer shape.');
        const next = new Float32Array(LATENTS);
        for (let i = 0; i < LATENTS; i++) {
          next[i] = latents[i] + (velocity[1][i] + this.guidanceScale * (velocity[0][i] - velocity[1][i])) / steps;
          if (!Number.isFinite(next[i])) throw new Error('Supra2 produced invalid latents.');
        }
        latents = next;
        options.onProgress?.({ step: step + 1, totalSteps: steps });
        if (this.onPreview && step < steps - 1 && (step === 0 || (step + 1) % 4 === 0)) {
          try {
            const previewLatents = Float32Array.from(latents, value => value / 0.18215);
            const preview = await sessions[2].run({ z: new ort.Tensor('float32', previewLatents, [1, 4, 32, 32]) });
            this.onPreview({ step: step + 1, totalSteps: steps, imageData: imageFromPlanes(Object.values(preview)[0].data, 256) });
          } catch (error) { console.warn('Supra2 preview unavailable; continuing generation.', error); this.onPreview = undefined; }
        }
      }
      const scaled = Float32Array.from(latents, value => value / 0.18215);
      const decoded = await sessions[2].run({ z: new ort.Tensor('float32', scaled, [1, 4, 32, 32]) });
      return { imageData: imageFromPlanes(Object.values(decoded)[0].data, 256) };
    },
    async release() { await Promise.all(sessions.map(session => session.release())); sessions.length = 0; },
  };
}
