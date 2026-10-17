import { analyzeCropCorners, drawSkewedDocument, type CropCorners } from './visionCrop.ts';

export type VisionFixture = {
  id: string;
  title: string;
  prompt: string;
  expected: string;
  score: (answer: string) => boolean;
  analyze?: (answer: string) => { passed: boolean; detail: string; sizeResults?: { sizePx: number; words: string[]; matched: string[] }[]; keywordResults?: PhotoKeywordResult[]; cropCorners?: CropCorners };
  blob: Blob;
  url: string;
};

export type PhotoKeywordResult = { label: string; difficulty: 'Obvious' | 'Detailed' | 'Subtle'; matched: boolean };
export const PUBLIC_REFERENCE_PHOTO_NAME = 'Lewis-Moten-and-Teddy-at-B-n-L-custard.jpg';

const photoKeywords: { label: string; difficulty: PhotoKeywordResult['difficulty']; pattern: RegExp }[] = [
  { label: 'person', difficulty: 'Obvious', pattern: /\b(person|man|human|guy|individual|someone)\b/i },
  { label: 'face or facial detail', difficulty: 'Obvious', pattern: /\b(face|facial|portrait|beard|stubble|sunglasses|sun glasses|shades)\b/i },
  { label: 'dog', difficulty: 'Obvious', pattern: /\b(dog|puppy|corgi|canine)\b/i },
  { label: 'sunglasses', difficulty: 'Obvious', pattern: /\b(sunglasses|sun glasses|shades|dark glasses)\b/i },
  { label: 'outdoors', difficulty: 'Obvious', pattern: /\b(outdoors?|outside|exterior|street|sky|trees?)\b/i },
  { label: 'ice cream or dessert', difficulty: 'Detailed', pattern: /\b(ice[ -]?cream|sundae|dessert|cupcake)\b/i },
  { label: 'shirt graphic', difficulty: 'Detailed', pattern: /\b(shirt|t-shirt|tee)\b.{0,60}\b(graphic|design|print|image|logo)\b|\b(graphic|design|print|image|logo)\b.{0,60}\b(shirt|t-shirt|tee)\b/i },
  { label: 'red overhead covering', difficulty: 'Detailed', pattern: /\bred\b.{0,35}\b(awning|canopy|roof|overhead|covering)\b|\b(awning|canopy|roof|overhead|covering)\b.{0,35}\bred\b/i },
  { label: 'blue sky or sunshine', difficulty: 'Detailed', pattern: /\b(blue sky|sky is blue|sky looks blue|clear sky|sunny|sunshine|sunlit|bright sunlight)\b/i },
  { label: 'door or opening', difficulty: 'Detailed', pattern: /\b(door|doorway|opening|open side)\b/i },
  { label: 'table or counter', difficulty: 'Detailed', pattern: /\b(table|counter)\b/i },
  { label: 'corgi breed', difficulty: 'Subtle', pattern: /\b(corgi|pembroke|welsh corgi)\b/i },
  { label: 'checkerboard pattern', difficulty: 'Subtle', pattern: /\b(checkerboard|checkered|chequered|black.and.white tiles?)\b/i },
];

export function analyzeReferencePhoto(answer: string) {
  const keywordResults = photoKeywords.map(({ label, difficulty, pattern }) => ({ label, difficulty, matched: pattern.test(answer) }));
  const obvious = keywordResults.filter(item => item.difficulty === 'Obvious');
  const matched = keywordResults.filter(item => item.matched).length;
  return {
    passed: obvious.filter(item => item.matched).length >= 3,
    detail: `${matched}/${keywordResults.length} checklist terms mentioned. This counts words in the response, not whether every claim is visible in the photo.`,
    keywordResults,
  };
}

export function createReferencePhotoFixture(blob: Blob): VisionFixture {
  return {
    id: 'photo', title: 'Real photo',
    prompt: 'In two or three short sentences, describe the main subjects, clothing, nearby objects, colors, and background. Distinguish what is visible from an uncertain interpretation: use words like "possibly" for an ambiguous object. Avoid invented activities, intentions, or relationships.',
    expected: 'Visible details include a person, dog, sunglasses, shirt graphic, dessert imagery, red overhead covering, checkered pattern, sky, opening, and table. Similar descriptions count; checklist matches do not verify every claim.',
    score: answer => analyzeReferencePhoto(answer).passed,
    analyze: analyzeReferencePhoto,
    blob, url: URL.createObjectURL(blob),
  };
}

