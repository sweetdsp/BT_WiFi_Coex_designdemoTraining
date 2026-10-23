// Parameter helpers shared by the validator and the engine.
import type { DataBundle } from './data';
import type { ParamDef, ParamMap, ParamValue, PlatformConfig, TaskDef, TaskInstance } from './types';

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True when the value is acceptable for the definition (type, range, choice). */
export function paramValueValid(def: ParamDef, v: unknown): boolean {
  if (def.type === 'number') return isFiniteNumber(v) && (def.min === undefined || v >= def.min) && (def.max === undefined || v <= def.max);
  if (def.type === 'boolean') return typeof v === 'boolean';
  return def.choices?.some((c) => c === v || String(c) === String(v)) ?? false;
}

/** Parameters with defaults filled in. Invalid values fall back to the default so later stages never crash; stage 1 of the validator reports them. */
export function effectiveParams(def: TaskDef, inst: TaskInstance): ParamMap {
  const out: ParamMap = {};
  for (const [name, p] of Object.entries(def.params)) {
    const v = inst.params[name];
    if (v === undefined || !paramValueValid(p, v)) out[name] = p.default;
    else out[name] = p.type === 'choice' && typeof p.default === 'number' && typeof v === 'string' ? Number(v) : v;
  }
  return out;
}

export function defaultParams(def: TaskDef): ParamMap {
  const out: ParamMap = {};
  for (const [name, p] of Object.entries(def.params)) out[name] = p.default;
  return out;
}

export function nearestAllowed(def: ParamDef, v: unknown): ParamValue {
  if (def.type === 'number') {
    const n = isFiniteNumber(v) ? v : Number(def.default);
    return Math.min(def.max ?? n, Math.max(def.min ?? n, n));
  }
  return def.default;
}

export interface EffectiveWifi { genId: string; band: string; channel: number; bandwidth: number }

/** Wi-Fi channel and bandwidth for a task: its own value, or the platform's when set to 0 (FR-7). */
export function effectiveWifi(platform: PlatformConfig, params: ParamMap): EffectiveWifi {
  const ch = typeof params.channel === 'number' && params.channel > 0 ? params.channel : platform.wifiChannel;
  const bw = typeof params.bandwidthMHz === 'number' && params.bandwidthMHz > 0 ? params.bandwidthMHz : platform.wifiBandwidth;
  return { genId: platform.wifiGeneration, band: platform.wifiBand, channel: ch, bandwidth: bw };
}

export function wifiFootprint(data: DataBundle, band: string, channel: number, bandwidth: number): { center: number; low: number; high: number } {
  const b = data.wifiBands[band];
  const center = b.baseMHz + b.spacingMHz * channel;
  return { center, low: center - bandwidth / 2, high: center + bandwidth / 2 };
}

export function taskDisplayNames(tasks: { inst: TaskInstance; def: TaskDef }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.def.id, (counts.get(t.def.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const t of tasks) {
    const n = (seen.get(t.def.id) ?? 0) + 1;
    seen.set(t.def.id, n);
    out.set(t.inst.instanceId, (counts.get(t.def.id) ?? 1) > 1 ? `${t.def.name} ${String.fromCharCode(64 + n)}` : t.def.name);
  }
  return out;
}
