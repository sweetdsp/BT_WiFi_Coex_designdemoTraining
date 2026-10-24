// Pre-generation estimate of blocks and requested airtime from task patterns (spec 7C W-2, R-3).
// Uses only the data-driven pattern fields; there is no task-specific logic here (SR-2).
import type { DataBundle } from './data';
import { effectiveWifi } from './params';
import { classicPacket, bleDurationUs } from './timing/bt';
import { resolveRef, resolveText, type RefContext } from './timing/refs';
import { averageAccessUs, carriedBytes, streamCount, wifiFrameDurationUs, wifiRateMbps, type WifiFrameKind, type WifiRateKind } from './timing/wifi';
import type { DurSpec, PacketSpec, ParamMap, PlatformConfig, TaskDef } from './types';

export interface LoadEstimate {
  blocks: number;
  /** Requested air time in microseconds over the window. */
  airtimeUs: number;
  /** Average microseconds between events (for window checks). */
  eventIntervalUs: number;
}

export interface DurationContext extends RefContext {
  platform: PlatformConfig;
  task: TaskDef;
  rateFactor?: number;
}

/** Resolve a packet duration spec to integer microseconds. */
export function resolveDurationUs(spec: DurSpec, ctx: DurationContext): number {
  if (typeof spec === 'object' && spec !== null) {
    if ('bt' in spec) return classicPacket(ctx.data, resolveText(spec.bt, ctx)).durationUs;
    if ('ble' in spec) return bleDurationUs(ctx.data, resolveText(spec.ble.phy, ctx), resolveRef(spec.ble.payloadBytes, ctx));
    if ('wifi' in spec) {
      const w = effectiveWifi(ctx.platform, ctx.params);
      const tctx = { data: ctx.data, genId: w.genId, bandwidthMHz: w.bandwidth, streams: streamCount(ctx.data, ctx.platform), rateFactor: ctx.rateFactor };
      return wifiFrameDurationUs(tctx, resolveRef(spec.wifi.bytes, ctx), spec.wifi.frame as WifiFrameKind, spec.wifi.rate as WifiRateKind | undefined);
    }
    if ('sum' in spec) return spec.sum.reduce<number>((a, s) => a + resolveDurationUs(s, ctx), 0);
    if ('mul' in spec) return spec.mul.reduce<number>((a, s) => a * resolveDurationUs(s, ctx), 1);
    if ('div' in spec) return resolveDurationUs(spec.div[0], ctx) / resolveDurationUs(spec.div[1], ctx);
  }
  return resolveRef(spec as never, ctx);
}

export function packetIncluded(p: PacketSpec, params: ParamMap): boolean {
  if (!p.when) return true;
  return p.when.in.some((v) => String(v) === String(params[p.when!.param]));
}

/** Sum of durations and block count for a packet sequence, honouring count, when and ADV3 repetition. */
function sequenceTotals(seq: PacketSpec[], ctx: DurationContext, includeOptional = false): { blocks: number; us: number } {
  let blocks = 0;
  let us = 0;
  for (const p of seq) {
    if (!packetIncluded(p, ctx.params)) continue;
    if (p.optional && !includeOptional) continue;
    const count = p.count === undefined ? 1 : resolveRef(p.count, ctx);
    const mult = p.chan === 'ADV3' ? ctx.data.constants.bleAdvChannels.length : 1;
    const d = resolveDurationUs(p.dur, ctx);
    blocks += count * mult;
    us += count * mult * d;
  }
  return { blocks, us };
}

/** Derived Classic interval for bitrate-driven slot schedules (A2DP). Rounded to an even slot count. */
export function bitrateIntervalSlots(ctx: DurationContext, pattern: Record<string, unknown>): number {
  const kbps = resolveRef(pattern.bitrateKbps as never, ctx);
  const pkt = classicPacket(ctx.data, resolveText(pattern.payloadPacketType as string, ctx));
  const intervalUs = (pkt.maxPayloadBytes * 8 * 1000) / kbps;
  const slots = intervalUs / ctx.data.constants.classicSlotUs;
  const master = classicPacket(ctx.data, resolveText(((pattern.master as PacketSpec).dur as { bt: string }).bt, ctx)).slots;
  const reply = classicPacket(ctx.data, resolveText(((pattern.reply as PacketSpec).dur as { bt: string }).bt, ctx)).slots;
  return Math.max(master + reply + ((master + reply) % 2), 2 * Math.round(slots / 2));
}

