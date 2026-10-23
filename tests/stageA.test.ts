import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { defaultData as data } from '../src/engine/data';
import { estimateLoad } from '../src/engine/estimate';
import { expandAll, expandTask } from '../src/engine/stageA';
import { effectiveParams } from '../src/engine/params';
import { makeRng } from '../src/engine/util/rng';
import type { AirBlock, ScenarioConfig } from '../src/engine/types';
import { makeConfig, type TaskSpec } from './helpers';

const W1S = { windowUs: 1_000_000 };
const run = (spec: TaskSpec, platform = W1S, id = 't1'): AirBlock[] => expandTask(makeConfig([spec], platform), id, data);
const byDir = (b: AirBlock[]) => b.map((x) => x.dir).join(',');

describe('seeded random generator (SR-4, SR-25)', () => {
  it('gives the same stream for the same seed and label', () => {
    const a = makeRng(7, 'x'), b = makeRng(7, 'x');
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });
  it('gives different streams for different seeds or labels', () => {
    expect(makeRng(1, 'x').next()).not.toBe(makeRng(2, 'x').next());
    expect(makeRng(1, 'x').next()).not.toBe(makeRng(1, 'y').next());
  });
  it('int() stays inside its inclusive range and covers it; exp() has the right mean', () => {
    const r = makeRng(3, 'r');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { const v = r.int(0, 15); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(15); seen.add(v); }
    expect(seen.size).toBe(16);
    const e = makeRng(3, 'e');
    const mean = Array.from({ length: 20000 }, () => e.exp(100)).reduce((a, b) => a + b, 0) / 20000;
    expect(mean).toBeGreaterThan(95);
    expect(mean).toBeLessThan(105);
  });
});

