// Explanation of a conflict as a short story in a fixed order (spec 7B.8).
import type { Change, Conflict, SpecLabel } from '../engine/types';
import { firstSentence, labelText, techWord, type ViewCtx } from './context';

export interface Statement { text: string; label: string }
export interface Involved { role: string; blockId: string; name: string; kind: string; dir: string; start: number; end: number; freq: number; width: number; channel: number; tech: 'BT' | 'WIFI'; status: string }
export interface Suggestion { id: string; label: string; why: string; changes: Change[]; spec: string }
export interface Explanation {
  conflictId: string;
  number: number;
  severity: string;
  what: Statement;
  involved: Involved[];
  why: Statement & { tests: string[]; overlapUs: number; freqOverlap: boolean; diagram: { time: { bt: [number, number]; wifi: [number, number] }; freq: { bt: [number, number]; wifi: [number, number]; guard: number } } };
  who: (Statement & { rule: string; winner?: string; priorities: { name: string; tech: string; value: number; base: number; critical: boolean; anchor: boolean; waiting?: number }[] }) | null;
  means: Statement;
  changes: Suggestion[];
}

const TEST: Record<string, string> = { TIME: 'time overlap', FREQUENCY: 'frequency overlap', ANTENNA: 'shared antenna', CORE: 'shared core', SIMULTANEOUS: 'no simultaneous Wi-Fi TX with Bluetooth RX', ISOLATION: 'low isolation' };

export function explainConflict(c: Conflict, ctx: ViewCtx): Explanation {
  const { result } = ctx;
  const p = result.config.platform;
  const number = result.conflicts.indexOf(c) + 1;
  const bt = ctx.blockById.get(c.btBlockId)!, wf = ctx.blockById.get(c.wifiBlockId)!;
  const btName = ctx.nameOf(bt.taskId), wfName = ctx.nameOf(wf.taskId);
  const dec = c.decisionId ? ctx.decisionById.get(c.decisionId) : undefined;
  const lab = (l: SpecLabel) => labelText(l);

  const mk = (role: string, b: typeof bt): Involved => ({ role, blockId: b.id, name: ctx.nameOf(b.taskId), kind: String(b.kind), dir: b.dir, start: b.start, end: b.start + b.duration, freq: b.freqCenter, width: b.freqWidth, channel: b.channelIndex, tech: b.tech, status: b.status });

  const via = c.tests.includes('ANTENNA') ? 'both share one antenna' : c.tests.includes('CORE') ? 'both share one core' : c.tests.includes('SIMULTANEOUS') ? 'the platform cannot send Wi-Fi while receiving Bluetooth' : c.freqOverlap ? 'their frequencies overlap' : `isolation is only ${p.isolationDb} dB`;
  const verb = (d: string) => (d === 'TX' ? 'sending' : 'receiving');
  const what: Statement = { text: `${wfName} was ${verb(wf.dir)} while ${btName} was ${verb(bt.dir)} a ${String(bt.kind).toLowerCase()} packet, and ${via}.`, label: lab(c.label) };

  const diag = { time: { bt: [bt.start, bt.start + bt.duration] as [number, number], wifi: [wf.start, wf.start + wf.duration] as [number, number] }, freq: { bt: [bt.freqCenter - bt.freqWidth / 2, bt.freqCenter + bt.freqWidth / 2] as [number, number], wifi: [wf.freqCenter - wf.freqWidth / 2, wf.freqCenter + wf.freqWidth / 2] as [number, number], guard: p.guardMHz } };
  const why = { text: `The test that fired: ${c.tests.filter((t) => t !== 'TIME').map((t) => TEST[t]).join(' and ') || 'time overlap'}. The blocks overlapped for ${c.overlapUs} µs (from ${c.overlapStart} to ${c.overlapEnd} µs). ${c.reason}`, label: lab(c.label), tests: c.tests.map((t) => TEST[t]), overlapUs: c.overlapUs, freqOverlap: c.freqOverlap, diagram: diag };

  let who: Explanation['who'] = null;
  if (dec) {
    const rows = Object.entries(dec.priorities).map(([id, pr]) => { const b = ctx.blockById.get(id); return { name: b ? ctx.nameOf(b.taskId) : id, tech: b ? techWord(b.tech) : '', value: pr.value, base: pr.base, critical: pr.critical, anchor: pr.anchor, waiting: pr.waiting }; });
    const w = ctx.blockById.get(dec.winnerId);
    who = { rule: dec.rule, text: dec.text, label: lab(dec.label), winner: w ? ctx.nameOf(w.taskId) : undefined, priorities: rows };
  }

  // What it means for the user, side by side.
  const side = (b: typeof bt): string => {
    const def = ctx.taskDefOf(b.taskId);
    const m = result.metrics.perTask[b.taskId];
    const tags = def?.tags ?? [];
    const name = ctx.nameOf(b.taskId);
    const lost = b.status === 'LOST' || b.status === 'RETRIED' || b.status === 'DENIED';
    if (tags.includes('A2DP')) {
      if (lost) return 'An audio packet was lost; a glitch is possible.';
      if (b.status === 'DEGRADED') return 'An audio packet was probably corrupted and will need to be resent.';
      if (b.status === 'DELAYED') return 'One audio packet was sent late; the buffer absorbed it, so there is no audible glitch.';
      return 'The audio packet went out on time.';
    }
    if (tags.includes('VOICE_LINK')) return lost || b.status === 'DEGRADED' ? 'A voice packet was lost: an audible glitch.' : 'The voice packet went out on time.';
    if (m?.anchor && (lost || b.status === 'DEGRADED')) return `${name} missed an event (${m.anchor.misses} missed in total, ${m.anchor.tolerated} tolerated before the link is at risk).`;
    if (b.tech === 'WIFI' && (lost || b.status === 'DELAYED' || b.status === 'DEGRADED')) return `Wi-Fi throughput dropped by ${(m?.throughputImpactPct ?? 0).toFixed(1)} percent over the window${b.status === 'DELAYED' ? `, and a ${name} block was sent ${b.start - b.plannedStart} µs late` : ''}.`;
    if (lost) return `${name} lost a block${b.status === 'RETRIED' ? ' and sent it again' : ''}.`;
    return `${name} was not affected.`;
  };
  const means: Statement = { text: `${side(bt)} ${side(wf)}`, label: lab('IMPLEMENTATION_VARIES') };

  const sug: Suggestion[] = [];
  const spec = labelText('IMPLEMENTATION_VARIES');
  if (c.tests.includes('ANTENNA')) sug.push({ id: 'separate-antennas', label: 'Use separate antennas with 40 dB isolation and concurrent cores', why: 'Removes the shared path, so overlapping blocks no longer have to take turns.', spec, changes: [{ op: 'setPlatform', field: 'femArrangement', value: 'SEPARATE' }, { op: 'setPlatform', field: 'antennaMode', value: 'SEPARATE' }, { op: 'setPlatform', field: 'coreCount', value: 2 }, { op: 'setPlatform', field: 'coreMode', value: 'CONCURRENT' }, { op: 'setPlatform', field: 'simultaneousWifiTxBtRx', value: true }, { op: 'setPlatform', field: 'isolationDb', value: 40 }] });
  if (c.freqOverlap && !p.afhEnabled && p.wifiBand === '2.4') sug.push({ id: 'afh-on', label: 'Turn on adaptive frequency hopping', why: 'Bluetooth stops hopping into the Wi-Fi channel once the channel map takes effect.', spec, changes: [{ op: 'setPlatform', field: 'afhEnabled', value: true }] });
  if (c.column === 'SEP_LOW' || (!c.tests.includes('ANTENNA') && p.isolationDb < 40)) sug.push({ id: 'raise-isolation', label: `Raise isolation from ${p.isolationDb} dB to 40 dB`, why: 'Above the interaction threshold, a transmit no longer disturbs a nearby receive.', spec, changes: [{ op: 'setPlatform', field: 'isolationDb', value: 40 }] });
  if (c.severity === 'HARD' && p.arbitrationPolicy === 'PRIORITY' && sug.length < 3) sug.push({ id: 'bt-favoured', label: 'Favour Bluetooth in arbitration', why: 'Bluetooth always wins a hard conflict, whatever the priorities.', spec, changes: [{ op: 'setPlatform', field: 'arbitrationPolicy', value: 'BT_FAVOURED' }] });
  if (sug.length === 0 && p.wifiBand === '2.4') sug.push({ id: 'afh-on', label: 'Turn on adaptive frequency hopping', why: 'Keeps Bluetooth out of the Wi-Fi channel.', spec, changes: [{ op: 'setPlatform', field: 'afhEnabled', value: true }] });

  return {
    conflictId: c.id, number, severity: c.severity,
    what, involved: [mk('Bluetooth', bt), mk('Wi-Fi', wf)], why, who, means, changes: sug.slice(0, 3),
  };
}

