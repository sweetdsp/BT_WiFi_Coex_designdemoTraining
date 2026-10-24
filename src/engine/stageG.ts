// Stage G: metrics (spec 7A.10). Computed from the final blocks and the conflict list only.
//
// Throughput impact counts payload that did not get through. A packet is delivered when the group it
// travelled in (for example a master packet and its reply) went out completely, with no block denied or
// corrupted, and started inside the window. A packet that went out late but after the window ended is
// "queued at the end": for a buffered stream, packets up to its critical threshold are healthy
// buffering and do not count against it (see ASSUMPTIONS.md).
import type { AnchorStats } from './arbitration/arbitrate';
import type { TaskRuntime } from './arbitration/runtime';
import type { DataBundle } from './data';
import { overlappingPairs } from './stageD';
import { footprint, footprintsOverlap } from './stageB';
import type { AirBlock, Conflict, ConflictSeverity, Decision, DirClass, ScenarioConfig, Tech } from './types';

export interface DirAirtime { txUs: number; rxUs: number; totalUs: number; txPct: number; rxPct: number; totalPct: number }

export interface TaskMetrics {
  instanceId: string;
  name: string;
  tech: Tech;
  counts: { granted: number; delayed: number; tolerated: number; degraded: number; lost: number; retried: number; retryBlocks: number };
  airtimeUs: number;
  requestedBytes: number;
  deliveredBytes: number;
  queuedAtEndBytes: number;
  lostBytes: number;
  corruptedBytes: number;
  /** Payload counted against the task, in percent of the requested payload. */
  throughputImpactPct: number;
  /** Payload not delivered by the end of the window, including packets still queued (strict reading of 7A.10), in percent of the requested payload. Always at least the impact. */
  undeliveredPct: number;
  /** Packets delayed and not yet sent when the window ended. */
  queuedAtEnd: number;
  /** Extra wait from planned start to the start of the delivering block. */
  latency: { delayedPackets: number; meanUs: number; maxUs: number; totalUs: number };
  anchor?: { hits: number; misses: number; longestRun: number; tolerated: number; supervisionUs?: number; marginUs?: number };
}

export interface Metrics {
  windowUs: number;
  airtime: Record<Tech, DirAirtime>;
  /** Airtime the tasks asked for before arbitration, per technology, in percent of the window. */
  requestedAirtimePct: Record<Tech, number>;
  overlap: { timeUs: number; freqUs: number; timePct: number; freqPct: number };
  conflicts: {
    total: number;
    bySeverity: Record<ConflictSeverity, number>;
    byDirClass: Record<DirClass, number>;
    hardWonByBluetooth: number;
    hardWonByWifi: number;
  };
  totals: { blocksLost: number; blocksDelayed: number; blocksRetried: number; blocksTolerated: number; blocksDegraded: number; retryBlocks: number };
  perTask: Record<string, TaskMetrics>;
  /** One sentence a screen reader can read (7B.13). */
  summary: string;
}

const LIVE = new Set(['GRANTED', 'DELAYED', 'TOLERATED', 'DEGRADED']);
const live = (b: AirBlock) => !b.optional && LIVE.has(b.status);

/** Total length covered by a set of intervals. */
export function unionLength(iv: [number, number][]): number {
  const s = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity, start = 0;
  for (const [a, b] of s) {
    if (a > end) { if (end > start) total += end - start; start = a; end = b; } else end = Math.max(end, b);
  }
  if (end > start) total += end - start;
  return total;
}

const clip = (b: AirBlock, w: number): [number, number] => [Math.max(0, b.start), Math.min(w, b.start + b.duration)];
const empty = (): DirAirtime => ({ txUs: 0, rxUs: 0, totalUs: 0, txPct: 0, rxPct: 0, totalPct: 0 });