describe('PERIODIC_EVENT', () => {
  it('BLE connection: one TX then RX pair per interval with 150 us spacing, PHY sets the duration', () => {
    const b = run(['le_conn_central', { connIntervalMs: 30, phy: '1M', payloadBytes: 27 }]);
    expect(b).toHaveLength(34 * 2);
    expect(byDir(b.slice(0, 4))).toBe('TX,RX,TX,RX');
    expect(b[0].duration).toBe(296); // 40 + (5 + 27) * 8
    expect(b[1].start - (b[0].start + b[0].duration)).toBe(150);
    expect(b[2].start - b[0].start).toBe(30000);
    const fast = run(['le_conn_central', { connIntervalMs: 30, phy: '2M', payloadBytes: 27 }]);
    expect(fast[0].duration).toBe(152); // 24 + 32 * 4
    expect(run(['le_conn_central', { phy: 'CODED_S8', payloadBytes: 27 }])[0].duration).toBe(400 + 32 * 64);
  });
  it('BLE connection: packets per event repeat the pair and subrating stretches the interval', () => {
    expect(run(['le_conn_central', { packetsPerEvent: 3 }]).filter((x) => x.start < 30000)).toHaveLength(6);
    const sub = run(['le_conn_central', { subrateFactor: 4 }]);
    expect(sub[2].start - sub[0].start).toBe(120000);
  });
  it('BLE connection: all blocks of one event share an event id, so they share one hop', () => {
    const b = run('le_conn_central');
    expect(b[0].eventId).toBe(b[1].eventId);
    expect(b[0].eventId).not.toBe(b[2].eventId);
    expect(b[0].chanMode).toBe('BLE_DATA');
  });
  it('legacy advertising: three blocks on channels 37, 38, 39 and a random delay of 0 to 10 ms per event', () => {
    const b = run(['le_adv_legacy', { advIntervalMs: 100 }]);
    expect(b.slice(0, 3).map((x) => x.fixedChannel)).toEqual([37, 38, 39]);
    expect(b.slice(0, 3).every((x) => x.chanMode === 'BLE_ADV' && x.dir === 'TX')).toBe(true);
    const starts = b.filter((x) => x.fixedChannel === 37).map((x) => x.start);
    for (let i = 1; i < starts.length; i++) {
      const d = starts[i] - starts[i - 1];
      expect(d).toBeGreaterThanOrEqual(100000);
      expect(d).toBeLessThanOrEqual(110000);
    }
    expect(new Set(starts.slice(1).map((s, i) => s - starts[i])).size).toBeGreaterThan(1);
    expect(b[1].start - (b[0].start + b[0].duration)).toBe(1000);
  });
  it('extended advertising: primary on advertising channels then a secondary on a data channel', () => {
    const b = run('le_adv_extended').slice(0, 4);
    expect(b.map((x) => x.chanMode)).toEqual(['BLE_ADV', 'BLE_ADV', 'BLE_ADV', 'BLE_DATA']);
  });
  it('LE Audio CIS: subevents beyond the burst number are optional retransmission opportunities', () => {
    const b = run(['le_cis', { nse: 3, bn: 1 }]).filter((x) => x.start < 10000);
    expect(b).toHaveLength(6);
    expect(b.filter((x) => x.optional)).toHaveLength(4);
    expect(b.filter((x) => !x.optional)).toHaveLength(2);
  });
  it('LE Audio BIS: repeats are not optional and the receiver listens', () => {
    const rx = run(['le_bis', { role: 'receiver', irc: 2 }]);
    expect(rx.every((x) => x.dir === 'RX' && !x.optional)).toBe(true);
    expect(rx.filter((x) => x.start < 10000)).toHaveLength(2);
  });
  it('Channel Sounding: every tone step is on its own channel hop', () => {
    const b = run(['le_channel_sounding', { steps: 5 }]).filter((x) => x.start < 100000);
    expect(b).toHaveLength(10);
    expect(new Set(b.map((x) => x.eventId)).size).toBe(10);
  });
  it('Wi-Fi: beacons repeat every 102.4 ms, station receives and access point transmits', () => {
    const sta = run('wifi_beacon');
    expect(sta[1].start - sta[0].start).toBe(102400);
    expect(sta.every((x) => x.dir === 'RX')).toBe(true);
    expect(run(['wifi_beacon', { role: 'AP' }]).every((x) => x.dir === 'TX')).toBe(true);
  });
  it('Wi-Fi voice: 20 ms cadence with a seeded backoff before each transmit event', () => {
    const b = run('wifi_vowifi').filter((x) => x.dir === 'TX' && x.kind === 'VOICE');
    expect(b.length).toBe(50);
    const offsets = b.map((x, i) => x.start - i * 20000);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(34); // DIFS = SIFS + 2 slots
    expect(Math.max(...offsets)).toBeLessThanOrEqual(34 + 15 * 9);
  });
  it('Wi-Fi protection: the packets shown depend on the selected mode', () => {
    expect(run(['wifi_protection', { mode: 'CTS_TO_SELF' }]).filter((x) => x.start < 10000)).toHaveLength(1);
    expect(run(['wifi_protection', { mode: 'RTS_CTS' }]).filter((x) => x.start < 10000)).toHaveLength(2);
  });
});