export function estimateLoad(def: TaskDef, params: ParamMap, data: DataBundle, platform: PlatformConfig, windowUs: number): LoadEstimate {
  const ctx: DurationContext = { params, data, platform, task: def };
  const pat = def.pattern as Record<string, any>;
  const num = (r: unknown) => resolveRef(r as never, ctx);
  const events = (intervalUs: number) => Math.max(1, Math.ceil(windowUs / Math.max(1, intervalUs)));
  switch (def.generator) {
    case 'PERIODIC_EVENT': {
      const interval = num(pat.intervalUs);
      const repeatAll = pat.repeat === undefined ? 1 : num(pat.repeat);
      // Subevents after "optionalAfter" are retransmission opportunities and are not requested airtime.
      const repeat = pat.optionalAfter === undefined ? repeatAll : Math.min(repeatAll, num(pat.optionalAfter));
      const t = sequenceTotals(pat.sequence, ctx);
      const n = events(interval);
      return { blocks: n * t.blocks * repeat, airtimeUs: n * t.us * repeat, eventIntervalUs: interval };
    }
    case 'SLOT_SCHEDULE': {
      const slotUs = data.constants.classicSlotUs;
      const slots = pat.bitrateKbps !== undefined ? bitrateIntervalSlots(ctx, pat) : num(pat.intervalSlots);
      const interval = slots * slotUs;
      const pairs = pat.pairs === undefined ? 1 : num(pat.pairs);
      const m = sequenceTotals([pat.master, pat.reply], ctx);
      const n = events(interval);
      return { blocks: n * m.blocks * pairs, airtimeUs: n * m.us * pairs, eventIntervalUs: interval };
    }
    case 'BURST_TRAIN': {
      const w = effectiveWifi(platform, params);
      const tctx = { data, genId: w.genId, bandwidthMHz: w.bandwidth, streams: streamCount(data, platform) };
      const agg = pat.aggregationParam ? num(`$${pat.aggregationParam}`) : 65535;
      const bytes = carriedBytes(tctx, agg);
      const seq = sequenceTotals(pat.sequence, { ...ctx, params: { ...params, [pat.aggregationParam]: bytes } });
      const burstUs = seq.us + averageAccessUs(data, w.genId);
      let interval: number;
      if (pat.mode === 'DUTY') interval = burstUs / (num(`$${pat.dutyParam}`) / 100);
      else if (pat.mode === 'INTERVAL') interval = num(pat.intervalUs);
      else interval = (bytes * 8) / num(`$${pat.bitrateParam}`);
      let perInterval = 1;
      if (pat.mode === 'INTERVAL') {
        const wantBytes = (num(`$${pat.bitrateParam}`) * interval) / 8;
        perInterval = Math.max(1, Math.ceil(wantBytes / bytes));
      }
      const n = events(interval);
      return { blocks: n * perInterval * seq.blocks, airtimeUs: n * perInterval * burstUs, eventIntervalUs: interval };
    }
    case 'WINDOWED_LISTEN': {
      const interval = num(pat.intervalUs);
      const win = resolveDurationUs(pat.windowUs, ctx);
      const n = events(interval);
      let blocks = n;
      let us = n * win;
      if (pat.exchange) {
        const ex = sequenceTotals(pat.exchange, ctx);
        const rep = num(pat.exchangeRepeat ?? 1);
        const r = pat.exchangeOnce ? rep : n * rep;
        blocks += ex.blocks * r;
        us += ex.us * r;
      }
      return { blocks, airtimeUs: us, eventIntervalUs: interval };
    }
    case 'SCAN_SWEEP': {
      const interval = num(pat.sweepIntervalUs);
      const list = parseChannelList(resolveText(pat.channels, ctx));
      const dwell = num(pat.dwellUs);
      const per = (pat.probe ? sequenceTotals([pat.probe], ctx) : { blocks: 0, us: 0 });
      const tail = pat.after ? sequenceTotals(pat.after, ctx) : { blocks: 0, us: 0 };
      const n = events(interval);
      const sweepBlocks = list.length * (1 + per.blocks) + tail.blocks;
      const sweepUs = list.length * (dwell + per.us) + tail.us;
      return { blocks: n * sweepBlocks, airtimeUs: n * sweepUs, eventIntervalUs: interval };
    }
    case 'IRREGULAR_BURSTS': {
      const rate = num(pat.ratePerSec);
      const bursts = Math.max(1, Math.ceil((rate * windowUs) / 1e6));
      const t = sequenceTotals(pat.burst, ctx);
      const access = def.tech === 'WIFI' ? averageAccessUs(data, platform.wifiGeneration) : 0;
      return { blocks: bursts * t.blocks, airtimeUs: bursts * (t.us + access), eventIntervalUs: 1e6 / rate };
    }
    case 'ONE_SHOT_EXCHANGE': {
      const t = sequenceTotals(pat.sequence, ctx);
      return { blocks: t.blocks, airtimeUs: t.us, eventIntervalUs: windowUs };
    }
  }
}

/** "1,6,11" or "1-13" to a list of channel numbers. */
export function parseChannelList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) for (let c = Number(m[1]); c <= Number(m[2]); c++) out.push(c);
    else if (part.trim() !== '') out.push(Number(part.trim()));
  }
  return out;
}

export { wifiRateMbps };
