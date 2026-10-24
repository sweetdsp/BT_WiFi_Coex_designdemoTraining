// Wi-Fi frame and burst timing (spec 7A.5). Preamble, symbol and rate tables come from data files.
import type { DataBundle, WifiGenDef } from '../data';
import type { PlatformConfig } from '../types';

export function wifiGen(data: DataBundle, id: string): WifiGenDef {
  const g = data.wifiGenerations[id];
  if (!g) throw new Error(`Unknown Wi-Fi generation ${id}`);
  return g;
}

/** Number of spatial streams in use: the platform setting capped by the chains and the generation maximum. */
export function streamCount(data: DataBundle, p: Pick<PlatformConfig, 'txRxStreams' | 'wifiChains' | 'wifiGeneration'>): number {
  const wanted = Number.parseInt(p.txRxStreams.split('x')[0] ?? '1', 10) || 1;
  return Math.max(1, Math.min(wanted, p.wifiChains, wifiGen(data, p.wifiGeneration).maxStreams));
}

/** Highest PHY rate in Mbps for the generation at a bandwidth (the largest allowed width not above the request). */
export function wifiRateMbps(data: DataBundle, genId: string, bandwidthMHz: number, streams: number): number {
  const g = wifiGen(data, genId);
  const widths = Object.keys(g.rates1ssMbps).map(Number).sort((a, b) => a - b);
  let w = widths[0];
  for (const x of widths) if (x <= bandwidthMHz) w = x;
  return g.rates1ssMbps[String(w)] * streams;
}

export type WifiRateKind = 'BASIC' | 'CONTROL' | 'DATA';
export type WifiFrameKind = 'DATA' | 'AMPDU' | 'MGMT' | 'ACK' | 'BA' | 'BEACON' | 'CTRL';

export interface WifiTimingCtx {
  data: DataBundle;
  genId: string;
  bandwidthMHz: number;
  streams: number;
  /** Rate multiplier from retry rate step-down (1 = no step down). */
  rateFactor?: number;
}

/** Whether a generation can aggregate; legacy generations carry one MPDU per burst. */
export function canAggregate(data: DataBundle, genId: string): boolean {
  return wifiGen(data, genId).features.includes('AMPDU');
}

function symbolsDuration(bits: number, rateMbps: number, symbolUs: number): number {
  const bitsPerSymbol = rateMbps * symbolUs;
  return Math.ceil(bits / bitsPerSymbol) * symbolUs;
}

/** Frame duration in microseconds: preamble plus payload symbols times symbol duration (SR-14). */
export function wifiFrameDurationUs(
  ctx: WifiTimingCtx, bytes: number, frame: WifiFrameKind, rate: WifiRateKind | undefined,
): number {
  const g = wifiGen(ctx.data, ctx.genId);
  const t = ctx.data.wifiTiming;
  const legacy = frame !== 'DATA' && frame !== 'AMPDU';
  const kind: WifiRateKind = rate ?? (legacy ? 'CONTROL' : 'DATA');
  let preamble = g.preambleUs;
  let symbol = g.symbolUs;
  let mbps: number;
  if (kind === 'DATA') {
    mbps = wifiRateMbps(ctx.data, ctx.genId, ctx.bandwidthMHz, ctx.streams) * (ctx.rateFactor ?? 1);
  } else {
    // Control and management frames use the legacy preamble and a basic rate.
    preamble = g.rank === 1 ? g.preambleUs : 20;
    symbol = g.rank === 1 ? 1 : 4;
    mbps = kind === 'BASIC' || g.rank === 1 ? g.basicRateMbps : t.controlRateMbps;
  }
  let payloadBytes = bytes;
  if (kind === 'DATA' && frame === 'AMPDU') payloadBytes = Math.min(bytes, aggregationCapBytes(ctx.data, ctx.genId, preamble, symbol, mbps));
  return Math.ceil(preamble + symbolsDuration(payloadBytes * 8, mbps, symbol));
}

/** Most payload bytes one burst can hold: whole symbols that fit in the maximum aggregation time (spec 7A.5). */
export function aggregationCapBytes(data: DataBundle, genId: string, preambleUs: number, symbolUs: number, mbps: number): number {
  if (!canAggregate(data, genId)) return 1500;
  const symbols = Math.floor((data.wifiTiming.maxAggregationUs - preambleUs) / symbolUs);
  return Math.max(1, Math.floor((symbols * symbolUs * mbps) / 8));
}

/** Bytes that fit in one burst of the requested size after the aggregation time cap. */
export function carriedBytes(ctx: WifiTimingCtx, requestedBytes: number): number {
  const g = wifiGen(ctx.data, ctx.genId);
  const mbps = wifiRateMbps(ctx.data, ctx.genId, ctx.bandwidthMHz, ctx.streams) * (ctx.rateFactor ?? 1);
  return Math.max(1, Math.min(requestedBytes, aggregationCapBytes(ctx.data, ctx.genId, g.preambleUs, g.symbolUs, mbps)));
}

/** Medium access overhead before a burst on average: DIFS plus half the contention window (used for estimates). */
export function averageAccessUs(data: DataBundle, genId: string): number {
  const t = data.wifiTiming;
  const slot = wifiGen(data, genId).slotUs;
  return t.sifsUs + 2 * slot + (t.contentionWindowSlots / 2) * slot;
}
