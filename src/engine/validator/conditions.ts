// Rule condition functions (spec 7C.7). Each rule in validationRules.json names one of these.
// A condition inspects the context and returns one Finding per problem. Messages, labels and
// fix texts live in the data file; only the logic that decides "is there a problem" lives here.
import { classicPacket } from '../timing/bt';
import { effectiveWifi, isFiniteNumber, nearestAllowed, paramValueValid, wifiFootprint } from '../params';
import { parseChannelList } from '../estimate';
import { wifiGen } from '../timing/wifi';
import type { Finding, ParamDef, PlatformConfig, RuleFix } from '../types';
import { platformItem, taskItem, type Ctx, type RTask } from './context';

export type ConditionFn = (ctx: Ctx, params: Record<string, any>) => Finding[];

const restoreDefault = (t: RTask, name: string, def: ParamDef): RuleFix => ({
  fixId: 'restoreDefault', safe: true, vars: { param: def.label, value: String(def.default) },
  changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: name, value: def.default }],
});
const removeTask = (t: RTask, fixId = 'remove'): RuleFix => ({ fixId, vars: { task: t.name }, changes: [{ op: 'removeTask', instanceId: t.inst.instanceId }] });
const setPlatform = (fixId: string, field: keyof PlatformConfig, value: string | number | boolean, vars: Record<string, string | number> = {}, safe = false): RuleFix => ({
  fixId, safe, vars: { value: String(value), ...vars }, changes: [{ op: 'setPlatform', field, value }],
});
const isFiniteNum = isFiniteNumber;
const gens = (ctx: Ctx) => Object.entries(ctx.data.wifiGenerations).sort((a, b) => a[1].rank - b[1].rank);
const cmpGen = (ctx: Ctx, id: string) => wifiGen(ctx.data, id);
const wifiGenOk = (ctx: Ctx) => ctx.data.wifiGenerations[ctx.platform.wifiGeneration] !== undefined;

// ------------------------------------------------------------------ Stage 1
const paramOutOfRange: ConditionFn = (ctx, rp) => {
  const out: Finding[] = [];
  for (const t of ctx.tasks) {
    for (const [name, def] of Object.entries(t.def.params)) {
      const raw = t.inst.params[name];
      if (raw === undefined || raw === null || raw === '') continue; // V-2
      if (def.type === 'number') {
        if (!isFiniteNum(raw)) continue; // V-2
        if (!paramValueValid(def, raw)) {
          const near = nearestAllowed(def, raw);
          out.push({
            items: [taskItem(t, name)],
            vars: { task: t.name, param: def.label, value: raw, min: def.min ?? '', max: def.max ?? '', unit: def.unit ?? '', nearest: String(near) },
            fixes: [{ fixId: 'clamp', safe: true, vars: { param: def.label, nearest: String(near), unit: def.unit ?? '' }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: name, value: near }] }],
          });
        }
      } else if (def.type === 'choice' && !paramValueValid(def, raw)) {
        out.push({
          items: [taskItem(t, name)],
          vars: { task: t.name, param: def.label, value: String(raw), min: '', max: '', unit: '', nearest: String(def.default) },
          fixes: [restoreDefault(t, name, def)],
        });
      }
    }
    // Wi-Fi channel must exist in the chosen band.
    if (t.def.tech === 'WIFI') {
      const ch = t.inst.params.channel;
      const plan = ctx.data.wifiBands[ctx.platform.wifiBand]?.channels;
      if (isFiniteNum(ch) && ch > 0 && plan && !plan.includes(ch)) {
        const near = plan.reduce((a, b) => (Math.abs(b - ch) < Math.abs(a - ch) ? b : a));
        out.push({
          items: [taskItem(t, 'channel')],
          vars: { task: t.name, param: 'Channel', value: ch, min: plan[0], max: plan[plan.length - 1], unit: `in the ${ctx.platform.wifiBand} GHz band`, nearest: String(near) },
          fixes: [{ fixId: 'clamp', safe: true, vars: { param: 'Channel', nearest: String(near), unit: '' }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'channel', value: near }] }],
        });
      }
    }
  }
  const p = ctx.platform as unknown as Record<string, unknown>;
  const plan = ctx.data.wifiBands[ctx.platform.wifiBand]?.channels;
  if (plan && isFiniteNum(p.wifiChannel) && !plan.includes(p.wifiChannel as number)) {
    const v = p.wifiChannel as number;
    const near = plan.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    out.push({
      items: [platformItem('wifiChannel', 'Wi-Fi channel')],
      vars: { task: 'Platform', param: 'Wi-Fi channel', value: v, min: plan[0], max: plan[plan.length - 1], unit: `in the ${ctx.platform.wifiBand} GHz band`, nearest: String(near) },
      fixes: [{ fixId: 'clamp', safe: true, vars: { param: 'Wi-Fi channel', nearest: String(near), unit: '' }, changes: [{ op: 'setPlatform', field: 'wifiChannel', value: near }] }],
    });
  }
  for (const [field, range] of Object.entries((rp.platformRanges ?? {}) as Record<string, [number, number]>)) {
    const v = p[field];
    if (isFiniteNum(v) && (v < range[0] || v > range[1])) {
      const near = Math.min(range[1], Math.max(range[0], v));
      out.push({
        items: [platformItem(field)],
        vars: { task: 'Platform', param: field, value: v, min: range[0], max: range[1], unit: '', nearest: String(near) },
        fixes: [{ fixId: 'clamp', safe: true, vars: { param: field, nearest: String(near), unit: '' }, changes: [{ op: 'setPlatform', field: field as keyof PlatformConfig, value: near }] }],
      });
    }
  }
  // Edits to the priority table must be sensible numbers.
  const ov = ctx.cfg.overrides;
  for (const [group, label] of [['base', 'Base priority'], ['bufferThreshold', 'Critical threshold']] as const) {
    for (const [k, v] of Object.entries((ov?.[group] ?? {}) as Record<string, unknown>)) {
      const [lo, hi] = group === 'base' ? [0, 1000] : [1, 64];
      if (isFiniteNum(v) && (v < lo || v > hi)) {
        out.push({
          items: [platformItem('overrides', `${label} of ${k}`)],
          vars: { task: 'Priority table', param: `${label} of ${k}`, value: v, min: lo, max: hi, unit: '', nearest: String(Math.min(hi, Math.max(lo, v))) },
          fixes: [],
        });
      }
    }
  }
  return out;
};

