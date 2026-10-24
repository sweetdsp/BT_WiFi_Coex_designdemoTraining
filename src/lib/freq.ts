// Frequency view model (spec 7A.11, 7B.6): footprint, hops, circled hops, histogram, AFH strip, higher-band panel.
import type { AfhMap } from '../engine/stageC';
import { bleDataFreq } from '../engine/stageB';
import type { AirBlock } from '../engine/types';
import type { ViewCtx } from './context';

export const BAND_LOW = 2400;
export const BAND_HIGH = 2483.5;

export interface Footprint { taskId: string; channel: number; low: number; high: number; guardLow: number; guardHigh: number }
export interface Hop { blockId: string; t: number; freq: number; channelIndex: number; width: number; inOverlap: boolean; tech: 'BT' }
export interface HistBin { freq: number; count: number; inFootprint: boolean; removed: boolean }
export interface AfhCell { channelIndex: number; freq: number; removed: boolean }
export interface HighBand { band: string; channel: number; centre: number; widthMHz: number; caption: string }

export interface FreqModel {
  footprints: Footprint[];
  hops: Hop[];
  /** Hops that landed inside a footprint during a time overlap (circled in red). */
  circled: number;
  histogram: HistBin[];
  afhStrip: AfhCell[];
  afh: AfhMap;
  highBands: HighBand[];
  caption: string;
}

export const HIGH_BAND_CAPTION = 'No frequency overlap with Bluetooth. Interaction is only through shared antenna, core, and isolation.';

export function freqModel(ctx: ViewCtx, range: [number, number] | null): FreqModel {
  const { result, data } = ctx;
  const guard = result.config.platform.guardMHz;
  const seen = new Map<string, Footprint>();
  const high = new Map<string, HighBand>();
  for (const b of result.blocks) {
    if (b.tech !== 'WIFI' || b.optional) continue;
    const band = b.wifiBand ?? result.config.platform.wifiBand;
    const w = b.wifiWidth ?? b.freqWidth;
    if (band === '2.4') {
      const key = `${b.freqCenter}-${w}`;
      if (!seen.has(key)) seen.set(key, { taskId: b.taskId, channel: b.channelIndex, low: b.freqCenter - w / 2, high: b.freqCenter + w / 2, guardLow: b.freqCenter - w / 2 - guard, guardHigh: b.freqCenter + w / 2 + guard });
    } else {
      const key = `${band}-${b.channelIndex}-${w}`;
      if (!high.has(key)) high.set(key, { band, channel: b.channelIndex, centre: b.freqCenter, widthMHz: w, caption: HIGH_BAND_CAPTION });
    }
  }
  const circledBlocks = new Set<string>();
  for (const c of result.conflicts) if (c.freqOverlap) circledBlocks.add(c.btBlockId);

  const hops: Hop[] = [];
  const counts = new Map<number, number>();
  for (const b of result.blocks) {
    if (b.tech !== 'BT' || b.optional || (b.status !== 'GRANTED' && b.status !== 'DELAYED' && b.status !== 'TOLERATED' && b.status !== 'DEGRADED')) continue;
    if (range && (b.start < range[0] || b.start > range[1])) continue;
    hops.push({ blockId: b.id, t: b.start, freq: b.freqCenter, channelIndex: b.channelIndex, width: b.freqWidth, inOverlap: circledBlocks.has(b.id), tech: 'BT' });
    counts.set(b.freqCenter, (counts.get(b.freqCenter) ?? 0) + 1);
  }
  const afh = result.afh;
  const removedFreq = new Set(afh.classicRemoved.map((k) => data.constants.classicBaseMHz + k));
  const inFp = (f: number) => [...seen.values()].some((fp) => f >= fp.guardLow && f <= fp.guardHigh);
  const histogram: HistBin[] = [];
  for (let k = 0; k < data.constants.classicHopChannels; k++) {
    const f = data.constants.classicBaseMHz + k;
    histogram.push({ freq: f, count: counts.get(f) ?? 0, inFootprint: inFp(f), removed: removedFreq.has(f) });
  }
  // BLE data channels that fall between classic channels still count in the histogram at their own frequency.
  for (let i = 0; i < data.constants.bleDataChannelCount; i++) {
    const f = bleDataFreq(data, i);
    const bin = histogram.find((h) => h.freq === f);
    void bin;
  }
  const afhStrip: AfhCell[] = Array.from({ length: data.constants.classicHopChannels }, (_, k) => ({ channelIndex: k, freq: data.constants.classicBaseMHz + k, removed: afh.classicRemoved.includes(k) }));
  return {
    footprints: [...seen.values()], hops, circled: hops.filter((h) => h.inOverlap && inFp(h.freq)).length, histogram, afhStrip, afh,
    highBands: [...high.values()],
    caption: 'Blue marks are Bluetooth hops. The orange band is the Wi-Fi channel, with a lighter margin for the guard. Hops circled in red landed inside the Wi-Fi channel while a Wi-Fi block was on the air.',
  };
}

export interface FreqTip { title: string; lines: string[] }

/** Tooltip for one channel: number, centre frequency, whether it is in the AFH map, and how many hops landed there. */
export function channelTip(m: FreqModel, channelIndex: number, baseMHz: number): FreqTip {
  const f = baseMHz + channelIndex;
  const bin = m.histogram.find((h) => h.freq === f);
  const removed = m.afh.classicRemoved.includes(channelIndex);
  return {
    title: `Channel ${channelIndex}, ${f} MHz`,
    lines: [m.afh.enabled ? (removed ? 'Not in the adaptive hopping map (removed)' : 'In the adaptive hopping map') : 'Adaptive hopping is off, so every channel is in use', `${bin?.count ?? 0} hops landed here`],
  };
}

export const hopBlock = (ctx: ViewCtx, h: Hop): AirBlock | undefined => ctx.blockById.get(h.blockId);
