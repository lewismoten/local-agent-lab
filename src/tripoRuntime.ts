import { assertBrowserOnnxEngineFiles } from './browserImageAssets.ts';
import { unloadBrowserImageModel } from './browserImage.ts';
import { unloadBrowserModel } from './browserModel.ts';
import { unloadBrowserSpeech } from './browserSpeech.ts';
import { unloadBrowserTranscription } from './browserTranscription.ts';
import { unloadLocalOllama } from './localOllama.ts';
import { unloadNeedle } from './needleRuntime.ts';
import { withLocalModelMemory } from './localModelMemory.ts';
import { assertMotionFiles } from './motionAssets.ts';
import type { ImageOrt, ImageSession } from './imagePipelineUtils.ts';

type TripoOrt = ImageOrt & { env: { logLevel: string; wasm: { wasmPaths: { mjs: string; wasm: string }; numThreads: number } }; InferenceSession: { create: (url: string, options: { executionProviders: string[]; logSeverityLevel: 0 | 1 | 2 | 3 | 4; externalData?: { path: string; data: Blob }[] }) => Promise<ImageSession> } };
type Vertex = { x: number; y: number; z: number; r: number; g: number; b: number; nx?: number; ny?: number; nz?: number };
export type TripoMesh = { vertices: Vertex[]; triangles: number; ply: Blob };
export type TripoClipPoint = { x: number; y: number };
export type TripoBackgroundMode = 'auto' | 'keep' | 'clip';
const side = 512;
const radius = 0.87;
const runtimeGlobal = globalThis as typeof globalThis & { ort?: TripoOrt };

function removeSolidBackground(image: ImageData, tolerance: number): number {
  const { width, height, data } = image;
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  const samples = corners.map(([x, y]) => {
    const sum = [0, 0, 0]; let count = 0;
    for (let dy = 0; dy < Math.min(5, height); dy++) for (let dx = 0; dx < Math.min(5, width); dx++) {
      const px = x === 0 ? dx : x - dx, py = y === 0 ? dy : y - dy;
      const offset = (py * width + px) * 4;
      for (let channel = 0; channel < 3; channel++) sum[channel] += data[offset + channel];
      count++;
    }
    return sum.map(value => value / count);
  });
  let pair: [number, number] = [0, 1], best = Infinity;
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const distance = Math.hypot(...samples[a].map((value, channel) => value - samples[b][channel]));
    if (distance < best) { best = distance; pair = [a, b]; }
  }
  const background = samples[pair[0]].map((value, channel) => (value + samples[pair[1]][channel]) / 2);
  const matches = (index: number) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) <= tolerance;
  };
  const removed = new Uint8Array(width * height);
  const queue = new Int32Array(width * height); let head = 0, tail = 0;
  const enqueue = (index: number) => { if (!removed[index] && matches(index)) { removed[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  // Fade matching edge pixels so JPEG and resized images leave less of a color halo.
  for (let index = 0; index < removed.length; index++) {
    if (removed[index]) { data[index * 4 + 3] = 0; continue; }
    const x = index % width, y = Math.floor(index / width);
    if (!((x > 0 && removed[index - 1]) || (x + 1 < width && removed[index + 1]) || (y > 0 && removed[index - width]) || (y + 1 < height && removed[index + width]))) continue;
    const offset = index * 4;
    const distance = Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]);
    if (distance < tolerance + 20) data[offset + 3] = Math.min(data[offset + 3], Math.round(255 * Math.max(0, (distance - tolerance) / 20)));
  }
  return tail;
}

