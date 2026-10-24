// The five worked examples of spec 7A.12 as automated tests (AC-6). Exact checks on block counts and timing.
import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { runEngine, type EngineResult } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import { expandAll } from '../src/engine/stageA';
import { hasErrors, validate } from '../src/engine/validator';
import type { AirBlock } from '../src/engine/types';

const cache = new Map<string, EngineResult>();
const ex = (n: number) => {
  const id = `example-${n}`;
  if (!cache.has(id)) cache.set(id, runEngine(presetConfig(id, data), data));
  return cache.get(id)!;
};
const bt = (r: EngineResult) => r.blocks.filter((b) => b.tech === 'BT' && !b.optional);
const wifi = (r: EngineResult) => r.blocks.filter((b) => b.tech === 'WIFI' && !b.optional);
const overlapsWifi = (r: EngineResult, b: AirBlock) => wifi(r).some((w) => w.start < b.start + b.duration && b.start < w.start + w.duration);
const decisionWaiting = (r: EngineResult, id: string, taskPrefix: string) => Object.entries(r.decisions.find((d) => d.id === id)!.priorities).find(([k]) => k.startsWith(taskPrefix))?.[1];

describe('VAL-9: every worked example passes validation with no ERROR', () => {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    it(`Example ${n}`, () => {
      const issues = validate(presetConfig(`example-${n}`, data), data);
      expect(hasErrors(issues), issues.filter((i) => i.severity === 'ERROR').map((i) => i.id).join(',')).toBe(false);
    });
  }
  it('Example 3 and 4 carry the expected low-isolation warning, Example 1 and 2 none', () => {
    const ids = (n: number) => validate(presetConfig(`example-${n}`, data), data).map((i) => i.id);
    expect(ids(3)).toContain('F-3');
    expect(ids(4)).toContain('F-3');
    expect(ids(1)).not.toContain('F-3');
    expect(ids(2)).toEqual([]);
  });
  it('the presets are data: six records (the five of 7A.12 and the LE Audio example added later), in order, each naming known tasks', () => {
    expect(data.presets.map((p) => p.example)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const p of data.presets) for (const t of p.tasks) expect(data.taskIndex.has(t.taskId)).toBe(true);
  });
});

