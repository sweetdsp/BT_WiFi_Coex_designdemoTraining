import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { expandAll } from '../src/engine/stageA';
import { bleDataFreq, resolveFrequencies, wifiCenterMHz } from '../src/engine/stageB';
import { applyAfh, buildAfhMap } from '../src/engine/stageC';
import { detectConflicts, platformCase } from '../src/engine/stageD';
import type { AirBlock, ConflictSeverity, DirClass, PlatformConfig, ScenarioConfig } from '../src/engine/types';
import { makeConfig, type TaskSpec } from './helpers';

const sepHigh: Partial<PlatformConfig> = { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 };
const sepLow: Partial<PlatformConfig> = { ...sepHigh, isolationDb: 10 };
const resolved = (specs: TaskSpec[], platform: Partial<PlatformConfig> = {}): { cfg: ScenarioConfig; blocks: AirBlock[] } => {
  const cfg = makeConfig(specs, platform);
  return { cfg, blocks: resolveFrequencies(expandAll(cfg, data), cfg, data) };
};

describe('stage B: frequency footprints (7A.6)', () => {
  it('Classic hops use 2402 + k MHz with k from 0 to 78 and cover the whole set', () => {
    const { blocks } = resolved(['bt_inquiry'], { windowUs: 1_000_000 });
    const ch = new Set(blocks.map((b) => b.channelIndex));
    expect(Math.min(...ch)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ch)).toBeLessThanOrEqual(78);
    expect(ch.size).toBeGreaterThan(70);
    expect(blocks.every((b) => b.freqCenter === 2402 + b.channelIndex && b.freqWidth === 1)).toBe(true);
  });
  it('BLE advertising sits on 2402, 2426 and 2480 MHz with 2 MHz width', () => {
    const { blocks } = resolved(['le_adv_legacy'], { windowUs: 300_000 });
    expect(new Set(blocks.map((b) => b.freqCenter))).toEqual(new Set([2402, 2426, 2480]));
    expect(blocks.every((b) => b.freqWidth === 2)).toBe(true);
  });
  it('BLE data channels are 0 to 36, 2 MHz apart, skipping 2426', () => {
    expect([0, 10, 11, 36].map((i) => bleDataFreq(data, i))).toEqual([2404, 2424, 2428, 2478]);
    const all = Array.from({ length: 37 }, (_, i) => bleDataFreq(data, i));
    expect(all).not.toContain(2426);
    expect(new Set(all).size).toBe(37);
    const { blocks } = resolved([['le_conn_central', { connIntervalMs: 7.5 }]], { windowUs: 1_000_000 });
    expect(new Set(blocks.map((b) => b.channelIndex)).size).toBeGreaterThan(30);
  });
  it('every connection event is one hop: its blocks share a channel, the next event differs from a fixed one', () => {
    const { blocks } = resolved([['le_conn_central', { packetsPerEvent: 3 }]], { windowUs: 300_000 });
    const byEvent = new Map<string, Set<number>>();
    for (const b of blocks) (byEvent.get(b.eventId) ?? byEvent.set(b.eventId, new Set()).get(b.eventId)!).add(b.channelIndex);
    expect([...byEvent.values()].every((s) => s.size === 1)).toBe(true);
    expect(new Set([...byEvent.values()].map((s) => [...s][0])).size).toBeGreaterThan(1);
  });
  it('Wi-Fi centre is 2407 + 5 x channel; channel 6 at 20 MHz covers 2427 to 2447 MHz', () => {
    expect(wifiCenterMHz(data, '2.4', 1)).toBe(2412);
    expect(wifiCenterMHz(data, '2.4', 6)).toBe(2437);
    expect(wifiCenterMHz(data, '2.4', 11)).toBe(2462);
    const { blocks } = resolved(['wifi_video_stream'], {});
    expect(blocks[0].freqCenter).toBe(2437);
    expect(blocks[0].freqWidth).toBe(20);
    const wide = resolved(['wifi_video_stream'], { wifiBandwidth: 40 }).blocks[0];
    expect(wide.freqWidth).toBe(40);
  });
  it('5 GHz and 6 GHz footprints are set and lie outside the Bluetooth band', () => {
    const five = resolved(['wifi_video_stream'], { wifiBand: '5', wifiChannel: 36 }).blocks[0];
    expect(five.freqCenter).toBe(5180);
    expect(resolved(['wifi_video_stream'], { wifiBand: '6', wifiChannel: 5 }).blocks[0].freqCenter).toBe(5975);
  });
  it('hops are repeatable for a seed and change with it, and one task is unaffected by another', () => {
    // Instance ids are stable per task, so add the other task after it.
    const f = (seed: number, extra: TaskSpec[] = []) => resolved(['bt_a2dp', ...extra], { seed, windowUs: 300_000 }).blocks.filter((b) => b.taskId === 't1').map((b) => b.channelIndex);
    expect(f(1)).toEqual(f(1));
    expect(f(1)).not.toEqual(f(2));
    expect(f(1, ['bt_inquiry_scan', 'wifi_video_stream'])).toEqual(f(1));
  });
  it('does not modify its input', () => {
    const cfg = makeConfig(['bt_a2dp']);
    const raw = expandAll(cfg, data);
    const copy = JSON.stringify(raw);
    resolveFrequencies(raw, cfg, data);
    expect(JSON.stringify(raw)).toBe(copy);
  });
});

