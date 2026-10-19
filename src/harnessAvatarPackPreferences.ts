export type AvatarPackPreferences = { version: 1; styles: string[]; directions: string[] };

export const AVATAR_STYLE_PRESETS = [
  'Watercolor', 'Ink drawing', 'Oil painting', 'Pencil sketch', 'Gouache', 'Paper collage',
  'Pixel art', 'Low poly', 'Clay sculpture', 'Woodcut', 'Stained glass', 'Art nouveau',
  'Comic book', 'Anime', 'Cartoon', 'Photorealistic', 'Cinematic', 'Cyberpunk',
  'Retro futurism', 'Fantasy illustration', 'Minimal vector', '3D render',
];

export const AVATAR_DIRECTION_PRESETS = [
  'Friendly', 'Mysterious', 'Playful', 'Thoughtful', 'Adventurous', 'Scholarly',
  'Expressive eyes', 'Unusual silhouette', 'Soft lighting', 'Bold colors',
];

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value.filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim().replace(/\s+/g, ' '))
    .filter(entry => entry.length > 0 && entry.length <= 60 && !/[\r\n<>]/.test(entry));
  return [...new Map(entries.map(entry => [entry.toLocaleLowerCase(), entry])).values()].slice(0, 30);
}

export function cleanAvatarPackPreferences(value: unknown): AvatarPackPreferences {
  const input = value && typeof value === 'object' ? value as Partial<AvatarPackPreferences> : {};
  return { version: 1, styles: cleanList(input.styles), directions: cleanList(input.directions) };
}
