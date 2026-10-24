// Compare mode (spec 7B.10): a difference table of the metrics and a list of the settings that differ.
import type { DataBundle } from '../engine/data';
import type { Metrics } from '../engine/stageG';
import type { ParamValue, ScenarioConfig } from '../engine/types';

export type Verdict = 'BETTER' | 'WORSE' | 'SAME';
export interface MetricRow { key: string; label: string; a: number; b: number; delta: number; verdict: Verdict; arrow: '▲' | '▼' | '='; unit: string; text: string }

interface Spec { key: string; label: string; unit: string; lowerIsBetter: boolean | null; get(m: Metrics): number }

const worstImpact = (m: Metrics) => Object.values(m.perTask).reduce((a, t) => Math.max(a, t.throughputImpactPct), 0);
const anchors = (m: Metrics) => Object.values(m.perTask).filter((t) => t.anchor);
const SPECS: Spec[] = [
  { key: 'hard', label: 'Hard conflicts', unit: '', lowerIsBetter: true, get: (m) => m.conflicts.bySeverity.HARD },
  { key: 'degraded', label: 'Degraded conflicts', unit: '', lowerIsBetter: true, get: (m) => m.conflicts.bySeverity.DEGRADED },
  { key: 'warning', label: 'Warning conflicts', unit: '', lowerIsBetter: true, get: (m) => m.conflicts.bySeverity.WARNING },
  { key: 'tolerated', label: 'Tolerated conflicts', unit: '', lowerIsBetter: null, get: (m) => m.conflicts.bySeverity.TOLERATED },
  { key: 'lost', label: 'Blocks lost', unit: '', lowerIsBetter: true, get: (m) => m.totals.blocksLost },
  { key: 'delayed', label: 'Blocks delayed', unit: '', lowerIsBetter: true, get: (m) => m.totals.blocksDelayed },
  { key: 'retried', label: 'Blocks retried', unit: '', lowerIsBetter: true, get: (m) => m.totals.blocksRetried },
  { key: 'impact', label: 'Worst throughput impact', unit: '%', lowerIsBetter: true, get: worstImpact },
  { key: 'undelivered', label: 'Worst not delivered by window end', unit: '%', lowerIsBetter: true, get: (m) => Object.values(m.perTask).reduce((a, t) => Math.max(a, t.undeliveredPct), 0) },
  { key: 'overlap', label: 'Overlap airtime', unit: '%', lowerIsBetter: true, get: (m) => m.overlap.timePct },
  { key: 'latency', label: 'Worst added latency', unit: 'µs', lowerIsBetter: true, get: (m) => Object.values(m.perTask).reduce((a, t) => Math.max(a, t.latency.maxUs), 0) },
  { key: 'missed', label: 'Anchor events missed', unit: '', lowerIsBetter: true, get: (m) => anchors(m).reduce((a, t) => a + t.anchor!.misses, 0) },
  { key: 'run', label: 'Longest miss run', unit: '', lowerIsBetter: true, get: (m) => Math.max(0, ...anchors(m).map((t) => t.anchor!.longestRun)) },
  { key: 'margin', label: 'Time before supervision timeout', unit: 'µs', lowerIsBetter: false, get: (m) => { const x = anchors(m).map((t) => t.anchor!.marginUs).filter((v): v is number => v !== undefined); return x.length ? Math.min(...x) : 0; } },
  { key: 'btAir', label: 'Bluetooth airtime', unit: '%', lowerIsBetter: null, get: (m) => m.airtime.BT.totalPct },
  { key: 'wifiAir', label: 'Wi-Fi airtime', unit: '%', lowerIsBetter: null, get: (m) => m.airtime.WIFI.totalPct },
];

const fmt = (v: number, unit: string) => (unit === '%' ? `${(Math.round(v * 10) / 10).toString()}%` : unit === 'µs' ? `${Math.round(v)} µs` : String(Math.round(v * 10) / 10));

/** Improvements show an up arrow and regressions a down arrow, each with the numbers in words, so colour is never the only cue. */
export function diffMetrics(a: Metrics, b: Metrics): MetricRow[] {
  return SPECS.map((s) => {
    const x = s.get(a), y = s.get(b), delta = y - x;
    const same = Math.abs(delta) < 1e-9 || s.lowerIsBetter === null;
    const better = s.lowerIsBetter === null ? false : s.lowerIsBetter ? delta < 0 : delta > 0;
    const verdict: Verdict = same ? 'SAME' : better ? 'BETTER' : 'WORSE';
    const arrow = verdict === 'BETTER' ? '▲' : verdict === 'WORSE' ? '▼' : '=';
    const word = verdict === 'BETTER' ? 'improved' : verdict === 'WORSE' ? 'worse' : s.lowerIsBetter === null && Math.abs(delta) > 1e-9 ? 'changed' : 'unchanged';
    return { key: s.key, label: s.label, a: x, b: y, delta, verdict, arrow, unit: s.unit, text: `${word}: ${fmt(x, s.unit)} → ${fmt(y, s.unit)}` };
  });
}

export interface SettingChange { what: string; from: string; to: string }

const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : v === undefined ? 'none' : String(v));

/** Which settings differ between two scenarios: platform settings, tasks added or removed, and changed parameters. */
export function diffConfigs(a: ScenarioConfig, b: ScenarioConfig, data: DataBundle): SettingChange[] {
  const out: SettingChange[] = [];
  for (const f of data.platformFields) {
    const x = a.platform[f.field], y = b.platform[f.field];
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ what: f.label, from: `${f.choiceLabels?.[String(x)] ?? show(x)}${f.unit ? ' ' + f.unit : ''}`, to: `${f.choiceLabels?.[String(y)] ?? show(y)}${f.unit ? ' ' + f.unit : ''}` });
  }
  const byId = (c: ScenarioConfig) => new Map(c.tasks.map((t) => [t.instanceId, t]));
  const A = byId(a), B = byId(b);
  const name = (id: string) => data.taskIndex.get(id)?.name ?? id;
  for (const [id, t] of B) if (!A.has(id)) out.push({ what: 'Task added', from: 'not selected', to: name(t.taskId) });
  for (const [id, t] of A) if (!B.has(id)) out.push({ what: 'Task removed', from: name(t.taskId), to: 'not selected' });
  for (const [id, t] of A) {
    const u = B.get(id);
    if (!u) continue;
    const def = data.taskIndex.get(t.taskId);
    for (const k of new Set([...Object.keys(t.params), ...Object.keys(u.params)])) {
      const x = t.params[k] as ParamValue | undefined, y = u.params[k] as ParamValue | undefined;
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ what: `${name(t.taskId)}: ${def?.params[k]?.label ?? k}`, from: show(x), to: show(y) });
    }
  }
  if (JSON.stringify(a.overrides ?? {}) !== JSON.stringify(b.overrides ?? {})) out.push({ what: 'Priority table', from: JSON.stringify(a.overrides ?? 'default'), to: JSON.stringify(b.overrides ?? 'default') });
  return out;
}
