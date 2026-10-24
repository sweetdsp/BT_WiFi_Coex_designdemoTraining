// SCAN_SWEEP: dwell on each channel of a list in turn, with an optional transmit at the start of each dwell (spec 7A.3).
import { resolveDurationUs, parseChannelList } from '../estimate';
import { resolveText } from '../timing/refs';
import type { PacketSpec } from '../types';
import { accessDelayUs, emitSequence, num, pattern, pushBlock, type GenContext } from './common';

export function scanSweep(g: GenContext): void {
  const pat = pattern(g);
  const channels = parseChannelList(resolveText(pat.channels, g));
  const dwell = num(g, pat.dwellUs);
  const interval = Math.max(1, num(g, pat.sweepIntervalUs));
  const start0 = pat.startUs === undefined ? 0 : num(g, pat.startUs);
  const probe = pat.probe as PacketSpec | undefined;
  const listen = pat.listen as PacketSpec;
  const after = pat.after as PacketSpec[] | undefined;
  const band = g.platform.wifiBand;

  for (let s = 0; start0 + s * interval < g.windowUs; s++) {
    let t = start0 + s * interval;
    channels.forEach((ch, i) => {
      const where = { band, channel: ch, width: 20 };
      const eventId = `${g.instanceId}.s${s}.c${i}`;
      if (probe) t = emitSequence(g, [{ ...probe, gapUs: accessDelayUs(g) }], t, { eventId, wifi: where });
      const l = { ...listen, dur: dwell, gapUs: listen.gapUs };
      const gap = l.gapUs === undefined ? 0 : num(g, l.gapUs);
      pushBlock(g, {
        dir: 'RX', start: t + gap, duration: resolveDurationUs(l.dur, g), kind: listen.kind, chanMode: 'WIFI', eventId: `${eventId}.l`,
        wifiBand: band, wifiChannel: ch, wifiWidth: 20, freqWidth: 20,
      });
      t += gap + dwell;
    });
    if (after) emitSequence(g, after, t, { eventId: `${g.instanceId}.s${s}.after` });
  }
}