describe('SLOT_SCHEDULE', () => {
  it('SCO HV3: reserved pairs every 6 slots, master in even slots, slave reply in the next odd slot', () => {
    const b = run(['bt_sco', {}], { windowUs: 100_000 });
    expect(b).toHaveLength(27 * 2);
    for (let k = 0; k < 27; k++) {
      expect(b[2 * k].start).toBe(k * 6 * 625);
      expect(Math.round(b[2 * k].start / 625) % 2).toBe(0);
      expect(b[2 * k + 1].start).toBe((k * 6 + 1) * 625);
    }
    expect(b[0].duration).toBe(366);
    expect(b.every((x) => x.chanMode === 'CLASSIC_HOP' && !x.optional)).toBe(true);
  });
  it('eSCO: the retransmission window holds optional blocks that exist only if a retry happens (SR-6)', () => {
    const b = run(['bt_esco', {}], { windowUs: 100_000 });
    // 14 events fit in 100 ms; blocks that would start after the window ends are not created.
    expect(b.filter((x) => !x.optional)).toHaveLength(28);
    expect(b.filter((x) => x.optional)).toHaveLength(54); // 14 x 4, minus the two cut off by the window
    const first = b.filter((x) => x.start < 12 * 625);
    expect(first.filter((x) => x.optional).every((x) => x.start >= 2 * 625)).toBe(true);
  });
  it('A2DP 328 kbps with 2-DH5: 5-slot master packets with 5-slot replies in slot pairs every 26 slots', () => {
    const b = run(['bt_a2dp', {}], { windowUs: 100_000 });
    // 7 events start inside 100 ms; the reply of the last one would start at 100.6 ms, after the window.
    expect(b).toHaveLength(13);
    expect(b[0].duration).toBe(2870);
    expect(b[1].start).toBe(5 * 625);
    expect(b[1].duration).toBe(2870);
    expect(b[2].start).toBe(26 * 625);
    expect(b[0].arrivalUs).toBe(0);
    expect(b[2].arrivalUs).toBe(16561);
  });
  it('sniff: the attempt window sends several slot pairs per anchor', () => {
    const b = run(['bt_acl_sniff', { intervalSlots: 100, attemptSlots: 3 }], { windowUs: 100_000 });
    expect(b.filter((x) => x.start < 100 * 625)).toHaveLength(6);
  });
  it('inquiry sends two ID packets in a transmit slot and listens in the next slot', () => {
    const b = run('bt_inquiry', { windowUs: 10_000 });
    expect(b.slice(0, 3).map((x) => x.kind)).toEqual(['ID', 'ID', 'SCAN']);
    expect(b[1].start - b[0].start).toBe(68 + 244);
    expect(b[2].start).toBe(625);
  });
});

describe('BURST_TRAIN', () => {
  it('video streaming: aggregated downlink bursts followed by a block acknowledgement after SIFS', () => {
    const b = run(['wifi_video_stream', { bitrateMbps: 100 }]);
    const data = b.filter((x) => x.kind === 'DATA');
    const acks = b.filter((x) => x.kind === 'ACK');
    expect(data.every((x) => x.dir === 'RX') && acks.every((x) => x.dir === 'TX')).toBe(true);
    expect(data.length).toBe(acks.length);
    expect(acks[0].start - (data[0].start + data[0].duration)).toBe(16);
    expect(data[0].duration).toBeLessThanOrEqual(5484);
    expect(acks[0].duration).toBe(32);
    const spacing = (data[data.length - 1].start - data[0].start) / (data.length - 1);
    expect(spacing).toBeGreaterThan(5000);
    expect(spacing).toBeLessThan(5500);
  });
  it('a slower generation gives a longer frame for the same bytes (SR-17)', () => {
    const fast = run(['wifi_ul_burst', {}], { windowUs: 100_000 });
    const slow = expandTask(makeConfig([['wifi_ul_burst', { aggregationBytes: 1500, bitrateMbps: 1 }]], { windowUs: 100_000, wifiGeneration: '11b', txRxStreams: '1x1' }), 't1', data);
    expect(slow[0].duration).toBeGreaterThan(1000); // 192 us preamble + 1500 B at 11 Mbps
    expect(fast[0].duration).toBeLessThan(slow[0].duration * 5);
  });
  it('aggregation is capped at the maximum aggregation time', () => {
    const b = expandTask(makeConfig([['wifi_ul_burst', { aggregationBytes: 262143 }]], { windowUs: 100_000, wifiGeneration: '11n', wifiBandwidth: 20, txRxStreams: '1x1' }), 't1', data);
    expect(b[0].duration).toBeLessThanOrEqual(5484);
    expect(b[0].duration).toBeGreaterThan(5400);
  });
  it('bulk transfer takes about its requested share of airtime', () => {
    const b = run(['wifi_bulk', { dutyCyclePct: 90 }]);
    const air = b.reduce((a, x) => a + x.duration, 0) / 1_000_000;
    expect(air).toBeGreaterThan(0.8);
    expect(air).toBeLessThan(0.95);
  });
  it('bulk direction decides which side transmits', () => {
    expect(run(['wifi_bulk', { direction: 'UL' }])[0].dir).toBe('TX');
    expect(run(['wifi_bulk', { direction: 'DL' }])[0].dir).toBe('RX');
  });
  it('video conferencing runs bursts at the frame cadence in both directions', () => {
    const b = run(['wifi_video_conf', { fps: 30 }]);
    expect(new Set(b.map((x) => x.dir))).toEqual(new Set(['TX', 'RX']));
    const first = b.filter((x) => x.start < 33333);
    expect(first.length).toBeGreaterThanOrEqual(4);
  });
  it('multi-link operation splits bursts across bands; only the 2.4 GHz link can meet Bluetooth', () => {
    const b = run(['wifi_mlo', { linkBands: '2.4+5' }]);
    expect(new Set(b.map((x) => x.wifiBand))).toEqual(new Set(['2.4', '5']));
    expect(b[0].wifiBand).toBe('2.4');
    expect(b.find((x) => x.wifiBand === '5')!.wifiChannel).toBe(36);
  });
  it('a Wi-Fi block carries the channel and width of its task', () => {
    const b = run(['wifi_web', { channel: 11, bandwidthMHz: 40 }]);
    expect(b[0].wifiChannel).toBe(11);
    expect(b[0].wifiWidth).toBe(40);
    expect(b[0].freqWidth).toBe(40);
  });
});

