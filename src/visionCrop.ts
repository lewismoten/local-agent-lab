export type CropPoint = [number, number];
export type CropCorners = [CropPoint, CropPoint, CropPoint, CropPoint];
export const CROP_IMAGE_SIZE = { width: 512, height: 320 };
export const CROP_TARGET_CORNERS: CropCorners = [[102, 38], [436, 73], [391, 272], [68, 236]];

type Matrix = [number, number, number, number, number, number, number, number, number];

function squareToQuad([tl, tr, br, bl]: CropCorners): Matrix {
  const dx1 = tr[0] - br[0], dx2 = bl[0] - br[0], dx3 = tl[0] - tr[0] + br[0] - bl[0];
  const dy1 = tr[1] - br[1], dy2 = bl[1] - br[1], dy3 = tl[1] - tr[1] + br[1] - bl[1];
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 1e-8) throw new Error('The crop corners do not form a usable quadrilateral.');
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  return [tr[0] - tl[0] + g * tr[0], bl[0] - tl[0] + h * bl[0], tl[0],
    tr[1] - tl[1] + g * tr[1], bl[1] - tl[1] + h * bl[1], tl[1], g, h, 1];
}

function inverse(matrix: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactors: Matrix = [e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d];
  const determinant = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (Math.abs(determinant) < 1e-8) throw new Error('The crop corners do not form a usable quadrilateral.');
  return cofactors.map(value => value / determinant) as Matrix;
}

function transform(matrix: Matrix, x: number, y: number): CropPoint {
  const scale = matrix[6] * x + matrix[7] * y + matrix[8];
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / scale,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / scale];
}

export function mapUnitToQuad(corners: CropCorners, u: number, v: number): CropPoint {
  return transform(squareToQuad(corners), u, v);
}

export function mapQuadToUnit(corners: CropCorners, x: number, y: number): CropPoint {
  return transform(inverse(squareToQuad(corners)), x, y);
}

function validCorners(points: unknown): CropCorners | null {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const parsed = points.map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] :
    point && typeof point === 'object' ? [Number((point as { x?: unknown }).x), Number((point as { y?: unknown }).y)] : []);
  if (parsed.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) return null;
  const normalized = parsed.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
  const scaled = parsed.map(([x, y]) => normalized ? [x * CROP_IMAGE_SIZE.width, y * CROP_IMAGE_SIZE.height] : [x, y]);
  if (scaled.some(([x, y]) => x < 0 || y < 0 || x > CROP_IMAGE_SIZE.width || y > CROP_IMAGE_SIZE.height)) return null;
  const top = [...scaled].sort((a, b) => a[1] - b[1]).slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottom = [...scaled].sort((a, b) => b[1] - a[1]).slice(0, 2).sort((a, b) => a[0] - b[0]);
  const ordered = [top[0], top[1], bottom[1], bottom[0]] as CropCorners;
  const cross = (a: CropPoint, b: CropPoint, c: CropPoint) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  if (ordered.some((point, index) => cross(point, ordered[(index + 1) % 4], ordered[(index + 2) % 4]) <= 100)) return null;
  return ordered;
}

function parseCropCandidate(candidate: string): CropCorners | null {
  const arrayStart = candidate.indexOf('['), arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      const array = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1)) as unknown;
      if (Array.isArray(array)) {
        const parsed = validCorners(array.map(item => item && typeof item === 'object' && 'point' in item ? (item as { point: unknown }).point : item));
        if (parsed) return parsed;
      }
    } catch { /* A model may return point lists with extra prose. */ }
  }
  const start = candidate.indexOf('{'), end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const object = JSON.parse(candidate.slice(start, end + 1)) as { corners?: unknown; points?: unknown };
      const parsed = validCorners(object.corners || object.points);
      if (parsed) return parsed;
    } catch { /* A model may add prose around its coordinates. */ }
  }
  const pairs = [...candidate.matchAll(/[[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[)\]]/g)].map(match => [Number(match[1]), Number(match[2])]);
  return validCorners(pairs);
}

export function parseCropCorners(answer: string): CropCorners | null {
  // A model may revise an earlier, invalid estimate. Prefer its last valid
  // fenced answer, then try the whole response for unfenced coordinates.
  const blocks = [...answer.matchAll(/```(?:[\w-]+)?\s*([\s\S]*?)```/g)];
  for (const block of blocks.reverse()) {
    const parsed = parseCropCandidate(block[1]);
    if (parsed) return parsed;
  }
  return parseCropCandidate(answer);
}