const missingOrNaN: ConditionFn = (ctx, rp) => {
  const out: Finding[] = [];
  for (const inst of ctx.unknown) {
    out.push({
      items: [{ kind: 'task', instanceId: inst.instanceId, label: String(inst.taskId) }],
      vars: { task: String(inst.taskId), param: 'task', what: 'is not in the task catalogue' },
      fixes: [{ fixId: 'remove', vars: { task: String(inst.taskId) }, changes: [{ op: 'removeTask', instanceId: inst.instanceId }] }],
    });
  }
  for (const t of ctx.tasks) {
    for (const [name, def] of Object.entries(t.def.params)) {
      const raw = t.inst.params[name];
      const empty = raw === undefined || raw === null || raw === '';
      const nanNum = def.type === 'number' && !empty && !isFiniteNum(raw);
      const badBool = def.type === 'boolean' && !empty && typeof raw !== 'boolean';
      if (empty || nanNum || badBool) {
        out.push({ items: [taskItem(t, name)], vars: { task: t.name, param: def.label, what: empty ? 'is empty' : 'is not a valid value' }, fixes: [restoreDefault(t, name, def)] });
      }
    }
  }
  const p = ctx.platform as unknown as Record<string, unknown>;
  const defaults = ctx.data.platformDefaults.defaults as unknown as Record<string, unknown>;
  for (const field of (rp.platformNumeric ?? []) as string[]) {
    const v = p[field];
    if (v === undefined || v === null || (typeof defaults[field] === 'number' && !isFiniteNum(v))) {
      out.push({
        items: [platformItem(field)],
        vars: { task: 'Platform', param: field, what: v === undefined || v === null ? 'is empty' : 'is not a number' },
        fixes: [{ fixId: 'restoreDefault', safe: true, vars: { param: field, value: String(defaults[field]) }, changes: [{ op: 'setPlatform', field: field as keyof PlatformConfig, value: defaults[field] as number }] }],
      });
    }
  }
  return out;
};

const scanWindowExceedsInterval: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  for (const t of ctx.tasks) {
    const w = t.inst.params.scanWindowMs;
    const i = t.inst.params.scanIntervalMs;
    if (isFiniteNum(w) && isFiniteNum(i) && w > i) {
      out.push({
        items: [taskItem(t, 'scanWindowMs'), taskItem(t, 'scanIntervalMs')],
        vars: { task: t.name, window: w, interval: i, half: Math.max(t.def.params.scanWindowMs.min ?? 0, i / 2) },
        fixes: [
          { fixId: 'equal', safe: true, vars: { interval: i }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'scanWindowMs', value: i }] },
          { fixId: 'half', vars: { half: Math.max(t.def.params.scanWindowMs.min ?? 0, i / 2) }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'scanWindowMs', value: Math.max(t.def.params.scanWindowMs.min ?? 0, i / 2) }] },
        ],
      });
    }
  }
  return out;
};

const packetTypeFit: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  for (const t of ctx.tasks) {
    const key = t.params.packetType;
    if (typeof key !== 'string' || !ctx.data.btPackets[key]) continue;
    const pkt = classicPacket(ctx.data, key);
    const limit = Number(t.params.slotLimit);
    if (Number.isFinite(limit) && pkt.slots > limit) {
      const alt = Object.entries(ctx.data.btPackets).filter(([k, v]) => v.family === pkt.family && v.slots <= limit && (t.def.params.packetType.choices ?? []).includes(k)).sort((a, b) => b[1].maxPayloadBytes - a[1].maxPayloadBytes)[0];
      const fixes: RuleFix[] = [];
      const slotChoices = (t.def.params.slotLimit.choices ?? []).map(Number);
      if (slotChoices.includes(pkt.slots)) fixes.push({ fixId: 'raiseSlotLimit', vars: { slots: pkt.slots }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'slotLimit', value: pkt.slots }] });
      if (alt) fixes.push({ fixId: 'shorterPacket', vars: { packet: alt[0] }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'packetType', value: alt[0] }] });
      out.push({ items: [taskItem(t, 'packetType'), taskItem(t, 'slotLimit')], vars: { task: t.name, packet: key, slots: pkt.slots, limit, what: `needs ${pkt.slots} slots but the link allows ${limit}` }, fixes });
      continue;
    }
    const pay = t.inst.params.payloadBytes;
    if (isFiniteNum(pay) && pay > pkt.maxPayloadBytes) {
      out.push({
        items: [taskItem(t, 'payloadBytes'), taskItem(t, 'packetType')],
        vars: { task: t.name, packet: key, slots: pkt.slots, limit: pay, what: `carries at most ${pkt.maxPayloadBytes} bytes but the payload is ${pay}` },
        fixes: [{ fixId: 'clampPayload', safe: true, vars: { max: pkt.maxPayloadBytes }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'payloadBytes', value: pkt.maxPayloadBytes }] }],
      });
    }
  }
  return out;
};

