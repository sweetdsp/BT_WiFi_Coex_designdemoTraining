// WINDOWED_LISTEN: a receive window of a given width repeated at an interval, with optional hopping (spec 7A.3).
// Used for inquiry scan, page scan, passive and active scan, initiating and periodic sync.
import type { ChanMode, PacketSpec } from '../types';
import { emitSequence, num, pattern, patternChanMode, pushBlock, type GenContext } from './common';
import { resolveDurationUs } from '../estimate';

export function windowedListen(g: GenContext): void {
  const pat = pattern(g);
  const interval = Math.max(1, num(g, pat.intervalUs));
  const window = resolveDurationUs(pat.windowUs, g);
  const mode: ChanMode = patternChanMode(g);
  const advChannels = g.data.constants.bleAdvChannels as { index: number }[];
  const exchange = pat.exchange as PacketSpec[] | undefined;
  const repeat = exchange ? Math.round(num(g, pat.exchangeRepeat ?? 1)) : 0;
  const once = pat.exchangeOnce === true;

  for (let k = 0; k * interval < g.windowUs; k++) {
    const start = k * interval;
    const eventId = `${g.instanceId}.w${k}`;
    pushBlock(g, {
      dir: 'RX', start, duration: window, kind: pat.kind ?? 'SCAN', chanMode: mode, eventId,
      ...(mode === 'BLE_ADV' ? { fixedChannel: advChannels[k % advChannels.length].index } : {}),
    });
    // Reactive follow-up (SCAN_REQ and SCAN_RSP, CONNECT_IND) is placed just after the window it answers.
    if (exchange && repeat > 0 && (!once || k === 0)) {
      let t = start + window;
      for (let r = 0; r < repeat; r++) {
        t = emitSequence(g, exchange, t, { eventId: `${eventId}.x${r}` });
      }
    }
  }
}
