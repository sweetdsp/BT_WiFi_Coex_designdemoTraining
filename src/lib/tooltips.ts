// Tooltip content (spec 7B.5). A block tooltip has a title, labelled fields, and a one-line plain sentence.
import metricsHelp from '../data/metricsHelp.json';
import { SLOT_US } from './viewport';
import { firstSentence, labelText, techWord, type ViewCtx } from './context';
import { STATUS_WORD } from './layout';
import { tokens } from './tokens';
import type { AirBlock, Conflict, SpecLabel } from '../engine/types';

export interface TipField { label: string; value: string }
export interface Tip {
  title: string;
  fields: TipField[];
  sentence: string;
  /** "Standard says" or "Implementations vary". */
  label: string;
  /** Topic for the "Learn more" link, which opens the help panel. */
  learnMore?: string;
}

const phrase = (b: AirBlock): string => {
  switch (b.status) {
    case 'GRANTED': return b.contested ? 'won the air' : 'went out without any contest';
    case 'DELAYED': return `was moved ${Math.max(0, b.start - b.plannedStart)} µs later`;
    case 'DENIED': case 'LOST': return 'was lost';
    case 'RETRIED': return 'was denied and sent again';
    case 'TOLERATED': return 'overlapped another block but did no harm';
    case 'DEGRADED': return 'was probably corrupted by interference';
    default: return 'is planned';
  }
};

export function blockTip(b: AirBlock, ctx: ViewCtx): Tip {
  const def = ctx.taskDefOf(b.taskId);
  const name = ctx.nameOf(b.taskId);
  const dec = b.decisionId ? ctx.decisionById.get(b.decisionId) : undefined;
  const cls = def ? ctx.data.priorityTable.classes[def.priorityClass] : undefined;
  const prio = dec?.priorities[b.id]?.value ?? b.priority;
  const fields: TipField[] = [
    { label: 'Technology and direction', value: `${techWord(b.tech)}, ${b.dir}` },
    { label: 'Time', value: `start ${b.start} µs, end ${b.start + b.duration} µs, duration ${b.duration} µs${b.tech === 'BT' && b.chanMode === 'CLASSIC_HOP' ? `, slot ${Math.floor(b.start / SLOT_US)}` : ''}` },
    { label: 'Frequency', value: `${b.freqCenter} MHz, channel ${b.channelIndex}, width ${b.freqWidth} MHz` },
    { label: 'Priority', value: `${cls?.name ?? 'Unknown class'} (${prio}${dec?.priorities[b.id]?.critical ? ', critical' : ''})` },
    { label: 'Status', value: `${STATUS_WORD[b.status]}. ${firstSentence(b.reason) || 'No reason recorded.'}` },
  ];
  if (b.status === 'DELAYED' || b.plannedStart !== b.start) fields.push({ label: 'Delay', value: `planned start ${b.plannedStart} µs, actual start ${b.start} µs` });
  if (b.attempt > 1) fields.push({ label: 'Retry', value: `attempt ${b.attempt}, retries block ${b.retryOf}` });
  const label: SpecLabel = dec?.label ?? def?.specLabel ?? 'IMPLEMENTATION_VARIES';
  fields.push({ label: 'Label', value: labelText(label) });
  return {
    title: `${name}, ${b.kind}${b.kind === 'DATA' && def ? '' : ''} ${b.tech === 'BT' && b.chanMode === 'CLASSIC_HOP' ? 'packet' : 'block'}`.replace(/\s+/g, ' ').trim(),
    fields,
    sentence: `${name} ${phrase(b)}.`,
    label: labelText(label),
    learnMore: def?.id ?? b.kind,
  };
}

const TEST_WORD: Record<string, string> = { TIME: 'time overlap', FREQUENCY: 'frequency overlap', ANTENNA: 'shared antenna', CORE: 'shared core', SIMULTANEOUS: 'no simultaneous Wi-Fi TX with Bluetooth RX', ISOLATION: 'low isolation' };

export function conflictTip(c: Conflict, number: number, ctx: ViewCtx): Tip {
  const bt = ctx.blockById.get(c.btBlockId), wf = ctx.blockById.get(c.wifiBlockId);
  const dec = c.decisionId ? ctx.decisionById.get(c.decisionId) : undefined;
  const sev = c.severity[0] + c.severity.slice(1).toLowerCase();
  const fields: TipField[] = [
    { label: 'Blocks', value: `${bt ? `${ctx.nameOf(bt.taskId)} ${bt.kind}` : c.btBlockId} and ${wf ? `${ctx.nameOf(wf.taskId)} ${wf.kind}` : c.wifiBlockId}` },
    { label: 'Overlap', value: `start ${c.overlapStart} µs, end ${c.overlapEnd} µs, duration ${c.overlapUs} µs` },
    { label: 'Triggered by', value: c.tests.filter((t) => t !== 'TIME' || c.tests.length === 1).map((t) => TEST_WORD[t]).join(', ') },
    { label: 'Winner', value: dec ? `${ctx.nameOf(ctx.blockById.get(dec.winnerId)?.taskId ?? '')} (${dec.rule.toLowerCase().replace(/_/g, ' ')})` : c.severity === 'HARD' ? 'Decided by arbitration' : 'No arbitration needed' },
    { label: 'Label', value: labelText(c.label) },
  ];
  return { title: `Conflict ${number}: ${sev}`, fields, sentence: dec ? dec.text : c.reason, label: labelText(c.label), learnMore: 'conflicts' };
}

export function metricTip(key: string): Tip | undefined {
  const m = (metricsHelp.metrics as { key: string; label: string; label_spec: string; help: string }[]).find((x) => x.key === key);
  if (!m) return undefined;
  return { title: m.label, fields: [], sentence: m.help, label: labelText(m.label_spec as SpecLabel), learnMore: key };
}

export function legendTip(id: string): Tip | undefined {
  const c = tokens.cues.find((x) => x.id === id);
  if (!c) return undefined;
  return { title: c.meaning, fields: [{ label: 'Pattern', value: c.pattern }, { label: 'Shape', value: c.shape }, { label: 'Used for', value: c.where }, { label: 'Example', value: c.example }], sentence: c.example, label: labelText('IMPLEMENTATION_VARIES'), learnMore: id };
}