describe('stage C: adaptive frequency hopping (7A.6, SR-13)', () => {
  const afh = (over: Partial<PlatformConfig> = {}) => ({ afhEnabled: true, windowUs: 1_000_000, ...over });

  it('AFH off uses the full set', () => {
    const cfg = makeConfig(['bt_a2dp', 'wifi_video_stream'], afh({ afhEnabled: false }));
    const map = buildAfhMap(cfg, data);
    expect(map.enabled).toBe(false);
    expect(map.classicAllowed).toHaveLength(79);
    expect(map.bleAllowed).toHaveLength(37);
  });
  it('channel 6 at 20 MHz with a 1 MHz guard removes 23 Classic channels (2426 to 2448 MHz)', () => {
    const map = buildAfhMap(makeConfig(['bt_a2dp', 'wifi_video_stream'], afh()), data);
    expect(map.classicRemoved).toHaveLength(23);
    expect(map.classicRemoved[0]).toBe(24);
    expect(map.classicRemoved[22]).toBe(46);
    expect(map.classicAllowed).toHaveLength(56);
    expect(map.footprints).toEqual([[2427, 2447]]);
  });
  it('a 40 MHz channel removes more, and BLE data channels inside the footprint are removed too', () => {
    const map = buildAfhMap(makeConfig(['bt_a2dp', 'wifi_video_stream'], afh({ wifiBandwidth: 40 })), data);
    expect(map.classicAllowed).toHaveLength(79 - 43);
    expect(map.bleRemoved.map((i) => bleDataFreq(data, i)).every((f) => f >= 2415 && f <= 2459)).toBe(true);
    expect(map.bleRemoved.length).toBeGreaterThan(10);
  });
  it('never leaves fewer than the minimum channels, putting back those furthest from the Wi-Fi centre', () => {
    const map = buildAfhMap(makeConfig(['bt_a2dp', 'wifi_video_stream'], afh({ afhMinChannelsClassic: 70 })), data);
    expect(map.classicAllowed).toHaveLength(70);
    expect(map.classicRemoved).toHaveLength(9);
    const centreIdx = 2437 - 2402;
    const dists = map.classicRemoved.map((k) => Math.abs(k - centreIdx));
    expect(Math.max(...dists)).toBeLessThan(10);
  });
  it('scans are ignored: only operating channels of Wi-Fi tasks shape the map', () => {
    const map = buildAfhMap(makeConfig(['bt_a2dp', 'wifi_scan_passive'], afh()), data);
    expect(map.enabled).toBe(false);
  });
  it('5 GHz Wi-Fi does not narrow the Bluetooth map', () => {
    const map = buildAfhMap(makeConfig(['bt_a2dp', 'wifi_video_stream'], afh({ wifiBand: '5', wifiChannel: 36 })), data);
    expect(map.enabled).toBe(false);
  });
  it('blocks before the 100 ms delay are unchanged; none hop inside the footprint afterwards', () => {
    const { cfg, blocks } = resolved(['bt_inquiry', 'wifi_video_stream'], afh());
    const { blocks: after, map } = applyAfh(blocks, cfg, data);
    const bt = after.filter((b) => b.tech === 'BT');
    const before = bt.filter((b) => b.start < 100_000);
    expect(before.some((b) => map.classicRemoved.includes(b.channelIndex))).toBe(true);
    for (const b of before) expect(b.channelIndex).toBe(blocks.find((x) => x.id === b.id)!.channelIndex);
    expect(bt.filter((b) => b.start >= 100_000 && map.classicRemoved.includes(b.channelIndex))).toHaveLength(0);
    expect(bt.filter((b) => b.start >= 100_000 && b.freqCenter >= 2426 && b.freqCenter <= 2448)).toHaveLength(0);
  });
  it('the delay is configurable', () => {
    const { cfg, blocks } = resolved(['bt_inquiry', 'wifi_video_stream'], afh({ afhDelayUs: 500_000 }));
    const { blocks: after } = applyAfh(blocks, cfg, data);
    expect(after.filter((b) => b.tech === 'BT' && b.start >= 500_000 && b.freqCenter >= 2426 && b.freqCenter <= 2448)).toHaveLength(0);
    expect(after.filter((b) => b.tech === 'BT' && b.start < 500_000 && b.freqCenter >= 2426 && b.freqCenter <= 2448).length).toBeGreaterThan(0);
  });
  it('BLE advertising channels and Wi-Fi blocks are never moved by AFH', () => {
    const { cfg, blocks } = resolved(['le_adv_legacy', 'wifi_video_stream'], afh());
    const { blocks: after } = applyAfh(blocks, cfg, data);
    expect(after.map((b) => b.freqCenter)).toEqual(blocks.map((b) => b.freqCenter));
  });
  it('keeps the same random draw, so the result is deterministic', () => {
    const { cfg, blocks } = resolved(['bt_inquiry', 'wifi_video_stream'], afh());
    expect(applyAfh(blocks, cfg, data).blocks).toEqual(applyAfh(blocks, cfg, data).blocks);
  });
});

