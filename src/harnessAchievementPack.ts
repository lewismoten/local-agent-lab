import { ACHIEVEMENTS } from './harnessAchievements.ts';
import {
  achievementArtworkKey,
  validAchievementSet,
  type AchievementSet,
} from './harnessAchievementSets.ts';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import type { HarnessStore } from './harnessStore.ts';

export type AchievementPackedIcon = { png: string; prompt: string };
export type AchievementSetPack = {
  format: 'local-agent-lab-achievement-set';
  version: 1;
  set: AchievementSet;
  icons: Record<string, AchievementPackedIcon>;
};
const achievementIds = new Set(ACHIEVEMENTS.map(item => item.id));
const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

export function packedIconBlob(icon: AchievementPackedIcon): Blob {
  if (!icon || typeof icon.png !== 'string' || icon.png.length > 700_000
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(icon.png) || icon.png.length % 4 !== 0)
    throw new Error('An achievement icon has invalid image data.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(icon.png), value => value.charCodeAt(0)); }
  catch { throw new Error('An achievement icon has invalid image data.'); }
  if (bytes.length < 24 || bytes.length > 512_000 || pngMagic.some((value, index) => bytes[index] !== value))
    throw new Error('Achievement icon must be a compact PNG.');
  const dimensions = new DataView(bytes.buffer);
  const width = dimensions.getUint32(16);
  const height = dimensions.getUint32(20);
  if (!width || !height || width > 1024 || height > 1024 || width * height > 1_000_000)
    throw new Error('Achievement icon dimensions are too large.');
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'image/png' });
}

export function readAchievementSetPack(value: unknown): AchievementSetPack {
  if (validAchievementSet(value)) return {
    format: 'local-agent-lab-achievement-set', version: 1, set: value, icons: {},
  };
  if (!value || typeof value !== 'object') throw new Error('This is not an achievement set.');
  const pack = value as Partial<AchievementSetPack>;
  if (pack.format !== 'local-agent-lab-achievement-set' || pack.version !== 1
    || !validAchievementSet(pack.set) || !pack.icons || typeof pack.icons !== 'object'
    || Array.isArray(pack.icons) || Object.keys(pack.icons).length > ACHIEVEMENTS.length)
    throw new Error('This achievement set uses an invalid or unsupported format.');
  let total = 0;
  for (const [id, icon] of Object.entries(pack.icons)) {
    if (!achievementIds.has(id) || !icon || typeof icon.prompt !== 'string' || icon.prompt.length > 1200)
      throw new Error('An achievement icon has invalid metadata.');
    const image = packedIconBlob(icon);
    total += image.size;
    if (total > 12_000_000) throw new Error('The achievement set contains too much image data.');
  }
  return pack as AchievementSetPack;
}

export async function exportAchievementSetPack(store: HarnessStore, set: AchievementSet): Promise<AchievementSetPack> {
  const artwork = await store.surfaceArtwork();
  const icons: Record<string, AchievementPackedIcon> = {};
  for (const achievement of ACHIEVEMENTS) {
    const entry = artwork.items[achievementArtworkKey(set.id, achievement.id)];
    if (!entry) continue;
    const original = await store.avatarAsset(entry.assetId);
    if (!original) throw new Error(`The image for ${achievement.id} is missing from this workspace.`);
    const header = new Uint8Array(await original.slice(0, 24).arrayBuffer());
    const isPng = header.length >= 24 && pngMagic.every((value, index) => header[index] === value);
    const image = isPng && original.size <= 512_000
      ? new Blob([original], { type: 'image/png' })
      : await compactIdentityAvatar(original.type ? original : new Blob([original], { type: isPng ? 'image/png' : 'application/octet-stream' }));
    const bytes = new Uint8Array(await image.arrayBuffer());
    icons[achievement.id] = { png: toBase64(bytes), prompt: entry.prompt };
  }
  return readAchievementSetPack({ format: 'local-agent-lab-achievement-set', version: 1, set, icons });
}
