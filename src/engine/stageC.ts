// Stage C: Bluetooth adaptive frequency hopping (spec 7A.6, SR-13).
// The channel map removes every channel that overlaps the Wi-Fi footprint plus guard, but never leaves
// fewer than the minimum. Blocks starting after the AFH delay are re-assigned from the reduced set.
import type { DataBundle } from './data';
import { effectiveWifi, wifiFootprint } from './params';
import { bleDataFreq, classicFreq, footprintsOverlap, setBleDataChannel, setClassicChannel } from './stageB';
import { effectiveParams } from './params';
import type { AirBlock, ScenarioConfig } from './types';

export interface AfhMap {
  enabled: boolean;
  /** Wi-Fi footprints on 2.4 GHz that the map avoids, in MHz. */
  footprints: [number, number][];
  classicAllowed: number[];
  classicRemoved: number[];
  bleAllowed: number[];
  bleRemoved: number[];
  delayUs: number;
  guardMHz: number;
}

/** 2.4 GHz Wi-Fi footprints that count for AFH: operating channels of selected Wi-Fi tasks, not scans. */
export function afhFootprints(config: ScenarioConfig, data: DataBundle): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const inst of config.tasks) {
    const def = data.taskIndex.get(inst.taskId);
    if (!def || def.tech !== 'WIFI' || def.sweepsChannels) continue;
    const params = effectiveParams(def, inst);
    const links = typeof params.linkBands === 'string' ? params.linkBands.split('+') : [config.platform.wifiBand];
    if (!links.includes('2.4')) continue;
    const w = effectiveWifi(config.platform, params);
    const bw = def.id && links.length > 1 ? Math.min(w.bandwidth, 40) : w.bandwidth;
    const fp = wifiFootprint(data, '2.4', w.channel, bw);
    const key = `${fp.low}-${fp.high}`;
    if (!seen.has(key)) { seen.add(key); out.push([fp.low, fp.high]); }
  }
  return out;
}

function buildAllowed(count: number, freqOf: (i: number) => number, width: number, fps: [number, number][], guard: number, min: number): { allowed: number[]; removed: number[] } {
  const hit = (i: number) => fps.some((fp) => footprintsOverlap([freqOf(i) - width / 2, freqOf(i) + width / 2], fp, guard));
  const all = Array.from({ length: count }, (_, i) => i);
  let allowed = all.filter((i) => !hit(i));
  let removed = all.filter(hit);
  if (allowed.length < min) {
    // Put back the removed channels that are furthest from the Wi-Fi centre first, then by index for a stable order.
    const centre = fps.reduce((a, fp) => a + (fp[0] + fp[1]) / 2, 0) / Math.max(1, fps.length);
    const back = [...removed].sort((a, b) => Math.abs(freqOf(b) - centre) - Math.abs(freqOf(a) - centre) || a - b).slice(0, min - allowed.length);
    allowed = [...allowed, ...back].sort((a, b) => a - b);
    removed = removed.filter((i) => !back.includes(i));
  }
  return { allowed, removed };
}

export function buildAfhMap(config: ScenarioConfig, data: DataBundle): AfhMap {
  const p = config.platform;
  const fps = p.afhEnabled ? afhFootprints(config, data) : [];
  const c = data.constants;
  const classic = fps.length
    ? buildAllowed(c.classicHopChannels, (k) => classicFreq(data, k), c.classicChannelWidthMHz, fps, p.guardMHz, p.afhMinChannelsClassic)
    : { allowed: Array.from({ length: c.classicHopChannels }, (_, i) => i), removed: [] as number[] };
  const ble = fps.length
    ? buildAllowed(c.bleDataChannelCount, (i) => bleDataFreq(data, i), c.bleChannelWidthMHz, fps, p.guardMHz, p.afhMinChannelsBle)
    : { allowed: Array.from({ length: c.bleDataChannelCount }, (_, i) => i), removed: [] as number[] };
  return {
    enabled: p.afhEnabled && fps.length > 0, footprints: fps,
    classicAllowed: classic.allowed, classicRemoved: classic.removed, bleAllowed: ble.allowed, bleRemoved: ble.removed,
    delayUs: p.afhDelayUs, guardMHz: p.guardMHz,
  };
}

/** Returns new blocks with hops re-assigned after the AFH delay, plus the map used. */
export function applyAfh(blocks: AirBlock[], config: ScenarioConfig, data: DataBundle): { blocks: AirBlock[]; map: AfhMap } {
  const map = buildAfhMap(config, data);
  if (!map.enabled) return { blocks: blocks.map((b) => ({ ...b })), map };
  const out = blocks.map((b) => {
    const nb = { ...b };
    if (nb.start < map.delayUs || nb.hopU === undefined) return nb;
    if (nb.chanMode === 'CLASSIC_HOP') setClassicChannel(data, nb, map.classicAllowed[Math.floor(nb.hopU * map.classicAllowed.length)]);
    else if (nb.chanMode === 'BLE_DATA') setBleDataChannel(data, nb, map.bleAllowed[Math.floor(nb.hopU * map.bleAllowed.length)]);
    return nb;
  });
  return { blocks: out, map };
}