function canvas() {
  const element = document.createElement('canvas');
  element.width = 512;
  element.height = 320;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 512, 320);
  return { element, context };
}

async function fixture(id: string, title: string, prompt: string, expected: string, score: (answer: string) => boolean, draw: (context: CanvasRenderingContext2D) => void, analyze?: VisionFixture['analyze']): Promise<VisionFixture> {
  const { element, context } = canvas();
  draw(context);
  const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the test image.')), 'image/png'));
  return { id, title, prompt, expected, score, analyze, blob, url: URL.createObjectURL(blob) };
}

const eanLeftOdd = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const eanLeftEven = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const eanRight = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const eanParity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export function ean13Bits(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 requires 13 digits.');
  const digits = [...code].map(Number);
  const checksum = (10 - (digits.slice(0, 12).reduce((sum, digit, index) => sum + digit * (index % 2 ? 3 : 1), 0) % 10)) % 10;
  if (checksum !== digits[12]) throw new Error('Invalid EAN-13 checksum.');
  const parity = eanParity[digits[0]];
  return '101' + digits.slice(1, 7).map((digit, index) => parity[index] === 'L' ? eanLeftOdd[digit] : eanLeftEven[digit]).join('') + '01010' + digits.slice(7).map(digit => eanRight[digit]).join('') + '101';
}
export function drawEan13(context: CanvasRenderingContext2D, code: string, x: number, y: number) {
  const bits = ean13Bits(code);
  context.fillStyle = '#111';
  [...bits].forEach((bit, index) => { if (bit === '1') context.fillRect(x + index * 3, y, 3, index < 3 || index > 91 || index > 44 && index < 50 ? 120 : 110); });
}

const microWordPool = ['amber', 'basil', 'cedar', 'daisy', 'ember', 'fable', 'globe', 'hazel', 'ivory', 'jelly', 'koala', 'lunar', 'maple', 'novel', 'otter', 'pearl', 'quartz', 'raven', 'solar', 'tulip', 'umber', 'vivid', 'whale', 'yarrow', 'zebra', 'acorn', 'brisk', 'coral', 'drift', 'elmwood', 'frost', 'ginger', 'harbor', 'island', 'juniper', 'kettle'];
const microSizes = [28, 22, 18, 14, 10, 7] as const;
export type MicroTextRow = { sizePx: number; words: [string, string] };
export function createMicroTextRows(randomIndex: (max: number) => number = max => crypto.getRandomValues(new Uint32Array(1))[0] % max): MicroTextRow[] {
  const words = [...microWordPool];
  return microSizes.map(sizePx => {
    const take = () => words.splice(Math.min(Math.max(0, randomIndex(words.length)), words.length - 1), 1)[0];
    return { sizePx, words: [take(), take()] };
  });
}
export function analyzeMicroText(answer: string, rows: MicroTextRow[]) {
  const spoken = new Set((answer.toLowerCase().match(/[a-z]+/g) || []));
  const sizeResults = rows.map(row => ({ sizePx: row.sizePx, words: [...row.words], matched: row.words.filter(word => spoken.has(word)) }));
  const smallest = [...sizeResults].reverse().find(row => row.matched.length > 0);
  return {
    passed: !!smallest && smallest.sizePx <= 10,
    sizeResults,
    detail: `${smallest ? `Smallest text read: ${smallest.sizePx}px.` : 'No target words read.'} Microtext target: 10px or smaller. ${sizeResults.map(row => `${row.sizePx}px ${row.matched.length}/2`).join(' · ')}`,
  };
}

