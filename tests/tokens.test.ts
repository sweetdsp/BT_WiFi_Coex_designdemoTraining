import { describe, expect, it } from 'vitest';
import { contrast, deltaE, hexToRgb, simulate, type CvdType } from '../src/lib/color';
import { colorOf, cssVariables, laneTint, tokens, type ThemeName } from '../src/lib/tokens';

const themes: ThemeName[] = ['light', 'dark'];
const cvd: CvdType[] = ['deuteranopia', 'protanopia', 'tritanopia'];

describe('colour maths', () => {
  it('contrast of black on white is 21 and of a colour with itself is 1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#1F6FEB', '#1F6FEB')).toBeCloseTo(1, 5);
  });
  it('simulation leaves greys alone and changes saturated colours', () => {
    for (const t of cvd) expect(deltaE(simulate('#808080', t), '#808080')).toBeLessThan(3);
    expect(deltaE(simulate('#D93025', 'deuteranopia'), '#D93025')).toBeGreaterThan(10);
  });
  it('parses short and long hex', () => {
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
  });
});

describe.each(themes)('%s theme tokens (7B.3, UX-4)', (theme) => {
  const c = (k: string) => colorOf(theme, k);

  it('text meets 4.5 to 1 against every background it sits on', () => {
    for (const fg of ['text', 'textMuted']) for (const bg of ['bg', 'panel', 'laneBg', 'laneAlt']) expect(contrast(c(fg), c(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('technology blocks and status marks meet 3 to 1 against the lane background', () => {
    for (const k of ['bt', 'wifi', 'denied', 'degraded', 'delayedGhost', 'granted', 'selected']) {
      for (const bg of ['laneBg', 'laneAlt']) expect(contrast(c(k), c(bg)), `${k} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the grey of adaptive-hopping channels (a fill, not a block) has a darker dotted mark that meets 3 to 1 on the panel', () => {
    for (const bg of ['bg', 'panel']) expect(contrast(c('afhMark'), c(bg))).toBeGreaterThanOrEqual(3);
  });
  it('every lane tint of a technology still meets 3 to 1 against the lane background', () => {
    for (const tech of ['BT', 'WIFI'] as const) {
      for (let i = 0; i < 12; i++) for (const bg of ['laneBg', 'laneAlt']) expect(contrast(laneTint(theme, tech, i), c(bg)), `${tech} lane ${i} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('lane tints are different from each other but stay clearly the same technology', () => {
    const tints = Array.from({ length: tokens.laneTint.steps }, (_, i) => laneTint(theme, 'BT', i));
    expect(new Set(tints).size).toBe(tokens.laneTint.steps);
    for (const t of tints) expect(deltaE(t, c('bt'))).toBeLessThan(25);
    for (const t of tints) expect(deltaE(t, c('wifi'))).toBeGreaterThan(30);
  });
  it('focus outline is visible on the page background (3 to 1)', () => {
    expect(contrast(c('focus'), c('bg'))).toBeGreaterThanOrEqual(3);
  });
  it('Bluetooth and Wi-Fi stay clearly different under deuteranopia, protanopia and tritanopia', () => {
    for (const t of cvd) expect(deltaE(simulate(c('bt'), t), simulate(c('wifi'), t)), t).toBeGreaterThanOrEqual(25);
  });
  it('the other cue colours stay different from the technology colours and from each other under all three simulations', () => {
    const keys = ['bt', 'wifi', 'denied', 'degraded', 'afhRemoved'];
    for (const t of cvd) {
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const d = deltaE(simulate(c(keys[i]), t), simulate(c(keys[j]), t));
        // Amber is the colour of the cross-hatch laid over a block, never a block fill. Against red and orange it is close for
        // red-green colour blindness, so those pairs are also told apart by pattern (hatch against strike, hatch over a solid block).
        const hatch = keys[i] === 'degraded' || keys[j] === 'degraded';
        expect(d, `${keys[i]} vs ${keys[j]} (${t})`).toBeGreaterThanOrEqual(hatch ? 4 : 12);
      }
    }
  });
  it('light and dark themes define exactly the same tokens', () => {
    expect(Object.keys(tokens.themes.light).sort()).toEqual(Object.keys(tokens.themes.dark).sort());
  });
  it('exposes CSS variables for every token', () => {
    const vars = cssVariables(theme);
    expect(vars['--c-bt']).toBe(c('bt'));
    expect(vars['--c-lane-bg']).toBe(c('laneBg'));
    expect(vars['--grid']).toBe('8px');
  });
});

describe('UX-3: every colour cue has a matching pattern or shape (works in greyscale)', () => {
  it('lists every cue of the 7B.3 table', () => {
    expect(tokens.cues.map((c) => c.id).sort()).toEqual(['afhRemoved', 'bluetooth', 'conflict', 'degraded', 'delayed', 'denied', 'granted', 'retry', 'selected', 'tolerated', 'warning', 'wifi'].sort());
  });
  it('each cue has a pattern, a shape, a place and an example, and its colour is a token', () => {
    for (const cue of tokens.cues) {
      expect(cue.pattern.length, cue.id).toBeGreaterThan(3);
      expect(cue.shape.length, cue.id).toBeGreaterThan(3);
      expect(cue.where.length).toBeGreaterThan(3);
      expect(cue.example.length).toBeGreaterThan(10);
      expect(tokens.themes.light[cue.color], cue.id).toBeDefined();
    }
  });
  it('the spec colours are used for the default palette', () => {
    const l = (k: string) => colorOf('light', k).toUpperCase();
    expect([l('bt'), l('wifi'), l('conflict'), l('degraded'), l('warning'), l('afhRemoved')]).toEqual(['#1F6FEB', '#E8710A', '#D93025', '#B06A00', '#F9AB00', '#9AA0A6']);
  });
  it('typography and spacing follow 7B.2: 14 px base, 12 px diagram minimum, 8 px grid, 6 px radius, animation at most 400 ms', () => {
    expect(tokens.typography.basePx).toBe(14);
    expect(tokens.typography.diagramMinPx).toBe(12);
    expect(tokens.spacing).toEqual({ gridPx: 8, radiusPx: 6 });
    expect(tokens.animation.maxMs).toBe(400);
  });
});
