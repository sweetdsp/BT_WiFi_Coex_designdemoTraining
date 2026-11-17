// Shared time cursor (7B.4): the readout shows the time and the channels active at that instant.
import type { EngineResult } from '../engine';
import type { AirBlock } from '../engine/types';

const LIVE = new Set(['GRANTED', 'DELAYED', 'TOLERATED', 'DEGRADED']);

/** Blocks on the air at time t (7B.7 active paths). */
export function activeAt(result: EngineResult, t: number): AirBlock[] {
  return result.blocks.filter((b) => !b.optional && LIVE.has(b.status) && b.start <= t && t < b.start + b.duration);
}

export interface CursorReadout { timeUs: number; /** Which narrowband radios the scenario has, so the text mentions only those. */ hasBt: boolean; hasThread: boolean; btChannel?: { index: number; mhz: number }; threadChannel?: { index: number; mhz: number }; wifiChannel?: { index: number; mhz: number; widthMHz: number } }

export function readoutAt(result: EngineResult, t: number): CursorReadout {
  const act = activeAt(result, t);
  const bt = act.find((b) => b.tech === 'BT');
  const th = act.find((b) => b.tech === 'THREAD');
  const wf = act.find((b) => b.tech === 'WIFI');
  const hasThread = result.blocks.some((b) => b.tech === 'THREAD');
  return {
    hasThread, hasBt: result.blocks.some((b) => b.tech === 'BT') || !hasThread,
    threadChannel: th ? { index: th.channelIndex, mhz: th.freqCenter } : undefined,
    timeUs: Math.round(t),
    btChannel: bt ? { index: bt.channelIndex, mhz: bt.freqCenter } : undefined,
    wifiChannel: wf ? { index: wf.channelIndex, mhz: wf.freqCenter, widthMHz: wf.freqWidth } : undefined,
  };
}

export function readoutText(r: CursorReadout): string {
  const bt = r.btChannel ? `Bluetooth channel ${r.btChannel.index} (${r.btChannel.mhz} MHz)` : 'Bluetooth idle';
  const th = r.threadChannel ? ` · Thread channel ${r.threadChannel.index} (${r.threadChannel.mhz} MHz)` : r.hasThread ? ' · Thread idle' : '';
  const wf = r.wifiChannel ? `Wi-Fi channel ${r.wifiChannel.index} (${r.wifiChannel.mhz} MHz)` : 'Wi-Fi idle';
  return `${r.timeUs} µs · ${r.hasBt ? `${bt}${th}`.replace(/^ · /, '') : th.replace(/^ · /, '')} · ${wf}`;
}
