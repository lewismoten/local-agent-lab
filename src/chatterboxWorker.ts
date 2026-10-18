// App-owned adapter. Third-party runtime and model files come from the connected workspace.
export {};
type RawAudio = { data: Float32Array };
type Tensor = new (type: string, data: Float32Array, dims: number[]) => unknown;
type ChatterboxRuntime = {
  env: { backends: { onnx: { wasm: { wasmPaths: { wasm: string }; numThreads: number } } } };
  Tensor: Tensor;
  AutoProcessor: { from_pretrained: (id: string) => Promise<{ _call: (text: string) => Promise<Record<string, unknown>> }> };
  ChatterboxModel: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<{ encode_speech: (audio: unknown) => Promise<Record<string, unknown>>; generate: (options: Record<string, unknown>) => Promise<RawAudio>; dispose?: () => Promise<void> }> };
};
type InitMessage = { type: 'init'; runtimeUrl: string; ortUrl: string; wasmUrl: string; files: Record<string, string>; modelId: string };
type GenerateMessage = { type: 'generate'; requestId: number; text: string; audio: Float32Array; exaggeration?: number };
let model: Awaited<ReturnType<ChatterboxRuntime['ChatterboxModel']['from_pretrained']>> | null = null;
let processor: Awaited<ReturnType<ChatterboxRuntime['AutoProcessor']['from_pretrained']>> | null = null;
let runtime: ChatterboxRuntime | null = null;
let modelPrefix = '';
const originalFetch = self.fetch.bind(self);
const reply = (value: unknown, transfer?: Transferable[]) => self.postMessage(value, { transfer: transfer || [] });

function speechSegments(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const result: string[] = [];
  for (const sentence of sentences) {
    let remaining = sentence.trim();
    while (remaining.length > 180) {
      const cut = remaining.lastIndexOf(' ', 180);
      const size = cut > 70 ? cut : 180;
      result.push(remaining.slice(0, size).trim());
      remaining = remaining.slice(size).trim();
    }
    if (remaining) result.push(remaining);
  }
  return result;
}

self.onmessage = async (event: MessageEvent<InitMessage | GenerateMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      modelPrefix = `https://huggingface.co/${message.modelId}/`;
      self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(modelPrefix)) {
          const path = url.split('/resolve/')[1]?.split('/').slice(1).join('/').split('?')[0] || '';
          const local = message.files[path];
          return local ? originalFetch(local, init) : Promise.resolve(new Response('Missing workspace model file', { status: 404 }));
        }
        return originalFetch(input, init);
      }) as typeof self.fetch;
      const ortSource = await (await originalFetch(message.ortUrl)).text();
      const ortBlob = URL.createObjectURL(new Blob([ortSource], { type: 'text/javascript' }));
      const source = await (await originalFetch(message.runtimeUrl)).text();
      const rewritten = source.replace('from "onnxruntime-web/webgpu"', `from "${ortBlob}"`).replace('from "onnxruntime-common"', `from "${ortBlob}"`);
      if (rewritten === source || rewritten.includes('from "onnxruntime-web/webgpu"') || rewritten.includes('from "onnxruntime-common"')) throw new Error('The saved Chatterbox engine changed and cannot be adapted safely.');
      runtime = await import(/* @vite-ignore */ URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }))) as ChatterboxRuntime;
      // The bundle contains the JS loader for this asyncify WASM binary.
      runtime.env.backends.onnx.wasm.wasmPaths = { wasm: message.wasmUrl };
      runtime.env.backends.onnx.wasm.numThreads = 1;
      const id = message.modelId;
      processor = await runtime.AutoProcessor.from_pretrained(id);
      // This export has an int64 Cast that ONNX WebGPU cannot execute.
      const device = 'wasm';
      const dtype = id.startsWith('onnx-community/') ? { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4f16', conditional_decoder: 'fp32' } : { embed_tokens: 'q4f16', speech_encoder: 'q4f16', language_model: 'q4f16', conditional_decoder: 'q4f16' };
      const options = { dtype, progress_callback: (value: { file?: string; status?: string }) => { if (value.file || value.status) reply({ type: 'progress', message: value.file || value.status }); } };
      model = await runtime.ChatterboxModel.from_pretrained(id, { ...options, device });
      reply({ type: 'ready', device });
      return;
    }
    if (!runtime || !model || !processor) throw new Error('Load Chatterbox before generating speech.');
    reply({ type: 'progress', requestId: message.requestId, message: 'Encoding reference voice…' });
    const reference = new runtime.Tensor('float32', message.audio, [1, message.audio.length]);
    const speaker = await model.encode_speech(reference);
    const segments = speechSegments(message.text);
    let count = 0;
    for (const [index, segment] of segments.entries()) {
      reply({ type: 'progress', requestId: message.requestId, message: `Generating passage ${index + 1}/${segments.length}…` });
      const input = await processor._call(segment);
      const tokenLimit = Math.min(256, Math.max(48, segment.split(/\s+/u).length * 8 + 24));
      const waveform = await model.generate({ ...input, ...speaker, ...(message.exaggeration === undefined ? {} : { exaggeration: message.exaggeration }), max_new_tokens: tokenLimit });
      const data = waveform.data;
      if (!(data instanceof Float32Array) || !data.length) continue;
      reply({ type: 'chunk', requestId: message.requestId, data, sampleRate: 24000 }, [data.buffer]);
      count++;
    }
    if (!count) throw new Error('Chatterbox returned no audio samples.');
    reply({ type: 'done', requestId: message.requestId });
  } catch (error) { reply({ type: 'error', requestId: message.type === 'generate' ? message.requestId : null, message: error instanceof Error ? error.message : String(error) }); }
};
