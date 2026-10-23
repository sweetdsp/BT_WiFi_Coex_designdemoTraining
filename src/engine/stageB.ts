// Stage B: resolve channels and frequency footprints for every block (spec 7A.6).
// Hops are a seeded uniform draw. The raw draw is stored on the block so stage C can re-map the same
// draw onto a narrower channel set when adaptive frequency hopping is on.
import type { DataBundle } from './data';
import { makeRng } from './util/rng';
import type { AirBlock, ScenarioConfig } from './types';

export function classicFreq(data: DataBundle, k: number): number {
  return data.constants.classicBaseMHz + k;
}

/** BLE data channel index 0 to 36 to MHz: 2 MHz steps from 2404, skipping the 2426 advertising channel. */
export function bleDataFreq(data: DataBundle, idx: number): number {
  const c = data.constants;
  const f = c.bleDataBaseMHz + 2 * idx;
  return f >= c.bleDataSkipMHz ? f + 2 : f;
}

export function wifiCenterMHz(data: DataBundle, band: string, channel: number): number {
  const b = data.wifiBands[band];
  return b.baseMHz + b.spacingMHz * channel;
}

export function classicChannelCount(data: DataBundle): number {
  return data.constants.classicHopChannels;
}

export function setClassicChannel(data: DataBundle, b: AirBlock, k: number): void {
  b.channelIndex = k;
  b.freqCenter = classicFreq(data, k);
  b.freqWidth = data.constants.classicChannelWidthMHz;
}

export function setBleDataChannel(data: DataBundle, b: AirBlock, idx: number): void {
  b.channelIndex = idx;
  b.freqCenter = bleDataFreq(data, idx);
  b.freqWidth = data.constants.bleChannelWidthMHz;
}

/** Returns new blocks with frequency fields filled in. The input is not modified. */
export function resolveFrequencies(blocks: AirBlock[], config: ScenarioConfig, data: DataBundle): AirBlock[] {
  const out = blocks.map((b) => ({ ...b }));
  const seed = config.platform.seed;
  const nClassic = classicChannelCount(data);
  const nBle = data.constants.bleDataChannelCount;
  // One hop draw per event id per task, in time order, from a stream private to the task.
  const perTask = new Map<string, AirBlock[]>();
  for (const b of out) (perTask.get(b.taskId) ?? perTask.set(b.taskId, []).get(b.taskId)!).push(b);
  for (const [taskId, list] of perTask) {
    list.sort((a, b) => a.start - b.start || a.seq - b.seq);
    const rng = makeRng(seed, `${taskId}:hop`);
    const drawn = new Map<string, number>();
    for (const b of list) {
      if (b.chanMode === 'WIFI') {
        const band = b.wifiBand ?? config.platform.wifiBand;
        const ch = b.wifiChannel ?? config.platform.wifiChannel;
        const width = b.wifiWidth ?? config.platform.wifiBandwidth;
        b.channelIndex = ch;
        b.freqCenter = wifiCenterMHz(data, band, ch);
        b.freqWidth = width;
      } else if (b.chanMode === 'BLE_ADV') {
        const ch = (data.constants.bleAdvChannels as { index: number; mhz: number }[]).find((c) => c.index === b.fixedChannel);
        if (!ch) throw new Error(`Block ${b.id} has no advertising channel`);
        b.channelIndex = ch.index;
        b.freqCenter = ch.mhz;
        b.freqWidth = data.constants.bleChannelWidthMHz;
      } else {
        let u = drawn.get(b.eventId);
        if (u === undefined) { u = rng.next(); drawn.set(b.eventId, u); }
        b.hopU = u;
        if (b.chanMode === 'CLASSIC_HOP') setClassicChannel(data, b, Math.floor(u * nClassic));
        else setBleDataChannel(data, b, Math.floor(u * nBle));
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/** Frequency footprint [low, high] in MHz. */
export function footprint(b: Pick<AirBlock, 'freqCenter' | 'freqWidth'>): [number, number] {
  return [b.freqCenter - b.freqWidth / 2, b.freqCenter + b.freqWidth / 2];
}

/** Open-interval intersection with a guard added on each side of the second footprint. */
export function footprintsOverlap(a: [number, number], b: [number, number], guardMHz = 0): boolean {
  return a[0] < b[1] + guardMHz && b[0] - guardMHz < a[1];
}