// A fixed set of synthetic images makes repeat runs comparable and never uses user files.
export async function createVisionFixtures(): Promise<VisionFixture[]> {
  const microRows = createMicroTextRows();
  return Promise.all([
    fixture('shapes', 'Shapes and colors', 'List the geometric shapes and their colors. Reply in plain English.', 'Red circle, blue square, green triangle', answer => /red/i.test(answer) && /circle/i.test(answer) && /blue/i.test(answer) && /square/i.test(answer) && /green/i.test(answer) && /triangle/i.test(answer), context => {
      context.fillStyle = '#db2633'; context.beginPath(); context.arc(95, 150, 58, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#156bd9'; context.fillRect(207, 95, 112, 112);
      context.fillStyle = '#1f963f'; context.beginPath(); context.moveTo(420, 84); context.lineTo(355, 210); context.lineTo(485, 210); context.closePath(); context.fill();
      const image = context.getImageData(0, 0, 512, 320);
      for (let y = 0; y < 320; y += 11) for (let x = 0; x < 512; x += 13) { const p = (y * 512 + x) * 4; image.data[p] = Math.max(0, image.data[p] - 12); }
      context.putImageData(image, 0, 0);
    }),
    fixture('text', 'Text and numbers', 'Read the large text and number. Report exactly what you can make out.', 'RIVER 28', answer => /RIVER/i.test(answer) && /\b28\b/.test(answer), context => {
      context.fillStyle = '#111'; context.font = 'bold 58px sans-serif'; context.fillText('RIVER 28', 70, 180);
    }),
    fixture('imperfect', 'Imperfect print', 'Transcribe the printed text and number as best you can.', 'LANTERN 73', answer => /LANTERN/i.test(answer) && /\b73\b/.test(answer), context => {
      context.fillStyle = '#26323b'; context.font = 'bold 44px Georgia'; context.fillText('LANTERN 73', 54, 180);
      context.fillStyle = 'rgba(255,255,255,.38)';
      for (let x = 56; x < 450; x += 19) context.fillRect(x, 135 + (x * 7) % 35, 24, 3);
    }),
    fixture('barcode', 'EAN-13 barcode', 'Decode the digits from the bars only. No digits are printed. If uncertain, say so.', '5901234123457', answer => answer.includes('5901234123457'), context => drawEan13(context, '5901234123457', 105, 65)),
    fixture('crop', 'Perspective crop', 'Find the four outer corners of the tilted white document, not the image border. The image is 512 pixels wide and 320 pixels tall: x runs from 0 to 511 and y from 0 to 319. Return one JSON object with a "corners" array containing exactly four [x,y] points, ordered top-left, top-right, bottom-right, bottom-left. Each point has two numbers. Do not return four-number boxes, repeat the points, or add prose.', 'Four corners of the tilted document', answer => analyzeCropCorners(answer).passed, drawSkewedDocument, analyzeCropCorners),
    fixture('faint', 'Faint watermark', 'Describe any text you can actually discern. Do not guess.', 'OWL', answer => /\bOWL\b/i.test(answer), context => {
      context.fillStyle = '#fcfcfc'; context.font = 'bold 96px sans-serif'; context.fillText('OWL', 140, 190);
    }),
    fixture('channel', 'Single-channel text', 'Read any text and number you can distinguish.', 'FOX 19', answer => /FOX/i.test(answer) && /\b19\b/.test(answer), context => {
      context.fillStyle = '#d8d8d8'; context.fillRect(0, 0, 512, 320);
      context.fillStyle = 'rgb(55,216,216)'; context.font = 'bold 68px sans-serif'; context.fillText('FOX 19', 105, 185);
    }),
    fixture('micro', 'Text size ladder', 'Read every word you can see, from top to bottom. Skip words you cannot read; do not guess.', microRows.map(row => `${row.sizePx}px: ${row.words.join(' ')}`).join(' · '), answer => analyzeMicroText(answer, microRows).passed, context => {
      context.fillStyle = '#171b1a';
      microRows.forEach((row, index) => { context.font = `${row.sizePx}px sans-serif`; context.fillText(row.words.join('   '), 54, 42 + index * 51); });
    }, answer => analyzeMicroText(answer, microRows)),
    fixture('lsb', 'Red-channel LSB pattern', 'Describe any pattern you can actually distinguish. Do not guess.', 'X encoded in the red-channel least significant bit', answer => /\bX\b|\bcross\b/i.test(answer), context => {
      const image = context.getImageData(0, 0, 512, 320);
      for (let y = 45; y < 275; y++) for (let x = 140; x < 372; x++) {
        const p = (y * 512 + x) * 4;
        const left = x - 140;
        const top = y - 45;
        image.data[p] = Math.abs(left - top) < 14 || Math.abs(left + top - 230) < 14 ? 254 : 255;
      }
      context.putImageData(image, 0, 0);
    }),
  ]);
}