const windowBounds: ConditionFn = (ctx) => {
  const w = ctx.platform.windowUs;
  const { minWindowUs, maxWindowUs } = ctx.data.limits;
  if (!isFiniteNum(w) || (w >= minWindowUs && w <= maxWindowUs)) return [];
  const near = Math.min(maxWindowUs, Math.max(minWindowUs, w));
  return [{
    items: [platformItem('windowUs', 'Simulation window')],
    vars: { window: w, min: minWindowUs, max: maxWindowUs, nearest: near },
    fixes: [{ fixId: 'clamp', safe: true, vars: { nearest: near }, changes: [{ op: 'setPlatform', field: 'windowUs', value: near }] }],
  }];
};

// ------------------------------------------------------------------ Stage 2
function versionBlocked(ctx: Ctx, t: RTask): boolean {
  if (t.def.tech === 'BT') return !t.def.isoStream && t.def.minVersion > ctx.platform.btMaxVersion;
  return wifiGenOk(ctx) && t.def.minVersion > cmpGen(ctx, ctx.platform.wifiGeneration).rank;
}

const versionUnsupported: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  for (const t of ctx.tasks) {
    if (t.def.tech === 'BT') {
      if (!t.def.isoStream && t.def.minVersion > ctx.platform.btMaxVersion) {
        out.push({
          items: [taskItem(t), platformItem('btMaxVersion', 'Bluetooth Core version')],
          vars: { task: t.name, need: `Core ${t.def.minVersion.toFixed(1)}`, have: `Core ${ctx.platform.btMaxVersion.toFixed(1)}` },
          fixes: [setPlatform('raiseBt', 'btMaxVersion', t.def.minVersion, { version: t.def.minVersion.toFixed(1) }), removeTask(t)],
        });
      }
      for (const [name, def] of Object.entries(t.def.params)) {
        const g = def.gate;
        const v = t.params[name];
        if (!g?.btCore || g.btCore <= ctx.platform.btMaxVersion) continue;
        const hit = (g.whenGt !== undefined && typeof v === 'number' && v > g.whenGt) || (g.whenIn !== undefined && g.whenIn.some((x) => String(x) === String(v)));
        if (hit) {
          out.push({
            items: [taskItem(t, name), platformItem('btMaxVersion', 'Bluetooth Core version')],
            vars: { task: `${t.name} (${def.label} ${v})`, need: `Core ${g.btCore.toFixed(1)}`, have: `Core ${ctx.platform.btMaxVersion.toFixed(1)}` },
            fixes: [setPlatform('raiseBt', 'btMaxVersion', g.btCore, { version: g.btCore.toFixed(1) }), restoreDefault(t, name, def)],
          });
        }
      }
    } else if (versionBlocked(ctx, t)) {
      const target = gens(ctx).find(([, g]) => g.rank >= t.def.minVersion);
      out.push({
        items: [taskItem(t), platformItem('wifiGeneration', 'Wi-Fi generation')],
        vars: { task: t.name, need: target ? target[1].name : `generation rank ${t.def.minVersion}`, have: cmpGen(ctx, ctx.platform.wifiGeneration).name },
        fixes: [...(target ? [setPlatform('raiseWifi', 'wifiGeneration', target[0], { generation: target[1].name })] : []), removeTask(t)],
      });
    }
  }
  return out;
};

