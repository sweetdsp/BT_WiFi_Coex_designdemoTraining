// What the simulated device supports (spec FR-6c, FR-6d): greys out tasks, parameter values and options that the device settings rule out.
import type { DataBundle } from '../engine/data';
import type { ParamValue, PlatformConfig, TaskDef } from '../engine/types';

export interface Support { ok: boolean; reason?: string }
const OK: Support = { ok: true };

export function taskSupport(def: TaskDef, p: PlatformConfig, data: DataBundle): Support {
  if (def.tech === 'BT') {
    if (def.isoStream) return data.blePhy.isoMinCore > p.btMaxVersion ? { ok: false, reason: `needs Core ${data.blePhy.isoMinCore.toFixed(1)}; the device supports ${p.btMaxVersion.toFixed(1)}` } : OK;
    return def.minVersion > p.btMaxVersion ? { ok: false, reason: `needs Core ${def.minVersion.toFixed(1)}; the device supports ${p.btMaxVersion.toFixed(1)}` } : OK;
  }
  const gen = data.wifiGenerations[p.wifiGeneration];
  if (!gen) return OK;
  if (def.minVersion > gen.rank) return { ok: false, reason: `needs a newer Wi-Fi generation than ${gen.name}` };
  if (def.requiresFeature && !gen.features.includes(def.requiresFeature)) return { ok: false, reason: `needs ${def.requiresFeature}, which ${gen.name} does not have` };
  return OK;
}

/** Whether one value of a parameter is allowed on this device (PHY versions, version-gated values). */
export function valueSupport(def: TaskDef, name: string, value: ParamValue, p: PlatformConfig, data: DataBundle): Support {
  const pd = def.params[name];
  if (!pd) return OK;
  if (pd.isPhy) {
    const need = data.blePhy.phys[String(value)]?.minCore;
    if (need !== undefined && need > p.btMaxVersion) return { ok: false, reason: `needs Core ${need.toFixed(1)}` };
  }
  const g = pd.gate;
  if (g?.btCore && g.btCore > p.btMaxVersion) {
    const hit = (g.whenGt !== undefined && typeof value === 'number' && value > g.whenGt) || (g.whenIn !== undefined && g.whenIn.some((x) => String(x) === String(value)));
    if (hit) return { ok: false, reason: `needs Core ${g.btCore.toFixed(1)}` };
  }
  return OK;
}

/** Bands, widths and channels the Wi-Fi generation allows (FR-6d, FR-7). */
export function wifiOptions(p: PlatformConfig, data: DataBundle) {
  const gen = data.wifiGenerations[p.wifiGeneration];
  return {
    bands: gen?.bands ?? ['2.4', '5', '6'],
    bandwidths: gen?.bandwidths[p.wifiBand] ?? [20],
    channels: data.wifiBands[p.wifiBand]?.channels ?? [],
  };
}
