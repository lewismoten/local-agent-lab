import type { BrowserImageModelGroup } from './browserImageAssets.ts';
import type { MotionModel } from './motionAssets.ts';

export type BrowserHardware = {
  webgpu: 'available' | 'unavailable' | 'unknown';
  shaderF16: boolean | null;
  wasm: boolean;
  fileSystem: { directoryPicker: boolean; browserStorage: boolean };
  memoryGiBEstimate: number | null;
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number } | null;
};

type Adapter = {
  features?: { has(feature: string): boolean };
  limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
};

export async function probeBrowserHardware(): Promise<BrowserHardware> {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const result: BrowserHardware = {
    webgpu: 'unavailable', shaderF16: null,
    wasm: typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    fileSystem: {
      directoryPicker: typeof window.showDirectoryPicker === 'function',
      browserStorage: typeof navigator.storage?.getDirectory === 'function',
    },
    memoryGiBEstimate: typeof memory === 'number' && Number.isFinite(memory) && memory > 0 ? memory : null,
    limits: null,
  };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  if (!gpu) return result;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return result;
    result.webgpu = 'available';
    result.shaderF16 = adapter.features?.has('shader-f16') ?? null;
    if (typeof adapter.limits?.maxBufferSize === 'number' && typeof adapter.limits?.maxStorageBufferBindingSize === 'number') {
      result.limits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
    }
  } catch { result.webgpu = 'unknown'; }
  return result;
}

export function visualHardwareWarnings(kind: 'image' | 'motion', id: BrowserImageModelGroup | MotionModel, packageBytes: number, hardware: BrowserHardware | null): string[] {
  if (!hardware) return [];
  const warnings: string[] = [];
  if (!hardware.wasm) warnings.push('WebAssembly is unavailable in this browser. The visual engine cannot run here.');
  if (kind === 'image' || id === 'tripo') {
    if (hardware.webgpu === 'unavailable') warnings.push('No WebGPU adapter is available. This model needs WebGPU.');
    else if (kind === 'image' && hardware.webgpu === 'available' && hardware.shaderF16 === false) warnings.push('This WebGPU adapter lacks shader-f16, which the image engine requires.');
  }
  if (hardware.memoryGiBEstimate !== null && packageBytes >= hardware.memoryGiBEstimate * 1024 ** 3 * 0.75) {
    warnings.push(`Memory caution: the ${Math.round(packageBytes / 1e6)} MB download is large compared with this browser's coarse ${hardware.memoryGiBEstimate} GiB device-memory estimate. Runtime memory may be higher.`);
  }
  return warnings;
}