const bandwidthBandNotAllowed: ConditionFn = (ctx) => {
  if (ctx.wifi.length === 0 || !wifiGenOk(ctx)) return [];
  const g = cmpGen(ctx, ctx.platform.wifiGeneration);
  const out: Finding[] = [];
  const band = ctx.platform.wifiBand;
  const bandOk = g.bands.includes(band);
  if (!bandOk) {
    out.push({
      items: [platformItem('wifiBand', 'Wi-Fi band'), ...ctx.wifi.map((t) => taskItem(t))],
      vars: { what: `${band} GHz`, generation: g.name, allowed: g.bands.join(', ') + ' GHz' },
      fixes: [setPlatform('setBand', 'wifiBand', g.bands[0], { band: g.bands[0] })],
    });
  }
  const allowed = g.bandwidths[band];
  const check = (bw: number, item: ReturnType<typeof platformItem> | ReturnType<typeof taskItem>, fixChange: RuleFix, label: string) => {
    if (bw > 0 && allowed && !allowed.includes(bw)) {
      out.push({ items: [item], vars: { what: `${bw} MHz ${label} in the ${band} GHz band`, generation: g.name, allowed: allowed.join(', ') + ' MHz' }, fixes: [fixChange] });
    }
  };
  if (bandOk && allowed) {
    const best = Math.max(...allowed.filter((a) => a <= ctx.platform.wifiBandwidth), allowed[0]);
    check(ctx.platform.wifiBandwidth, platformItem('wifiBandwidth', 'Wi-Fi bandwidth'), setPlatform('setBandwidth', 'wifiBandwidth', best, { bandwidth: best }), 'bandwidth');
    for (const t of ctx.wifi) {
      const bw = Number(t.inst.params.bandwidthMHz);
      if (Number.isFinite(bw)) {
        const b = Math.max(...allowed.filter((a) => a <= bw), allowed[0]);
        check(bw, taskItem(t, 'bandwidthMHz'), { fixId: 'setBandwidth', vars: { bandwidth: b }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'bandwidthMHz', value: b }] }, `bandwidth for ${t.name}`);
      }
    }
  }
  return out;
};

const phyOrIsoUnsupported: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  const max = ctx.platform.btMaxVersion;
  for (const t of ctx.bt) {
    for (const [name, def] of Object.entries(t.def.params)) {
      if (!def.isPhy) continue;
      const phy = String(t.params[name]);
      const need = ctx.data.blePhy.phys[phy]?.minCore;
      if (need !== undefined && need > max) {
        out.push({
          items: [taskItem(t, name), platformItem('btMaxVersion', 'Bluetooth Core version')],
          vars: { task: t.name, what: `the ${ctx.data.blePhy.phys[phy].label} PHY`, need: `Core ${need.toFixed(1)}`, have: `Core ${max.toFixed(1)}` },
          fixes: [setPlatform('raiseBt', 'btMaxVersion', need, { version: need.toFixed(1) }), { fixId: 'usePhy1M', safe: false, vars: {}, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: name, value: '1M' }] }],
        });
      }
    }
    if (t.def.isoStream && ctx.data.blePhy.isoMinCore > max) {
      out.push({
        items: [taskItem(t), platformItem('btMaxVersion', 'Bluetooth Core version')],
        vars: { task: t.name, what: 'LE Audio isochronous streams', need: `Core ${ctx.data.blePhy.isoMinCore.toFixed(1)}`, have: `Core ${max.toFixed(1)}` },
        fixes: [setPlatform('raiseBt', 'btMaxVersion', ctx.data.blePhy.isoMinCore, { version: ctx.data.blePhy.isoMinCore.toFixed(1) }), removeTask(t)],
      });
    }
  }
  return out;
};

const featureMissing: ConditionFn = (ctx) => {
  if (!wifiGenOk(ctx)) return [];
  const g = cmpGen(ctx, ctx.platform.wifiGeneration);
  const out: Finding[] = [];
  for (const t of ctx.wifi) {
    const f = t.def.requiresFeature;
    if (!f || g.features.includes(f) || versionBlocked(ctx, t)) continue;
    const target = gens(ctx).find(([, x]) => x.features.includes(f));
    out.push({
      items: [taskItem(t), platformItem('wifiGeneration', 'Wi-Fi generation')],
      vars: { task: t.name, feature: f, generation: g.name, need: target ? target[1].name : 'a newer generation' },
      fixes: [...(target ? [setPlatform('raiseWifi', 'wifiGeneration', target[0], { generation: target[1].name })] : []), removeTask(t)],
    });
  }
  return out;
};

const highBandNoOverlap: ConditionFn = (ctx) => {
  if (ctx.bt.length === 0) return [];
  const high = ctx.wifi.filter((t) => {
    if (ctx.platform.wifiBand === '2.4') return false;
    const links = String(t.params.linkBands ?? '');
    return !links.split('+').includes('2.4');
  });
  if (high.length === 0) return [];
  const quiet = ctx.platform.antennaMode === 'SEPARATE' && ctx.platform.isolationDb >= ctx.platform.interactionThresholdDb;
  return [{
    items: [platformItem('wifiBand', 'Wi-Fi band'), ...high.map((t) => taskItem(t))],
    vars: { band: ctx.platform.wifiBand, count: high.length },
    severity: quiet ? 'INFO' : 'WARNING',
    fixes: [setPlatform('use24', 'wifiBand', '2.4')],
  }];
};

const roleConflict: ConditionFn = (ctx, rp) => {
  if (ctx.platform.wifiMultiRole) return [];
  const ap = ctx.wifi.filter((t) => (rp.apRoles as string[]).includes(String(t.params.role)));
  const sta = ctx.wifi.filter((t) => (rp.staRoles as string[]).includes(String(t.params.role)));
  if (ap.length === 0 || sta.length === 0) return [];
  return [{
    items: [...ap, ...sta].map((t) => taskItem(t, 'role')),
    vars: { ap: ap.map((t) => t.name).join(', '), sta: sta.map((t) => t.name).join(', ') },
    fixes: [setPlatform('enableMultiRole', 'wifiMultiRole', true), ...ap.map((t) => removeTask(t, 'removeAp'))],
  }];
};