describe('WINDOWED_LISTEN', () => {
  it('inquiry scan: an 11.25 ms window at each 1.28 s interval', () => {
    const b = run('bt_inquiry_scan', { windowUs: 2_000_000 });
    expect(b.map((x) => x.start)).toEqual([0, 1_280_000]);
    expect(b[0].duration).toBe(11250);
    expect(b[0].dir).toBe('RX');
  });
  it('passive scanning cycles through advertising channels 37, 38, 39', () => {
    const b = run('le_scan_passive');
    expect(b).toHaveLength(10);
    expect(b.slice(0, 4).map((x) => x.fixedChannel)).toEqual([37, 38, 39, 37]);
  });
  it('active scanning adds SCAN_REQ and SCAN_RSP after each window', () => {
    const b = run('le_scan_active');
    expect(b).toHaveLength(30);
    expect(b.slice(0, 3).map((x) => x.dir)).toEqual(['RX', 'TX', 'RX']);
    expect(b[1].start).toBe(b[0].start + b[0].duration + 150);
  });
  it('initiating sends CONNECT_IND once', () => {
    const b = run('le_initiating');
    expect(b.filter((x) => x.dir === 'TX')).toHaveLength(1);
  });
  it('periodic sync widens its window on both sides', () => {
    const narrow = run(['le_sync_periodic', { windowWideningUs: 0 }])[0].duration;
    const wide = run(['le_sync_periodic', { windowWideningUs: 100 }])[0].duration;
    expect(wide - narrow).toBe(200);
  });
});

