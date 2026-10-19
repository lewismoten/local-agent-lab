export type ThemeFont = 'sans' | 'serif' | 'mono';
export type ThemeMotion = 'none' | 'subtle' | 'full';
export type ThemeColors = {
  background: string;
  panel: string;
  raised: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
};
export type CustomTheme = {
  version: 1;
  id: string;
  name: string;
  description: string;
  prompt: string;
  tags: string[];
  colors: ThemeColors;
  font: ThemeFont;
  radius: number;
  motion: ThemeMotion;
  readingScale: number;
  wallpaper?: string;
};
export type ThemePack = { format: 'local-agent-lab-theme'; version: 1; theme: CustomTheme };

const colorKeys: (keyof ThemeColors)[] = ['background', 'panel', 'raised', 'text', 'muted', 'accent', 'border'];
const hexColor = /^#[0-9a-f]{6}$/i;
const safeId = /^[a-z0-9][a-z0-9-]{0,63}$/;
const pngPrefix = 'data:image/png;base64,';

/** Embedded PNGs are bounded so a workspace pack stays portable and CSS values stay inert. */
export function cleanThemeWallpaper(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(pngPrefix) || value.length > 140_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.slice(pngPrefix.length))) return null;
  let binary: string;
  try { binary = atob(value.slice(pngPrefix.length)); }
  catch { return null; }
  if (binary.length < 45 || binary.length > 100_000 || binary.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || binary.slice(12, 16) !== 'IHDR' || binary.slice(-8, -4) !== 'IEND') return null;
  const dimension = (offset: number) => ((binary.charCodeAt(offset) * 0x1000000) + (binary.charCodeAt(offset + 1) << 16) + (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3)) >>> 0;
  const width = dimension(16), height = dimension(20);
  return width > 0 && height > 0 && width <= 1600 && height <= 1600 && width * height <= 1_600_000 ? value : null;
}

export function cleanCustomTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<CustomTheme>;
  if (input.version !== 1 || typeof input.id !== 'string' || !safeId.test(input.id) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || typeof input.description !== 'string' || input.description.length > 240 || typeof input.prompt !== 'string' || input.prompt.length > 2000) return null;
  if (!input.colors || typeof input.colors !== 'object' || colorKeys.some(key => typeof input.colors?.[key] !== 'string' || !hexColor.test(input.colors[key]))) return null;
  if (!['sans', 'serif', 'mono'].includes(input.font || '') || !['none', 'subtle', 'full'].includes(input.motion || '') || !Number.isInteger(input.radius) || input.radius! < 0 || input.radius! > 24) return null;
  const readingScale = input.readingScale ?? 100;
  if (!Number.isInteger(readingScale) || readingScale < 90 || readingScale > 130) return null;
  if (input.wallpaper !== undefined && cleanThemeWallpaper(input.wallpaper) === null) return null;
  if (!Array.isArray(input.tags) || input.tags.length > 12 || input.tags.some(tag => typeof tag !== 'string' || tag.length > 32)) return null;
  return {
    version: 1, id: input.id, name: input.name.trim(), description: input.description.trim(), prompt: input.prompt.trim(),
    tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))],
    colors: Object.fromEntries(colorKeys.map(key => [key, input.colors![key]!.toLowerCase()])) as ThemeColors,
    font: input.font!, radius: input.radius!, motion: input.motion!, readingScale,
    ...(input.wallpaper ? { wallpaper: input.wallpaper } : {}),
  };
}

export function cleanCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const themes: CustomTheme[] = [];
  for (const item of value.slice(0, 24)) {
    const theme = cleanCustomTheme(item);
    if (theme && !themes.some(saved => saved.id === theme.id)) themes.push(theme);
  }
  return themes;
}

export function newCustomTheme(): CustomTheme {
  return {
    version: 1, id: crypto.randomUUID(), name: 'New theme', description: '', prompt: '', tags: [],
    colors: { background: '#10141b', panel: '#1a2029', raised: '#25303c', text: '#eef3f8', muted: '#b7c5d1', accent: '#83ddcf', border: '#536879' },
    font: 'sans', radius: 8, motion: 'subtle', readingScale: 100,
  };
}

export function themePack(theme: CustomTheme): ThemePack { return { format: 'local-agent-lab-theme', version: 1, theme }; }
export function readThemePack(value: unknown): CustomTheme | null {
  if (!value || typeof value !== 'object') return null;
  const pack = value as Partial<ThemePack>;
  return pack.format === 'local-agent-lab-theme' && pack.version === 1 ? cleanCustomTheme(pack.theme) : null;
}

export function colorLuminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function colorContrast(first: string, second: string): number {
  const a = colorLuminance(first), b = colorLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Theme variables stay as validated values; theme packs never inject CSS text. */
export function customThemeVariables(theme: CustomTheme): Record<string, string> {
  const { colors } = theme;
  const font = theme.font === 'serif' ? "Georgia, 'Times New Roman', serif" : theme.font === 'mono' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'Inter, system-ui, sans-serif';
  return {
    '--theme-background': colors.background, '--theme-panel': colors.panel, '--theme-raised': colors.raised,
    '--theme-text': colors.text, '--theme-muted': colors.muted, '--theme-accent': colors.accent,
    '--theme-border': colors.border, '--theme-font': font, '--theme-radius': `${theme.radius}px`,
    '--theme-reading-size': `${(13 * theme.readingScale / 100).toFixed(1)}px`,
    '--theme-editor-size': `${(12 * theme.readingScale / 100).toFixed(1)}px`,
    '--theme-wallpaper': theme.wallpaper && cleanThemeWallpaper(theme.wallpaper) ? `url("${theme.wallpaper}")` : 'none',
  };
}
