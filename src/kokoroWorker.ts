// App-owned adapter. The Kokoro runtime and weights are loaded from the connected workspace.
type InitMessage = { type: 'init'; engineUrl: string; wasmMjsUrl: string; wasmUrl: string; files: Record<string, string> };
type GenerateMessage = { type: 'generate'; text: string; voice: string; requestId: number };
type RawAudio = { data?: Float32Array; audio?: Float32Array; sampling_rate: number };
type Runtime = { env: { wasmPaths: { mjs: string; wasm: string } }; TextSplitterStream: new () => { push: (...parts: string[]) => void; close: () => void }; KokoroTTS: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<{ stream: (text: InstanceType<Runtime['TextSplitterStream']>, options: { voice: string }) => AsyncGenerator<{ audio: RawAudio }>; model?: { dispose?: () => Promise<void> } }> } };
let tts: Awaited<ReturnType<Runtime['KokoroTTS']['from_pretrained']>> | null = null;
let splitterClass: Runtime['TextSplitterStream'] | null = null;
const remotePrefix = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/';
const originalFetch = self.fetch.bind(self);
const reply = (value: unknown, transfer?: Transferable[]) => self.postMessage(value, { transfer: transfer || [] });
self.onmessage = async (event: MessageEvent<InitMessage | GenerateMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const files = message.files;
      self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(remotePrefix)) {
          const path = url.split('/resolve/')[1]?.split('/').slice(1).join('/').split('?')[0] || '';
          const local = files[path];
          return local ? originalFetch(local, init) : Promise.resolve(new Response('Not found', { status: 404 }));
        }
        return originalFetch(input, init);
      }) as typeof self.fetch;
      const runtime = await import(/* @vite-ignore */ message.engineUrl) as Runtime;
      splitterClass = runtime.TextSplitterStream;
      runtime.env.wasmPaths = { mjs: message.wasmMjsUrl, wasm: message.wasmUrl };
      tts = await runtime.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm', progress_callback: (value: { status?: string; file?: string }) => reply({ type: 'progress', message: value.file || value.status || 'Loading Kokoro…' }) });
      reply({ type: 'ready' });
    } else {
      if (!tts) throw new Error('Load Kokoro before generating speech.');
      if (!splitterClass) throw new Error('Kokoro text splitter is unavailable.');
      const splitter = new splitterClass();
      for (const token of message.text.match(/\s*\S+/g) || []) splitter.push(token);
      splitter.close();
      let count = 0;
      for await (const { audio } of tts.stream(splitter, { voice: message.voice })) {
        const data = audio.data || audio.audio;
        if (!(data instanceof Float32Array) || !data.length) continue;
        reply({ type: 'chunk', requestId: message.requestId, data, sampleRate: audio.sampling_rate }, [data.buffer]);
        count++;
      }
      if (!count) throw new Error('Kokoro returned no audio samples.');
      reply({ type: 'done', requestId: message.requestId });
    }
  } catch (error) { reply({ type: 'error', requestId: message.type === 'generate' ? message.requestId : null, message: error instanceof Error ? error.message : String(error) }); }
};
