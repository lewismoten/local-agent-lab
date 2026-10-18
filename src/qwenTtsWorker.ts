// App-owned adapter. The bridge and GGUF files are supplied from the workspace.
export {};
type Bridge = {
  loadModelFromUrl: (url: string, options: Record<string, unknown>) => Promise<unknown>;
  loadMultimodalProjector: (url: string) => Promise<unknown>;
  getTextToSpeechCapabilities: () => Promise<{ supported: boolean; reason?: string; supportsSpeakerReference?: boolean }>;
  synthesizeSpeech: (options: Record<string, unknown>) => Promise<{ pcm: Float32Array; sampleRate: number; framesGenerated: number; truncated: boolean }>;
  dispose: () => Promise<void>;
};
type Init = { type: 'init'; bridgeUrl: string; coreUrl: string; wasmUrl: string; modelUrl: string; projectorUrl: string };
type Generate = { type: 'generate'; requestId: number; text: string; language: string; speakerAudio?: Uint8Array; maxFrames: number };
let bridge: Bridge | null = null;
const send = (value: unknown, transfer?: Transferable[]) => self.postMessage(value, { transfer: transfer || [] });

function passages(text: string) {
  const sentences = text.trim().split(/(?<=[.!?])\s+/u);
  const parts: string[] = [];
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length <= 130) { parts.push(sentence); continue; }
    const words = sentence.split(/\s+/u);
    let part = '';
    for (const word of words) {
      if (part && `${part} ${word}`.length > 130) { parts.push(part); part = word; }
      else part = part ? `${part} ${word}` : word;
    }
    if (part) parts.push(part);
  }
  return parts;
}

self.onmessage = async (event: MessageEvent<Init | Generate>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      if (!crossOriginIsolated) throw new Error('Qwen3-TTS needs a cross-origin-isolated browser page for its memory64 runtime.');
      const module = await import(/* @vite-ignore */ message.bridgeUrl) as { LlamaWebGpuBridge: new (options: Record<string, unknown>) => Bridge };
      bridge = new module.LlamaWebGpuBridge({ coreModuleUrl: message.coreUrl, wasmUrl: message.wasmUrl, coreModuleUrlMem64: message.coreUrl, wasmUrlMem64: message.wasmUrl, preferMemory64: true, disableWorker: true, threads: 1, nGpuLayers: 'gpu' in navigator ? 99 : 0 });
      send({ type: 'progress', message: 'Loading Qwen3-TTS…' });
      await bridge.loadModelFromUrl(message.modelUrl, { useCache: false, nCtx: 2048, nGpuLayers: 'gpu' in navigator ? 99 : 0, progressCallback: (value: { loaded?: number; total?: number }) => { if (value.total) send({ type: 'progress', message: `Loading model ${Math.round((value.loaded || 0) / value.total * 100)}%…` }); } });
      send({ type: 'progress', message: 'Loading audio projector…' });
      await bridge.loadMultimodalProjector(message.projectorUrl);
      const capabilities = await bridge.getTextToSpeechCapabilities();
      if (!capabilities.supported) throw new Error(capabilities.reason || 'This browser bridge cannot synthesize speech with Qwen3-TTS.');
      send({ type: 'ready', speakerReference: !!capabilities.supportsSpeakerReference });
      return;
    }
    if (!bridge) throw new Error('Load Qwen3-TTS before generating speech.');
    const segments = passages(message.text);
    if (!segments.length) throw new Error('Enter text for Qwen3-TTS to speak.');
    for (const [index, segment] of segments.entries()) {
      const part = index + 1;
      const parts = segments.length;
      send({ type: 'progress', requestId: message.requestId, part, parts, framesGenerated: 0, message: `Passage ${part}/${parts} · starting…` });
      const output = await bridge.synthesizeSpeech({ text: segment, language: message.language, speakerAudio: message.speakerAudio, maxFrames: message.maxFrames, onProgress: (value: { framesGenerated?: number }) => send({ type: 'progress', requestId: message.requestId, part, parts, framesGenerated: value.framesGenerated || 0, message: `Passage ${part}/${parts} · ${value.framesGenerated || 0} audio frames` }) });
      if (!output.pcm?.length) throw new Error(`Qwen3-TTS returned no audio for passage ${part}.`);
      if (output.truncated) throw new Error(`Qwen3-TTS stopped early in passage ${part}. Try shorter text.`);
      send({ type: 'chunk', requestId: message.requestId, data: output.pcm, sampleRate: output.sampleRate }, [output.pcm.buffer]);
    }
    send({ type: 'done', requestId: message.requestId });
  } catch (error) { send({ type: 'error', requestId: message.type === 'generate' ? message.requestId : null, message: error instanceof Error ? error.message : String(error) }); }
};
