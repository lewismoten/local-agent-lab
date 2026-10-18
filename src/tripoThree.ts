import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import type { TripoMesh } from './tripoRuntime.ts';

function smoothLegacyNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const groups = new Map<string, [number, number, number]>();
  const key = (offset: number) => `${Math.round(positions[offset] * 100000)},${Math.round(positions[offset + 1] * 100000)},${Math.round(positions[offset + 2] * 100000)}`;
  for (let offset = 0; offset < positions.length; offset += 9) {
    const ax = positions[offset], ay = positions[offset + 1], az = positions[offset + 2];
    const bx = positions[offset + 3] - ax, by = positions[offset + 4] - ay, bz = positions[offset + 5] - az;
    const cx = positions[offset + 6] - ax, cy = positions[offset + 7] - ay, cz = positions[offset + 8] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    for (let vertex = offset; vertex < offset + 9; vertex += 3) {
      const id = key(vertex);
      const sum = groups.get(id) || [0, 0, 0];
      sum[0] += nx; sum[1] += ny; sum[2] += nz;
      groups.set(id, sum);
    }
  }
  for (let offset = 0; offset < positions.length; offset += 3) {
    const [x, y, z] = groups.get(key(offset)) || [0, 1, 0];
    const length = Math.hypot(x, y, z) || 1;
    normals[offset] = x / length; normals[offset + 1] = y / length; normals[offset + 2] = z / length;
  }
  return normals;
}

// TripoSR supplies colors at mesh vertices, not an image texture or UV atlas.
// Keep those colors in the GLB so the export matches the browser preview.
export function createTripoGeometry(mesh: TripoMesh): THREE.BufferGeometry {
  const positions = new Float32Array(mesh.vertices.length * 3);
  const colors = new Float32Array(mesh.vertices.length * 3);
  const normals = new Float32Array(mesh.vertices.length * 3);
  const hasNormals = mesh.vertices.every(vertex => Number.isFinite(vertex.nx) && Number.isFinite(vertex.ny) && Number.isFinite(vertex.nz));
  const color = new THREE.Color();
  mesh.vertices.forEach((vertex, index) => {
    const offset = index * 3;
    positions[offset] = vertex.x;
    positions[offset + 1] = vertex.y;
    positions[offset + 2] = vertex.z;
    color.setRGB(vertex.r / 255, vertex.g / 255, vertex.b / 255, THREE.SRGBColorSpace);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    if (hasNormals) {
      normals[offset] = vertex.nx!;
      normals[offset + 1] = vertex.ny!;
      normals[offset + 2] = vertex.nz!;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(hasNormals ? normals : smoothLegacyNormals(positions), 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export async function exportTripoGlb(mesh: TripoMesh): Promise<Blob> {
  const geometry = createTripoGeometry(mesh);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'TripoSR mesh';
  try {
    const output = await new GLTFExporter().parseAsync(object, { binary: true });
    if (!(output instanceof ArrayBuffer)) throw new Error('The GLB exporter returned an unexpected result.');
    return new Blob([output], { type: 'model/gltf-binary' });
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

export async function importTripoPly(file: Blob): Promise<TripoMesh> {
  const loaded = new PLYLoader().parse(await file.arrayBuffer());
  const geometry = loaded.index ? loaded.toNonIndexed() : loaded;
  try {
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');
    const normal = geometry.getAttribute('normal');
    if (!position || position.count < 3 || position.count % 3 !== 0) throw new Error('This PLY does not contain a triangle mesh.');
    const vertices: TripoMesh['vertices'] = [];
    const srgb = new THREE.Color();
    for (let index = 0; index < position.count; index++) {
      if (color) srgb.setRGB(color.getX(index), color.getY(index), color.getZ(index)).convertLinearToSRGB();
      else srgb.setRGB(0.7, 0.7, 0.7);
      vertices.push({
        x: position.getX(index), y: position.getY(index), z: position.getZ(index),
        ...(normal ? { nx: normal.getX(index), ny: normal.getY(index), nz: normal.getZ(index) } : {}),
        r: Math.round(THREE.MathUtils.clamp(srgb.r, 0, 1) * 255),
        g: Math.round(THREE.MathUtils.clamp(srgb.g, 0, 1) * 255),
        b: Math.round(THREE.MathUtils.clamp(srgb.b, 0, 1) * 255),
      });
    }
    return { vertices, triangles: vertices.length / 3, ply: file };
  } finally {
    if (geometry !== loaded) loaded.dispose();
    geometry.dispose();
  }
}
