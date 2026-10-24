// Lookups shared by the view-model modules.
import type { EngineResult } from '../engine';
import type { DataBundle } from '../engine/data';
import type { AirBlock, Conflict, Decision, SpecLabel, TaskDef } from '../engine/types';

export interface ViewCtx {
  result: EngineResult;
  data: DataBundle;
  blockById: Map<string, AirBlock>;
  conflictById: Map<string, Conflict>;
  decisionById: Map<string, Decision>;
  taskDefOf(taskInstanceId: string): TaskDef | undefined;
  nameOf(taskInstanceId: string): string;
}

export function makeCtx(result: EngineResult, data: DataBundle): ViewCtx {
  const instDef = new Map(result.config.tasks.map((t) => [t.instanceId, data.taskIndex.get(t.taskId)]));
  return {
    result, data,
    blockById: new Map(result.blocks.map((b) => [b.id, b])),
    conflictById: new Map(result.conflicts.map((c) => [c.id, c])),
    decisionById: new Map(result.decisions.map((d) => [d.id, d])),
    taskDefOf: (id) => instDef.get(id),
    nameOf: (id) => result.taskNames[id] ?? id,
  };
}

export const labelText = (l: SpecLabel) => (l === 'STANDARD' ? 'Standard says' : 'Implementations vary');
export const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
export const techWord = (t: 'BT' | 'WIFI') => (t === 'BT' ? 'Bluetooth' : 'Wi-Fi');
