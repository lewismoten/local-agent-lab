// App-owned ONNX adapter. Runtime and weights are loaded from the connected workspace.
export {};
type Tensor = { data: Float32Array; dims: readonly number[] };
type Ort = { env: { logLevel: 'error' | 'warning'; wasm: { wasmPaths: { mjs: string; wasm: string }; numThreads: number } }; Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown; InferenceSession: { create: (bytes: ArrayBuffer, options: Record<string, unknown>) => Promise<{ run: (feeds: Record<string, unknown>) => Promise<Record<string, Tensor>> }> } };
type Init = { type: 'init'; ortUrl: string; wasmMjsUrl: string; wasmUrl: string; encoderUrl: string; converterUrl: string };
type Convert = { type: 'convert'; requestId: number; batchId: number; source: Float32Array; reference?: Float32Array };
let ort: Ort | null = null;
let encoder: Awaited<ReturnType<Ort['InferenceSession']['create']>> | null = null;
let converter: Awaited<ReturnType<Ort['InferenceSession']['create']>> | null = null;
let referenceBatch: number | null = null;
let referenceEmbedding: Float32Array | null = null;
const reply = (value: unknown, transfer?: Transferable[]) => self.postMessage(value, { transfer: transfer || [] });
const N = 1024, HOP = 256, PAD = 384;
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
function fft(real: Float32Array, imag: Float32Array) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = real[b] * cr - imag[b] * ci, ti = real[b] * ci + imag[b] * cr;
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function reflect(index: number, length: number) {
  while (index < 0 || index >= length) index = index < 0 ? -index : 2 * length - index - 2;
  return index;
}
function spectrogram(audio: Float32Array) {
  if (audio.length < 2) throw new Error('Audio needs at least two samples.');
  const frames = Math.floor((audio.length + PAD * 2 - N) / HOP) + 1;
  if (frames < 1) throw new Error('Audio is too short for OpenVoice.');
  const channels = N / 2 + 1;
  const byChannel = new Float32Array(channels * frames);
  const byFrame = new Float32Array(channels * frames);
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let t = 0; t < frames; t++) {
    const offset = t * HOP - PAD;
    for (let i = 0; i < N; i++) { real[i] = audio[reflect(offset + i, audio.length)] * hann[i]; imag[i] = 0; }
    fft(real, imag);
    for (let c = 0; c < channels; c++) {
      const magnitude = Math.sqrt(real[c] * real[c] + imag[c] * imag[c] + 1e-6);
      byChannel[c * frames + t] = magnitude;
      byFrame[t * channels + c] = magnitude;
    }
  }
  return { frames, byChannel, byFrame };
}
async function embedding(spec: ReturnType<typeof spectrogram>) {
  const output = await encoder!.run({ spec: new ort!.Tensor('float32', spec.byFrame, [1, spec.frames, 513]) });
  const data = output.tone_embedding?.data;
  if (!(data instanceof Float32Array) || data.length !== 256) throw new Error('OpenVoice returned an invalid voice embedding.');
  return data;
}
self.onmessage = async (event: MessageEvent<Init | Convert>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      ort = await import(/* @vite-ignore */ message.ortUrl) as Ort;
      ort.env.logLevel = 'error';
      ort.env.wasm.wasmPaths = { mjs: message.wasmMjsUrl, wasm: message.wasmUrl };
      ort.env.wasm.numThreads = 1;
      reply({ type: 'progress', message: 'Loading OpenVoice encoder…' });
      encoder = await ort.InferenceSession.create(await (await fetch(message.encoderUrl)).arrayBuffer(), { executionProviders: ['wasm'] });
      reply({ type: 'progress', message: 'Loading OpenVoice converter…' });
      converter = await ort.InferenceSession.create(await (await fetch(message.converterUrl)).arrayBuffer(), { executionProviders: ['wasm'] });
      reply({ type: 'ready' });
      return;
    }
    if (!ort || !encoder || !converter) throw new Error('Load OpenVoice before converting audio.');
    reply({ type: 'progress', requestId: message.requestId, message: 'Analyzing voices…' });
    const source = spectrogram(message.source);
    if (referenceBatch !== message.batchId) {
      if (!message.reference) throw new Error('The reference voice is missing from this conversion.');
      referenceEmbedding = await embedding(spectrogram(message.reference));
      referenceBatch = message.batchId;
    }
    const src = await embedding(source), tgt = referenceEmbedding!;
    reply({ type: 'progress', requestId: message.requestId, message: 'Converting voice…' });
    const output = await converter.run({
      spec: new ort.Tensor('float32', source.byChannel, [1, 513, source.frames]),
      spec_lengths: new ort.Tensor('int64', new BigInt64Array([BigInt(source.frames)]), [1]),
      src_g: new ort.Tensor('float32', src, [1, 256, 1]),
      tgt_g: new ort.Tensor('float32', tgt, [1, 256, 1]),
    });
    const audio = output.audio?.data;
    if (!(audio instanceof Float32Array) || !audio.length) throw new Error('OpenVoice returned no audio.');
    reply({ type: 'done', requestId: message.requestId, data: audio }, [audio.buffer]);
  } catch (error) { reply({ type: 'error', requestId: message.type === 'convert' ? message.requestId : null, message: error instanceof Error ? error.message : String(error) }); }
};