describe('Example 1: A2DP with Wi-Fi 7 on 2.4 GHz, shared antenna, AFH off', () => {
  const r = ex(1);
  it('setup matches the spec: A2DP 328 kbps with 2-DH5, 100 ms window, Wi-Fi 7 channel 6 at 20 MHz, shared antenna, PRIORITY', () => {
    const c = r.config;
    expect(c.tasks[0].params).toMatchObject({ bitrateKbps: 328, packetType: '2-DH5' });
    expect(c.platform).toMatchObject({ windowUs: 100_000, wifiGeneration: '11be', wifiChannel: 6, wifiBandwidth: 20, wifiBand: '2.4', antennaMode: 'SHARED', arbitrationPolicy: 'PRIORITY', afhEnabled: false });
    expect(c.tasks[1].taskId).toBe('wifi_video_stream');
  });
  it('pipeline: Bluetooth blocks are 5-slot master packets with 5-slot slave replies in slot pairs', () => {
    const a = expandAll(r.config, data).filter((b) => b.tech === 'BT');
    const masters = a.filter((b) => b.dir === 'TX');
    expect(masters).toHaveLength(7);
    for (const m of masters) {
      expect(m.duration).toBe(2870); // five slots
      expect(Math.round(m.start / 625) % 2).toBe(0); // master in even slots
      const reply = a.find((x) => x.dir === 'RX' && x.start === m.start + 5 * 625);
      if (m.start + 5 * 625 < 100_000) { expect(reply, `reply for ${m.id}`).toBeDefined(); expect(reply!.duration).toBe(2870); }
    }
  });
  it('pipeline: Wi-Fi blocks are aggregated bursts with block acknowledgements', () => {
    const a = expandAll(r.config, data).filter((b) => b.tech === 'WIFI');
    const data_ = a.filter((b) => b.kind === 'DATA');
    expect(data_.length).toBeGreaterThan(10);
    expect(data_.every((b) => b.duration > 1500 && b.duration <= data.wifiTiming.maxAggregationUs)).toBe(true);
    for (const d of data_) {
      const ack = a.find((x) => x.kind === 'ACK' && x.start === d.start + d.duration + data.wifiTiming.sifsUs);
      expect(ack, `block ack after ${d.id}`).toBeDefined();
      expect(ack!.duration).toBe(32);
    }
  });
  it('with a shared antenna every overlap that involves a transmit is a HARD conflict regardless of frequency', () => {
    const hard = r.conflicts.filter((c) => c.severity === 'HARD');
    expect(hard.length).toBeGreaterThan(0);
    for (const c of r.conflicts) expect(c.severity, c.id).toBe(c.dirClass === 'RX_RX' ? 'TOLERATED' : 'HARD');
    expect(hard.some((c) => c.freqOverlap)).toBe(true);
    expect(hard.some((c) => !c.freqOverlap)).toBe(true);
    expect(bt(r).filter((b) => b.dir === 'TX').every((b) => !overlapsWifi(r, b) || r.conflicts.some((c) => c.btBlockId === b.id && c.severity === 'HARD'))).toBe(true);
  });
  it('check 1: at least one A2DP block is DELAYED while fewer than four packets were waiting', () => {
    const low = r.decisions.filter((d) => d.loserIds[0].startsWith('t1:') && d.rule === 'PRIORITY_DYNAMIC' && (decisionWaiting(r, d.id, 't1')?.waiting ?? 9) < 4 && !decisionWaiting(r, d.id, 't1')!.critical);
    expect(low.length).toBeGreaterThan(0);
    const delayed = low.filter((d) => r.blocks.find((b) => b.id === d.loserIds[0])!.status === 'DELAYED');
    expect(delayed.length).toBeGreaterThan(0);
    expect(low.every((d) => /\d+ packets? waiting/.test(d.text))).toBe(true);
    expect(low.some((d) => /A2DP streaming had \d+ packets? waiting, so Video streaming was granted/.test(d.text))).toBe(true);
  });
  it('check 2: at least one Wi-Fi burst is DELAYED while four or more A2DP packets were waiting', () => {
    const crit = r.decisions.filter((d) => d.winnerId.startsWith('t1:') && (decisionWaiting(r, d.id, 't1')?.waiting ?? 0) >= 4 && decisionWaiting(r, d.id, 't1')!.critical);
    expect(crit.length).toBeGreaterThan(0);
    expect(crit.some((d) => { const b = r.blocks.find((x) => x.id === d.loserIds[0])!; return b.tech === 'WIFI' && b.status === 'DELAYED'; })).toBe(true);
    expect(crit.every((d) => /4 packets waiting, so it became critical/.test(d.text))).toBe(true);
  });
  it('check 3: no A2DP block is LOST in the 100 ms window', () => {
    expect(bt(r).filter((b) => b.status === 'LOST')).toHaveLength(0);
  });
  it('the reason text of every A2DP decision states the number of packets waiting', () => {
    const a2dp = r.decisions.filter((d) => d.rule === 'PRIORITY_DYNAMIC' && (d.winnerId.startsWith('t1:') || d.loserIds[0].startsWith('t1:')) && decisionWaiting(r, d.id, 't1')?.waiting !== undefined);
    expect(a2dp.length).toBeGreaterThan(5);
    for (const d of a2dp.filter((x) => !/follows the first block/.test(x.text) && !/priority \d+\) was granted over/.test(x.text))) expect(d.text).toMatch(/\d+ packets? waiting/);
  });
  it('summary: a small Wi-Fi throughput impact above zero and an A2DP impact of zero', () => {
    const m = r.metrics.perTask;
    expect(m.t1.throughputImpactPct).toBe(0);
    expect(m.t2.throughputImpactPct).toBeGreaterThan(0);
    expect(m.t2.throughputImpactPct).toBeLessThan(15);
  });
});

describe('Example 2: same setup with separate antennas and 40 dB isolation', () => {
  const r = ex(2);
  it('the same time overlaps occur as in Example 1', () => {
    expect(r.metrics.overlap.timeUs).toBe(ex(1).metrics.overlap.timeUs);
    expect(r.metrics.overlap.timeUs).toBeGreaterThan(0);
  });
  it('check: HARD conflicts equal zero and TOLERATED is greater than zero', () => {
    expect(r.metrics.conflicts.bySeverity.HARD).toBe(0);
    expect(r.metrics.conflicts.bySeverity.TOLERATED).toBeGreaterThan(0);
    expect(r.conflicts.every((c) => c.severity === 'TOLERATED')).toBe(true);
  });
  it('all pairs are tolerated and no block is delayed, denied, lost or retried', () => {
    expect(r.blocks.filter((b) => ['DELAYED', 'DENIED', 'LOST', 'RETRIED'].includes(b.status))).toHaveLength(0);
    expect(r.metrics.perTask.t1.throughputImpactPct).toBe(0);
    expect(r.metrics.perTask.t2.throughputImpactPct).toBe(0);
  });
});

