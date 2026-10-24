import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runEngine } from '../src/engine';
import { unionLength } from '../src/engine/stageG';
import type { PlatformConfig } from '../src/engine/types';
import { freshData, makeConfig, type TaskSpec } from './helpers';

const sepHigh: Partial<PlatformConfig> = { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 };
const sepLow: Partial<PlatformConfig> = { ...sepHigh, isolationDb: 10 };
const run = (specs: TaskSpec[], platform: Partial<PlatformConfig> = {}, data = freshData()) => runEngine(makeConfig(specs, { windowUs: 100_000, ...platform }, data), data);
const video = (mbps: number): TaskSpec => ['wifi_video_stream', { bitrateMbps: mbps }];

describe('union of intervals', () => {
  it('merges overlaps and ignores empty intervals', () => {
    expect(unionLength([[0, 10], [5, 20], [30, 40], [40, 45], [50, 50]])).toBe(35);
    expect(unionLength([])).toBe(0);
  });
});

describe('airtime and overlap (7A.10)', () => {
  it('airtime per technology and direction is the sum of the blocks that went out over the window', () => {
    const x = run(['bt_sco'], { windowUs: 100_000 });
    // 27 events, 2 blocks of 366 us each, one TX and one RX
    expect(x.metrics.airtime.BT.txUs).toBe(27 * 366);
    expect(x.metrics.airtime.BT.rxUs).toBe(27 * 366);
    expect(x.metrics.airtime.BT.totalPct).toBeCloseTo((54 * 366) / 1000, 5);
    expect(x.metrics.airtime.WIFI.totalUs).toBe(0);
  });
  it('blocks that were denied or lost add no airtime; the requested airtime still counts them', () => {
    const x = run(['bt_sco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    const lost = x.blocks.filter((b) => b.tech === 'BT' && b.status === 'LOST').length;
    expect(lost).toBeGreaterThan(0);
    expect(x.metrics.airtime.BT.totalUs).toBe((54 - lost) * 366);
    expect(x.metrics.requestedAirtimePct.BT).toBeCloseTo((54 * 366) / 1000, 5);
  });
  it('overlap airtime splits into time overlap and the part that also overlaps in frequency', () => {
    const x = run(['bt_a2dp', video(100)], sepHigh);
    expect(x.metrics.overlap.timeUs).toBeGreaterThan(0);
    expect(x.metrics.overlap.freqUs).toBeGreaterThan(0);
    expect(x.metrics.overlap.freqUs).toBeLessThanOrEqual(x.metrics.overlap.timeUs);
    expect(x.metrics.overlap.freqPct).toBeCloseTo((x.metrics.overlap.freqUs / 100_000) * 100, 5);
  });
  it('no overlap with only one technology', () => {
    const x = run(['bt_a2dp']);
    expect(x.metrics.overlap).toEqual({ timeUs: 0, freqUs: 0, timePct: 0, freqPct: 0 });
    expect(x.metrics.conflicts.total).toBe(0);
  });
});

describe('conflict counts', () => {
  it('count by severity and by direction class, and who won the hard ones', () => {
    const x = run(['bt_a2dp', video(100)]);
    const c = x.metrics.conflicts;
    expect(c.total).toBe(x.conflicts.length);
    expect(Object.values(c.bySeverity).reduce((a, b) => a + b, 0)).toBe(c.total);
    expect(Object.values(c.byDirClass).reduce((a, b) => a + b, 0)).toBe(c.total);
    expect(c.bySeverity.HARD).toBe(x.conflicts.filter((k) => k.severity === 'HARD').length);
    expect(c.hardWonByBluetooth + c.hardWonByWifi).toBeLessThanOrEqual(c.bySeverity.HARD);
    expect(c.hardWonByBluetooth).toBeGreaterThan(0);
    expect(c.hardWonByWifi).toBeGreaterThan(0);
  });
  it('the screen-reader summary names the counts', () => {
    const x = run(['bt_a2dp', video(100)]);
    expect(x.metrics.summary).toMatch(/^\d+ conflicts?: \d+ hard \(\d+ resolved in favour of Bluetooth, \d+ in favour of Wi-Fi\), \d+ degraded, \d+ warning, \d+ tolerated\./);
    expect(run(['bt_a2dp']).metrics.summary).toMatch(/^0 conflicts:/);
  });
});

describe('per-task counts and throughput impact', () => {
  it('counts blocks by final status per task and sums them in the totals', () => {
    const x = run(['bt_a2dp', video(100)]);
    const sum = (k: 'delayed' | 'lost' | 'retried') => Object.values(x.metrics.perTask).reduce((a, t) => a + t.counts[k], 0);
    expect(x.metrics.totals.blocksDelayed).toBe(sum('delayed'));
    expect(x.metrics.totals.blocksRetried).toBe(sum('retried'));
    expect(x.metrics.perTask.t1.counts.delayed).toBeGreaterThan(0);
    expect(x.metrics.perTask.t1.name).toBe('A2DP streaming');
  });
  it('with no conflict everything requested is delivered: impact is zero', () => {
    const x = run(['bt_a2dp', video(100)], sepHigh);
    for (const t of Object.values(x.metrics.perTask)) {
      expect(t.throughputImpactPct).toBe(0);
      expect(t.deliveredBytes).toBe(t.requestedBytes);
    }
    expect(x.metrics.perTask.t1.requestedBytes).toBe(679 * 7);
  });
  it('payload of blocks marked corrupted does not count (7A.8)', () => {
    const x = run(['bt_a2dp', video(100)], sepLow);
    expect(x.metrics.perTask.t1.corruptedBytes + x.metrics.perTask.t1.lostBytes).toBeGreaterThan(0);
    expect(x.metrics.perTask.t1.throughputImpactPct).toBeGreaterThan(0);
    expect(x.metrics.perTask.t1.deliveredBytes).toBeLessThan(x.metrics.perTask.t1.requestedBytes);
  });
  it('a lost SCO block is lost payload; a recovered one is not', () => {
    const lost = run(['bt_sco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    expect(lost.metrics.perTask.t1.lostBytes).toBeGreaterThan(0);
    expect(lost.metrics.perTask.t1.throughputImpactPct).toBeGreaterThan(0);
    const fine = run(['bt_sco', ['wifi_bulk', { dutyCyclePct: 90 }]]);
    expect(fine.metrics.perTask.t1.throughputImpactPct).toBe(0);
  });
  it('A2DP (Example 1 shape): delayed packets are not lost, backlog below the critical threshold is not an impact, latency is reported', () => {
    const x = run(['bt_a2dp', video(100)]);
    const a = x.metrics.perTask.t1;
    expect(a.counts.lost).toBe(0);
    expect(a.lostBytes).toBe(0);
    expect(a.queuedAtEnd).toBeGreaterThan(0);
    expect(a.queuedAtEnd).toBeLessThanOrEqual(3);
    expect(a.throughputImpactPct).toBe(0);
    expect(a.latency.delayedPackets).toBeGreaterThan(0);
    expect(a.latency.maxUs).toBeGreaterThan(0);
    expect(a.latency.meanUs).toBeLessThanOrEqual(a.latency.maxUs);
  });
  it('a non-buffered task gets no allowance: packets still queued at the end count against it', () => {
    const d = freshData();
    d.taskIndex.get('bt_a2dp')!.buffer!.enabled = false;
    const x = run(['bt_a2dp', video(100)], {}, d);
    const a = x.metrics.perTask.t1;
    if (a.queuedAtEnd > 0) expect(a.throughputImpactPct).toBeGreaterThan(0);
  });
  it('latency impact is the extra wait before the block that finally delivered the packet', () => {
    const x = run(['bt_a2dp', video(100)]);
    const delayed = x.blocks.filter((b) => b.taskId === 't1' && b.kind === 'DATA' && b.attempt === 1 && b.status === 'DELAYED' && b.start + b.duration <= 100_000);
    if (delayed.length) {
      const worst = Math.max(...delayed.map((b) => b.start - b.plannedStart));
      expect(x.metrics.perTask.t1.latency.maxUs).toBeGreaterThanOrEqual(0);
      expect(worst).toBeGreaterThan(0);
    }
  });
});

describe('anchor metrics (7A.8)', () => {
  it('reports hits and misses per anchor task, the longest run of misses and the supervision margin', () => {
    const d = freshData();
    d.taskIndex.get('wifi_video_stream')!.buffer!.criticalThreshold = 1;
    const x = run([['le_conn_central', { connIntervalMs: 7.5 }], video(100)], { windowUs: 300_000 }, d);
    const a = x.metrics.perTask.t1.anchor!;
    expect(a.hits + a.misses).toBe(Math.ceil(300_000 / 7500));
    expect(a.misses).toBeGreaterThan(0);
    expect(a.longestRun).toBeGreaterThan(0);
    expect(a.longestRun).toBeLessThanOrEqual(3);
    expect(a.supervisionUs).toBe(2_000_000);
    expect(a.marginUs).toBeGreaterThan(0);
    expect(a.marginUs).toBeLessThan(2_000_000);
  });
  it('a clean anchor shows no misses and a margin close to the whole timeout', () => {
    const x = run(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]]);
    const a = x.metrics.perTask.t1.anchor!;
    expect(a.misses).toBe(0);
    expect(a.hits).toBe(14);
    expect(a.longestRun).toBe(0);
  });
  it('the margin shrinks when events are missed in a row', () => {
    const clean = run([['le_conn_central', { connIntervalMs: 7.5 }], 'wifi_web'], { windowUs: 300_000 });
    const starved = run([['le_conn_central', { connIntervalMs: 7.5 }], ['wifi_bulk', { dutyCyclePct: 90 }]], { windowUs: 300_000, arbitrationPolicy: 'WIFI_FAVOURED' });
    expect(starved.metrics.perTask.t1.anchor!.marginUs!).toBeLessThan(clean.metrics.perTask.t1.anchor!.marginUs!);
    expect(starved.metrics.perTask.t1.anchor!.longestRun).toBeGreaterThan(clean.metrics.perTask.t1.anchor!.longestRun);
  });
  it('tasks that are not anchors have no anchor figures', () => {
    expect(run(['bt_a2dp']).metrics.perTask.t1.anchor).toBeUndefined();
  });
});

describe('metric help text (7B.5)', () => {
  it('every metric in the summary has a plain-language help text and a label', () => {
    const help = JSON.parse(readFileSync('src/data/metricsHelp.json', 'utf8')).metrics as { key: string; help: string; label_spec: string }[];
    const keys = ['airtime', 'overlap', 'conflicts', 'blocksLost', 'blocksDelayed', 'blocksRetried', 'blocksTolerated', 'throughputImpact', 'queuedAtEnd', 'latency', 'anchorsHit', 'longestMissRun', 'supervisionMargin'];
    expect(help.map((h) => h.key).sort()).toEqual([...keys].sort());
    for (const h of help) { expect(h.help.length).toBeGreaterThan(40); expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(h.label_spec); }
  });
});

describe('determinism of the whole engine (AC-7)', () => {
  it('the same configuration and seed give identical blocks, conflicts, decisions and metrics', () => {
    const a = run(['bt_a2dp', ['le_conn_central', { connIntervalMs: 15 }], video(100), 'wifi_web'], { seed: 42, windowUs: 300_000 });
    const b = run(['bt_a2dp', ['le_conn_central', { connIntervalMs: 15 }], video(100), 'wifi_web'], { seed: 42, windowUs: 300_000 });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('a different seed changes the random parts', () => {
    const a = run(['bt_inquiry', video(100), 'wifi_web'], { seed: 1, windowUs: 200_000, ...sepLow });
    const b = run(['bt_inquiry', video(100), 'wifi_web'], { seed: 2, windowUs: 200_000, ...sepLow });
    expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(b.blocks));
  });
});
