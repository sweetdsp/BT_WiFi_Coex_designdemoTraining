// IRREGULAR_BURSTS: bursts at random times drawn from the seeded generator, with a given average rate (spec 7A.3).
// Gaps between bursts are exponential (a Poisson process), used for web browsing, background sync and mesh traffic.
import type { PacketSpec } from '../types';
import { accessDelayUs, emitSequence, num, pattern, type GenContext } from './common';

export function irregularBursts(g: GenContext): void {
  const pat = pattern(g);
  const rate = num(g, pat.ratePerSec);
  if (!(rate > 0)) return;
  const meanGap = 1e6 / rate;
  const advGap = pat.advChannelGapUs === undefined ? 0 : num(g, pat.advChannelGapUs);
  let t = g.rng.exp(meanGap);
  for (let k = 0; t < g.windowUs; k++) {
    const end = emitSequence(g, pat.burst as PacketSpec[], t + accessDelayUs(g), { eventId: `${g.instanceId}.b${k}`, advGapUs: advGap });
    t = Math.max(end, t) + g.rng.exp(meanGap);
  }
}