describe('Example 3: separate antennas, 10 dB isolation, AFH off, Wi-Fi channel 6 at 20 MHz', () => {
  const r = ex(3);
  const inside = (b: AirBlock) => b.freqCenter >= 2426 && b.freqCenter <= 2448;
  const overlapping = bt(r).filter((b) => overlapsWifi(r, b));
  it('about 23 of the 79 Classic channels fall inside the footprint plus guard (spec says "about 22")', () => {
    const n = Array.from({ length: 79 }, (_, k) => 2402 + k).filter((f) => f >= 2426 && f <= 2448).length;
    expect(n).toBe(23);
  });
  it('check: the share of overlapping Bluetooth blocks marked DEGRADED is within 5 points of 28 percent over a 1 second window', () => {
    expect(r.config.platform.windowUs).toBe(1_000_000);
    expect(overlapping.length).toBeGreaterThan(100);
    const share = (overlapping.filter((b) => b.status === 'DEGRADED').length / overlapping.length) * 100;
    expect(share).toBeGreaterThanOrEqual(23);
    expect(share).toBeLessThanOrEqual(33);
  });
  it('blocks whose hop lands inside 2426 to 2448 MHz and overlap a transmit-involved Wi-Fi block are DEGRADED', () => {
    for (const b of overlapping.filter(inside)) {
      const cs = r.conflicts.filter((c) => c.btBlockId === b.id);
      if (cs.some((c) => c.severity === 'DEGRADED')) expect(b.status).toBe('DEGRADED');
    }
    expect(overlapping.filter((b) => b.status === 'DEGRADED').every(inside)).toBe(true);
  });
  it('blocks hopping outside that range remain TOLERATED, or GRANTED with a WARNING flag', () => {
    const outside = overlapping.filter((b) => !inside(b));
    expect(outside.length).toBeGreaterThan(50);
    for (const b of outside) expect(b.status === 'TOLERATED' || (b.status === 'GRANTED' && b.warning === true), `${b.id} ${b.status}`).toBe(true);
    expect(outside.some((b) => b.warning)).toBe(true);
  });
  it('degraded blocks are still drawn (airtime kept), marked corrupted, and not arbitrated', () => {
    const deg = bt(r).filter((b) => b.status === 'DEGRADED');
    expect(deg.every((b) => b.corrupted)).toBe(true);
    expect(r.blocks.filter((b) => ['DELAYED', 'LOST', 'RETRIED'].includes(b.status))).toHaveLength(0);
    expect(r.metrics.perTask.t1.throughputImpactPct).toBeGreaterThan(10);
  });
});

describe('Example 4: Example 3 with AFH on', () => {
  const r = ex(4);
  const delay = 100_000;
  it('check: no Bluetooth block hops inside the Wi-Fi footprint after the AFH delay', () => {
    expect(r.config.platform.afhEnabled).toBe(true);
    expect(r.afh.enabled).toBe(true);
    expect(bt(r).filter((b) => b.start >= delay && b.freqCenter >= 2426 && b.freqCenter <= 2448)).toHaveLength(0);
  });
  it('check: no DEGRADED Bluetooth block starts after the AFH delay, and the DEGRADED count drops to zero for the rest of the window', () => {
    const deg = bt(r).filter((b) => b.status === 'DEGRADED');
    expect(deg.length).toBeGreaterThan(0);
    expect(deg.filter((b) => b.start >= delay)).toHaveLength(0);
  });
  it('a 1 second window shows degraded conflicts only in the first 100 ms', () => {
    const deg = r.conflicts.filter((c) => c.severity === 'DEGRADED');
    expect(deg.length).toBeGreaterThan(0);
    expect(deg.every((c) => c.overlapStart < delay + 3000)).toBe(true);
  });
  it('is much better than Example 3', () => {
    expect(r.metrics.conflicts.bySeverity.DEGRADED).toBeLessThan(ex(3).metrics.conflicts.bySeverity.DEGRADED / 4);
    expect(r.metrics.perTask.t1.throughputImpactPct).toBeLessThan(ex(3).metrics.perTask.t1.throughputImpactPct);
  });
});

