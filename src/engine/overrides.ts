// Applies the user's edits to the default priority table (FR-13) without changing the shared defaults.
import type { DataBundle } from './data';
import type { PriorityOverrides, TaskDef } from './types';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function hasOverrides(o: PriorityOverrides | undefined): boolean {
  return !!o && (Object.keys(o.base ?? {}).length > 0 || Object.keys(o.bufferThreshold ?? {}).length > 0);
}

/** A copy of the data bundle with the edited base priorities and critical thresholds. Invalid values are ignored (the validator reports them). */
export function withOverrides(data: DataBundle, o: PriorityOverrides | undefined): DataBundle {
  if (!hasOverrides(o)) return data;
  const classes = Object.fromEntries(Object.entries(data.priorityTable.classes).map(([k, v]) => [k, num(o!.base?.[k]) ? { ...v, base: o!.base![k] } : v]));
  const tasks: TaskDef[] = data.tasks.map((t) => (t.buffer && num(o!.bufferThreshold?.[t.id]) ? { ...t, buffer: { ...t.buffer, criticalThreshold: o!.bufferThreshold![t.id] } } : t));
  return { ...data, priorityTable: { ...data.priorityTable, classes }, tasks, taskIndex: new Map(tasks.map((t) => [t.id, t])) };
}