export type SortKey = 'time' | 'severity' | 'task';
const SEV: Record<string, number> = { HARD: 0, DEGRADED: 1, WARNING: 2, TOLERATED: 3 };

/** The conflict list at the top of the explanation panel: sortable and filterable (7B.8). */
export function conflictList(ctx: ViewCtx, sort: SortKey, hardOnly: boolean): { conflict: Conflict; number: number }[] {
  const list = ctx.result.conflicts.map((c, i) => ({ conflict: c, number: i + 1 })).filter((x) => !hardOnly || x.conflict.severity === 'HARD');
  const key = (x: { conflict: Conflict }) => (sort === 'task' ? ctx.nameOf(x.conflict.btTaskId) + ctx.nameOf(x.conflict.wifiTaskId) : '');
  return list.sort((a, b) =>
    sort === 'severity' ? SEV[a.conflict.severity] - SEV[b.conflict.severity] || a.conflict.overlapStart - b.conflict.overlapStart
      : sort === 'task' ? key(a).localeCompare(key(b)) || a.conflict.overlapStart - b.conflict.overlapStart
        : a.conflict.overlapStart - b.conflict.overlapStart);
}

export function neighbour(list: { conflict: Conflict }[], currentId: string | undefined, dir: 1 | -1): string | undefined {
  if (list.length === 0) return undefined;
  const i = list.findIndex((x) => x.conflict.id === currentId);
  const j = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  return list[j].conflict.id;
}

export { firstSentence };
