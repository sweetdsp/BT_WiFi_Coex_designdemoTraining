// Playback and step-through (spec 7B.9). Playback never changes results; it only moves the cursor and reveals blocks.
import type { EngineResult } from '../engine';
import type { Conflict } from '../engine/types';

export const SPEEDS = [0.1, 0.5, 1, 5] as const;
export type Speed = (typeof SPEEDS)[number];

/** At 1x the whole window plays in this many seconds. */
export const SECONDS_PER_WINDOW_AT_1X = 10;

/** Times worth stopping at: every block start and every conflict start, ascending and unique. */
export function eventTimes(result: EngineResult): number[] {
  const s = new Set<number>();
  for (const b of result.blocks) if (!b.optional && b.start < result.config.platform.windowUs) s.add(b.start);
  for (const c of result.conflicts) s.add(c.overlapStart);
  return [...s].sort((a, b) => a - b);
}

export function nextEvent(times: number[], t: number): number | undefined {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; }
  return times[lo];
}

export function prevEvent(times: number[], t: number): number | undefined {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
  return times[lo - 1];
}

/** Move the cursor forward by real elapsed milliseconds at a speed. Stops at the end of the window. */
export function advance(t: number, elapsedMs: number, speed: number, windowUs: number): { t: number; done: boolean } {
  const next = t + (elapsedMs / 1000 / SECONDS_PER_WINDOW_AT_1X) * windowUs * speed;
  return next >= windowUs ? { t: windowUs, done: true } : { t: next, done: false };
}

export interface ReplayStep { n: 1 | 2 | 3 | 4; caption: string; showBlocks: boolean; flashOverlap: boolean; showDecision: boolean; showOutcome: boolean }

/** Conflict replay: the two blocks appear, the overlap flashes, the decision is applied, the outcome is shown. */
export function replaySteps(c: Conflict, names: { bt: string; wifi: string }, winner: string | undefined, outcome: string): ReplayStep[] {
  return [
    { n: 1, caption: `${names.bt} and ${names.wifi} are both due at about the same time.`, showBlocks: true, flashOverlap: false, showDecision: false, showOutcome: false },
    { n: 2, caption: `They overlap for ${c.overlapUs} µs.`, showBlocks: true, flashOverlap: true, showDecision: false, showOutcome: false },
    { n: 3, caption: winner ? `Arbitration applies: ${winner} wins.` : `No arbitration is needed (${c.severity.toLowerCase()}).`, showBlocks: true, flashOverlap: true, showDecision: true, showOutcome: false },
    { n: 4, caption: outcome, showBlocks: true, flashOverlap: false, showDecision: true, showOutcome: true },
  ];
}

/** Blocks revealed so far when playing: those that have started by the cursor. */
export const revealed = (start: number, cursor: number | null, playing: boolean) => !playing || cursor === null || start <= cursor;
