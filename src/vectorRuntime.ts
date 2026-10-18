import { assertMotionFiles } from './motionAssets.ts';
import { unloadBrowserImageModel } from './browserImage.ts';
import { unloadBrowserModel } from './browserModel.ts';
import { unloadBrowserSpeech } from './browserSpeech.ts';
import { unloadBrowserTranscription } from './browserTranscription.ts';
import { unloadLocalOllama } from './localOllama.ts';
import { unloadNeedle } from './needleRuntime.ts';
import { withLocalModelMemory } from './localModelMemory.ts';

type VectorApi = { vectorize_rgba: (rgba: Uint8Array, width: number, height: number, options: { preset: 'bw' | 'poster' | 'photo'; mode: 'polygon' | 'spline'; maxColors: number }) => string };
type VectorModule = { initialize: (bytes: Uint8Array) => Promise<VectorApi> };
const nodeLoader = /const wasmPath = `\$\{__dirname\}\/vtracer_wasm_bg\.wasm`;\s*const wasmBytes = require\('fs'\)\.readFileSync\(wasmPath\);/;

export async function vectorizeImage(folder: FileSystemDirectoryHandle, source: Blob, preset: 'bw' | 'poster' | 'photo', maxColors: number): Promise<{ svg: string; width: number; height: number }> {
  return withLocalModelMemory(async () => {
    const [engine] = await Promise.all([assertMotionFiles(folder, 'vector_engine'), assertMotionFiles(folder, 'vector')]);
    await unloadBrowserImageModel(); await unloadBrowserModel(); await unloadNeedle();
    await unloadBrowserSpeech(); await unloadBrowserTranscription(); await unloadLocalOllama();
    const glue = await engine[1].text();
    if (!nodeLoader.test(glue)) throw new Error('The saved VTracer adapter does not match this pinned engine version.');
    const adapted = `export async function initialize(bytes) { const exports = {};\n${glue.replace(nodeLoader, 'const wasmBytes = bytes;').replace('const wasmModule = new WebAssembly.Module(wasmBytes);', 'const wasmModule = await WebAssembly.compile(wasmBytes);')}\nreturn exports; }`;
    const scriptUrl = URL.createObjectURL(new Blob([adapted], { type: 'text/javascript' }));
    const bitmap = await createImageBitmap(source);
    try {
      const width = Math.max(1, Math.round(bitmap.width * Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))));
      const height = Math.max(1, Math.round(bitmap.height * Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(bitmap, 0, 0, width, height);
      const rgba = context.getImageData(0, 0, width, height).data;
      const module = await import(/* @vite-ignore */ scriptUrl) as VectorModule;
      const api = await module.initialize(new Uint8Array(await engine[2].arrayBuffer()));
      const svg = api.vectorize_rgba(new Uint8Array(rgba), width, height, { preset, mode: 'spline', maxColors });
      if (!svg.includes('<svg') || svg.length > 20_000_000) throw new Error('VTracer returned an invalid or oversized SVG.');
      return { svg, width, height };
    } finally { bitmap.close(); URL.revokeObjectURL(scriptUrl); }
  });
}
