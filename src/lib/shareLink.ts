// Share link (spec 7B.12): the scenario encoded in the page address. Only values that differ from the defaults are stored.
import { defaultParams } from '../engine/params';
import type { DataBundle } from '../engine/data';
import { configFromObject, type ParseResult } from './scenarioFile';
import type { ParamMap, PlatformConfig, ScenarioConfig } from '../engine/types';

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Encode a scenario as a short string for the page address. */
export function encodeShare(cfg: ScenarioConfig, data: DataBundle): string {
  const d = data.platformDefaults.defaults as unknown as Record<string, unknown>;
  const plat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.platform)) if (JSON.stringify(v) !== JSON.stringify(d[k])) plat[k] = v;
  const tasks = cfg.tasks.map((t) => {
    const def = data.taskIndex.get(t.taskId);
    const base: ParamMap = def ? defaultParams(def) : {};
    const changed: ParamMap = {};
    for (const [k, v] of Object.entries(t.params)) if (JSON.stringify(v) !== JSON.stringify(base[k])) changed[k] = v;
    return Object.keys(changed).length ? [t.taskId, changed] : [t.taskId];
  });
  const payload: Record<string, unknown> = { v: 1, n: cfg.name, t: tasks };
  if (Object.keys(plat).length) payload.p = plat;
  if (cfg.overrides) payload.o = cfg.overrides;
  return b64(JSON.stringify(payload));
}

/** Decode a share string. Anything wrong comes back as a problem, never as an exception. */
export function decodeShare(text: string, data: DataBundle): ParseResult {
  let o: unknown;
  try { o = JSON.parse(unb64(text.trim())); } catch { return { problems: ['The share link is damaged and could not be read.'], notices: [] }; }
  if (typeof o !== 'object' || o === null) return { problems: ['The share link is damaged and could not be read.'], notices: [] };
  const p = o as { v?: number; n?: string; t?: unknown; p?: Record<string, unknown>; o?: unknown };
  if (!Array.isArray(p.t)) return { problems: ['The share link has no tasks.'], notices: [] };
  const full = {
    format: 'coex-scenario', version: 1, name: p.n,
    platform: { ...data.platformDefaults.defaults, ...(typeof p.p === 'object' && p.p ? p.p : {}) },
    tasks: p.t.map((row, i) => {
      const [taskId, changed] = Array.isArray(row) ? row : [row];
      const def = typeof taskId === 'string' ? data.taskIndex.get(taskId) : undefined;
      return { instanceId: `t${i + 1}`, taskId, params: { ...(def ? defaultParams(def) : {}), ...(typeof changed === 'object' && changed ? (changed as ParamMap) : {}) } };
    }),
    ...(p.o ? { overrides: p.o } : {}),
  };
  return configFromObject(full, data);
}

export const SHARE_KEY = 's';
export const shareHash = (cfg: ScenarioConfig, data: DataBundle) => `#${SHARE_KEY}=${encodeShare(cfg, data)}`;
export function shareFromHash(hash: string): string | null {
  const m = new RegExp(`[#&]${SHARE_KEY}=([^&]+)`).exec(hash);
  return m ? m[1] : null;
}
export type { PlatformConfig };