// ------------------------------------------------------------------ Stage 3
interface Res { t: RTask; interval: number; offset: number; total: number }

function reservation(ctx: Ctx, t: RTask): Res | undefined {
  const r = t.def.slotReservation;
  if (!r) return undefined;
  const interval = Number(t.params[r.intervalParam]);
  const offset = r.offsetParam ? Number(t.params[r.offsetParam]) : 0;
  const pkt = ctx.data.btPackets[String(t.params.packetType ?? 'POLL')];
  const pairs = r.pairsParam ? Number(t.params[r.pairsParam]) : 1;
  const win = r.windowParam ? Number(t.params[r.windowParam]) : 0;
  const total = pairs * 2 * (pkt?.slots ?? 1) + win;
  if (!Number.isFinite(interval) || interval <= 0) return undefined;
  return { t, interval, offset: Number.isFinite(offset) ? offset : 0, total };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
function slotSet(r: Res, period: number): Set<number> {
  const s = new Set<number>();
  for (let base = r.offset % r.interval; base < period + r.interval; base += r.interval) for (let k = 0; k < r.total; k++) s.add((base + k) % period);
  return s;
}
function collide(a: Res, b: Res, cap: number): number[] {
  const period = Math.min(cap, (a.interval * b.interval) / gcd(a.interval, b.interval));
  const sa = slotSet(a, period);
  const hit: number[] = [];
  for (const x of slotSet(b, period)) if (sa.has(x)) hit.push(x);
  return hit.sort((x, y) => x - y);
}

const slotCollision: ConditionFn = (ctx, rp) => {
  const res = ctx.tasks.filter((t) => t.def.slotReservation?.exclusive).map((t) => reservation(ctx, t)).filter((r): r is Res => !!r);
  const out: Finding[] = [];
  for (let i = 0; i < res.length; i++) {
    for (let j = i + 1; j < res.length; j++) {
      const hit = collide(res[i], res[j], rp.periodCapSlots);
      if (hit.length === 0) continue;
      const b = res[j];
      const others = res.filter((r) => r !== b);
      const fixes: RuleFix[] = [];
      for (let o = 0; o < b.interval; o += 2) {
        const cand = { ...b, offset: o };
        if (others.every((r) => collide(r, cand, rp.periodCapSlots).length === 0)) {
          const param = b.t.def.slotReservation!.offsetParam!;
          fixes.push({ fixId: 'moveOffset', vars: { task: b.t.name, offset: o }, changes: [{ op: 'setParam', instanceId: b.t.inst.instanceId, param, value: o }] });
          break;
        }
      }
      fixes.push(removeTask(b.t));
      out.push({
        items: [taskItem(res[i].t, res[i].t.def.slotReservation!.offsetParam), taskItem(b.t, b.t.def.slotReservation!.offsetParam)],
        vars: { a: res[i].t.name, b: b.t.name, slots: hit.slice(0, 4).join(', '), interval: res[i].interval },
        fixes,
      });
    }
  }
  return out;
};

const exclusivePairs: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  for (const rule of ctx.data.groupRules.exclusivePairs) {
    const a = ctx.tasks.find((t) => t.def.id === rule.a);
    const b = ctx.tasks.find((t) => t.def.id === rule.b);
    if (a && b) out.push({ items: [taskItem(a), taskItem(b)], vars: { a: a.name, b: b.name, why: rule.reason }, fixes: [removeTask(b)] });
  }
  return out;
};

const groupLimits: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  for (const rule of ctx.data.groupRules.groupLimits) {
    const members = ctx.tasks.filter((t) => t.def.tags.includes(rule.countTag));
    const limit = Number(ctx.platform[rule.platformField]);
    if (Number.isFinite(limit) && members.length > limit) {
      out.push({
        items: [...members.map((t) => taskItem(t)), platformItem(String(rule.platformField), rule.what)],
        vars: { what: rule.what, count: members.length, limit, why: rule.reason },
        fixes: [setPlatform('raiseLimit', rule.platformField, members.length, { what: rule.what, count: members.length }), removeTask(members[members.length - 1])],
      });
    }
  }
  return out;
};

const a2dpWithVoice: ConditionFn = (ctx) => {
  const a = ctx.tasks.filter((t) => t.def.tags.includes('A2DP'));
  const v = ctx.bt.filter((t) => t.def.tags.includes('VOICE_LINK'));
  if (a.length === 0 || v.length === 0) return [];
  return [{
    items: [...a, ...v].map((t) => taskItem(t, t.def.tags.includes('A2DP') ? 'onVoice' : undefined)),
    vars: { audio: a.map((t) => t.name).join(', '), voice: v.map((t) => t.name).join(', ') },
    fixes: [
      ...a.map((t): RuleFix => ({ fixId: 'pauseAudio', vars: { task: t.name }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'onVoice', value: 'PAUSE' }] })),
      ...a.map((t): RuleFix => ({ fixId: 'reduceAudio', vars: { task: t.name }, changes: [{ op: 'setParam', instanceId: t.inst.instanceId, param: 'onVoice', value: 'REDUCE' }] })),
    ],
  }];
};

