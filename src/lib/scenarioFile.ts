// Scenario files (spec FR-27): save, load, and re-validate on load so an edited file cannot bypass the gate (7C.5).
import { defaultParams } from '../engine/params';
import type { DataBundle } from '../engine/data';
import type { ParamMap, PlatformConfig, PriorityOverrides, ScenarioConfig } from '../engine/types';

export const FORMAT = 'coex-scenario';
export const VERSION = 1;

export interface ParseResult {
  config?: ScenarioConfig;
  /** Problems with the file itself, in plain language. */
  problems: string[];
  /** Things filled in from the defaults because the file did not have them. Never silent: shown to the user. */
  notices: string[];
}

export function serializeScenario(cfg: ScenarioConfig): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, name: cfg.name, tasks: cfg.tasks.map((t) => ({ instanceId: t.instanceId, taskId: t.taskId, params: t.params })), platform: cfg.platform, ...(cfg.overrides ? { overrides: cfg.overrides } : {}) }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Build a configuration from parsed JSON. Missing fields get defaults and are reported; wrong values are kept so the validator reports them. */
export function configFromObject(o: unknown, data: DataBundle): ParseResult {
  const problems: string[] = [], notices: string[] = [];
  if (!isObj(o)) return { problems: ['The file is not a scenario: expected a JSON object.'], notices };
  if (o.format !== undefined && o.format !== FORMAT) problems.push(`This does not look like a coex scenario file (format "${String(o.format)}").`);
  if (typeof o.version === 'number' && o.version > VERSION) problems.push(`The file was saved by a newer version of the tool (file version ${o.version}).`);
  if (!Array.isArray(o.tasks)) problems.push('The file has no list of tasks.');
  if (!isObj(o.platform)) problems.push('The file has no platform settings.');
  if (problems.length) return { problems, notices };

  const defaults = data.platformDefaults.defaults;
  const platform = { ...(o.platform as Record<string, unknown>) } as unknown as PlatformConfig;
  for (const [k, v] of Object.entries(defaults)) {
    if ((platform as unknown as Record<string, unknown>)[k] === undefined) {
      (platform as unknown as Record<string, unknown>)[k] = v;
      notices.push(`The platform setting "${data.platformFields.find((f) => f.field === k)?.label ?? k}" was missing, so the default (${String(v)}) was used.`);
    }
  }
  const used = new Set<string>();
  const tasks = (o.tasks as unknown[]).map((raw, i) => {
    const t = isObj(raw) ? raw : {};
    let id = typeof t.instanceId === 'string' && t.instanceId && !used.has(t.instanceId) ? t.instanceId : `t${i + 1}`;
    while (used.has(id)) id += 'x';
    used.add(id);
    const taskId = typeof t.taskId === 'string' ? t.taskId : String(t.taskId ?? '');
    const def = data.taskIndex.get(taskId);
    const params: ParamMap = isObj(t.params) ? { ...(t.params as ParamMap) } : {};
    if (def) {
      const base = defaultParams(def);
      for (const [name, v] of Object.entries(base)) if (params[name] === undefined) { params[name] = v; notices.push(`"${def.name}": the parameter "${def.params[name].label}" was missing, so the default (${String(v)}) was used.`); }
    }
    return { instanceId: id, taskId, params };
  });
  const cfg: ScenarioConfig = { name: typeof o.name === 'string' && o.name ? o.name : 'Loaded scenario', tasks, platform };
  if (isObj(o.overrides)) cfg.overrides = o.overrides as PriorityOverrides;
  return { config: cfg, problems, notices };
}

export function parseScenario(text: string, data: DataBundle): ParseResult {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { problems: ['The file is not valid JSON, so it cannot be read as a scenario.'], notices: [] }; }
  return configFromObject(o, data);
}