export async function renderTripoInput(source: Blob, paddingPercent = 8, clipPoints?: readonly TripoClipPoint[], backgroundMode: TripoBackgroundMode = 'auto', backgroundTolerance = 36): Promise<{ staged: HTMLCanvasElement; composited: HTMLCanvasElement; needsPadding: boolean; sourceHasTransparency: boolean; backgroundRemoved: number; sourceWidth: number; sourceHeight: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(bitmap, 0, 0);
    let backgroundRemoved = 0, sourceHasTransparency = false;
    if (backgroundMode === 'auto') {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let offset = 3; offset < pixels.data.length; offset += 4) if (pixels.data[offset] < 250) { sourceHasTransparency = true; break; }
      if (!sourceHasTransparency) {
        backgroundRemoved = removeSolidBackground(pixels, Math.max(0, Math.min(100, backgroundTolerance)));
        if (backgroundRemoved < canvas.width * canvas.height * 0.95) ctx.putImageData(pixels, 0, 0);
        else backgroundRemoved = 0;
      }
    }
    if (clipPoints && clipPoints.length >= 3) {
      const mask = document.createElement('canvas'); mask.width = bitmap.width; mask.height = bitmap.height;
      const outline = mask.getContext('2d');
      if (!outline) throw new Error('Canvas is unavailable.');
      outline.fillStyle = '#fff'; outline.beginPath();
      clipPoints.forEach((point, index) => {
        const x = Math.max(0, Math.min(1, point.x)) * bitmap.width;
        const y = Math.max(0, Math.min(1, point.y)) * bitmap.height;
        if (index === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
      });
      outline.closePath(); outline.fill('evenodd');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = raw.width, y0 = raw.height, x1 = -1, y1 = -1;
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
      if (raw.data[(y * raw.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < 0) throw new Error('The image has no visible pixels.');
    const needsPadding = x0 === 0 && y0 === 0 && x1 === raw.width - 1 && y1 === raw.height - 1;
    const foreground = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const margin = Math.max(0, Math.min(40, paddingPercent)) / 100;
    const scale = side * (1 - margin * 2) / foreground;
    const staged = document.createElement('canvas'); staged.width = side; staged.height = side;
    const staging = staged.getContext('2d');
    if (!staging) throw new Error('Canvas is unavailable.');
    staging.drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, (side - (x1 - x0 + 1) * scale) / 2, (side - (y1 - y0 + 1) * scale) / 2, (x1 - x0 + 1) * scale, (y1 - y0 + 1) * scale);
    const composited = document.createElement('canvas'); composited.width = side; composited.height = side;
    const output = composited.getContext('2d', { willReadFrequently: true });
    if (!output) throw new Error('Canvas is unavailable.');
    output.fillStyle = '#808080'; output.fillRect(0, 0, side, side);
    output.drawImage(staged, 0, 0);
    return { staged, composited, needsPadding, sourceHasTransparency, backgroundRemoved, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
  } finally { bitmap.close(); }
}

async function inputTensor(source: Blob, paddingPercent: number, clipPoints?: readonly TripoClipPoint[], backgroundMode: TripoBackgroundMode = 'auto', backgroundTolerance = 36) {
  const { composited } = await renderTripoInput(source, paddingPercent, clipPoints, backgroundMode, backgroundTolerance);
  const pixels = composited.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, side, side).data;
  if (!pixels) throw new Error('Canvas is unavailable.');
  const tensor = new Float32Array(3 * side * side);
  for (let i = 0; i < side * side; i++) for (let channel = 0; channel < 3; channel++) tensor[channel * side * side + i] = pixels[i * 4 + channel] / 255;
  return tensor;
}

function samplePlane(plane: Float32Array, planeIndex: number, channel: number, u: number, v: number): number {
  const px = (u / radius + 1) * 32 - 0.5;
  const py = (v / radius + 1) * 32 - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py), x1 = x0 + 1, y1 = y0 + 1;
  const fx = px - x0, fy = py - y0;
  const base = (planeIndex * 40 + channel) * 64 * 64;
  const pixel = (x: number, y: number) => x < 0 || x >= 64 || y < 0 || y >= 64 ? 0 : plane[base + y * 64 + x];
  return pixel(x0,y0) * (1 - fx) * (1 - fy) + pixel(x1,y0) * fx * (1 - fy) + pixel(x0,y1) * (1 - fx) * fy + pixel(x1,y1) * fx * fy;
}

function featureAt(plane: Float32Array, x: number, y: number, z: number, into: Float32Array, offset: number) {
  for (let channel = 0; channel < 40; channel++) {
    into[offset + channel] = samplePlane(plane, 0, channel, x, y);
    into[offset + 40 + channel] = samplePlane(plane, 1, channel, x, z);
    into[offset + 80 + channel] = samplePlane(plane, 2, channel, y, z);
  }
}

const corners: readonly [number, number, number][] = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const tetrahedra: readonly [number, number, number, number][] = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];