const duplicates: ConditionFn = (ctx) => {
  const out: Finding[] = [];
  const seen = new Map<string, RTask>();
  for (const t of ctx.tasks) {
    const key = `${t.def.id}|${JSON.stringify(Object.entries(t.params).sort(([a], [b]) => a.localeCompare(b)))}`;
    const first = seen.get(key);
    if (first) out.push({ items: [taskItem(first), taskItem(t)], vars: { task: t.def.name }, fixes: [removeTask(t, 'removeDuplicate')] });
    else seen.set(key, t);
  }
  return out;
};

const tooManyTasks: ConditionFn = (ctx) => {
  const lim = ctx.data.limits.maxTasksWarn as { BT: number; WIFI: number; TOTAL: number };
  const total = ctx.tasks.length;
  if (ctx.bt.length > lim.BT || ctx.wifi.length > lim.WIFI || total > lim.TOTAL) {
    const last = ctx.tasks[ctx.tasks.length - 1];
    return [{
      items: ctx.tasks.map((t) => taskItem(t)),
      vars: { bt: ctx.bt.length, wifi: ctx.wifi.length, total, limBt: lim.BT, limWifi: lim.WIFI, limTotal: lim.TOTAL },
      fixes: [removeTask(last, 'removeLast')],
    }];
  }
  return [];
};

const channelMismatchSingleRadio: ConditionFn = (ctx) => {
  if (!(ctx.platform.coreCount <= 1 && ctx.platform.coreMode !== 'CONCURRENT')) return [];
  const list = ctx.wifi.filter((t) => !t.def.sweepsChannels);
  const out: Finding[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = effectiveWifi(ctx.platform, list[i].params);
      const b = effectiveWifi(ctx.platform, list[j].params);
      if (a.channel !== b.channel || a.bandwidth !== b.bandwidth) {
        out.push({
          items: [taskItem(list[i], 'channel'), taskItem(list[j], 'channel')],
          vars: { a: list[i].name, b: list[j].name, chA: a.channel, chB: b.channel, bwA: a.bandwidth, bwB: b.bandwidth },
          fixes: [
            { fixId: 'alignChannel', vars: { task: list[j].name, channel: a.channel }, changes: [{ op: 'setParam', instanceId: list[j].inst.instanceId, param: 'channel', value: a.channel }, { op: 'setParam', instanceId: list[j].inst.instanceId, param: 'bandwidthMHz', value: a.bandwidth }] },
            setPlatform('enableConcurrent', 'coreMode', 'CONCURRENT'),
            setPlatform('moreCores', 'coreCount', 2),
          ],
        });
      }
    }
  }
  return out;
};

// ------------------------------------------------------------------ Stage 4
const slotBudget: ConditionFn = (ctx, rp) => {
  const res = ctx.bt.map((t) => reservation(ctx, t)).filter((r): r is Res => !!r);
  if (res.length === 0) return [];
  const pct = res.reduce((a, r) => a + r.total / r.interval, 0) * 100;
  const above = Number(ctx.data.limits[rp.above]);
  const upTo = rp.upTo ? Number(ctx.data.limits[rp.upTo]) : Infinity;
  if (!(pct > above && pct <= upTo)) return [];
  const heavy = res.reduce((a, b) => (b.total / b.interval > a.total / a.interval ? b : a));
  const intervalParam = heavy.t.def.slotReservation!.intervalParam;
  const def = heavy.t.def.params[intervalParam];
  const longer = Math.min(def.max ?? heavy.interval * 2, heavy.interval * 2);
  return [{
    items: res.map((r) => taskItem(r.t)),
    vars: { pct: Math.round(pct * 10) / 10, links: res.map((r) => r.t.name).join(', ') },
    fixes: [
      ...(def.type === 'number' && longer > heavy.interval ? [{ fixId: 'lengthenInterval', vars: { task: heavy.t.name, interval: longer }, changes: [{ op: 'setParam' as const, instanceId: heavy.t.inst.instanceId, param: intervalParam, value: longer }] }] : []),
      removeTask(heavy.t),
    ],
  }];
};

const airtimeLoad: ConditionFn = (ctx, rp) => {
  const windowUs = ctx.platform.windowUs;
  if (!(windowUs > 0)) return [];
  const above = Number(ctx.data.limits[rp.above]);
  const upTo = rp.upTo ? Number(ctx.data.limits[rp.upTo]) : Infinity;
  const out: Finding[] = [];
  for (const [tech, list] of [['Bluetooth', ctx.bt], ['Wi-Fi', ctx.wifi]] as const) {
    if (list.length === 0) continue;
    const us = list.reduce((a, t) => a + ctx.load(t).airtimeUs, 0);
    const pct = (us / windowUs) * 100;
    if (!(pct > above && pct <= upTo)) continue;
    const heavy = list.reduce((a, b) => (ctx.load(b).airtimeUs > ctx.load(a).airtimeUs ? b : a));
    const fixes: RuleFix[] = [];
    for (const key of ['bitrateMbps', 'dutyCyclePct', 'bitrateKbps']) {
      const def = heavy.def.params[key];
      if (def && typeof heavy.params[key] === 'number') {
        const half = Math.max(def.min ?? 0, Math.round(((heavy.params[key] as number) / 2) * 100) / 100);
        fixes.push({ fixId: 'lowerBitrate', vars: { task: heavy.name, value: half, unit: def.unit ?? '' }, changes: [{ op: 'setParam', instanceId: heavy.inst.instanceId, param: key, value: half }] });
        break;
      }
    }
    if (tech === 'Wi-Fi' && wifiGenOk(ctx)) {
      const allowed = cmpGen(ctx, ctx.platform.wifiGeneration).bandwidths[ctx.platform.wifiBand] ?? [];
      const wider = allowed.find((b) => b > ctx.platform.wifiBandwidth);
      if (wider) fixes.push(setPlatform('widenChannel', 'wifiBandwidth', wider, { bandwidth: wider }));
    }
    fixes.push(removeTask(heavy));
    out.push({ items: list.map((t) => taskItem(t)), vars: { tech, pct: Math.round(pct), heavy: heavy.name }, fixes });
  }
  return out;
};

