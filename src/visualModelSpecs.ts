import { browserImageAssets, browserImageOutputSize, type BrowserImageModelGroup } from './browserImageAssets.ts';
import { MOTION_MODELS, type MotionModel } from './motionAssets.ts';

export type VisualModelSpec = {
  task: string;
  inputs: readonly string[];
  outputs: readonly string[];
  dimensions: string;
  runtime: string;
  backends: readonly string[];
};

export type VisualRevision = { label: string; value: string; url: string };
const resolvedRevision = (url: string): VisualRevision => {
  const value = url.match(/\/resolve\/([^/]+)\//)?.[1];
  if (!value) throw new Error(`Visual model source is not pinned: ${url}`);
  return { label: 'Weights revision', value, url };
};

export function imageModelRevision(group: BrowserImageModelGroup): VisualRevision {
  const weight = browserImageAssets(group).find(asset => asset.name.endsWith('.onnx'));
  if (!weight) throw new Error(`No weight source declared for ${group}`);
  return resolvedRevision(weight.url);
}

export function motionModelRevision(id: MotionModel): VisualRevision {
  if (id === 'pose') {
    const url = MOTION_MODELS.pose.assets.find(asset => asset.name.endsWith('.task'))!.url;
    return { label: 'Model release', value: 'float16 / 1', url };
  }
  if (id === 'vector') {
    const url = MOTION_MODELS.vector_engine.assets.find(asset => asset.name === 'vtracer_wasm.js')!.url;
    return { label: 'Engine release', value: '1.0.0-alpha.4', url };
  }
  const weight = MOTION_MODELS[id].assets.find(asset => asset.name.endsWith('.onnx'));
  if (!weight) throw new Error(`No weight source declared for ${id}`);
  return resolvedRevision(weight.url);
}

export function imageModelSpec(group: BrowserImageModelGroup): VisualModelSpec {
  const side = browserImageOutputSize(group);
  return {
    task: 'Text to image',
    inputs: ['Text prompt', 'Seed'],
    outputs: ['PNG image'],
    dimensions: `${side} × ${side} px output`,
    runtime: 'ONNX Image engine',
    backends: ['WebGPU', 'shader-f16'],
  };
}

export const MOTION_MODEL_SPECS: Record<MotionModel, VisualModelSpec> = {
  depth: {
    task: 'Depth estimation and camera parallax',
    inputs: ['One image', 'Optional text prompt via an image model'],
    outputs: ['Depth map', 'Parallax video'],
    dimensions: '518 × 518 px depth processor; 512 × 512 px video frames',
    runtime: 'ONNX Image engine',
    backends: ['WebGPU', 'WASM fallback'],
  },
  rife: {
    task: 'Frame interpolation',
    inputs: ['First image', 'Up to four ordered intermediate images', 'Last image'],
    outputs: ['Interpolated frames', 'WebM video', 'Optional PNG sequence'],
    dimensions: '256 × 256 or 512 × 512 px frames in this app',
    runtime: 'ONNX Image engine',
    backends: ['WebGPU', 'WASM fallback'],
  },
  pose: {
    task: 'Body pose detection',
    inputs: ['Image or video frames'],
    outputs: ['33 body landmarks per detected pose', 'Overlay'],
    dimensions: 'Uses source frame dimensions',
    runtime: 'MediaPipe Vision',
    backends: ['WASM CPU', 'SIMD when available'],
  },
  vector: {
    task: 'Raster to vector',
    inputs: ['Raster image'],
    outputs: ['SVG paths'],
    dimensions: 'Longest input side reduced to 1,024 px',
    runtime: 'VTracer WebAssembly',
    backends: ['WASM CPU'],
  },
  tripo: {
    task: 'Single image to 3D mesh',
    inputs: ['Object image'],
    outputs: ['PLY mesh', 'GLB mesh with vertex colors'],
    dimensions: '512 × 512 px model input; adjustable mesh grid',
    runtime: 'ONNX Image engine',
    backends: ['WebGPU', 'WASM decoder fallback'],
  },
};