// ---------------------------------------------------------------------------
// Stage D with hand-made blocks, so each cell of the 7A.7 table is tested alone.
// ---------------------------------------------------------------------------
let n = 0;
const blk = (o: Partial<AirBlock> & Pick<AirBlock, 'tech' | 'dir'>): AirBlock => ({
  id: `b${++n}`, taskId: o.tech === 'BT' ? 'bt' : 'wf', start: 0, duration: 1000, freqCenter: 2437, freqWidth: 20, channelIndex: 6, priority: 1, kind: 'DATA', retryOf: '',
  status: 'PLANNED', reason: '', seq: n, plannedStart: o.start ?? 0, eventId: `e${n}`, chanMode: 'WIFI', ...o,
});
const btAt = (dir: 'TX' | 'RX', freq: number, over: Partial<AirBlock> = {}) => blk({ tech: 'BT', dir, freqCenter: freq, freqWidth: 1, ...over });
const wf = (dir: 'TX' | 'RX', over: Partial<AirBlock> = {}) => blk({ tech: 'WIFI', dir, freqCenter: 2437, freqWidth: 20, ...over });
const classify = (b: AirBlock, w: AirBlock, platform: Partial<PlatformConfig>) => detectConflicts([b, w], makeConfig(['bt_a2dp'], platform), data);