const coresCannotServe: ConditionFn = (ctx) => {
  const p = ctx.platform;
  if (p.coreCount <= 1 && p.coreMode === 'TIME_DIVISION' && p.simultaneousWifiTxBtRx) {
    return [{
      items: [platformItem('coreCount', 'Number of cores'), platformItem('coreMode', 'Core mode'), platformItem('simultaneousWifiTxBtRx', 'Simultaneous Wi-Fi TX with Bluetooth RX')],
      vars: {},
      fixes: [setPlatform('moreCores', 'coreCount', 2), setPlatform('enableConcurrent', 'coreMode', 'CONCURRENT'), setPlatform('turnOffSimultaneous', 'simultaneousWifiTxBtRx', false)],
    }];
  }
  return [];
};

// ------------------------------------------------------------------ Stage 5
const platformContradiction: ConditionFn = (ctx) => {
  const p = ctx.platform;
  const out: Finding[] = [];
  const sepFem = p.femArrangement === 'SEPARATE';
  if (sepFem !== (p.antennaMode === 'SEPARATE')) {
    const want = sepFem ? 'SEPARATE' : 'SHARED';
    out.push({
      items: [platformItem('femArrangement', 'Front-end arrangement'), platformItem('antennaMode', 'Antenna mode')],
      vars: { what: `the front-end is "${p.femArrangement}" but the antenna mode is "${p.antennaMode}"` },
      fixes: [setPlatform('matchAntenna', 'antennaMode', want, { mode: want }), setPlatform('matchFem', 'femArrangement', p.antennaMode === 'SEPARATE' ? 'SEPARATE' : 'SHARED_SWITCH', { mode: p.antennaMode })],
    });
  }
  const m = /^(\d+)x(\d+)$/.exec(String(p.txRxStreams));
  if (!m) {
    out.push({ items: [platformItem('txRxStreams', 'TX/RX streams')], vars: { what: `the stream setting "${p.txRxStreams}" is not in the form 1x1 or 2x2` }, fixes: [setPlatform('setStreams', 'txRxStreams', '1x1', { streams: '1x1' }, true)] });
  } else if (Number(m[1]) > p.wifiChains || Number(m[2]) > p.wifiChains) {
    out.push({
      items: [platformItem('txRxStreams', 'TX/RX streams'), platformItem('wifiChains', 'Wi-Fi chains')],
      vars: { what: `${p.txRxStreams} streams need ${Math.max(Number(m[1]), Number(m[2]))} chains but the device has ${p.wifiChains}` },
      fixes: [setPlatform('setStreams', 'txRxStreams', `${p.wifiChains}x${p.wifiChains}`, { streams: `${p.wifiChains}x${p.wifiChains}` }), setPlatform('setChains', 'wifiChains', Math.max(Number(m[1]), Number(m[2])), { chains: Math.max(Number(m[1]), Number(m[2])) })],
    });
  }
  return out;
};

const isolationRange: ConditionFn = (ctx) => {
  const v = ctx.platform.isolationDb;
  const { isolationMinDb: lo, isolationMaxDb: hi } = ctx.data.limits;
  if (!isFiniteNum(v) || (v >= lo && v <= hi)) return [];
  const near = Math.min(hi, Math.max(lo, v));
  return [{ items: [platformItem('isolationDb', 'Isolation')], vars: { value: v, min: lo, max: hi, nearest: near }, fixes: [setPlatform('clamp', 'isolationDb', near, { nearest: near }, true)] }];
};

const concurrentLowIsolation: ConditionFn = (ctx) => {
  const p = ctx.platform;
  if (p.coreMode === 'CONCURRENT' && p.antennaMode === 'SEPARATE' && p.isolationDb < p.interactionThresholdDb) {
    return [{ items: [platformItem('coreMode', 'Core mode'), platformItem('isolationDb', 'Isolation')], vars: { isolation: p.isolationDb, threshold: p.interactionThresholdDb }, fixes: [setPlatform('raiseIsolation', 'isolationDb', p.interactionThresholdDb, { threshold: p.interactionThresholdDb })] }];
  }
  return [];
};

const afhNoWifi: ConditionFn = (ctx) => {
  if (ctx.platform.afhEnabled && ctx.wifi.length === 0) {
    return [{ items: [platformItem('afhEnabled', 'Adaptive frequency hopping')], vars: {}, fixes: [setPlatform('turnOffAfh', 'afhEnabled', false)] }];
  }
  return [];
};

