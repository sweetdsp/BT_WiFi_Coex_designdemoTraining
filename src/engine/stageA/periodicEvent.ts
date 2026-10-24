// PERIODIC_EVENT: one event every interval, each a fixed sequence of packets (spec 7A.3).
// Used for BLE connection and advertising events, ISO events, beacons and voice over Wi-Fi.
import type { PacketSpec } from '../types';
import { accessDelayUs, emitSequence, num, pattern, type GenContext } from './common';

export function periodicEvent(g: GenContext): void {
  const pat = pattern(g);
  const interval = Math.max(1, num(g, pat.intervalUs));
  const jitter = pat.jitterUs === undefined ? 0 : num(g, pat.jitterUs);
  const offset = pat.offsetUs === undefined ? 0 : num(g, pat.offsetUs);
  const repeat = pat.repeat === undefined ? 1 : Math.max(1, Math.round(num(g, pat.repeat)));
  const optionalAfter = pat.optionalAfter === undefined ? Infinity : num(g, pat.optionalAfter);
  const advGap = pat.advChannelGapUs === undefined ? 0 : num(g, pat.advChannelGapUs);
  const seq = pat.sequence as PacketSpec[];
  const firstIsTx = seq.length > 0 && typeof seq[0].dir === 'string' ? seq[0].dir === 'TX' : true;

  let nominal = offset;
  for (let k = 0; nominal < g.windowUs; k++) {
    // A random advertising delay is added to every interval and accumulates (SR-4, spec 7A.4).
    const delay = jitter > 0 ? g.rng.int(0, jitter) : 0;
    const eventStart = nominal + delay;
    if (eventStart >= g.windowUs) break;
    const access = g.task.tech === 'WIFI' && firstIsTx && seq[0]?.kind !== 'BEACON' ? accessDelayUs(g) : 0;
    let t = eventStart + access;
    for (let r = 0; r < repeat; r++) {
      t = emitSequence(g, seq, t, { eventId: `${g.instanceId}.e${k}`, optional: r >= optionalAfter, advGapUs: advGap });
    }
    nominal += interval + delay;
  }
}
