// Time view layout model (spec 7A.11, 7B.3, 7B.4): lanes, block rectangles, level of detail, labels and conflict bands.
import type { EngineResult } from '../engine';
import type { AirBlock, BlockStatus, Conflict, Tech } from '../engine/types';
import { span, xOf, type Viewport } from './viewport';

export interface Lane { id: string; tech: Tech; name: string; index: number; help: string; taskId: string }

export function buildLanes(result: EngineResult, data: { taskIndex: Map<string, { name: string; help: string }> }): { bt: Lane[]; wifi: Lane[] } {
  const bt: Lane[] = [], wifi: Lane[] = [];
  for (const inst of result.config.tasks) {
    const def = data.taskIndex.get(inst.taskId) as unknown as { tech: Tech; name: string; help: string } | undefined;
    if (!def) continue;
    const tech = def.tech;
    const list = tech === 'BT' ? bt : wifi;
    list.push({ id: inst.instanceId, tech, name: result.taskNames[inst.instanceId] ?? def.name, index: list.length, help: def.help, taskId: inst.taskId });
  }
  return { bt, wifi };
}

/** Blocks that are drawn: untriggered retransmission slots are not on the air and are left out. */
export const drawn = (b: AirBlock) => !b.optional;

export interface BlockLook {
  /** Fill style: solid for TX, outlined with a light fill for RX (7B.3). */
  fill: 'SOLID' | 'OUTLINE';
  half: 'TOP' | 'BOTTOM';
  strike: boolean;
  hatch: boolean;
  /** Little marks: granted tick, tolerated open tick, cross, warning triangle, exclamation badge, retry badge. */
  marks: ('GRANTED_TICK' | 'TOLERATED_TICK' | 'CROSS' | 'TRIANGLE' | 'EXCLAMATION' | 'RETRY')[];
  ghost: boolean;
}

export function lookOf(b: AirBlock): BlockLook {
  const lost = b.status === 'DENIED' || b.status === 'LOST' || b.status === 'RETRIED';
  const marks: BlockLook['marks'] = [];
  if (lost) marks.push('CROSS');
  if (b.status === 'GRANTED' && b.contested && b.decisionId) marks.push('GRANTED_TICK');
  if (b.status === 'TOLERATED') marks.push('TOLERATED_TICK');
  if (b.status === 'DEGRADED' || b.corrupted) marks.push('TRIANGLE');
  if (b.warning && !b.corrupted) marks.push('EXCLAMATION');
  if (b.attempt > 1) marks.push('RETRY');
  if (b.status === 'DELAYED' && b.decisionId && b.delayCount) { /* the ghost and arrow show the delay */ }
  return {
    fill: b.dir === 'TX' ? 'SOLID' : 'OUTLINE',
    half: b.dir === 'TX' ? 'TOP' : 'BOTTOM',
    strike: lost,
    hatch: b.status === 'DEGRADED' || !!b.corrupted,
    marks,
    ghost: b.status === 'DELAYED' && b.plannedStart !== b.start,
  };
}

/** Text inside a block, by order of preference: packet kind and channel, kind only, nothing (7B.4). */
export function labelFor(b: AirBlock, widthPx: number, charPx = 7): string {
  const full = `${b.kind} ch${b.channelIndex}`;
  if (widthPx >= full.length * charPx + 8) return full;
  if (widthPx >= String(b.kind).length * charPx + 8) return String(b.kind);
  return '';
}

/** Blocks overlapping the viewport. The list must be sorted by start. Ghosts of delayed blocks are handled separately. */
export function inView(blocks: AirBlock[], v: Viewport): AirBlock[] {
  const out: AirBlock[] = [];
  for (const b of blocks) {
    if (b.start >= v.end) break;
    if (b.start + b.duration > v.start) out.push(b);
  }
  return out;
}

export type LodMode = 'BLOCKS' | 'DENSITY';

/** Switch to density bars when blocks are too small to read or too many to draw (7B.4). */
export function lodMode(visible: AirBlock[], v: Viewport, widthPx: number, opts = { minBlockPx: 2, maxBlocks: 1500 }): LodMode {
  if (visible.length === 0) return 'BLOCKS';
  if (visible.length > opts.maxBlocks) return 'DENSITY';
  const avg = (visible.reduce((a, b) => a + b.duration, 0) / visible.length / span(v)) * widthPx;
  return avg < opts.minBlockPx ? 'DENSITY' : 'BLOCKS';
}

export interface DensityBar { x: number; w: number; pct: number }

/** Airtime share per bucket for one lane, for the density mode. */
export function densityBars(blocks: AirBlock[], v: Viewport, widthPx: number, bucketPx = 4): DensityBar[] {
  const n = Math.max(1, Math.ceil(widthPx / bucketPx));
  const size = span(v) / n;
  const acc = new Float64Array(n);
  for (const b of blocks) {
    if (b.start >= v.end) break;
    const e = b.start + b.duration;
    if (e <= v.start) continue;
    const first = Math.max(0, Math.floor((b.start - v.start) / size));
    const last = Math.min(n - 1, Math.floor((e - v.start) / size));
    for (let i = first; i <= last; i++) {
      const lo = Math.max(b.start, v.start + i * size), hi = Math.min(e, v.start + (i + 1) * size);
      if (hi > lo) acc[i] += hi - lo;
    }
  }
  const bars: DensityBar[] = [];
  for (let i = 0; i < n; i++) if (acc[i] > 0) bars.push({ x: i * bucketPx, w: bucketPx, pct: Math.min(100, (acc[i] / size) * 100) });
  return bars;
}

export interface Band { conflict: Conflict; number: number; x: number; w: number }

/** Conflict regions as vertical bands, numbered to match the conflict list (7B.4). */
export function bandsFor(conflicts: Conflict[], v: Viewport, widthPx: number): Band[] {
  const out: Band[] = [];
  conflicts.forEach((c, i) => {
    if (c.overlapEnd <= v.start || c.overlapStart >= v.end) return;
    const x0 = Math.max(0, xOf(v, c.overlapStart, widthPx)), x1 = Math.min(widthPx, xOf(v, c.overlapEnd, widthPx));
    out.push({ conflict: c, number: i + 1, x: x0, w: Math.max(2, x1 - x0) });
  });
  return out;
}

/** Tiny coloured ticks for the minimap strip. */
export function minimapTicks(conflicts: Conflict[], windowUs: number, widthPx: number): { x: number; severity: Conflict['severity'] }[] {
  return conflicts.map((c) => ({ x: (c.overlapStart / windowUs) * widthPx, severity: c.severity }));
}

/** Blocks of a conflict's two sides plus the partners of any hovered block (7B.4 cross-links). */
export function partnersOf(blockId: string, conflicts: Conflict[]): string[] {
  const out = new Set<string>();
  for (const c of conflicts) {
    if (c.btBlockId === blockId) out.add(c.wifiBlockId);
    if (c.wifiBlockId === blockId) out.add(c.btBlockId);
  }
  return [...out];
}

export const STATUS_WORD: Record<BlockStatus, string> = {
  PLANNED: 'Planned', GRANTED: 'Granted', DENIED: 'Denied', DELAYED: 'Delayed', TOLERATED: 'Tolerated', LOST: 'Lost', RETRIED: 'Retried', DEGRADED: 'Degraded',
};
