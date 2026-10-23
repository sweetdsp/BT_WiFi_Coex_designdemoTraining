// Stage D: overlap detection and conflict classes (spec 7A.7, SR-20 to SR-22).
// For every Bluetooth block and Wi-Fi block that overlap in time: run the interaction test, find the
// direction class, then look up the severity in the data table. Retransmission blocks that were never
// triggered (optional) are not on the air and are skipped.
import type { DataBundle } from './data';
import { footprint, footprintsOverlap } from './stageB';
import type { AirBlock, Conflict, DirClass, InteractionTest, PlatformColumn, PlatformConfig, ScenarioConfig } from './types';

export interface PlatformCase {
  column: PlatformColumn;
  /** Reasons the paths are shared, in the order the spec lists them. */
  shared: InteractionTest[];
  lowIsolation: boolean;
}

/** Decide which platform column applies to a pair. Shared antenna, shared core, or no simultaneous TX/RX force turn-taking. */
export function platformCase(p: PlatformConfig, bt: Pick<AirBlock, 'dir'>, wifi: Pick<AirBlock, 'dir'>): PlatformCase {
  const shared: InteractionTest[] = [];
  if (p.antennaMode === 'SHARED') shared.push('ANTENNA');
  if (p.coreMode !== 'CONCURRENT') shared.push('CORE');
  if (bt.dir === 'RX' && wifi.dir === 'TX' && !p.simultaneousWifiTxBtRx) shared.push('SIMULTANEOUS');
  const lowIsolation = p.isolationDb < p.interactionThresholdDb;
  const column: PlatformColumn = shared.length > 0 ? 'SHARED' : lowIsolation ? 'SEP_LOW' : 'SEP_HIGH';
  return { column, shared, lowIsolation };
}

export const dirClassOf = (bt: AirBlock, wifi: AirBlock): DirClass => `${bt.dir}_${wifi.dir}` as DirClass;

/** Time-overlapping BT and Wi-Fi block pairs. Efficient for tens of thousands of blocks. */
function* overlappingPairs(bt: AirBlock[], wifi: AirBlock[]): Generator<[AirBlock, AirBlock]> {
  const w = [...wifi].sort((a, b) => a.start - b.start);
  const maxEnd: number[] = [];
  let m = -Infinity;
  for (const b of w) { m = Math.max(m, b.start + b.duration); maxEnd.push(m); }
  for (const b of bt) {
    const s = b.start, e = b.start + b.duration;
    // First Wi-Fi block that starts at or after the end of this block.
    let lo = 0, hi = w.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (w[mid].start < e) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0 && maxEnd[i] > s; i--) {
      if (w[i].start + w[i].duration > s) yield [b, w[i]];
    }
  }
}

/** Classify one Bluetooth/Wi-Fi pair that overlaps in time. Returns undefined when the pair does not interact. */
export function classifyPair(b: AirBlock, w: AirBlock, p: PlatformConfig, data: DataBundle): Omit<Conflict, 'id'> | undefined {
  const oStart = Math.max(b.start, w.start);
  const oEnd = Math.min(b.start + b.duration, w.start + w.duration);
  if (oEnd <= oStart) return undefined;
  const labels = data.conflictSeverity.testLabels;
  const freq = footprintsOverlap(footprint(b), footprint(w), p.guardMHz);
  const pc = platformCase(p, b, w);
  const tests: InteractionTest[] = ['TIME'];
  if (freq) tests.push('FREQUENCY');
  tests.push(...pc.shared);
  if (pc.lowIsolation) tests.push('ISOLATION');
  // The pair interacts if frequency overlaps, the path is shared, or isolation is below the threshold.
  if (tests.length === 1) return undefined;
  const dirClass = dirClassOf(b, w);
  const row = data.conflictSeverity.rows.find((r) => r.dirClass === dirClass && r.freqOverlap === freq);
  if (!row) throw new Error(`No severity row for ${dirClass} freq=${freq}`);
  const cell = row[pc.column];
  const why = pc.shared.length ? pc.shared.map((t) => labels[t]).join(' and ') : freq ? labels.FREQUENCY : labels.ISOLATION;
  return {
    btBlockId: b.id, wifiBlockId: w.id, btTaskId: b.taskId, wifiTaskId: w.taskId,
    overlapStart: oStart, overlapEnd: oEnd, overlapUs: oEnd - oStart, freqOverlap: freq, dirClass, tests, column: pc.column,
    severity: cell.severity, reason: `${cell.text} (Triggered by: ${why}.)`, label: cell.label,
  };
}

/** True when blocks on the shared path must take turns. */
export function isHard(b: AirBlock, w: AirBlock, p: PlatformConfig, data: DataBundle): boolean {
  return classifyPair(b, w, p, data)?.severity === 'HARD';
}

export function detectConflicts(blocks: AirBlock[], config: ScenarioConfig, data: DataBundle): Conflict[] {
  const p = config.platform;
  // Optional blocks are retransmission opportunities that were never triggered; a retry is a new, non-optional block.
  const set = blocks.filter((b) => !b.optional);
  const bt = set.filter((b) => b.tech === 'BT');
  const wifi = set.filter((b) => b.tech === 'WIFI');
  const found: Conflict[] = [];
  for (const [b, w] of overlappingPairs(bt, wifi)) {
    const c = classifyPair(b, w, p, data);
    if (c) found.push({ id: '', ...c });
  }
  found.sort((a, b) => a.overlapStart - b.overlapStart || (a.btBlockId < b.btBlockId ? -1 : a.btBlockId > b.btBlockId ? 1 : a.wifiBlockId < b.wifiBlockId ? -1 : 1));
  found.forEach((c, i) => { c.id = `C${String(i + 1).padStart(4, '0')}`; });
  return found;
}