export function makeMesh(density: Float32Array, colors: Float32Array, n: number, threshold: number): TripoMesh {
  const vertices: Vertex[] = [];
  const at = (x: number, y: number, z: number) => (z * n + y) * n + x;
  if (density.length !== n ** 3 || colors.length !== density.length * 3) throw new Error('Invalid surface sample dimensions.');
  const gradients = new Float32Array(density.length * 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const index = at(x, y, z) * 3;
    gradients[index] = density[at(Math.min(n - 1, x + 1), y, z)] - density[at(Math.max(0, x - 1), y, z)];
    gradients[index + 1] = density[at(x, Math.min(n - 1, y + 1), z)] - density[at(x, Math.max(0, y - 1), z)];
    gradients[index + 2] = density[at(x, y, Math.min(n - 1, z + 1))] - density[at(x, y, Math.max(0, z - 1))];
  }
  const position = (x: number, y: number, z: number) => [((x / (n - 1)) * 2 - 1) * radius, ((y / (n - 1)) * 2 - 1) * radius, ((z / (n - 1)) * 2 - 1) * radius] as const;
  const edge = (a: number, b: number, indices: number[], coords: (readonly number[])[]) => {
    const ia = indices[a], ib = indices[b], da = density[ia], db = density[ib];
    const t = da === db ? 0.5 : Math.max(0, Math.min(1, (threshold - da) / (db - da)));
    const pa = coords[a], pb = coords[b];
    const gx = gradients[ia * 3] * (1 - t) + gradients[ib * 3] * t;
    const gy = gradients[ia * 3 + 1] * (1 - t) + gradients[ib * 3 + 1] * t;
    const gz = gradients[ia * 3 + 2] * (1 - t) + gradients[ib * 3 + 2] * t;
    const magnitude = Math.hypot(gx, gy, gz) || 1;
    return { x: pa[0] + (pb[0] - pa[0]) * t, y: pa[1] + (pb[1] - pa[1]) * t, z: pa[2] + (pb[2] - pa[2]) * t,
      nx: -gx / magnitude, ny: -gy / magnitude, nz: -gz / magnitude,
      r: Math.round(255 * Math.max(0, Math.min(1, colors[ia * 3] + (colors[ib * 3] - colors[ia * 3]) * t))),
      g: Math.round(255 * Math.max(0, Math.min(1, colors[ia * 3 + 1] + (colors[ib * 3 + 1] - colors[ia * 3 + 1]) * t))),
      b: Math.round(255 * Math.max(0, Math.min(1, colors[ia * 3 + 2] + (colors[ib * 3 + 2] - colors[ia * 3 + 2]) * t))) };
  };
  for (let z = 0; z < n - 1; z++) for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const indices = corners.map(([dx,dy,dz]) => at(x+dx,y+dy,z+dz));
    const values = indices.map(index => density[index]);
    if (values.every(value => value < threshold) || values.every(value => value >= threshold)) continue;
    const coords = corners.map(([dx,dy,dz]) => position(x+dx,y+dy,z+dz));
    for (const tet of tetrahedra) {
      const inside = tet.filter(k => values[k] >= threshold), outside = tet.filter(k => values[k] < threshold);
      if (inside.length === 1) {
        const [a] = inside; vertices.push(edge(a,outside[0],indices,coords),edge(a,outside[1],indices,coords),edge(a,outside[2],indices,coords));
      } else if (inside.length === 3) {
        const [a] = outside; vertices.push(edge(a,inside[0],indices,coords),edge(a,inside[2],indices,coords),edge(a,inside[1],indices,coords));
      } else if (inside.length === 2) {
        const a = edge(inside[0],outside[0],indices,coords), b = edge(inside[0],outside[1],indices,coords);
        const c = edge(inside[1],outside[0],indices,coords), d = edge(inside[1],outside[1],indices,coords);
        vertices.push(a,b,c,b,d,c);
      }
    }
  }
  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    const alignment = fx * ((a.nx || 0) + (b.nx || 0) + (c.nx || 0)) + fy * ((a.ny || 0) + (b.ny || 0) + (c.ny || 0)) + fz * ((a.nz || 0) + (b.nz || 0) + (c.nz || 0));
    if (alignment < 0) [vertices[i + 1], vertices[i + 2]] = [c, b];
    const length = Math.hypot(fx, fy, fz) || 1;
    for (const vertex of [a, b, c]) if (Math.hypot(vertex.nx || 0, vertex.ny || 0, vertex.nz || 0) < 0.01) {
      const direction = alignment < 0 ? -1 : 1;
      vertex.nx = fx / length * direction; vertex.ny = fy / length * direction; vertex.nz = fz / length * direction;
    }
  }
  const header = `ply\nformat ascii 1.0\ncomment Generated locally with TripoSR\nelement vertex ${vertices.length}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${vertices.length / 3}\nproperty list uchar int vertex_indices\nend_header\n`;
  const body = vertices.map(vertex => `${vertex.x} ${vertex.y} ${vertex.z} ${vertex.nx} ${vertex.ny} ${vertex.nz} ${vertex.r} ${vertex.g} ${vertex.b}\n`).join('');
  const faces = Array.from({ length: vertices.length / 3 }, (_, i) => `3 ${i*3} ${i*3+1} ${i*3+2}\n`).join('');
  return { vertices, triangles: vertices.length / 3, ply: new Blob([header, body, faces], { type: 'application/octet-stream' }) };
}