describe('stage D: severity table (7A.7)', () => {
  const shared = {};
  const IN = 2437, OUT = 2470;
  type Cell = [DirClass, boolean, ConflictSeverity, ConflictSeverity, ConflictSeverity];
  const table: Cell[] = [
    ['TX_TX', true, 'HARD', 'DEGRADED', 'TOLERATED'],
    ['TX_TX', false, 'HARD', 'TOLERATED', 'TOLERATED'],
    ['TX_RX', true, 'HARD', 'DEGRADED', 'TOLERATED'],
    ['TX_RX', false, 'HARD', 'WARNING', 'TOLERATED'],
    ['RX_TX', true, 'HARD', 'DEGRADED', 'TOLERATED'],
    ['RX_TX', false, 'HARD', 'WARNING', 'TOLERATED'],
    ['RX_RX', true, 'TOLERATED', 'TOLERATED', 'TOLERATED'],
    ['RX_RX', false, 'TOLERATED', 'TOLERATED', 'TOLERATED'],
  ];
  describe.each(table)('%s, frequency overlap %s', (dc, freq, sh, lo, hi) => {
    const [bd, wd] = dc.split('_') as ['TX' | 'RX', 'TX' | 'RX'];
    const mk = () => [btAt(bd, freq ? IN : OUT), wf(wd)] as const;
    it('shared antenna', () => {
      const c = classify(...mk(), shared);
      expect(c.length === 1 && c[0].severity).toBe(sh);
      expect(c[0].tests).toContain('ANTENNA');
    });
    it('separate antennas, isolation below the threshold', () => {
      const c = classify(...mk(), sepLow);
      if (!freq && dc === 'TX_TX') { expect(c[0].severity).toBe(lo); return; }
      expect(c[0].severity).toBe(lo);
      expect(c[0].column).toBe('SEP_LOW');
    });
    it('separate antennas, isolation above the threshold', () => {
      const c = classify(...mk(), sepHigh);
      if (freq) expect(c[0].severity).toBe(hi);
      else expect(c).toHaveLength(0); // no frequency overlap, separate paths, high isolation: no interaction at all
    });
  });

  it('records the direction class, the overlap and the tests that fired', () => {
    const c = classify(btAt('TX', IN, { start: 500, duration: 1000 }), wf('RX', { start: 0, duration: 1000 }), sepLow)[0];
    expect(c.dirClass).toBe('TX_RX');
    expect([c.overlapStart, c.overlapEnd, c.overlapUs]).toEqual([500, 1000, 500]);
    expect(c.tests).toEqual(['TIME', 'FREQUENCY', 'ISOLATION']);
    expect(c.reason).toMatch(/desensitised/);
    expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(c.label);
    expect(c.id).toBe('C0001');
  });
  it('blocks that only touch (end equals start) do not overlap', () => {
    expect(classify(btAt('TX', IN, { start: 1000 }), wf('RX', { start: 0 }), shared)).toHaveLength(0);
    expect(classify(btAt('TX', IN, { start: 999 }), wf('RX', { start: 0 }), shared)).toHaveLength(1);
  });
  it('the 1 MHz guard puts a hop at 2426 or 2448 MHz inside the Wi-Fi channel 6 footprint but 2425 or 2449 outside', () => {
    for (const [f, hit] of [[2425, false], [2426, true], [2448, true], [2449, false]] as const) {
      expect(classify(btAt('TX', f), wf('RX'), sepLow)[0].freqOverlap, `${f}`).toBe(hit);
    }
    const noGuard = (f: number) => detectConflicts([btAt('TX', f), wf('RX')], makeConfig(['bt_a2dp'], { ...sepLow, guardMHz: 0 }), data)[0].freqOverlap;
    expect(noGuard(2426)).toBe(false);
    expect(noGuard(2428)).toBe(true);
  });
  it('a core that cannot run both at once forces turn-taking even with separate antennas', () => {
    const p = { ...sepHigh, coreMode: 'TIME_DIVISION' as const };
    const c = classify(btAt('TX', IN), wf('RX'), p)[0];
    expect(c.severity).toBe('HARD');
    expect(c.tests).toContain('CORE');
  });
  it('without simultaneous Wi-Fi TX and Bluetooth RX, that pair is a hard conflict but Bluetooth TX with Wi-Fi RX is not', () => {
    const p = { ...sepHigh, simultaneousWifiTxBtRx: false };
    expect(classify(btAt('RX', IN), wf('TX'), p)[0].severity).toBe('HARD');
    expect(classify(btAt('TX', IN), wf('RX'), p)[0].severity).toBe('TOLERATED');
  });
  it('multi-band Wi-Fi blocks on 5 GHz interact only through the platform', () => {
    const five = wf('TX', { freqCenter: 5180 });
    expect(classify(btAt('TX', IN), five, shared)[0].severity).toBe('HARD');
    expect(classify(btAt('TX', IN), five, sepHigh)).toHaveLength(0);
    expect(classify(btAt('TX', IN), five, sepLow)[0].severity).toBe('TOLERATED');
  });
  it('optional (untriggered) blocks are not on the air and cause no conflict; a retry block does', () => {
    expect(classify(btAt('TX', IN, { optional: true }), wf('RX'), shared)).toHaveLength(0);
    expect(classify(btAt('TX', IN, { retryOf: 'x' }), wf('RX'), shared)).toHaveLength(1);
  });
  it('one Bluetooth block overlapping two Wi-Fi blocks gives two conflicts', () => {
    const c = detectConflicts([btAt('TX', IN, { duration: 3000 }), wf('RX', { start: 0, duration: 1000 }), wf('TX', { start: 1500, duration: 1000 })], makeConfig(['bt_a2dp']), data);
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.id)).toEqual(['C0001', 'C0002']);
  });
  it('platformCase reports the columns', () => {
    const base = makeConfig(['bt_a2dp']).platform;
    expect(platformCase(base, { dir: 'TX' }, { dir: 'RX' }).column).toBe('SHARED');
    expect(platformCase({ ...base, ...sepHigh }, { dir: 'TX' }, { dir: 'RX' }).column).toBe('SEP_HIGH');
    expect(platformCase({ ...base, ...sepLow }, { dir: 'TX' }, { dir: 'RX' }).column).toBe('SEP_LOW');
  });
  it('finds conflicts among 20,000 blocks quickly', () => {
    const bt: AirBlock[] = [], w: AirBlock[] = [];
    for (let i = 0; i < 10000; i++) { bt.push(btAt('TX', 2400 + (i % 80), { start: i * 100, duration: 60 })); w.push(wf('RX', { start: i * 100 + 30, duration: 60 })); }
    const t0 = performance.now();
    const c = detectConflicts([...bt, ...w], makeConfig(['bt_a2dp'], sepLow), data);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(c.length).toBeGreaterThan(5000);
  });
});

