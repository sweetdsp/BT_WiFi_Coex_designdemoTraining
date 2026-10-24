// Time axis model for the time view (spec 7B.4): zoom, pan, presets, adaptive ticks and slot lines.
import { ticks } from 'd3-array';

export interface Viewport { start: number; end: number }

/** Smallest span the user can zoom to: 50 microseconds across the screen (7B.4). */
export const MIN_SPAN_US = 50;
export const SLOT_US = 625;

export const span = (v: Viewport) => v.end - v.start;

export function clampViewport(v: Viewport, windowUs: number): Viewport {
  const s = Math.min(windowUs, Math.max(Math.min(MIN_SPAN_US, windowUs), span(v)));
  let start = v.start;
  if (start < 0) start = 0;
  if (start + s > windowUs) start = windowUs - s;
  return { start, end: start + s };
}

/** Zoom keeping the time under the pointer fixed. factor below 1 zooms in. */
export function zoomAt(v: Viewport, anchorUs: number, factor: number, windowUs: number): Viewport {
  const s = span(v) * factor;
  const k = span(v) === 0 ? 0.5 : (anchorUs - v.start) / span(v);
  return clampViewport({ start: anchorUs - k * s, end: anchorUs - k * s + s }, windowUs);
}

export function pan(v: Viewport, deltaUs: number, windowUs: number): Viewport {
  return clampViewport({ start: v.start + deltaUs, end: v.end + deltaUs }, windowUs);
}

export type PresetName = 'whole' | '10ms' | '1ms' | 'slot';
export const PRESET_LABELS: Record<PresetName, string> = { whole: 'Whole window', '10ms': '10 ms', '1ms': '1 ms', slot: 'Single slot' };

/** Preset zoom levels, centred on a time (default the middle of the current view). */
export function presetViewport(name: PresetName, windowUs: number, centreUs: number): Viewport {
  const s = name === 'whole' ? windowUs : name === '10ms' ? 10_000 : name === '1ms' ? 1_000 : SLOT_US;
  if (name === 'slot') {
    const slotStart = Math.floor(centreUs / SLOT_US) * SLOT_US;
    return clampViewport({ start: slotStart, end: slotStart + SLOT_US }, windowUs);
  }
  return clampViewport({ start: centreUs - s / 2, end: centreUs + s / 2 }, windowUs);
}

export interface Tick { t: number; label: string; major: boolean }

export function formatTime(us: number, stepUs: number): string {
  if (stepUs >= 1000) {
    const ms = us / 1000;
    const dp = stepUs >= 10_000 ? 0 : stepUs >= 1000 ? (stepUs % 1000 === 0 ? 0 : 1) : 2;
    return `${ms.toFixed(dp)} ms`;
  }
  return `${Math.round(us)} µs`;
}

/** Ticks whose spacing adapts to the zoom level, about one per 90 pixels. */
export function timeTicks(v: Viewport, widthPx: number): { ticks: Tick[]; stepUs: number } {
  const want = Math.max(2, Math.floor(widthPx / 90));
  const raw = ticks(v.start, v.end, want);
  const stepUs = raw.length > 1 ? raw[1] - raw[0] : span(v);
  return { ticks: raw.map((t) => ({ t, label: formatTime(t, stepUs), major: true })), stepUs };
}

export interface SlotLine { t: number; n: number }

/** Bluetooth slot boundaries with slot numbers, drawn when zoomed in far enough (about 12 px per slot or more). */
export function slotLines(v: Viewport, widthPx: number): SlotLine[] {
  if ((SLOT_US / span(v)) * widthPx < 12) return [];
  const out: SlotLine[] = [];
  for (let n = Math.floor(v.start / SLOT_US); n * SLOT_US <= v.end; n++) if (n * SLOT_US >= v.start) out.push({ t: n * SLOT_US, n });
  return out;
}

export const xOf = (v: Viewport, t: number, widthPx: number) => ((t - v.start) / span(v)) * widthPx;
export const tOf = (v: Viewport, x: number, widthPx: number) => v.start + (x / widthPx) * span(v);
