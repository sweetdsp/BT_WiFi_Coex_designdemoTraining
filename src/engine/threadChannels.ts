// Which Thread channels sit under the 2.4 GHz Wi-Fi channels of the selected tasks, and which is the nearest clear one.
import type { DataBundle } from './data';
import { footprintsOverlap } from './stageB';
import { afhFootprints } from './stageC';
import { threadCenterMHz, threadChannels } from './timing/thread';
import type { ScenarioConfig } from './types';

export interface ThreadChannelPlan {
  /** Wi-Fi footprints (low, high in MHz) on 2.4 GHz that count, in the order found. */
  wifi: [number, number][];
  /** The Wi-Fi footprint the current Thread channel sits under, if any. */
  hit?: [number, number];
  /** Channels clear of every footprint plus the guard. */
  clear: number[];
  /** The clear channel nearest the current one (the lower on a tie). */
  nearestClear?: number;
}

export function threadChannelPlan(config: ScenarioConfig, data: DataBundle, channel = config.platform.threadChannel): ThreadChannelPlan {
  const wifi = afhFootprints(config, data);
  const guard = config.platform.guardMHz;
  const w = data.threadTiming.channelWidthMHz;
  const fpOf = (c: number): [number, number] => { const m = threadCenterMHz(data, c); return [m - w / 2, m + w / 2]; };
  const hit = wifi.find((fp) => footprintsOverlap(fpOf(channel), fp, guard));
  const clear = threadChannels(data).filter((c) => !wifi.some((fp) => footprintsOverlap(fpOf(c), fp, guard)));
  const nearestClear = clear.length ? clear.reduce((a, b) => (Math.abs(b - channel) < Math.abs(a - channel) ? b : a)) : undefined;
  return { wifi, hit, clear, nearestClear };
}