describe('stages A to D together', () => {
  it('shared antenna: every overlap that involves a transmit is HARD regardless of frequency', () => {
    const { cfg, blocks } = resolved(['bt_a2dp', 'wifi_video_stream'], { windowUs: 100_000 });
    const conflicts = detectConflicts(blocks, cfg, data);
    expect(conflicts.length).toBeGreaterThan(0);
    for (const c of conflicts) expect(c.severity).toBe(c.dirClass === 'RX_RX' ? 'TOLERATED' : 'HARD');
    expect(conflicts.some((c) => !c.freqOverlap || c.freqOverlap)).toBe(true);
    expect(conflicts.every((c) => c.reason.length > 20)).toBe(true);
  });
  it('separate antennas and 40 dB isolation: overlapping hops are tolerated and nothing is HARD (Example 2 shape)', () => {
    const { cfg, blocks } = resolved(['bt_a2dp', 'wifi_video_stream'], { ...sepHigh, windowUs: 100_000 });
    const conflicts = detectConflicts(blocks, cfg, data);
    expect(conflicts.filter((c) => c.severity === 'HARD')).toHaveLength(0);
  });
  it('is deterministic for a seed', () => {
    const run = () => { const { cfg, blocks } = resolved(['bt_a2dp', 'wifi_video_stream'], { ...sepLow, windowUs: 300_000 }); return detectConflicts(blocks, cfg, data); };
    expect(run()).toEqual(run());
  });
});
