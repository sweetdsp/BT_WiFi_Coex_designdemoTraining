// Stages E and F: arbitration and retries (spec 7A.8, 7A.9).
//
// Blocks are processed in time order. A block that has no hard conflict is simply granted. A block that
// does is decided together with every block it chains to (its "group"): the policy picks a winner,
// the winner is granted, and each loser is delayed (if its task allows it), or denied and recorded as
// lost or retried. Delayed blocks and retry blocks are put back into the queue, which re-runs stages
// D and E for them. Every decision records its reason, including buffer levels and the spec basis.
import type { DataBundle } from '../data';
import { isHard } from '../stageD';
import type { AfhMap } from '../stageC';
import { setBleDataChannel, setClassicChannel } from '../stageB';
import { makeRng, type Rng } from '../util/rng';
import type { AirBlock, ArbitrationPolicy, Decision, ScenarioConfig, SpecLabel } from '../types';
import { PriorityModel, type PriorityInfo } from './priority';
import { buildRuntime, type TaskRuntime } from './runtime';

export interface AnchorStats {
  hits: number;
  misses: number;
  longestRun: number;
  tolerated: number;
  /** Smallest remaining time before the supervision timeout at a miss, if the link has one. */
  minMarginUs?: number;
}

export interface ArbitrationResult {
  blocks: AirBlock[];
  decisions: Decision[];
  anchorStats: Record<string, AnchorStats>;
  runtime: Map<string, TaskRuntime>;
}