export function computeMetrics(
  blocks: AirBlock[], conflicts: Conflict[], decisions: Decision[], config: ScenarioConfig, _data: DataBundle,
  runtime: Map<string, TaskRuntime>, anchorStats: Record<string, AnchorStats>,
): Metrics {
  const W = config.platform.windowUs;
  const pct = (us: number) => (W > 0 ? (us / W) * 100 : 0);

  // ---- airtime ------------------------------------------------------------------------------
  const airtime: Record<Tech, DirAirtime> = { BT: empty(), WIFI: empty() };
  const requested: Record<Tech, number> = { BT: 0, WIFI: 0 };
  for (const b of blocks) {
    if (b.optional) continue;
    if (b.attempt === 1 && b.plannedStart < W) requested[b.tech] += Math.max(0, Math.min(W, b.plannedStart + b.duration) - b.plannedStart);
    if (!live(b)) continue;
    const [s, e] = clip(b, W);
    if (e <= s) continue;
    airtime[b.tech][b.dir === 'TX' ? 'txUs' : 'rxUs'] += e - s;
  }
  for (const t of ['BT', 'WIFI'] as const) {
    const a = airtime[t];
    a.totalUs = a.txUs + a.rxUs;
    a.txPct = pct(a.txUs); a.rxPct = pct(a.rxUs); a.totalPct = pct(a.totalUs);
  }

  // ---- overlap at the planned positions -----------------------------------------------------
  const planned = blocks.filter((b) => !b.optional && b.attempt === 1).map((b) => ({ ...b, start: b.plannedStart, freqCenter: b.plannedFreqCenter ?? b.freqCenter }));
  const timeIv: [number, number][] = [], freqIv: [number, number][] = [];
  for (const [bt, wf] of overlappingPairs(planned.filter((b) => b.tech === 'BT'), planned.filter((b) => b.tech === 'WIFI'))) {
    const iv: [number, number] = [Math.max(bt.start, wf.start), Math.min(bt.start + bt.duration, wf.start + wf.duration)];
    if (iv[0] >= W) continue;
    iv[1] = Math.min(iv[1], W);
    timeIv.push(iv);
    if (footprintsOverlap(footprint(bt), footprint(wf), config.platform.guardMHz)) freqIv.push(iv);
  }
  const overlap = { timeUs: unionLength(timeIv), freqUs: unionLength(freqIv), timePct: 0, freqPct: 0 };
  overlap.timePct = pct(overlap.timeUs); overlap.freqPct = pct(overlap.freqUs);

  // ---- conflicts ----------------------------------------------------------------------------
  const bySeverity: Record<ConflictSeverity, number> = { HARD: 0, DEGRADED: 0, WARNING: 0, TOLERATED: 0 };
  const byDirClass: Record<DirClass, number> = { TX_TX: 0, TX_RX: 0, RX_TX: 0, RX_RX: 0 };
  let wonBt = 0, wonWf = 0;
  for (const c of conflicts) {
    bySeverity[c.severity]++;
    byDirClass[c.dirClass]++;
    if (c.severity === 'HARD' && c.winnerBlockId) { if (c.winnerBlockId === c.btBlockId) wonBt++; else wonWf++; }
  }

  // ---- per task -----------------------------------------------------------------------------
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const kids = new Map<string, AirBlock[]>();
  for (const b of blocks) if (b.retryOf && !b.optional) (kids.get(b.retryOf) ?? kids.set(b.retryOf, []).get(b.retryOf)!).push(b);
  const groups = new Map<string, AirBlock[]>();
  for (const b of blocks) if (!b.optional) (groups.get(b.groupId) ?? groups.set(b.groupId, []).get(b.groupId)!).push(b);

  const groupOutcome = (g: AirBlock[]): 'OK' | 'LATE' | 'CORRUPT' | 'FAIL' => {
    if (g.some((b) => !LIVE.has(b.status))) return 'FAIL';
    if (g.some((b) => b.corrupted)) return 'CORRUPT';
    return g.every((b) => b.start < W) ? 'OK' : 'LATE';
  };

  const perTask: Record<string, TaskMetrics> = {};
  const totals = { blocksLost: 0, blocksDelayed: 0, blocksRetried: 0, blocksTolerated: 0, blocksDegraded: 0, retryBlocks: 0 };
  for (const [id, rt] of runtime) {
    const mine = blocks.filter((b) => b.taskId === id && !b.optional);
    const counts = { granted: 0, delayed: 0, tolerated: 0, degraded: 0, lost: 0, retried: 0, retryBlocks: 0 };
    let air = 0;
    for (const b of mine) {
      if (b.status === 'GRANTED') counts.granted++;
      else if (b.status === 'DELAYED') counts.delayed++;
      else if (b.status === 'TOLERATED') counts.tolerated++;
      else if (b.status === 'DEGRADED') counts.degraded++;
      else if (b.status === 'LOST') counts.lost++;
      else if (b.status === 'RETRIED') counts.retried++;
      if (b.attempt > 1) counts.retryBlocks++;
      if (live(b)) { const [s, e] = clip(b, W); if (e > s) air += e - s; }
    }
    totals.blocksLost += counts.lost; totals.blocksDelayed += counts.delayed; totals.blocksRetried += counts.retried;
    totals.blocksTolerated += counts.tolerated; totals.blocksDegraded += counts.degraded; totals.retryBlocks += counts.retryBlocks;

    // Packets: first-attempt blocks that carry payload, followed through their retries.
    const roots = mine.filter((b) => b.attempt === 1 && (b.payloadBytes ?? 0) > 0 && b.plannedStart < W).sort((a, b) => a.plannedStart - b.plannedStart);
    let req = 0, del = 0, lost = 0, corrupt = 0;
    const late: { bytes: number; planned: number }[] = [];
    const lat: number[] = [];
    const deliveredStarts: number[] = [];
    const queued: number[] = []; // arrivals that were not lost or corrupted: these are the ones a queue holds
    for (const r of roots) {
      req += r.payloadBytes!;
      // The chain of this packet: itself, then every retry of it.
      const chain: AirBlock[] = [];
      for (let stack = [r]; stack.length;) { const x = stack.pop()!; chain.push(x); for (const k of kids.get(x.id) ?? []) stack.push(k); }
      chain.sort((a, b) => a.attempt - b.attempt || a.start - b.start);
      const outcomes = chain.map((x) => ({ x, o: groupOutcome(groups.get(x.groupId) ?? [x]) }));
      const ok = outcomes.find((e) => e.o === 'OK');
      const lateOne = outcomes.find((e) => e.o === 'LATE');
      if (ok || lateOne) queued.push(r.plannedStart);
      if (ok) {
        del += r.payloadBytes!;
        lat.push(Math.max(0, ok.x.start - r.plannedStart));
        deliveredStarts.push(ok.x.start);
      } else if (lateOne) {
        late.push({ bytes: r.payloadBytes!, planned: r.plannedStart });
      } else if (outcomes.some((e) => e.o === 'CORRUPT')) corrupt += r.payloadBytes!;
      else lost += r.payloadBytes!;
    }
    // Packets still waiting at the end: a buffer may hold up to its critical threshold without penalty (none may wait past it).
    const allowed = rt.def.buffer?.enabled ? Math.max(0, rt.criticalThreshold ?? 0) : 0;
    late.sort((a, b) => b.planned - a.planned);
    const counted = late.slice(allowed).reduce((a, x) => a + x.bytes, 0);
    const queuedBytes = late.reduce((a, x) => a + x.bytes, 0);
    // A buffered stream is a queue: its i-th delivery serves the i-th packet to arrive, whichever block carried it.
    if (rt.def.buffer?.enabled && deliveredStarts.length > 0) {
      const arrivals = [...queued].sort((a, b) => a - b);
      const starts = [...deliveredStarts].sort((a, b) => a - b);
      lat.length = 0;
      starts.forEach((t, i) => lat.push(Math.max(0, t - arrivals[i])));
    }
    const delayedLat = lat.filter((x) => x > 0);
    const total = lat.reduce((a, x) => a + x, 0);

    const m: TaskMetrics = {
      instanceId: id, name: rt.name, tech: rt.def.tech, counts, airtimeUs: air,
      requestedBytes: req, deliveredBytes: del, queuedAtEndBytes: queuedBytes, lostBytes: lost, corruptedBytes: corrupt,
      throughputImpactPct: req > 0 ? ((lost + corrupt + counted) / req) * 100 : 0,
      undeliveredPct: req > 0 ? ((req - del) / req) * 100 : 0,
      queuedAtEnd: late.length,
      latency: { delayedPackets: delayedLat.length, meanUs: delayedLat.length ? Math.round(delayedLat.reduce((a, x) => a + x, 0) / delayedLat.length) : 0, maxUs: lat.length ? Math.max(0, ...lat) : 0, totalUs: total },
    };

    // ---- anchors: events hit and missed, longest run, margin to the supervision timeout ------
    if (rt.anchor?.isAnchor) {
      const events = [...new Set(mine.filter((b) => b.attempt === 1).map((b) => b.groupId))]
        .map((gid) => ({ gid, g: (groups.get(gid) ?? []).filter((b) => b.attempt === 1), t: Math.min(...(groups.get(gid) ?? []).map((b) => b.plannedStart)) }))
        .filter((e) => e.t < W)
        .sort((a, b) => a.t - b.t);
      let hits = 0, misses = 0, run = 0, longest = 0;
      for (const e of events) {
        const ok = e.g.length > 0 && e.g.every((b) => live(b) && !b.corrupted && b.status !== 'DELAYED');
        if (ok) { hits++; run = 0; } else { misses++; run++; longest = Math.max(longest, run); }
      }
      // Margin: longest time between events that went out, against the supervision timeout.
      let margin: number | undefined;
      if (rt.supervisionUs) {
        const okTimes = [0];
        for (const g of groups.values()) {
          if (g[0]?.taskId !== id || g.some((b) => !live(b) || b.corrupted)) continue;
          okTimes.push(Math.min(...g.map((b) => b.start)));
        }
        okTimes.push(W);
        okTimes.sort((a, b) => a - b);
        let gap = 0;
        for (let i = 1; i < okTimes.length; i++) gap = Math.max(gap, okTimes[i] - okTimes[i - 1]);
        margin = rt.supervisionUs - gap;
      }
      m.anchor = { hits, misses, longestRun: longest, tolerated: rt.anchor.toleratedMisses, supervisionUs: rt.supervisionUs, marginUs: margin };
    }
    perTask[id] = m;
  }
  void anchorStats; void byId; void decisions;

  const summary = `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}: ${bySeverity.HARD} hard (${wonBt} resolved in favour of Bluetooth, ${wonWf} in favour of Wi-Fi), ${bySeverity.DEGRADED} degraded, ${bySeverity.WARNING} warning, ${bySeverity.TOLERATED} tolerated. ${totals.blocksDelayed} block${totals.blocksDelayed === 1 ? '' : 's'} delayed, ${totals.blocksLost} lost, ${totals.blocksRetried} retried.`;

  return {
    windowUs: W, airtime,
    requestedAirtimePct: { BT: pct(requested.BT), WIFI: pct(requested.WIFI) },
    overlap,
    conflicts: { total: conflicts.length, bySeverity, byDirClass, hardWonByBluetooth: wonBt, hardWonByWifi: wonWf },
    totals, perTask, summary,
  };
}