describe('SCAN_SWEEP', () => {
  it('active scan: probe then dwell on each channel in turn', () => {
    const b = run('wifi_scan_active');
    expect(b).toHaveLength(6);
    expect(b.map((x) => x.wifiChannel)).toEqual([1, 1, 6, 6, 11, 11]);
    expect(b.map((x) => x.dir)).toEqual(['TX', 'RX', 'TX', 'RX', 'TX', 'RX']);
    expect(b[1].duration).toBe(30000);
    expect(b[2].start).toBeGreaterThan(b[1].start + b[1].duration);
  });
  it('passive scan only listens, and a 1-13 sweep covers all 13 channels', () => {
    const b = run(['wifi_scan_passive', { scanChannels: '1-13', dwellMs: 20 }]);
    expect(b.map((x) => x.wifiChannel)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(b.every((x) => x.dir === 'RX')).toBe(true);
  });
  it('roaming ends with reassociation frames', () => {
    const b = run('wifi_roaming');
    expect(b.slice(-2).map((x) => x.dir)).toEqual(['TX', 'RX']);
  });
});

describe('IRREGULAR_BURSTS and ONE_SHOT_EXCHANGE', () => {
  it('web browsing: random bursts at roughly the requested rate, repeatable for one seed', () => {
    const cfg = (seed: number) => makeConfig([['wifi_web', { burstsPerSec: 3 }]], { windowUs: 10_000_000, seed });
    const a = expandTask(cfg(1), 't1', data);
    const bursts = a.filter((x) => x.dir === 'TX' && x.kind === 'DATA').length;
    expect(bursts).toBeGreaterThan(15);
    expect(bursts).toBeLessThan(50);
    expect(expandTask(cfg(1), 't1', data)).toEqual(a);
    expect(expandTask(cfg(2), 't1', data).map((x) => x.start)).not.toEqual(a.map((x) => x.start));
  });
  it('a task\'s random numbers do not depend on which other tasks are selected', () => {
    const alone = makeConfig([['wifi_web', {}]], { windowUs: 5_000_000 });
    const withOther = makeConfig([['wifi_web', {}], 'le_adv_legacy', 'wifi_video_stream'], { windowUs: 5_000_000 });
    expect(expandTask(withOther, 't1', data).map((x) => x.start)).toEqual(expandTask(alone, 't1', data).map((x) => x.start));
  });
  it('association: management frames then the four key handshake frames', () => {
    const sta = run('wifi_assoc');
    expect(sta).toHaveLength(8);
    expect(byDir(sta)).toBe('TX,RX,TX,RX,RX,TX,RX,TX');
    expect(byDir(run(['wifi_assoc', { role: 'AP' }]))).toBe('RX,TX,RX,TX,TX,RX,TX,RX');
    expect(run(['wifi_assoc', { startMs: 500 }])[0].start).toBeGreaterThanOrEqual(500000);
  });
});

describe('AC-2: every catalogue task expands through the generators only', () => {
  const all = data.tasks.map((t) => t.id);

  it.each(all)('%s expands to valid, deterministic blocks', (id) => {
    const cfg = makeConfig([id], W1S);
    const a = expandTask(cfg, 't1', data);
    expect(a.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const b of a) {
      expect(Number.isInteger(b.start) && b.start >= 0 && b.start < 1_000_000).toBe(true);
      expect(Number.isInteger(b.duration) && b.duration > 0).toBe(true);
      expect(['TX', 'RX']).toContain(b.dir);
      expect(b.tech).toBe(data.taskIndex.get(id)!.tech);
      expect(b.priority).toBeGreaterThan(0);
      expect(b.status).toBe('PLANNED');
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
    }
    expect(expandTask(cfg, 't1', data)).toEqual(a);
  });

  it.each(all.filter((id) => !['IRREGULAR_BURSTS'].includes(data.taskIndex.get(id)!.generator) && !data.taskIndex.get(id)!.pattern.jitterUs))(
    '%s agrees with the validator\'s block estimate', (id) => {
      const cfg = makeConfig([id], W1S);
      const def = data.taskIndex.get(id)!;
      const est = estimateLoad(def, effectiveParams(def, cfg.tasks[0]), data, cfg.platform, 1_000_000);
      const actual = expandTask(cfg, 't1', data).filter((b) => !b.optional).length;
      expect(Math.abs(actual - est.blocks) / est.blocks, `actual ${actual} vs estimate ${est.blocks}`).toBeLessThanOrEqual(0.2);
    });

  it('engine source never mentions a task id: there is no task-specific code (SR-2)', () => {
    const files: string[] = [];
    const scan = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) scan(p); else if (p.endsWith('.ts')) files.push(p); } };
    scan('src/engine');
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const id of all) expect(src.includes(`'${id}'`) || src.includes(`"${id}"`), id).toBe(false);
  });

  it('expandAll merges every task in time order', () => {
    const cfg = makeConfig(['bt_a2dp', 'wifi_video_stream', 'le_conn_central'], { windowUs: 100_000 });
    const b = expandAll(cfg, data);
    for (let i = 1; i < b.length; i++) expect(b[i].start).toBeGreaterThanOrEqual(b[i - 1].start);
    expect(new Set(b.map((x) => x.taskId))).toEqual(new Set(['t1', 't2', 't3']));
  });
});

// Keep a reference so unused-import checks stay quiet when tests are trimmed.
export type _Cfg = ScenarioConfig;