export function analyzeCropCorners(answer: string) {
  const cropCorners = parseCropCorners(answer);
  if (!cropCorners) {
    const pointMatches = [...answer.matchAll(/"point"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)];
    if (pointMatches.length === 4) {
      const points = pointMatches.map(match => [Number(match[1]), Number(match[2])]);
      const xSpan = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
      const ySpan = Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
      if (xSpan < 10 || ySpan < 10) return { passed: false, detail: 'Four points were returned, but they lie on nearly the same line. They cannot enclose the document, so no crop preview was made.', cropCorners: undefined };
    }
    const fourNumberRows = [...answer.matchAll(/^\s*\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){3}\s*\]\s*$/gm)];
    if (fourNumberRows.length >= 4) {
      const outOfBounds = fourNumberRows.some(row => {
        const [x1, y1, x2, y2] = row[0].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        return x1 < 0 || x1 > 511 || x2 < 0 || x2 > 511 || y1 < 0 || y1 > 319 || y2 < 0 || y2 > 319;
      });
      return { passed: false, detail: `The model returned four-number boxes instead of four [x,y] corner points.${outOfBounds ? ' Some coordinates also fall outside the 512 × 320 image.' : ''} No crop preview was made.`, cropCorners: undefined };
    }
    return { passed: false, detail: 'No valid four-corner selection was returned. Each point needs an [x,y] pair inside the 512 × 320 image, with no duplicates. No crop preview was made.', cropCorners: undefined };
  }
  const errors = cropCorners.map((point, index) => Math.hypot(point[0] - CROP_TARGET_CORNERS[index][0], point[1] - CROP_TARGET_CORNERS[index][1]));
  const meanError = errors.reduce((sum, value) => sum + value, 0) / 4;
  return { passed: meanError <= 25 && Math.max(...errors) <= 45,
    detail: `Corners found. Mean corner error: ${meanError.toFixed(1)} px. The straightened preview uses the model's corners.`, cropCorners };
}

export function drawSkewedDocument(context: CanvasRenderingContext2D) {
  const { width, height } = CROP_IMAGE_SIZE;
  context.fillStyle = '#d9e1df'; context.fillRect(0, 0, width, height);
  const page = document.createElement('canvas'); page.width = 384; page.height = 230;
  const pageContext = page.getContext('2d');
  if (!pageContext) throw new Error('Canvas is unavailable in this browser.');
  pageContext.fillStyle = '#fffdf6'; pageContext.fillRect(0, 0, page.width, page.height);
  pageContext.fillStyle = '#202c34'; pageContext.font = 'bold 44px sans-serif'; pageContext.fillText('RIVER 28', 35, 91);
  pageContext.fillStyle = '#c84e43'; pageContext.beginPath(); pageContext.arc(83, 166, 27, 0, Math.PI * 2); pageContext.fill();
  pageContext.fillStyle = '#417bb6'; pageContext.fillRect(161, 139, 94, 54);
  pageContext.fillStyle = '#566b61'; pageContext.font = '16px sans-serif'; pageContext.fillText('STORY CARD', 266, 178);
  const pagePixels = pageContext.getImageData(0, 0, page.width, page.height).data;
  const output = context.getImageData(0, 0, width, height);
  const toUnit = inverse(squareToQuad(CROP_TARGET_CORNERS));
  const xs = CROP_TARGET_CORNERS.map(point => point[0]), ys = CROP_TARGET_CORNERS.map(point => point[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const [u, v] = transform(toUnit, x + 0.5, y + 0.5);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const source = (Math.min(page.height - 1, Math.floor(v * page.height)) * page.width + Math.min(page.width - 1, Math.floor(u * page.width))) * 4;
      const dest = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) output.data[dest + channel] = pagePixels[source + channel];
    }
  }
  context.putImageData(output, 0, 0);
  context.strokeStyle = '#3a4e54'; context.lineWidth = 3;
  context.beginPath(); CROP_TARGET_CORNERS.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath(); context.stroke();
}

export async function straightenCrop(blob: Blob, corners: CropCorners): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const source = document.createElement('canvas'); source.width = bitmap.width; source.height = bitmap.height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('Canvas is unavailable in this browser.');
    sourceContext.drawImage(bitmap, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const output = document.createElement('canvas'); output.width = 384; output.height = 230;
    const context = output.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable in this browser.');
    const image = context.createImageData(output.width, output.height);
    const fromUnit = squareToQuad(corners);
    for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
      const [sx, sy] = transform(fromUnit, (x + 0.5) / output.width, (y + 0.5) / output.height);
      const sourceX = Math.max(0, Math.min(bitmap.width - 1, Math.round(sx)));
      const sourceY = Math.max(0, Math.min(bitmap.height - 1, Math.round(sy)));
      const from = (sourceY * bitmap.width + sourceX) * 4, to = (y * output.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) image.data[to + channel] = pixels[from + channel];
    }
    context.putImageData(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the straightened crop.')), 'image/png'));
  } finally { bitmap.close(); }
}
