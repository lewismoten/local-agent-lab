import type { AvatarAsset, AvatarAssetInput } from './harnessAvatarLibrary.ts';

const format = 'local-agent-lab-avatar-pack';
const pngSignature = '\x89PNG\r\n\x1a\n';

export type ImportedAvatar = { image: Blob; input: AvatarAssetInput };
export type ImportedAvatarPack = { name: string; avatars: ImportedAvatar[] };

function validName(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 80 && !/[\r\n<>]/.test(value);
}

function validPng(binary: string): boolean {
  return binary.length >= 45 && binary.length <= 512_000 && binary.slice(0, 8) === pngSignature && binary.slice(-8, -4) === 'IEND';
}

function encodePng(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  if (!validPng(binary)) throw new Error('An avatar image is not a supported PNG.');
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function exportAvatarPack(name: string, assets: AvatarAsset[], load: (id: string) => Promise<Blob | null>): Promise<string> {
  if (!validName(name) || !assets.length || assets.length > 24) throw new Error('Choose a named pack with 1–24 avatars.');
  const avatars = [];
  for (const asset of assets) {
    const image = await load(asset.id);
    if (!image || image.size > 512_000) throw new Error(`Image missing or too large: ${asset.title}`);
    avatars.push({ title: asset.title, tags: asset.tags, source: asset.source, ...(asset.prompt ? { prompt: asset.prompt } : {}), image: encodePng(new Uint8Array(await image.arrayBuffer())) });
  }
  return JSON.stringify({ format, version: 1, name: name.trim(), avatars });
}

export function importAvatarPack(value: unknown): ImportedAvatarPack {
  if (!value || typeof value !== 'object') throw new Error('Invalid avatar pack.');
  const pack = value as Record<string, unknown>;
  if (pack.format !== format || pack.version !== 1 || !validName(pack.name) || !Array.isArray(pack.avatars) || !pack.avatars.length || pack.avatars.length > 24) throw new Error('This avatar pack uses an unsupported format.');
  const avatars: ImportedAvatar[] = [];
  let total = 0;
  for (const entry of pack.avatars) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid avatar entry.');
    const avatar = entry as Record<string, unknown>;
    if (!validName(avatar.title) || !Array.isArray(avatar.tags) || avatar.tags.length > 12 || avatar.tags.some(tag => typeof tag !== 'string' || tag.length > 60)
      || (avatar.source !== 'generated' && avatar.source !== 'uploaded')
      || (avatar.prompt !== undefined && (typeof avatar.prompt !== 'string' || avatar.prompt.length > 1200))
      || typeof avatar.image !== 'string' || !avatar.image.startsWith('data:image/png;base64,') || avatar.image.length > 690_000) throw new Error('Invalid avatar metadata or image.');
    let binary: string;
    try { binary = atob(avatar.image.slice('data:image/png;base64,'.length)); }
    catch { throw new Error('Invalid avatar image encoding.'); }
    if (!validPng(binary)) throw new Error('An avatar image is not a supported PNG.');
    total += binary.length;
    if (total > 12_288_000) throw new Error('Avatar pack images exceed 12 MB.');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    avatars.push({ image: new Blob([bytes], { type: 'image/png' }), input: { title: avatar.title, tags: avatar.tags, source: avatar.source, ...(avatar.prompt ? { prompt: avatar.prompt } : {}) } });
  }
  return { name: pack.name.trim(), avatars };
}