export async function reconstructTripo(folder: FileSystemDirectoryHandle, source: Blob, resolution: number, threshold: number, signal: AbortSignal, progress: (message: string, current?: number, total?: number) => void, paddingPercent = 8, clipPoints?: readonly TripoClipPoint[], backgroundMode: TripoBackgroundMode = 'auto', backgroundTolerance = 36): Promise<TripoMesh> {
  return withLocalModelMemory(async () => {
    const [model, engine] = await Promise.all([assertMotionFiles(folder, 'tripo'), assertBrowserOnnxEngineFiles(folder)]);
    await unloadBrowserImageModel(); await unloadBrowserModel(); await unloadNeedle(); await unloadBrowserSpeech(); await unloadBrowserTranscription(); await unloadLocalOllama();
    if (signal.aborted) throw signal.reason;
    const input = await inputTensor(source, paddingPercent, clipPoints, backgroundMode, backgroundTolerance);
    const script = document.createElement('script'); script.src = URL.createObjectURL(new Blob([engine[3]], { type: 'text/javascript' }));
    try { await new Promise<void>((resolve,reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error('The saved ONNX engine could not start.')); document.head.append(script); }); }
    finally { script.remove(); URL.revokeObjectURL(script.src); }
    const ort = runtimeGlobal.ort;
    if (!ort) throw new Error('The saved ONNX engine did not expose its browser API.');
    const mjs = URL.createObjectURL(new Blob([engine[4]], { type: 'text/javascript' }));
    const wasm = URL.createObjectURL(new Blob([engine[5]], { type: 'application/wasm' }));
    const graph = URL.createObjectURL(model[3]), decoder = URL.createObjectURL(model[5]);
    let triplane: ImageSession | undefined, pointDecoder: ImageSession | undefined;
    try {
      ort.env.logLevel = 'error'; ort.env.wasm.wasmPaths = { mjs, wasm }; ort.env.wasm.numThreads = 1;
      progress('Loading 3D model…');
      triplane = await ort.InferenceSession.create(graph, { executionProviders: ['webgpu'], logSeverityLevel: 3, externalData: [{ path: 'triplane_q8.onnx.data', data: model[4] }] });
      pointDecoder = await ort.InferenceSession.create(decoder, { executionProviders: ['webgpu', 'wasm'], logSeverityLevel: 3 });
      if (signal.aborted) throw signal.reason;
      progress('Building 3D features…');
      const result = await triplane.run({ image: new ort.Tensor('float32', input, [1,3,side,side]) });
      const plane = Float32Array.from(result.triplane.data);
      if (plane.length !== 3*40*64*64) throw new Error('TripoSR returned an unexpected triplane shape.');
      const total = resolution ** 3, density = new Float32Array(total), colors = new Float32Array(total * 3), batchSize = 1024;
      for (let start = 0; start < total; start += batchSize) {
        if (signal.aborted) throw signal.reason;
        const count = Math.min(batchSize, total - start), features = new Float32Array(count * 120);
        for (let i = 0; i < count; i++) {
          const index = start + i, x = index % resolution, y = Math.floor(index / resolution) % resolution, z = Math.floor(index / (resolution * resolution));
          featureAt(plane, ((x / (resolution - 1)) * 2 - 1) * radius, ((y / (resolution - 1)) * 2 - 1) * radius, ((z / (resolution - 1)) * 2 - 1) * radius, features, i * 120);
        }
        const decoded = await pointDecoder.run({ features: new ort.Tensor('float32', features, [count,120]) });
        for (let i = 0; i < count; i++) {
          density[start + i] = decoded.density.data[i];
          for (let channel = 0; channel < 3; channel++) colors[(start + i) * 3 + channel] = decoded.color.data[i * 3 + channel];
        }
        progress('Sampling 3D surface…', Math.min(total, start + count), total);
      }
      progress('Building mesh…');
      const mesh = makeMesh(density, colors, resolution, threshold);
      if (!mesh.triangles) throw new Error('No 3D surface was found. Try another cutout image or density threshold.');
      return mesh;
    } finally {
      await triplane?.release().catch(() => {}); await pointDecoder?.release().catch(() => {});
      for (const url of [mjs, wasm, graph, decoder]) URL.revokeObjectURL(url);
    }
  });
}

export function meshPreview(mesh: TripoMesh, angle = 0.5): string {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.fillStyle = '#20232b'; ctx.fillRect(0, 0, 480, 480);
  const vertices = mesh.vertices;
  const step = Math.max(1, Math.floor(vertices.length / 25000));
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let i = 0; i < vertices.length; i += step) {
    const vertex = vertices[i], x = vertex.x * ca - vertex.z * sa, z = vertex.x * sa + vertex.z * ca;
    const scale = 210 / (2.5 - z);
    ctx.fillStyle = `rgb(${vertex.r},${vertex.g},${vertex.b})`;
    ctx.fillRect(240 + x * scale, 240 - vertex.y * scale, 2, 2);
  }
  return canvas.toDataURL('image/png');
}
