import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanCustomTheme, cleanCustomThemes, cleanThemeWallpaper, colorContrast, colorLuminance, customThemeVariables, newCustomTheme, readThemePack, themePack } from '../src/customTheme.ts';
import { cleanThemeId } from '../src/themeOptions.ts';
import { applyThemeStage, repairThemeContrast, themeStageRequest } from '../src/themeGeneration.ts';

test('theme packs round-trip without losing a workspace theme', () => {
  const theme = { ...newCustomTheme(), name: 'Ink garden', tags: ['Ink', 'Quiet'], colors: { ...newCustomTheme().colors, accent: '#Aa7744' } };
  const parsed = readThemePack(JSON.parse(JSON.stringify(themePack(theme))));
  assert.equal(parsed?.name, 'Ink garden');
  assert.equal(parsed?.colors.accent, '#aa7744');
  assert.equal(cleanThemeId(`custom:${theme.id}`, [parsed]), `custom:${theme.id}`);
  assert.equal(cleanThemeId(`custom:${theme.id}`), 'cyberpunk');
});

test('theme packs reject injected CSS, invalid colors, and duplicate ids', () => {
  const theme = newCustomTheme();
  assert.equal(cleanCustomTheme({ ...theme, colors: { ...theme.colors, accent: 'url(https://example.com/track)' } }), null);
  assert.equal(cleanCustomTheme({ ...theme, id: 'bad/id' }), null);
  assert.equal(readThemePack({ ...themePack(theme), format: 'unknown' }), null);
  assert.equal(cleanCustomThemes([theme, theme]).length, 1);
  assert.equal(cleanCustomTheme({ ...theme, readingScale: 500 }), null);
});

test('older theme packs default reading size while new packs retain it', () => {
  const theme = newCustomTheme();
  const legacy = themePack(theme);
  delete legacy.theme.readingScale;
  assert.equal(readThemePack(legacy)?.readingScale, 100);
  const enlarged = readThemePack(themePack({ ...theme, readingScale: 125 }));
  assert.equal(enlarged?.readingScale, 125);
  assert.equal(customThemeVariables(enlarged)['--theme-reading-size'], '16.3px');
  assert.equal(customThemeVariables({ ...theme, readingScale: 130 })['--theme-reading-size'], '16.9px');
});

test('theme packs keep a bounded embedded PNG and reject unsafe or oversized media', async () => {
  const bytes = await readFile(new URL('../docs/logo-256.png', import.meta.url));
  const wallpaper = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal(cleanThemeWallpaper(wallpaper), wallpaper);
  const theme = cleanCustomTheme({ ...newCustomTheme(), wallpaper });
  assert.equal(readThemePack(JSON.parse(JSON.stringify(themePack(theme))))?.wallpaper, wallpaper);
  assert.match(customThemeVariables(theme)['--theme-wallpaper'], /^url\("data:image\/png;base64,/);
  assert.equal(cleanThemeWallpaper('url(https://example.com/picture.png)'), null);
  assert.equal(cleanThemeWallpaper('data:image/svg+xml;base64,PHN2Zz4='), null);
  const oversized = Buffer.from(bytes);
  oversized.writeUInt32BE(2000, 16);
  assert.equal(cleanThemeWallpaper(`data:image/png;base64,${oversized.toString('base64')}`), null);
});

test('theme editor contrast uses the actual foreground and panel colors', () => {
  assert.ok(colorContrast('#ffffff', '#000000') > 20);
  assert.equal(colorContrast('#777777', '#777777'), 1);
  assert.equal(colorLuminance('#000000'), 0);
  assert.equal(colorLuminance('#ffffff'), 1);
});

test('AI theme stages accept reviewed values and reject unreadable or injected output', () => {
  const original = newCustomTheme();
  const named = applyThemeStage('identity', original, '```json\n{"name":"Night garden","description":"Quiet botanical lights","tags":["botanical","calm"]}\n```');
  assert.equal(named.name, 'Night garden');
  assert.equal(original.name, 'New theme');
  const palette = applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, accent: '#aabbcc' } }));
  assert.equal(palette.colors.accent, '#aabbcc');
  const styled = applyThemeStage('details', palette, '{"font":"serif","radius":12,"motion":"subtle","readingScale":115}');
  assert.equal(styled.font, 'serif');
  assert.equal(styled.readingScale, 115);
  assert.match(themeStageRequest('colors', styled).user, /4\.5:1/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, text: '#1a2029' } })), /too hard to read/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, muted: '#1a2029' } })), /too hard to read/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, accent: '#10141b' } })), /accent is too hard to see/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, panel: '#dddddd' } })), /too bright/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, text: '#10141b' } })), /too hard to read/);
  assert.throws(() => applyThemeStage('colors', named, JSON.stringify({ colors: { ...named.colors, accent: 'url(https://example.com)' } })), /outside the supported range/);
  assert.throws(() => applyThemeStage('details', named, '{"font":"serif","radius":300,"motion":"full"}'), /outside the supported range/);
});

test('generated palettes repair weak muted text and accents without accepting arbitrary CSS', () => {
  const draft = newCustomTheme();
  const response = JSON.stringify({ colors: { background: '#1a1d23', panel: '#7f7f7f', raised: '#999999', text: '#141414', muted: '#454f55', accent: '#20252a', border: '#4f5154' } });
  const repaired = repairThemeContrast(draft, response);
  assert.ok(repaired);
  const theme = applyThemeStage('colors', draft, repaired);
  assert.ok(colorContrast(theme.colors.muted, theme.colors.panel) >= 4.5);
  assert.ok(colorContrast(theme.colors.muted, theme.colors.raised) >= 4.5);
  assert.ok(colorContrast(theme.colors.text, theme.colors.background) >= 4.5);
  assert.ok(colorContrast(theme.colors.muted, theme.colors.background) >= 4.5);
  assert.ok(colorLuminance(theme.colors.panel) <= 0.14);
  assert.ok(colorContrast(theme.colors.accent, theme.colors.background) >= 4.5);
  assert.equal(repairThemeContrast(draft, JSON.stringify({ colors: { ...theme.colors, accent: 'url(https://example.com)' } })), null);
});
