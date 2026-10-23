// ONE_SHOT_EXCHANGE: a fixed sequence of frames at one time (spec 7A.3). Used for association, role switch and pairing.
import type { PacketSpec } from '../types';
import { accessDelayUs, emitSequence, num, pattern, type GenContext } from './common';

export function oneShotExchange(g: GenContext): void {
  const pat = pattern(g);
  const start = pat.startUs === undefined ? 0 : num(g, pat.startUs);
  if (start >= g.windowUs) return;
  emitSequence(g, pat.sequence as PacketSpec[], start + accessDelayUs(g), { eventId: `${g.instanceId}.x` });
}
