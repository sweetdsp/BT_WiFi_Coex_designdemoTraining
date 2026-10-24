// Design tokens (spec 7B.3). One data file for both themes; everything in the UI takes its colours from here.
import raw from '../data/designTokens.json';
import { shade } from './color';

export type ThemeName = 'light' | 'dark';
export type ThemeColors = Record<string, string | number>;

export interface Cue { id: string; meaning: string; color: string; pattern: string; shape: string; where: string; example: string }

export const tokens = raw as unknown as {
  typography: { ui: string; mono: string; basePx: number; diagramMinPx: number };
  spacing: { gridPx: number; radiusPx: number };
  animation: { maxMs: number };
  laneTint: { maxDarken: number; steps: number };
  themes: Record<ThemeName, Record<string, string | number>>;
  cues: Cue[];
};

export const colorOf = (theme: ThemeName, key: string): string => String(tokens.themes[theme][key]);

/** A slightly different tint of the technology colour for each task lane, so the technology stays obvious (7B.3). */
export function laneTint(theme: ThemeName, tech: 'BT' | 'WIFI', index: number): string {
  const base = colorOf(theme, tech === 'BT' ? 'bt' : 'wifi');
  const t = tokens.laneTint;
  const step = (index % t.steps) / Math.max(1, t.steps - 1);
  // Light theme darkens, dark theme lightens, so contrast with the lane background never drops.
  return shade(base, theme === 'light' ? step * t.maxDarken : -step * t.maxDarken);
}

/** CSS custom properties for a theme. */
export function cssVariables(theme: ThemeName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens.themes[theme])) out[`--c-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`] = String(v);
  out['--font-ui'] = tokens.typography.ui;
  out['--font-mono'] = tokens.typography.mono;
  out['--grid'] = `${tokens.spacing.gridPx}px`;
  out['--radius'] = `${tokens.spacing.radiusPx}px`;
  return out;
}
