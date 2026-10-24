// BURST_TRAIN: groups of back-to-back packets repeated at a burst interval (spec 7A.3).
// Used for Wi-Fi streaming and bulk transfer. Three ways to set the cadence:
//   BITRATE  - interval follows from the application bitrate and the bytes one burst carries
//   DUTY     - interval follows from a requested share of airtime
//   INTERVAL - fixed frame cadence; the bitrate decides how many back-to-back bursts per frame
import { resolveText } from '../timing/refs';
import { carriedBytes } from '../timing/wifi';
import type { PacketSpec } from '../types';
import { accessDelayUs, emitSequence, num, pattern, wifiTimingCtx, type GenContext } from './common';
import { effectiveWifi } from '../params';

interface Link { band: string; channel: number; width: number }

function mloLinks(g: GenContext, pat: Record<string, any>): Link[] | undefined {
  if (!pat.mloLinksParam) return undefined;
  const bands = resolveText(`$${pat.mloLinksParam}`, g).split('+');
  const w = effectiveWifi(g.platform, g.params);
  return bands.map((band) => ({
    band,
    channel: band === g.platform.wifiBand ? w.channel : band === '2.4' ? g.platform.wifiChannel : g.data.mloDefaultChannels[band],
    width: band === '2.4' ? Math.min(w.bandwidth, 40) : w.bandwidth,
  }));
}

export function burstTrain(g: GenContext): void {
  const pat = pattern(g);
  const seq = pat.sequence as PacketSpec[];
  const tctx = wifiTimingCtx(g);
  const requested = pat.aggregationParam ? num(g, `$${pat.aggregationParam}`) : 65535;
  const bytes = carriedBytes(tctx, requested);
  // Resolve durations with the byte count that really fits in one burst.
  const params = pat.aggregationParam ? { ...g.params, [pat.aggregationParam]: bytes } : g.params;
  const g2: GenContext = { ...g, params };
  g2.blocks = g.blocks;

  // Measure one burst sequence to size the cadence.
  const probe: GenContext = { ...g2, blocks: [], rng: g.rng, maxBlocks: Number.MAX_SAFE_INTEGER };
  const burstUs = emitSequence(probe, seq, 0, { eventId: 'probe' });

  let interval: number;
  let perFrame = 1;
  if (pat.mode === 'DUTY') interval = burstUs / (num(g, `$${pat.dutyParam}`) / 100);
  else if (pat.mode === 'INTERVAL') {
    interval = num(g, pat.intervalUs);
    perFrame = Math.max(1, Math.ceil((num(g, `$${pat.bitrateParam}`) * interval) / 8 / bytes));
  } else interval = (bytes * 8) / num(g, `$${pat.bitrateParam}`);
  interval = Math.max(1, interval);

  const links = mloLinks(g, pat);
  let nominal = 0;
  let free = 0;
  for (let k = 0; nominal < g.windowUs; k++, nominal += interval) {
    const link = links ? links[k % links.length] : undefined;
    let t = Math.max(nominal, free) + accessDelayUs(g);
    if (t >= g.windowUs) break;
    for (let f = 0; f < perFrame; f++) {
      t = emitSequence(g2, seq, t, { eventId: `${g.instanceId}.e${k}.f${f}`, wifi: link });
      if (f < perFrame - 1) t += g.data.wifiTiming.sifsUs;
    }
    free = t;
  }
}