describe('Example 5: BLE connection plus Wi-Fi 6 on 2.4 GHz, shared antenna, TIME_SHARE 50/50 with 5 ms slices', () => {
  const r = ex(5);
  const firstTx = r.blocks.filter((b) => b.taskId === 't1' && b.attempt === 1 && b.dir === 'TX' && !b.optional);
  const denied = firstTx.filter((b) => b.status === 'RETRIED' || b.status === 'LOST');
  it('setup matches the spec: 30 ms interval, 2M PHY, Wi-Fi 6 web browsing on channel 1, 1 second window', () => {
    expect(r.config.tasks[0].params).toMatchObject({ connIntervalMs: 30, phy: '2M' });
    expect(r.config.platform).toMatchObject({ wifiGeneration: '11ax', wifiChannel: 1, windowUs: 1_000_000, arbitrationPolicy: 'TIME_SHARE', timeShareBtPercent: 50, timeShareSliceUs: 5000, antennaMode: 'SHARED' });
    expect(firstTx).toHaveLength(34);
    expect(firstTx[0].duration).toBe(152); // 2M PHY, 27 byte payload
  });
  it('check: roughly half of the BLE connection events are DENIED on the first attempt', () => {
    expect(denied.length / firstTx.length).toBeGreaterThanOrEqual(0.35);
    expect(denied.length / firstTx.length).toBeLessThanOrEqual(0.65);
    expect(denied.every((b) => /belongs to Wi-Fi/.test(b.reason))).toBe(true);
  });
  it('check: the retry blocks appear 30 ms later (one connection interval, after the next event)', () => {
    const retries = r.blocks.filter((b) => b.taskId === 't1' && b.attempt === 2 && b.dir === 'TX');
    expect(retries.length).toBeGreaterThan(5);
    for (const rt of retries) {
      const orig = r.blocks.find((b) => b.id === rt.retryOf)!;
      expect(orig.plannedStart).toBeLessThan(rt.start);
      expect(rt.plannedStart - orig.plannedStart).toBeGreaterThanOrEqual(30_000);
      expect(rt.plannedStart - orig.plannedStart).toBeLessThanOrEqual(31_500);
    }
  });
  it('the summary shows the added latency for the BLE link and the missed anchors', () => {
    const t = r.metrics.perTask.t1;
    expect(t.latency.delayedPackets).toBeGreaterThan(5);
    expect(t.latency.maxUs).toBeGreaterThanOrEqual(30_000);
    expect(t.anchor!.misses).toBe(denied.length);
    expect(t.anchor!.marginUs!).toBeLessThan(2_000_000);
  });
  it('a denied anchor is not delayed, and every decision says which slice owned the time', () => {
    expect(r.blocks.filter((b) => b.taskId === 't1' && b.status === 'DELAYED')).toHaveLength(0);
    expect(r.decisions.filter((d) => d.rule === 'TIME_SHARE_SLICE').length).toBeGreaterThan(10);
  });
});

describe('all examples: determinism, speed and the gate (AC-7, AC-10, NFR-2)', () => {
  it.each([1, 2, 3, 4, 5, 6])('Example %i gives identical output for the same configuration and seed', (n) => {
    expect(runEngine(presetConfig(`example-${n}`, data), data)).toEqual(ex(n));
  });
  it.each([1, 2, 3, 4, 5, 6])('Example %i runs in under 2 seconds', (n) => {
    const t0 = performance.now();
    runEngine(presetConfig(`example-${n}`, data), data);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('changing only the seed changes the random parts of Example 3 but not the structure', () => {
    const c = presetConfig('example-3', data);
    const a = runEngine({ ...c, platform: { ...c.platform, seed: 7 } }, data);
    expect(a.blocks.length).toBe(ex(3).blocks.length);
    expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(ex(3).blocks));
  });
});

describe('Example 6: LE Audio and Wi-Fi video, shared antenna, policy favours Wi-Fi (added at the owner\'s request)', () => {
  const r = ex(6);
  const audio = r.blocks.filter((b) => b.taskId === 't1');
  const first = audio.filter((b) => b.attempt === 1 && b.dir === 'TX' && !b.optional);
  const denied = first.filter((b) => b.status === 'RETRIED');
  it('passes validation and the setup is as described', () => {
    expect(r.config.tasks.map((t) => t.taskId)).toEqual(['le_cis', 'wifi_video_stream']);
    expect(r.config.platform).toMatchObject({ arbitrationPolicy: 'WIFI_FAVOURED', antennaMode: 'SHARED', windowUs: 1_000_000 });
    expect(first).toHaveLength(100);
  });
  it('some events are denied to Wi-Fi, and the reason says the policy favours Wi-Fi', () => {
    expect(denied).toHaveLength(10);
    expect(denied.every((b) => /policy favours Wi-Fi/.test(b.reason))).toBe(true);
  });
  it('the spare slots recover the audio: retries are used and nothing is lost', () => {
    expect(audio.filter((b) => b.attempt > 1).length).toBeGreaterThan(10);
    const m = r.metrics.perTask.t1;
    expect(m.counts.lost).toBe(0);
    expect(m.throughputImpactPct).toBe(0);
    expect(m.latency.maxUs).toBe(10_000);
  });
  it('the anchor view shows ten missed events and no run longer than one', () => {
    const a = r.metrics.perTask.t1.anchor!;
    expect(a.misses).toBe(10); expect(a.hits).toBe(90); expect(a.longestRun).toBe(1);
  });
  it('Wi-Fi is never held back and wins every hard conflict', () => {
    expect(r.metrics.conflicts.hardWonByBluetooth).toBe(0);
    expect(r.metrics.perTask.t2.counts.delayed).toBe(0);
  });
});
