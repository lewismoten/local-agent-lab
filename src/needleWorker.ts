export {};
type NeedleRequest = { id: number; kind: 'load'; scriptUrl: string; wasm: ArrayBuffer; version: 'needle' | 'needle2' | 'needle3'; weights: ArrayBuffer; vocab?: string } | { id: number; kind: 'run'; query: string; tools: string } | { id: number; kind: 'unload' };
type NeedleHandle = { run(query: string, tools: string): string; free(): void };
let model: NeedleHandle | null = null;
self.onmessage = async (event: MessageEvent<NeedleRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'unload') { model?.free(); model = null; self.postMessage({ id: request.id, result: null }); return; }
    if (request.kind === 'load') {
      model?.free(); model = null;
      const runtime = await import(/* @vite-ignore */ request.scriptUrl) as {
        default: (options: { module_or_path: Uint8Array }) => Promise<unknown>;
        NeedleWasm: { load(bytes: Uint8Array, vocab: string): NeedleHandle | undefined };
        NeedleV2Wasm: { load(bytes: Uint8Array): NeedleHandle | undefined };
        NeedleV3Wasm: { load(bytes: Uint8Array): NeedleHandle | undefined };
      };
      await runtime.default({ module_or_path: new Uint8Array(request.wasm) });
      model = request.version === 'needle'
        ? runtime.NeedleWasm.load(new Uint8Array(request.weights), request.vocab || '') || null
        : request.version === 'needle2'
          ? runtime.NeedleV2Wasm.load(new Uint8Array(request.weights)) || null
          : runtime.NeedleV3Wasm.load(new Uint8Array(request.weights)) || null;
      if (!model) throw new Error('The Needle browser engine could not load these weights.');
      self.postMessage({ id: request.id, result: 'ready' });
      return;
    }
    if (!model) throw new Error('Load Needle first.');
    self.postMessage({ id: request.id, result: model.run(request.query, request.tools) });
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
};
