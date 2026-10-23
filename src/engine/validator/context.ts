// Shared context for validation rules: resolved tasks, effective parameters and cached load estimates.
import type { DataBundle } from '../data';
import { estimateLoad, type LoadEstimate } from '../estimate';
import { effectiveParams, taskDisplayNames } from '../params';
import type { IssueItem, ParamMap, PlatformConfig, ScenarioConfig, TaskDef, TaskInstance } from '../types';

export interface RTask {
  inst: TaskInstance;
  def: TaskDef;
  /** Effective parameters: invalid or missing values replaced by defaults. */
  params: ParamMap;
  name: string;
}

export interface Ctx {
  cfg: ScenarioConfig;
  data: DataBundle;
  platform: PlatformConfig;
  tasks: RTask[];
  unknown: TaskInstance[];
  bt: RTask[];
  wifi: RTask[];
  load(t: RTask): LoadEstimate;
}

export function buildContext(cfg: ScenarioConfig, data: DataBundle): Ctx {
  const known: { inst: TaskInstance; def: TaskDef }[] = [];
  const unknown: TaskInstance[] = [];
  for (const inst of cfg.tasks ?? []) {
    const def = data.taskIndex.get(inst.taskId);
    if (def) known.push({ inst, def });
    else unknown.push(inst);
  }
  const names = taskDisplayNames(known);
  const tasks: RTask[] = known.map((k) => ({ ...k, params: effectiveParams(k.def, k.inst), name: names.get(k.inst.instanceId) ?? k.def.name }));
  const cache = new Map<string, LoadEstimate>();
  const platform = cfg.platform;
  const windowUs = Number.isFinite(platform.windowUs) && platform.windowUs > 0 ? platform.windowUs : 1;
  return {
    cfg, data, platform, tasks, unknown,
    bt: tasks.filter((t) => t.def.tech === 'BT'),
    wifi: tasks.filter((t) => t.def.tech === 'WIFI'),
    load(t) {
      let v = cache.get(t.inst.instanceId);
      if (!v) {
        try { v = estimateLoad(t.def, t.params, data, platform, windowUs); }
        catch { v = { blocks: 0, airtimeUs: 0, eventIntervalUs: windowUs }; }
        cache.set(t.inst.instanceId, v);
      }
      return v;
    },
  };
}

export const taskItem = (t: RTask, param?: string): IssueItem => ({ kind: 'task', instanceId: t.inst.instanceId, label: t.name, param });
export const platformItem = (field: string, label?: string): IssueItem => ({ kind: 'platform', field, label: label ?? field });
