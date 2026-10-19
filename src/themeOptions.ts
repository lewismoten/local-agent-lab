export const THEMES = [
  { id: 'cyberpunk', name: 'Signal', description: 'Neon cyan, violet, and moving circuitry.' },
  { id: 'plain', name: 'Plain dark', description: 'Quiet charcoal surfaces with minimal decoration.' },
  { id: 'manuscript', name: 'Manuscript', description: 'Warm ink, copper, and a bookish reading room.' },
] as const;

export type BuiltInThemeId = (typeof THEMES)[number]['id'];
export type ThemeId = BuiltInThemeId | `custom:${string}`;
export const cleanThemeId = (value: unknown, customThemes: CustomTheme[] = []): ThemeId =>
  THEMES.some(theme => theme.id === value) || customThemes.some(theme => `custom:${theme.id}` === value) ? value as ThemeId : 'cyberpunk';
import type { CustomTheme } from './customTheme.ts';

