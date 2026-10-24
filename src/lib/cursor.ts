// Shared time cursor (7B.4): the readout shows the time and the channels active at that instant.
import type { EngineResult } from '../engine';
import type { AirBlock } from '../engine/types';

const LIVE = new Set(['GRANTED', 'DELAYED', 'TOLERATED', 'DEGRADED']);

/** Blocks on the air at time t (7B.7 active paths). */
export function activeAt(result: EngineResult, t: number): AirBlock[] {
  return result.blocks.filter((b) => !b.optional && LIVE.has(b.status) && b.start <= t && t < b.start + b.duration);
}

export interface CursorReadout { timeUs: number; btChannel?: { index: number; mhz: number }; wifiChannel?: { index: number; mhz: number; widthMHz: number } }

export function readoutAt(result: EngineResult, t: number): CursorReadout {
  const act = activeAt(result, t);
  const bt = act.find((b) => b.tech === 'BT');
  const wf = act.find((b) => b.tech === 'WIFI');
  return {
    timeUs: Math.round(t),
    btChannel: bt ? { index: bt.channelIndex, mhz: bt.freqCenter } : undefined,
    wifiChannel: wf ? { index: wf.channelIndex, mhz: wf.freqCenter, widthMHz: wf.freqWidth } : undefined,
  };
}

export function readoutText(r: CursorReadout): string {
  const bt = r.btChannel ? `Bluetooth channel ${r.btChannel.index} (${r.btChannel.mhz} MHz)` : 'Bluetooth idle';
  const wf = r.wifiChannel ? `Wi-Fi channel ${r.wifiChannel.index} (${r.wifiChannel.mhz} MHz)` : 'Wi-Fi idle';
  return `${r.timeUs} µs · ${bt} · ${wf}`;
}