const labelText = (l: SpecLabel) => (l === 'STANDARD' ? 'Standard says' : 'Implementations vary');
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith('s') ? `${w}es` : `${w}s`}`;

interface Cause { winner?: AirBlock; rule: string; text: string; label: SpecLabel; priorities?: Decision['priorities'] }

const cmp = (a: AirBlock, b: AirBlock) => a.start - b.start || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function arbitrate(input: AirBlock[], config: ScenarioConfig, data: DataBundle, afh: AfhMap): ArbitrationResult {
  const p = config.platform;
  const policy: ArbitrationPolicy = p.arbitrationPolicy;
  const blocks = input.map((b) => ({ ...b }));
  const runtime = buildRuntime(config, data);
  const model = new PriorityModel(data, runtime, blocks, config);
  const decisions: Decision[] = [];
  const byGroup = new Map<string, AirBlock[]>();
  const resolved = new Set<string>();
  const retryDone = new Set<string>();
  const pending: Record<'BT' | 'WIFI', AirBlock[]> = { BT: [], WIFI: [] };
  const heads = { BT: 0, WIFI: 0 };
  const granted: Record<'BT' | 'WIFI', AirBlock[]> = { BT: [], WIFI: [] };
  const justMoved = new Set<string>();
  const deliveredRoots = new Set<string>();
  const retryRng = new Map<string, Rng>();
  const rootOf = (b: AirBlock) => b.groupId.split('~')[0];
  let idCounter = 0;
  const maxDelays = data.limits.maxDelaysPerBlock as number;
  const slotUs = data.constants.classicSlotUs as number;
  const ifs = data.constants.bleInterFrameSpacingUs as number;
  const nameOf = (b: AirBlock) => runtime.get(b.taskId)?.name ?? b.taskId;
  const rtOf = (b: AirBlock) => runtime.get(b.taskId)!;
  const endOf = (b: AirBlock) => b.start + b.duration;

  // ---- indexes -----------------------------------------------------------------------------------
  const addToGroup = (b: AirBlock) => { (byGroup.get(b.groupId) ?? byGroup.set(b.groupId, []).get(b.groupId)!).push(b); };
  for (const b of blocks) addToGroup(b);
  const members = (b: AirBlock) => (byGroup.get(b.groupId) ?? []).filter((m) => !m.optional).sort(cmp);
  const isLeader = (b: AirBlock) => members(b)[0]?.id === b.id;
  const groupEnd = (b: AirBlock) => Math.max(...members(b).map(endOf));

  const insertPending = (b: AirBlock) => {
    const list = pending[b.tech];
    let lo = heads[b.tech], hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(list[mid], b) < 0) lo = mid + 1; else hi = mid; }
    list.splice(lo, 0, b);
  };
  const removePending = (b: AirBlock) => {
    const list = pending[b.tech];
    let lo = heads[b.tech], hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(list[mid], b) < 0) lo = mid + 1; else hi = mid; }
    if (list[lo]?.id === b.id) list.splice(lo, 1);
  };
  for (const b of blocks) if (!b.optional) insertPending(b);

  const nextPending = (): AirBlock | undefined => {
    for (const t of ['BT', 'WIFI'] as const) {
      const list = pending[t];
      while (heads[t] < list.length && resolved.has(list[heads[t]].id)) heads[t]++;
    }
    const a = pending.BT[heads.BT], w = pending.WIFI[heads.WIFI];
    if (a && w) return cmp(a, w) <= 0 ? a : w;
    return a ?? w;
  };

  // ---- granted blocks, for "is this time free?" ---------------------------------------------------
  const insertGranted = (b: AirBlock) => {
    const list = granted[b.tech];
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(list[mid], b) < 0) lo = mid + 1; else hi = mid; }
    list.splice(lo, 0, b);
  };
  const maxDur = { BT: Math.max(1, ...blocks.filter((b) => b.tech === 'BT').map((b) => b.duration)) * 2, WIFI: Math.max(1, ...blocks.filter((b) => b.tech === 'WIFI').map((b) => b.duration)) * 2 };
  const findOccupant = (probe: AirBlock): AirBlock | undefined => {
    const other = probe.tech === 'BT' ? 'WIFI' : 'BT';
    const list = granted[other];
    const s = probe.start, e = probe.start + probe.duration;
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].start < e) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0 && list[i].start >= s - maxDur[other]; i--) {
      const o = list[i];
      if (endOf(o) > s && o.start < e && (probe.tech === 'BT' ? isHard(probe, o, p, data) : isHard(o, probe, p, data))) return o;
    }
    return undefined;
  };

  /** Same-technology blocks (granted or still waiting) that overlap a probe, ignoring the probe's own group. */
  const sameTechBlockers = (probe: AirBlock, ignore: Set<string>): AirBlock[] => {
    const out: AirBlock[] = [];
    const s0 = probe.start, e0 = probe.start + probe.duration;
    const gl = granted[probe.tech];
    let lo = 0, hi = gl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (gl[mid].start < e0) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0 && gl[i].start >= s0 - maxDur[probe.tech]; i--) if (endOf(gl[i]) > s0 && !ignore.has(gl[i].id)) out.push(gl[i]);
    const pl = pending[probe.tech];
    let a = heads[probe.tech], z = pl.length;
    const from = s0 - maxDur[probe.tech];
    while (a < z) { const mid = (a + z) >> 1; if (pl[mid].start < from) a = mid + 1; else z = mid; }
    for (let i = a; i < pl.length && pl[i].start < e0; i++) {
      const c = pl[i];
      if (!resolved.has(c.id) && endOf(c) > s0 && !ignore.has(c.id) && !out.includes(c)) out.push(c);
    }
    return out;
  };

  const hardNeighbors = (b: AirBlock): AirBlock[] => {
    const other = b.tech === 'BT' ? 'WIFI' : 'BT';
    const list = pending[other];
    const out: AirBlock[] = [];
    const e = endOf(b);
    // Skip straight to the first block that could still reach b, then walk until blocks start after b ends.
    let lo = heads[other], hi = list.length;
    const from = b.start - maxDur[other];
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].start < from) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < list.length && list[i].start < e; i++) {
      const c = list[i];
      if (resolved.has(c.id) || endOf(c) <= b.start) continue;
      if (b.tech === 'BT' ? isHard(b, c, p, data) : isHard(c, b, p, data)) out.push(c);
    }
    return out;
  };

  // ---- time share --------------------------------------------------------------------------------
  const serialised = p.antennaMode === 'SHARED' || p.coreMode !== 'CONCURRENT';
  const tsActive = policy === 'TIME_SHARE' && serialised;
  const tsPhase = makeRng(p.seed, 'timeshare').next();
  const tsStep = data.constants.timeShareSequenceStep as number;
  const sliceIndex = (t: number) => Math.floor(t / p.timeShareSliceUs);
  const sliceOwner = (i: number): 'BT' | 'WIFI' => (((tsPhase + i * tsStep) % 1) < p.timeShareBtPercent / 100 ? 'BT' : 'WIFI');
  const nextOwnedSlice = (tech: 'BT' | 'WIFI', t: number): number => {
    let i = sliceIndex(t) + 1;
    for (let n = 0; n < 10000 && sliceOwner(i) !== tech; n++) i++;
    return i * p.timeShareSliceUs;
  };

  // ---- hops for moved or new blocks -------------------------------------------------------------
  const rehop = (b: AirBlock, tag: string) => {
    if (b.chanMode !== 'CLASSIC_HOP' && b.chanMode !== 'BLE_DATA') return;
    const u = makeRng(p.seed, `${b.id}:${tag}`).next();
    b.hopU = u;
    const reduced = afh.enabled && b.start >= afh.delayUs;
    if (b.chanMode === 'CLASSIC_HOP') {
      const set = reduced ? afh.classicAllowed : null;
      setClassicChannel(data, b, set ? set[Math.floor(u * set.length)] : Math.floor(u * data.constants.classicHopChannels));
    } else {
      const set = reduced ? afh.bleAllowed : null;
      setBleDataChannel(data, b, set ? set[Math.floor(u * set.length)] : Math.floor(u * data.constants.bleDataChannelCount));
    }
  };

  // ---- decisions ---------------------------------------------------------------------------------
  const record = (winner: AirBlock | undefined, loser: AirBlock, cause: Cause, t: number): Decision => {
    const d: Decision = {
      id: `D${String(decisions.length + 1).padStart(4, '0')}`, time: t, policy, rule: cause.rule,
      winnerId: winner?.id ?? '', loserIds: [loser.id], priorities: cause.priorities ?? {}, text: cause.text, label: cause.label,
    };
    decisions.push(d);
    loser.decisionId = d.id;
    if (winner) winner.decisionId ??= d.id;
    return d;
  };

  const describePriorities = (a: AirBlock, b: AirBlock, t: number): { pa: PriorityInfo; pb: PriorityInfo; map: Decision['priorities'] } => {
    const pa = model.priorityOf(a, t), pb = model.priorityOf(b, t);
    const row = (x: PriorityInfo) => ({ value: x.value, base: x.base, critical: x.critical, anchor: x.anchor, waiting: x.waiting });
    return { pa, pb, map: { [a.id]: row(pa), [b.id]: row(pb) } };
  };

  /** Explain why W beat n under the PRIORITY policy (anchor rules first, then dynamic priority). */
  const priorityCause = (w: AirBlock, n: AirBlock, t: number): Cause => {
    const { pa, pb, map } = describePriorities(w, n, t);
    const rw = rtOf(w), rn = rtOf(n);
    const wn = nameOf(w), nn = nameOf(n);
    const stN = model.state.get(n.taskId)!;
    const waitTxt = (x: PriorityInfo, name: string) => (x.waiting !== undefined ? ` ${name} had ${plural(x.waiting, 'packet')} waiting.` : '');
    if (pa.anchor && !pb.anchor) {
      const a = rw.anchor!;
      return { winner: w, rule: 'ANCHOR_FIRST_ATTEMPT', label: a.basis, priorities: map,
        text: `${wn} first attempt is a mandatory anchor with ${a.missCost.toLowerCase()} miss cost (${labelText(a.basis)}), so it was granted over ${nn}.${waitTxt(pb, nn)}` };
    }
    if (pa.anchor && pb.anchor) {
      const rank = data.priorityTable.missCostRank;
      const ca = rw.anchor!.missCost, cb = rn.anchor!.missCost;
      const why = rank[ca] !== rank[cb] ? `${wn} has a higher miss cost (${ca.toLowerCase()} against ${cb.toLowerCase()})` : data.priorityTable.anchorTiebreakClasses.includes(rw.def.priorityClass) && !data.priorityTable.anchorTiebreakClasses.includes(rn.def.priorityClass) ? `miss cost is equal and ${wn} is a voice or audio link` : `miss cost is equal and ${wn} comes first`;
      return { winner: w, rule: 'ANCHOR_VS_ANCHOR', label: rw.anchor!.basis, priorities: map, text: `Both ${wn} and ${nn} are mandatory anchors, and ${why}, so ${wn} was granted (${labelText(rw.anchor!.basis)}).` };
    }
    if (!pa.anchor && pb.anchor) {
      const a = rn.anchor!;
      return { winner: w, rule: 'ANCHOR_GIVE_UP', label: a.basis, priorities: map,
        text: `${nn} is a ${a.missCost.toLowerCase()}-cost anchor with ${plural(stN.misses, 'miss')} so far out of ${a.toleratedMisses} tolerated (${labelText(a.basis)}), so ${wn} was granted.${pa.critical ? ` ${wn} was critical${pa.waiting !== undefined ? ` with ${plural(pa.waiting, 'packet')} waiting` : ''}.` : ''}` };
    }
    // Both flexible: dynamic priority.
    let text: string;
    if (pa.critical && pa.waiting !== undefined) text = `${wn} had ${plural(pa.waiting, 'packet')} waiting, so it became critical (priority ${pa.value}) and won against ${nn} (priority ${pn(pb)}).`;
    else if (pb.waiting !== undefined && !pb.critical) text = `${nn} had ${plural(pb.waiting, 'packet')} waiting, so ${wn} was granted.`;
    else text = `${wn} (priority ${pa.value}) was granted over ${nn} (priority ${pb.value}).`;
    if (pa.value === pb.value) text += ` Priorities were equal, so the block that started first${w.tech === 'BT' && n.start === w.start ? ', then Bluetooth,' : ''} won.`;
    if (pb.note) text += ` ${nn}: ${pb.note}.`;
    return { winner: w, rule: 'PRIORITY_DYNAMIC', label: 'IMPLEMENTATION_VARIES', priorities: map, text };
  };
  const pn = (x: PriorityInfo) => x.value;

  const giveUpAllowed = (a: AirBlock, other: PriorityInfo, t: number): boolean => {
    const rt = rtOf(a);
    const anc = rt.anchor!;
    if (!data.priorityTable.anchorGiveUp.allowedMissCosts.includes(anc.missCost)) return false;
    if (!other.critical) return false;
    const st = model.state.get(a.taskId)!;
    if (st.consecutive >= anc.toleratedMisses) return false;
    if (rt.supervisionUs) {
      if (t - st.lastSuccessUs > data.priorityTable.anchorGiveUp.maxElapsedFractionOfSupervision * rt.supervisionUs) return false;
      if (t - st.lastSuccessUs + rt.intervalUs >= rt.supervisionUs) return false;
    }
    return true;
  };

  /** True if a beats b under the policy. */
  const beats = (a: AirBlock, b: AirBlock, t: number): boolean => {
    if (policy === 'FIRST_COME') return a.start !== b.start ? a.start < b.start : a.tech === 'BT' && b.tech !== 'BT' || (a.tech === b.tech && cmp(a, b) < 0);
    if (policy === 'BT_FAVOURED' || policy === 'WIFI_FAVOURED') {
      const fav = policy === 'BT_FAVOURED' ? 'BT' : 'WIFI';
      if (a.tech !== b.tech) return a.tech === fav;
      return cmp(a, b) < 0;
    }
    if (policy === 'TIME_SHARE') return cmp(a, b) < 0;
    const pa = model.priorityOf(a, t), pb = model.priorityOf(b, t);
    if (pa.anchor && pb.anchor) {
      const rank = data.priorityTable.missCostRank;
      const ra = rank[rtOf(a).anchor!.missCost], rb = rank[rtOf(b).anchor!.missCost];
      if (ra !== rb) return ra > rb;
      const tb = data.priorityTable.anchorTiebreakClasses;
      const va = tb.includes(rtOf(a).def.priorityClass), vb = tb.includes(rtOf(b).def.priorityClass);
      if (va !== vb) return va;
      return cmp(a, b) < 0;
    }
    if (pa.anchor) return !giveUpAllowed(a, pb, t);
    if (pb.anchor) return giveUpAllowed(b, pa, t);
    if (pa.value !== pb.value) return pa.value > pb.value;
    if (a.start !== b.start) return a.start < b.start;
    return a.tech === 'BT' && b.tech !== 'BT' ? true : a.tech === b.tech ? cmp(a, b) < 0 : false;
  };

  const cause = (w: AirBlock, n: AirBlock, t: number): Cause => {
    const wn = nameOf(w), nn = nameOf(n);
    const { map } = describePriorities(w, n, t);
    switch (policy) {
      case 'FIRST_COME':
        return { winner: w, rule: 'FIRST_COME', label: 'IMPLEMENTATION_VARIES', priorities: map, text: `${wn} started first (${w.start} us), so it was granted and ${nn} was denied.` };
      case 'BT_FAVOURED':
      case 'WIFI_FAVOURED': {
        const fav = policy === 'BT_FAVOURED' ? 'Bluetooth' : 'Wi-Fi';
        return { winner: w, rule: 'FAVOURED', label: 'IMPLEMENTATION_VARIES', priorities: map, text: w.tech !== n.tech ? `The policy favours ${fav}, so ${wn} was granted over ${nn} regardless of priority.` : `${wn} started first, so it was granted over ${nn}.` };
      }
      case 'TIME_SHARE':
        return { winner: w, rule: 'TIME_SHARE_SPILLOVER', label: 'IMPLEMENTATION_VARIES', priorities: map, text: `${wn} and ${nn} overlapped inside the same time slice, so the one that started first, ${wn}, was granted.` };
      default:
        return priorityCause(w, n, t);
    }
  };

  // ---- granting and losing ----------------------------------------------------------------------
  const anchorStat = (b: AirBlock) => model.state.get(b.taskId)!;

  const grant = (b: AirBlock, reason: string, dec?: Decision) => {
    // A block that was moved stays DELAYED: the outcome the user needs to see is that it went out late.
    // The rest of a pair keeps the priority its first block won with (the buffer level drops once a packet is granted).
    if (isLeader(b) && members(b).length > 1) model.pin(b, model.priorityOf(b, b.start));
    const moved = (b.delayCount ?? 0) > 0;
    b.status = moved ? 'DELAYED' : 'GRANTED';
    b.reason = moved ? `${b.reason} It was then granted at ${b.start} us.` : reason;
    if (dec) b.decisionId = dec.id;
    resolved.add(b.id);
    insertGranted(b);
    const st = anchorStat(b);
    if (model.isPacket({ ...b, attempt: 1, optional: false }) && rtOf(b).def.buffer?.enabled && !deliveredRoots.has(rootOf(b))) {
      deliveredRoots.add(rootOf(b));
      st.delivered++;
    }
    if (model.isAnchor(b) && isLeader(b)) {
      st.hits++;
      st.consecutive = 0;
      st.lastSuccessUs = b.start;
    }
  };

  const alignEven = (t: number) => Math.ceil(t / (2 * slotUs)) * 2 * slotUs;

  /** Move a block (and the unresolved blocks that follow it in its group) to the earliest free time at or after notBefore. */
  const delayGroup = (leader: AirBlock, notBefore: number, why: string): boolean => {
    const group = members(leader).filter((m) => !resolved.has(m.id) && cmp(m, leader) >= 0);
    const own = new Set(group.map((m) => m.id));
    let t = notBefore;
    const classicLeader = leader.chanMode === 'CLASSIC_HOP';
    for (let iter = 0; iter < 400; iter++) {
      if (classicLeader) t = alignEven(t);
      const delta = t - leader.start;
      let bump = t;
      for (const m of group) {
        const probe: AirBlock = { ...m, start: m.start + delta };
        const off = m.start - leader.start;
        const occ = findOccupant(probe);
        if (occ) bump = Math.max(bump, endOf(occ) - off);
        // The radio cannot do two things at once, so a moved block lands after same-technology blocks too.
        for (const x of sameTechBlockers(probe, own)) bump = Math.max(bump, endOf(x) - off);
        // Skip over blocks still waiting their turn that would beat this one, so it lands in a gap it can keep.
        for (const x of hardNeighbors(probe)) if (beats(x, probe, probe.start)) bump = Math.max(bump, groupEnd(x) - off);
      }
      if (bump === t) break;
      t = bump;
    }
    if (t <= leader.start) return false;
    const delta = t - leader.start;
    const from = leader.start;
    for (const m of group) {
      removePending(m);
      m.start += delta;
      m.status = 'DELAYED';
      m.delayCount = (m.delayCount ?? 0) + 1;
      justMoved.add(m.id);
      m.reason = `${why} Delayed from ${m.start - delta} us to ${m.start} us.`;
      if (m.chanMode === 'CLASSIC_HOP') {
        m.plannedFreqCenter ??= m.freqCenter;
        m.plannedChannelIndex ??= m.channelIndex;
        rehop(m, `rehop${m.delayCount}`);
      }
      if (m.start < p.windowUs) insertPending(m);
      else { resolved.add(m.id); insertGranted(m); } // pushed past the end of the window: parked, but still occupies the radio
    }
    void from;
    return true;
  };

  // Events of each task in time order (first attempts only), built once from the planned blocks.
  const eventTables = new Map<string, { k: string; s: number; e: number }[]>();
  const eventTable = (taskId: string) => {
    let t = eventTables.get(taskId);
    if (!t) {
      const byKey = new Map<string, { k: string; s: number; e: number }>();
      for (const b of input) {
        if (b.taskId !== taskId || b.optional) continue;
        const cur = byKey.get(b.eventKey);
        if (cur) { cur.s = Math.min(cur.s, b.plannedStart); cur.e = Math.max(cur.e, b.plannedStart + b.duration); }
        else byKey.set(b.eventKey, { k: b.eventKey, s: b.plannedStart, e: b.plannedStart + b.duration });
      }
      t = [...byKey.values()].sort((a, b) => a.s - b.s);
      eventTables.set(taskId, t);
    }
    return t;
  };

  const createRetry = (n: AirBlock): AirBlock[] | undefined => {
    const rt = rtOf(n);
    const rule = rt.def.retry;
    if (rule === 'NONE') return undefined;
    const grp = members(n);
    const anchorTask = !!rt.anchor?.isAnchor;
    const attempt = n.attempt + 1;
    // Retransmission opportunities that already exist in the event (eSCO window, spare ISO subevents).
    if (rule === 'ESCO_WINDOW' || rule === 'BLE_NEXT_PACKET_OR_EVENT') {
      const pools = new Map<string, AirBlock[]>();
      for (const b of blocks) if (b.optional && b.eventKey === n.eventKey && b.taskId === n.taskId && b.start > endOf(grp[grp.length - 1]) - 1) (pools.get(b.groupId) ?? pools.set(b.groupId, []).get(b.groupId)!).push(b);
      const first = [...pools.values()].map((g) => g.sort(cmp)).sort((a, b) => cmp(a[0], b[0]))[0];
      if (first) {
        first.forEach((b, i) => {
          b.optional = false; b.retryOf = (grp[i] ?? grp[0]).id; b.attempt = attempt; b.status = 'PLANNED'; b.retx = anchorTask; b.groupId = `${rootOf(n)}~r${attempt}`;
          b.reason = ''; rehop(b, 'retry');
        });
        const g2 = first;
        byGroup.set(g2[0].groupId, g2);
        return g2;
      }
      if (rule === 'ESCO_WINDOW') return undefined;
    }
    let shift: number;
    let scale = 1;
    if (rule === 'NEXT_SLOT_PAIR') {
      shift = alignEven(groupEnd(n)) - grp[0].start;
    } else if (rule === 'WIFI_BACKOFF') {
      const rng = retryRng.get(n.taskId) ?? retryRng.set(n.taskId, makeRng(p.seed, `${n.taskId}:retry`)).get(n.taskId)!;
      const wt = data.wifiTiming;
      const slot = data.wifiGenerations[p.wifiGeneration].slotUs;
      shift = groupEnd(n) + wt.sifsUs + 2 * slot + rng.int(0, wt.contentionWindowSlots) * slot - grp[0].start;
      const f = wt.rateStepFactors as number[];
      scale = 1 / f[Math.min(attempt - 1, f.length - 1)];
    } else {
      // BLE_NEXT_PACKET_OR_EVENT: send it again after the next event of the same task.
      const events = eventTable(n.taskId);
      const idx = events.findIndex((e) => e.k === n.eventKey);
      const next = events[idx + 1];
      if (idx < 0 || !next) return undefined;
      shift = next.e + ifs - grp[0].plannedStart;
    }
    // Lay the retry group out from its first block, keeping the original gaps between blocks. A longer frame
    // (rate step-down) pushes the blocks after it back, so the group never overlaps itself.
    const layout = (sh: number) => {
      let prevOrigEnd = 0, prevNewEnd = 0;
      return grp.map((m, i) => {
        const dur = scale !== 1 && ['DATA', 'VOICE', 'ISO'].includes(String(m.kind)) ? Math.ceil(m.duration * scale) : m.duration;
        const start = i === 0 ? m.start + sh : prevNewEnd + (m.start - prevOrigEnd);
        prevOrigEnd = endOf(m);
        prevNewEnd = start + dur;
        return { start, dur };
      });
    };
    // A retry may not land on top of another block of the same radio.
    {
      const own = new Set(grp.map((m) => m.id));
      for (let iter = 0; iter < 400; iter++) {
        let bump = shift;
        const pos = layout(shift);
        grp.forEach((m, i) => {
          for (const x of sameTechBlockers({ ...m, start: pos[i].start, duration: pos[i].dur }, own)) bump = Math.max(bump, shift + endOf(x) - pos[i].start);
        });
        if (rule === 'NEXT_SLOT_PAIR') bump = alignEven(bump + grp[0].start) - grp[0].start;
        if (bump === shift) break;
        shift = bump;
      }
    }
    if (grp[0].start + shift >= p.windowUs) return undefined;
    const groupId = `${rootOf(n)}~r${attempt}`;
    const pos = layout(shift);
    const clones = grp.map((m, i) => {
      const c: AirBlock = {
        ...m, id: `${m.taskId}:x${String(++idCounter).padStart(5, '0')}`, seq: 1_000_000 + idCounter, start: pos[i].start, plannedStart: pos[i].start,
        duration: pos[i].dur,
        retryOf: m.id, attempt, status: 'PLANNED', reason: '', groupId, optional: false, retx: anchorTask, decisionId: undefined, delayCount: 0, contested: false,
      };
      rehop(c, 'retry');
      return c;
    });
    for (const c of clones) { blocks.push(c); addToGroup(c); }
    return clones;
  };

  const scheduleRetry = (n: AirBlock): string => {
    if (retryDone.has(n.groupId)) return '';
    retryDone.add(n.groupId);
    if (n.attempt - 1 >= p.retryLimit) return ' The retry limit was reached, so the block is lost.';
    const clones = createRetry(n);
    if (!clones) {
      const r = rtOf(n).def.retry;
      return r === 'NONE' ? ' This task has no retransmission, so the block is lost.' : r === 'ESCO_WINDOW' ? ' No retransmission slots are left in the window, so the block is lost.' : ' There is no later chance to resend it within the window, so the block is lost.';
    }
    for (const c of clones) insertPending(c);
    return ` A retry (attempt ${n.attempt + 1}) is scheduled at ${clones[0].start} us.`;
  };

  const deny = (n: AirBlock, c: Cause, t: number) => {
    const dec = record(c.winner, n, c, t);
    n.status = 'DENIED';
    resolved.add(n.id);
    const rt = rtOf(n);
    const st = anchorStat(n);
    let missed = '';
    if (model.isAnchor(n) && isLeader(n)) {
      st.misses++;
      st.consecutive++;
      st.maxRun = Math.max(st.maxRun, st.consecutive);
      if (rt.supervisionUs) st.minMarginUs = Math.min(st.minMarginUs, rt.supervisionUs - (n.start - st.lastSuccessUs));
      missed = ` Recorded as a missed anchor (${st.consecutive} in a row, ${plural(st.misses, 'miss')} in total).`;
    }
    // Blocks that depended on this one are not sent either.
    const followers = members(n).filter((m) => cmp(m, n) > 0 && !resolved.has(m.id));
    for (const f of followers) { f.status = 'DENIED'; f.reason = `${nameOf(n)} was not sent, so this ${f.dir === 'RX' ? 'reply' : 'follow-up'} did not happen.`; resolved.add(f.id); f.decisionId = dec.id; }
    const retryText = scheduleRetry(n);
    const retried = retryText.includes('is scheduled');
    n.status = retried ? 'RETRIED' : 'LOST';
    n.reason = `${c.text} It was denied.${missed}${retryText}`;
    for (const f of followers) f.status = retried ? 'RETRIED' : 'LOST';
  };

  const lose = (n: AirBlock, c: Cause, t: number, delayTo?: number) => {
    const rt = rtOf(n);
    const canDelay = !model.isAnchor(n) && rt.def.delayable && isLeader(n) && (n.delayCount ?? 0) < maxDelays;
    if (canDelay) {
      const w = c.winner;
      const target = delayTo ?? (w ? Math.max(groupEnd(w), endOf(w)) + (n.tech === 'WIFI' ? data.wifiTiming.difsUs : 0) : t);
      const dec = record(c.winner, n, c, t);
      if (delayGroup(n, target, c.text)) { n.decisionId = dec.id; return; }
      decisions.pop();
    }
    deny(n, c, t);
  };

  // ---- main loop --------------------------------------------------------------------------------
  const resolveGroup = (group: AirBlock[], t: number) => {
    justMoved.clear();
    const unresolved = new Set(group);
    while (unresolved.size > 0) {
      const arr = [...unresolved].sort(cmp);
      const eligible = arr.filter((b) => !members(b).some((m) => cmp(m, b) < 0 && unresolved.has(m)));
      let w = eligible[0];
      for (const c of eligible.slice(1)) if (beats(c, w, Math.max(c.start, w.start))) w = c;
      const nbrs = hardNeighbors(w).filter((x) => unresolved.has(x));
      unresolved.delete(w);
      if (nbrs.length === 0) { grant(w, 'No other-technology block contests this time.'); continue; }
      let decFirst: Decision | undefined;
      const losers: { n: AirBlock; c: Cause }[] = [];
      for (const n of nbrs) { unresolved.delete(n); losers.push({ n, c: cause(w, n, Math.max(w.start, n.start)) }); }
      grant(w, losers[0].c.text);
      for (const { n, c } of losers) {
        if (justMoved.has(n.id) || resolved.has(n.id)) continue; // moved or settled together with its leader
        const before = decisions.length;
        lose(n, c, t);
        decFirst ??= decisions[before];
        for (const m of members(n)) unresolved.delete(m);
      }
      if (decFirst) w.decisionId = decFirst.id;
      w.contested = true;
      for (const { n } of losers) n.contested = true;
    }
  };

  for (let b = nextPending(); b; b = nextPending()) {
    const t = b.start;
    if (t >= p.windowUs) { resolved.add(b.id); continue; }
    // Time share: a block outside its technology's slice is not allowed on the air (7A.8).
    if (tsActive) {
      const i = sliceIndex(t);
      const owner = sliceOwner(i);
      if (owner !== b.tech) {
        const ownerName = owner === 'BT' ? 'Bluetooth' : 'Wi-Fi';
        const text = `Time slice ${i} (${i * p.timeShareSliceUs} to ${(i + 1) * p.timeShareSliceUs} us) belongs to ${ownerName} in the ${p.timeShareBtPercent}/${100 - p.timeShareBtPercent} share, so ${nameOf(b)} was outside its slice.`;
        const c: Cause = { rule: 'TIME_SHARE_SLICE', label: 'IMPLEMENTATION_VARIES', text };
        lose(b, c, t, nextOwnedSlice(b.tech, t));
        continue;
      }
    }
    const occ = findOccupant(b);
    if (occ) {
      const c: Cause = { winner: occ, rule: 'ALREADY_GRANTED', label: 'IMPLEMENTATION_VARIES', text: `${nameOf(occ)} had already been granted this time, so ${nameOf(b)} could not use it.` };
      lose(b, c, t, endOf(occ));
      continue;
    }
    const first = hardNeighbors(b);
    if (first.length === 0) { grant(b, 'No other-technology block contests this time.'); continue; }
    // Group: everything chained to b by hard conflicts, plus the blocks that move with them.
    const group = new Map<string, AirBlock>([[b.id, b]]);
    const queue = [b];
    while (queue.length) {
      const x = queue.pop()!;
      for (const y of [...hardNeighbors(x), ...members(x).filter((m) => !resolved.has(m.id))]) {
        if (!group.has(y.id) && !resolved.has(y.id)) { group.set(y.id, y); queue.push(y); }
      }
    }
    resolveGroup([...group.values()], t);
  }

  // Anything still planned has no contest.
  for (const b of blocks) if (!b.optional && b.status === 'PLANNED') { b.status = 'GRANTED'; b.reason ||= 'No other-technology block contests this time.'; }

  const anchorStats: Record<string, AnchorStats> = {};
  for (const [id, st] of model.state) {
    const rt = runtime.get(id)!;
    if (rt.anchor?.isAnchor) anchorStats[id] = { hits: st.hits, misses: st.misses, longestRun: st.maxRun, tolerated: rt.anchor.toleratedMisses, minMarginUs: Number.isFinite(st.minMarginUs) ? st.minMarginUs : undefined };
  }
  return { blocks: blocks.sort(cmp), decisions, anchorStats, runtime };
}
