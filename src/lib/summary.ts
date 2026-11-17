// Summary strip rows (spec 7A.11, 7B.2): metrics as numbers and small bars, with a per-task table.
import type { Metrics, TaskMetrics } from '../engine/stageG';

export interface SummaryItem { key: string; label: string; value: string; bar?: { fraction: number; tone: 'bt' | 'wifi' | 'conflict' | 'neutral' }; detail?: string }

const pct = (x: number) => `${x.toFixed(x >= 10 || x === 0 ? 0 : 1)}%`;
const ms = (us: number) => `${(us / 1000).toFixed(us >= 100000 ? 0 : 1)} ms`;

const present = (m: Metrics, t: 'BT' | 'THREAD') => m.requestedAirtimePct[t] > 0 || m.airtime[t].totalUs > 0;
/** Airtime of each technology in use. Bluetooth is shown when it is used or when Thread is not (a Wi-Fi-only scenario keeps its Bluetooth figure). */
function airtimeText(m: Metrics): string {
  const parts: string[] = [];
  if (present(m, 'BT') || !present(m, 'THREAD')) parts.push(`BT ${pct(m.airtime.BT.totalPct)}`);
  if (present(m, 'THREAD')) parts.push(`Thread ${pct(m.airtime.THREAD.totalPct)}`);
  parts.push(`Wi-Fi ${pct(m.airtime.WIFI.totalPct)}`);
  return parts.join(' · ');
}
function airtimeDetail(m: Metrics): string {
  const d = (n: string, t: 'BT' | 'THREAD' | 'WIFI') => `${n} TX ${pct(m.airtime[t].txPct)}, RX ${pct(m.airtime[t].rxPct)}`;
  const parts: string[] = [];
  if (present(m, 'BT') || !present(m, 'THREAD')) parts.push(d('BT', 'BT'));
  if (present(m, 'THREAD')) parts.push(d('Thread', 'THREAD'));
  parts.push(d('Wi-Fi', 'WIFI'));
  return parts.join('; ');
}

export function summaryItems(m: Metrics): SummaryItem[] {
  const c = m.conflicts;
  const anchors = Object.values(m.perTask).filter((t) => t.anchor);
  const hits = anchors.reduce((a, t) => a + t.anchor!.hits, 0), misses = anchors.reduce((a, t) => a + t.anchor!.misses, 0);
  const run = Math.max(0, ...anchors.map((t) => t.anchor!.longestRun));
  const margins = anchors.map((t) => t.anchor!.marginUs).filter((x): x is number => x !== undefined);
  const worst = Object.values(m.perTask).reduce((a, t) => Math.max(a, t.throughputImpactPct), 0);
  const worstUndelivered = Object.values(m.perTask).reduce((a, t) => Math.max(a, t.undeliveredPct), 0);
  const lat = Object.values(m.perTask).reduce((a, t) => ({ max: Math.max(a.max, t.latency.maxUs), n: a.n + t.latency.delayedPackets }), { max: 0, n: 0 });
  return [
    { key: 'airtime', label: 'Airtime', value: airtimeText(m), bar: { fraction: Math.min(1, m.airtime.WIFI.totalPct / 100), tone: 'wifi' }, detail: airtimeDetail(m) },
    { key: 'overlap', label: 'Overlap', value: `${ms(m.overlap.timeUs)} (${ms(m.overlap.freqUs)} in frequency)`, bar: { fraction: Math.min(1, m.overlap.timePct / 100), tone: 'conflict' } },
    { key: 'conflicts', label: 'Conflicts', value: `${c.total}: ${c.bySeverity.HARD} hard, ${c.bySeverity.DEGRADED} degraded, ${c.bySeverity.WARNING} warning, ${c.bySeverity.TOLERATED} tolerated`, bar: { fraction: c.total ? c.bySeverity.HARD / c.total : 0, tone: 'conflict' } },
    { key: 'blocksDelayed', label: 'Delayed', value: String(m.totals.blocksDelayed) },
    { key: 'blocksRetried', label: 'Retried', value: String(m.totals.blocksRetried) },
    { key: 'blocksLost', label: 'Lost', value: String(m.totals.blocksLost) },
    { key: 'blocksTolerated', label: 'Tolerated', value: String(m.totals.blocksTolerated) },
    { key: 'throughputImpact', label: 'Worst throughput impact', value: pct(worst), bar: { fraction: Math.min(1, worst / 100), tone: 'conflict' } },
    { key: 'undelivered', label: 'Not delivered by window end', value: pct(worstUndelivered), bar: { fraction: Math.min(1, worstUndelivered / 100), tone: 'neutral' }, detail: 'Strict count: everything requested and not delivered when the window ended, including packets still queued.' },
    { key: 'latency', label: 'Added latency', value: lat.n ? `up to ${ms(lat.max)} (${lat.n} packets)` : 'none' },
    { key: 'anchorsHit', label: 'Anchors hit / missed', value: anchors.length ? `${hits} / ${misses}` : 'no anchor tasks' },
    { key: 'longestMissRun', label: 'Longest miss run', value: anchors.length ? String(run) : '–' },
    { key: 'supervisionMargin', label: 'Time before supervision timeout', value: margins.length ? ms(Math.min(...margins)) : '–' },
  ];
}

export interface TaskRow { id: string; name: string; tech: string; counts: string; impact: string; undelivered: string; queued: string; latency: string; anchor: string }

export function taskRows(m: Metrics): TaskRow[] {
  return Object.values(m.perTask).map((t: TaskMetrics) => ({
    id: t.instanceId, name: t.name, tech: t.tech === 'BT' ? 'Bluetooth' : t.tech === 'THREAD' ? 'Thread' : 'Wi-Fi',
    counts: `${t.counts.delayed} delayed, ${t.counts.retried} retried, ${t.counts.lost} lost, ${t.counts.tolerated} tolerated`,
    impact: pct(t.throughputImpactPct), undelivered: pct(t.undeliveredPct), queued: String(t.queuedAtEnd),
    latency: t.latency.delayedPackets ? `mean ${ms(t.latency.meanUs)}, max ${ms(t.latency.maxUs)}` : 'none',
    anchor: t.anchor ? `${t.anchor.hits} hit, ${t.anchor.misses} missed, longest run ${t.anchor.longestRun}` : '–',
  }));
}
