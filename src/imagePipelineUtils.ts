export type ImageTensor = { data: ArrayLike<number>; dims: readonly number[] };
export type ImageSession = { run: (feeds: Record<string, ImageTensor>) => Promise<Record<string, ImageTensor>>; release: () => Promise<void> };
export type ImageOrt = {
  InferenceSession: { create: (url: string, options: { executionProviders: string[]; logSeverityLevel?: 0 | 1 | 2 | 3 | 4 }) => Promise<ImageSession> };
  Tensor: new (type: string, data: Float32Array | BigInt64Array | Uint16Array, dims: number[]) => ImageTensor;
};

export function gaussian(seed: number) {
  let state = seed >>> 0;
  let spare: number | null = null;
  const uniform = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function imageFromPlanes(pixels: ArrayLike<number>, side: number) {
  if (pixels.length !== 3 * side * side) throw new Error('The image decoder returned an unexpected shape.');
  const image = new ImageData(side, side);
  const plane = side * side;
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[channel * plane + i];
      image.data[4 * i + channel] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round((value + 1) * 127.5))) : 0;
    }
    image.data[4 * i + 3] = 255;
  }
  return image;
}

export function float16(value: number) {
  const bits = new Int32Array(new Float32Array([value]).buffer)[0];
  let output = (bits >> 16) & 0x8000;
  let mantissa = (bits >> 12) & 0x07ff;
  const exponent = (bits >> 23) & 0xff;
  if (exponent < 103) return output;
  if (exponent > 142) return output | 0x7c00 | ((exponent === 255 ? 0 : 1) && bits & 0x007fffff);
  if (exponent < 113) { mantissa |= 0x0800; return output | ((mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1)); }
  output |= ((exponent - 112) << 10) | (mantissa >> 1);
  return output + (mantissa & 1);
}

export function fromFloat16(bits: number) {
  const fraction = bits & 0x03ff;
  const exponent = (bits & 0x7c00) >> 10;
  const sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 31) return sign * (fraction ? NaN : Infinity);
  if (exponent === 0) return sign * 2 ** -14 * fraction / 1024;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