/** Classic channels left outside the Wi-Fi footprint plus guard. */
function channelsOutside(ctx: Ctx): number | undefined {
  if (ctx.platform.wifiBand !== '2.4' || !wifiGenOk(ctx)) return undefined;
  const fp = wifiFootprint(ctx.data, '2.4', ctx.platform.wifiChannel, ctx.platform.wifiBandwidth);
  const g = ctx.platform.guardMHz;
  let outside = 0;
  const c = ctx.data.constants;
  for (let k = 0; k < c.classicHopChannels; k++) {
    const f = c.classicBaseMHz + k;
    if (f < fp.low - g || f > fp.high + g) outside++;
  }
  return outside;
}

const afhMinTooHigh: ConditionFn = (ctx, rp) => {
  if (!ctx.platform.afhEnabled) return [];
  const outside = channelsOutside(ctx);
  if (outside === undefined) return [];
  const min = ctx.platform.afhMinChannelsClassic;
  const allowedMin = Number(rp.protocolMinClassic);
  if (isFiniteNum(min) && min > outside + allowedMin) {
    return [{
      items: [platformItem('afhMinChannelsClassic', 'AFH minimum channels')],
      vars: { min, outside, allowedMin, limit: outside + allowedMin },
      fixes: [setPlatform('lowerMin', 'afhMinChannelsClassic', outside, { outside }, true)],
    }];
  }
  return [];
};

const timeShareInvalid: ConditionFn = (ctx) => {
  const p = ctx.platform;
  if (p.arbitrationPolicy !== 'TIME_SHARE') return [];
  const bad = !(p.timeShareBtPercent > 0 && p.timeShareBtPercent < 100) || !(p.timeShareSliceUs > 0) || p.timeShareSliceUs > p.windowUs;
  if (!bad) return [];
  const d = ctx.data.platformDefaults.defaults;
  return [{
    items: [platformItem('timeShareBtPercent', 'Time-share ratio'), platformItem('timeShareSliceUs', 'Time-share slice length')],
    vars: { ratio: p.timeShareBtPercent, slice: p.timeShareSliceUs, window: p.windowUs },
    fixes: [{ fixId: 'resetTimeShare', safe: true, vars: { ratio: d.timeShareBtPercent, slice: d.timeShareSliceUs }, changes: [{ op: 'setPlatform', field: 'timeShareBtPercent', value: d.timeShareBtPercent }, { op: 'setPlatform', field: 'timeShareSliceUs', value: d.timeShareSliceUs }] }],
  }];
};

// ------------------------------------------------------------------ Stage 6
const windowShort: ConditionFn = (ctx) => {
  const w = ctx.platform.windowUs;
  const out: Finding[] = [];
  const maxW = ctx.data.limits.maxWindowUs;
  for (const t of ctx.tasks) {
    if (t.def.generator === 'ONE_SHOT_EXCHANGE' || t.def.generator === 'IRREGULAR_BURSTS') continue;
    const interval = ctx.load(t).eventIntervalUs;
    if (w < 2 * interval) {
      const want = Math.min(maxW, Math.ceil(2 * interval));
      out.push({
        items: [taskItem(t), platformItem('windowUs', 'Simulation window')],
        vars: { task: t.name, interval: Math.round(interval), window: w, want },
        fixes: [setPlatform('lengthenWindow', 'windowUs', want, { window: want })],
      });
    }
  }
  return out;
};

const blockCount: ConditionFn = (ctx, rp) => {
  const total = ctx.tasks.reduce((a, t) => a + ctx.load(t).blocks, 0);
  const above = Number(ctx.data.limits[rp.above]);
  const upTo = rp.upTo ? Number(ctx.data.limits[rp.upTo]) : Infinity;
  if (!(total > above && total <= upTo)) return [];
  const heavy = ctx.tasks.length ? ctx.tasks.reduce((a, b) => (ctx.load(b).blocks > ctx.load(a).blocks ? b : a)) : undefined;
  const shorter = Math.max(ctx.data.limits.minWindowUs, Math.floor((ctx.platform.windowUs * above) / total));
  return [{
    items: [platformItem('windowUs', 'Simulation window'), ...(heavy ? [taskItem(heavy)] : [])],
    vars: { blocks: total, limit: above, heavy: heavy?.name ?? '' },
    fixes: [setPlatform('shortenWindow', 'windowUs', shorter, { window: shorter }), ...(heavy ? [removeTask(heavy)] : [])],
  }];
};

export const conditions: Record<string, ConditionFn> = {
  paramOutOfRange, missingOrNaN, scanWindowExceedsInterval, packetTypeFit, windowBounds,
  versionUnsupported, bandwidthBandNotAllowed, phyOrIsoUnsupported, featureMissing, highBandNoOverlap, roleConflict,
  slotCollision, exclusivePairs, groupLimits, a2dpWithVoice, duplicates, tooManyTasks, channelMismatchSingleRadio,
  slotBudget, airtimeLoad, coresCannotServe,
  platformContradiction, isolationRange, concurrentLowIsolation, afhNoWifi, afhMinTooHigh, timeShareInvalid,
  windowShort, blockCount,
};

export { parseChannelList };
