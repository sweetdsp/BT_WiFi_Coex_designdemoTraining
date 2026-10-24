// Editing helpers for the scenario being built (spec 6.1 to 6.3, 7B.12). Pure: every function returns a new configuration.
import type { DataBundle } from '../engine/data';
import { defaultPlatform } from '../engine/data';
import { defaultParams } from '../engine/params';
import type { ParamMap, ParamValue, PlatformConfig, ScenarioConfig, TaskInstance, ValidationIssue } from '../engine/types';

const nextId = (tasks: TaskInstance[]) => {
  const used = new Set(tasks.map((t) => t.instanceId));
  let n = tasks.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
};

export function addTask(cfg: ScenarioConfig, taskId: string, data: DataBundle, params: ParamMap = {}): ScenarioConfig {
  const def = data.taskIndex.get(taskId);
  if (!def) return cfg;
  return { ...cfg, tasks: [...cfg.tasks, { instanceId: nextId(cfg.tasks), taskId, params: { ...defaultParams(def), ...params } }] };
}
export const removeTask = (cfg: ScenarioConfig, instanceId: string): ScenarioConfig => ({ ...cfg, tasks: cfg.tasks.filter((t) => t.instanceId !== instanceId) });
export const setParam = (cfg: ScenarioConfig, instanceId: string, name: string, value: ParamValue): ScenarioConfig => ({ ...cfg, tasks: cfg.tasks.map((t) => (t.instanceId === instanceId ? { ...t, params: { ...t.params, [name]: value } } : t)) });
export const resetTask = (cfg: ScenarioConfig, instanceId: string, data: DataBundle): ScenarioConfig => ({ ...cfg, tasks: cfg.tasks.map((t) => { const d = data.taskIndex.get(t.taskId); return t.instanceId === instanceId && d ? { ...t, params: defaultParams(d) } : t; }) });
export const clearTasks = (cfg: ScenarioConfig): ScenarioConfig => ({ ...cfg, tasks: [] });

/** Setting the front-end arrangement also sets the antenna mode, so the two never contradict (rule F-1). The change is reported by the caller. */
export function setPlatform(cfg: ScenarioConfig, field: keyof PlatformConfig, value: ParamValue): ScenarioConfig {
  const platform = { ...cfg.platform, [field]: value } as PlatformConfig;
  if (field === 'femArrangement') platform.antennaMode = value === 'SEPARATE' ? 'SEPARATE' : 'SHARED';
  return { ...cfg, platform };
}
export const resetPlatform = (cfg: ScenarioConfig, data: DataBundle): ScenarioConfig => ({ ...cfg, platform: defaultPlatform(data) });

export function applyPlatformPreset(cfg: ScenarioConfig, id: string, data: DataBundle): ScenarioConfig {
  const p = data.platformDefaults.presets.find((x) => x.id === id);
  return p ? { ...cfg, platform: { ...cfg.platform, ...(p.overrides as Partial<PlatformConfig>) } } : cfg;
}

/** A use case replaces the task list. */
export function applyUseCase(cfg: ScenarioConfig, id: string, data: DataBundle): ScenarioConfig {
  const u = data.useCases.find((x) => x.id === id);
  if (!u) return cfg;
  let next = clearTasks(cfg);
  for (const t of u.tasks) next = addTask(next, t.taskId, data, t.params ?? {});
  return { ...next, name: u.name };
}

export function setOverride(cfg: ScenarioConfig, kind: 'base' | 'bufferThreshold', key: string, value: number | undefined): ScenarioConfig {
  const o = { base: { ...(cfg.overrides?.base ?? {}) }, bufferThreshold: { ...(cfg.overrides?.bufferThreshold ?? {}) } };
  if (value === undefined) delete o[kind][key]; else o[kind][key] = value;
  const clean = { ...(Object.keys(o.base).length ? { base: o.base } : {}), ...(Object.keys(o.bufferThreshold).length ? { bufferThreshold: o.bufferThreshold } : {}) };
  const { overrides: _drop, ...rest } = cfg; void _drop;
  return Object.keys(clean).length ? { ...rest, overrides: clean } : rest;
}

export interface Gate { errors: ValidationIssue[]; warnings: ValidationIssue[]; infos: ValidationIssue[]; canGenerate: boolean; needsConfirm: boolean; badge: 'OK' | 'WARNINGS' | 'ERRORS' | 'EMPTY' }
export function gateOf(issues: ValidationIssue[], taskCount: number): Gate {
  const errors = issues.filter((i) => i.severity === 'ERROR'), warnings = issues.filter((i) => i.severity === 'WARNING'), infos = issues.filter((i) => i.severity === 'INFO');
  return { errors, warnings, infos, canGenerate: errors.length === 0 && taskCount > 0, needsConfirm: warnings.length > 0, badge: taskCount === 0 ? 'EMPTY' : errors.length ? 'ERRORS' : warnings.length ? 'WARNINGS' : 'OK' };
}

/** Which issues mention a task instance or a platform field, for the badges beside each item. */
export function issuesFor(issues: ValidationIssue[], target: { instanceId?: string; field?: string }): ValidationIssue[] {
  return issues.filter((i) => i.items.some((it) => (it.kind === 'task' ? target.instanceId !== undefined && it.instanceId === target.instanceId : target.field !== undefined && it.field === target.field)));
}
