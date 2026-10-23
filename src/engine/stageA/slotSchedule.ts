// SLOT_SCHEDULE: Bluetooth Classic slot-based activity (spec 7A.3 and 7A.4).
// A master slot is followed by a slave slot; the master transmits in even slots and the slave
// reply starts on the next odd slot after the master packet ends.
import { bitrateIntervalSlots, resolveDurationUs } from '../estimate';
import { classicPacket } from '../timing/bt';
import { resolveRef, resolveText } from '../timing/refs';
import type { PacketSpec } from '../types';
import { num, pattern, pushBlock, resolveDir, type GenContext } from './common';

function slotsOf(g: GenContext, p: PacketSpec): number {
  const d = p.dur as { bt?: string };
  return d.bt ? classicPacket(g.data, resolveText(d.bt, g)).slots : 1;
}

const evenUp = (n: number) => n + (n % 2);

export function slotSchedule(g: GenContext): void {
  const pat = pattern(g);
  const slotUs = g.data.constants.classicSlotUs;
  const master = pat.master as PacketSpec;
  const reply = pat.reply as PacketSpec;
  const pairs = pat.pairs === undefined ? 1 : Math.max(1, Math.round(num(g, pat.pairs)));
  const offset = evenUp(Math.round(pat.offsetSlots === undefined ? 0 : num(g, pat.offsetSlots)));
  const bitrate = pat.bitrateKbps !== undefined;
  const interval = bitrate ? bitrateIntervalSlots(g, pat) : Math.max(2, Math.round(num(g, pat.intervalSlots)));
  const ms = slotsOf(g, master);
  const rs = slotsOf(g, reply);
  const retxSlots = pat.retxWindowSlots === undefined ? 0 : Math.round(num(g, pat.retxWindowSlots));
  // Producer side of a buffered stream: a packet becomes available every payload/bitrate seconds.
  const arrivalStep = bitrate
    ? (classicPacket(g.data, resolveText(pat.payloadPacketType, g)).maxPayloadBytes * 8 * 1000) / resolveRef(pat.bitrateKbps, g)
    : 0;

  const emitPair = (m: number, optional: boolean, eventId: string, eventKey: string, arrival?: number): number => {
    const mDur = resolveDurationUs(master.dur, g);
    const rDur = resolveDurationUs(reply.dur, g);
    const mCount = master.count === undefined ? 1 : Math.round(num(g, master.count));
    const mGap = master.gapUs === undefined ? 0 : num(g, master.gapUs);
    for (let i = 0; i < mCount; i++) {
      pushBlock(g, { dir: resolveDir(master.dir, g.params), start: m * slotUs + i * (mDur + mGap), duration: mDur, kind: master.kind, chanMode: 'CLASSIC_HOP', eventId: `${eventId}.m${i}`, groupId: eventId, eventKey, optional, arrivalUs: arrival });
    }
    const r = m + ms;
    pushBlock(g, { dir: resolveDir(reply.dir, g.params), start: r * slotUs, duration: rDur, kind: reply.kind, chanMode: 'CLASSIC_HOP', eventId: `${eventId}.r`, groupId: eventId, eventKey, optional });
    return evenUp(r + rs);
  };

  for (let k = 0; ; k++) {
    const base = offset + k * interval;
    if (base * slotUs >= g.windowUs) break;
    const arrival = bitrate ? Math.round(k * arrivalStep) : undefined;
    let m = base;
    for (let p = 0; p < pairs; p++) m = emitPair(m, false, `${g.instanceId}.e${k}.p${p}`, `${g.instanceId}.e${k}`, arrival);
    // Retransmission window after the reserved pairs: blocks exist only if a retry is triggered (SR-6).
    if (retxSlots > 0) {
      let w = m;
      const end = m + retxSlots;
      for (let i = 0; w + ms + rs <= end; i++) w = emitPair(w, true, `${g.instanceId}.e${k}.w${i}`, `${g.instanceId}.e${k}`);
    }
  }
}
