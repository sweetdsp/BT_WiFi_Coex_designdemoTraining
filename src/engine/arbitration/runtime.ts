// Per-task facts the arbiter needs: parameters, anchor definition, supervision timeout and event interval.
import type { DataBundle } from '../data';
import { estimateLoad } from '../estimate';
import { effectiveParams, taskDisplayNames } from '../params';
import type { AnchorDef, ParamMap, ScenarioConfig, TaskDef } from '../types';

export interface TaskRuntime {
  instanceId: string;
  def: TaskDef;
  params: ParamMap;
  name: string;
  anchor: AnchorDef | null;
  /** Supervision timeout in microseconds, when the link has one. */
  supervisionUs?: number;
  /** Time between events in microseconds. */
  intervalUs: number;
  /** Packets waiting before the task becomes critical. */
  criticalThreshold?: number;
}

export function buildRuntime(config: ScenarioConfig, data: DataBundle): Map<string, TaskRuntime> {
  const known = config.tasks.flatMap((inst) => {
    const def = data.taskIndex.get(inst.taskId);
    return def ? [{ inst, def }] : [];
  });
  const names = taskDisplayNames(known);
  const out = new Map<string, TaskRuntime>();
  for (const { inst, def } of known) {
    const params = effectiveParams(def, inst);
    const est = estimateLoad(def, params, data, config.platform, Math.max(1, config.platform.windowUs));
    const sup = def.anchor?.supervisionParam ? Number(params[def.anchor.supervisionParam]) : undefined;
    out.set(inst.instanceId, {
      instanceId: inst.instanceId, def, params, name: names.get(inst.instanceId) ?? def.name, anchor: def.anchor,
      supervisionUs: sup !== undefined && Number.isFinite(sup) ? sup * 1000 : undefined,
      intervalUs: est.eventIntervalUs,
      criticalThreshold: def.buffer?.enabled ? def.buffer.criticalThreshold : undefined,
    });
  }
  return out;
}
