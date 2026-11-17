// Thread (IEEE 802.15.4) as a third technology: timing, channel plan, task patterns, conflicts with Wi-Fi, retries and rules.
import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { runEngine } from '../src/engine';
import { expandTask } from '../src/engine/stageA';
import { threadCenterMHz, threadChannels, threadFrameDurationUs, threadPsduBytes } from '../src/engine/timing/thread';
import { validate } from '../src/engine/validator';
import type { AirBlock } from '../src/engine/types';
import { makeConfig, type TaskSpec } from './helpers';

const sepHigh = { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 } as const;
const sepLow = { ...sepHigh, isolationDb: 10 } as const;
const THREAD_TASKS = data.tasks.filter((t) => t.tech === 'THREAD').map((t) => t.id);
const ids = (c: ReturnType<typeof makeConfig>) => validate(c).map((i) => i.id);
const live = (r: ReturnType<typeof runEngine>) => r.blocks.filter((b) => !b.optional);

describe('Thread timing and channel plan (IEEE 802.15.4, 2.4 GHz)', () => {
  it('frames take 32 us per byte including the 6 byte physical header', () => {
    expect(threadFrameDurationUs(data, 'ACK', 0)).toBe(11 * 32);
    expect(threadFrameDurationUs(data, 'COMMAND', 0)).toBe((6 + 16) * 32);
    expect(threadFrameDurationUs(data, 'DATA', 40)).toBe((6 + 22 + 40) * 32);
    expect(threadFrameDurationUs(data, 'DATA', 1000)).toBe((6 + 127) * 32); // capped at the 127 byte maximum
    expect(threadPsduBytes(data, 'MGMT', 0)).toBe(data.threadTiming.mleFrameBytes);
  });
  it('channels 11 to 26 sit 5 MHz apart from 2405 to 2480 MHz', () => {
    expect(threadChannels(data)).toHaveLength(16);
    expect(threadCenterMHz(data, 11)).toBe(2405);
    expect(threadCenterMHz(data, 15)).toBe(2425);
    expect(threadCenterMHz(data, 26)).toBe(2480);
  });
});

describe('every Thread task expands through the pattern generators', () => {
  it.each(THREAD_TASKS)('%s: blocks are Thread blocks on the platform channel, inside the window', (id) => {
    const cfg = makeConfig([id], { windowUs: 1_000_000, threadChannel: 20 });
    const blocks = expandTask(cfg, 't1', data);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) { expect(b.tech).toBe('THREAD'); expect(b.chanMode).toBe('THREAD'); expect(b.start).toBeLessThan(1_000_000); }
    const r = runEngine(cfg);
    if (id !== 'thread_scan') for (const x of live(r)) { expect(x.channelIndex).toBe(20); expect(x.freqCenter).toBe(2450); expect(x.freqWidth).toBe(2); }
  });
  it('is deterministic for the same seed and changes with another seed', () => {
    const a = runEngine(makeConfig(['thread_forward'], { windowUs: 1_000_000 }));
    const b = runEngine(makeConfig(['thread_forward'], { windowUs: 1_000_000 }));
    const c = runEngine(makeConfig(['thread_forward'], { windowUs: 1_000_000, seed: 9 }));
    expect(a.blocks).toEqual(b.blocks);
    expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(c.blocks));
  });
  it('a poll is a command, an acknowledgement, and with data pending a data frame and its acknowledgement', () => {
    const plain = expandTask(makeConfig(['thread_poll'], { windowUs: 100_000 }), 't1', data);
    const ev0 = plain.filter((b) => b.eventId === 't1.e0');
    expect(ev0.map((b) => `${b.dir}:${b.kind}`)).toEqual(['TX:POLL', 'RX:ACK']);
    const withData = expandTask(makeConfig([['thread_poll', { dataPending: true }]], { windowUs: 100_000 }), 't1', data).filter((b) => b.eventId === 't1.e0');
    expect(withData.map((b) => `${b.dir}:${b.kind}`)).toEqual(['TX:POLL', 'RX:ACK', 'RX:DATA', 'TX:ACK']);
    expect(withData[1].start - (withData[0].start + withData[0].duration)).toBe(data.threadTiming.turnaroundUs);
  });
  it('the first transmit waits for the CSMA backoff: a whole number of 320 us periods plus one 128 us clear-channel check', () => {
    const t = data.threadTiming;
    const starts = expandTask(makeConfig([['thread_poll', { pollPeriodMs: 10 }]], { windowUs: 1_000_000 }), 't1', data).filter((b) => b.kind === 'POLL').map((b, k) => b.start - k * 10_000);
    for (const s of starts) { expect(s).toBeGreaterThanOrEqual(t.ccaUs); expect((s - t.ccaUs) % t.unitBackoffUs).toBe(0); expect(s).toBeLessThanOrEqual((2 ** t.macMinBE - 1) * t.unitBackoffUs + t.ccaUs); }
    expect(new Set(starts).size).toBeGreaterThan(1);
  });
  it('a report with several frames sends them one after another, each acknowledged', () => {
    const ev = expandTask(makeConfig([['thread_report', { framesPerReport: 3 }]], { windowUs: 100_000 }), 't1', data).filter((b) => b.eventId === 't1.e0');
    expect(ev.map((b) => b.kind)).toEqual(['DATA', 'ACK', 'DATA', 'ACK', 'DATA', 'ACK']);
    for (let i = 1; i < ev.length; i++) expect(ev[i].start).toBeGreaterThanOrEqual(ev[i - 1].start + ev[i - 1].duration);
  });
  it('payload is counted only for data frames, and advertisements are not acknowledged', () => {
    const rep = expandTask(makeConfig(['thread_report'], { windowUs: 100_000 }), 't1', data);
    expect(rep.filter((b) => b.kind === 'DATA').every((b) => b.payloadBytes === 40)).toBe(true);
    expect(rep.filter((b) => b.kind === 'ACK').every((b) => !b.payloadBytes)).toBe(true);
    const mle = expandTask(makeConfig(['thread_mle'], { windowUs: 1_000_000 }), 't1', data);
    expect(mle.map((b) => `${b.dir}:${b.kind}`)).toEqual(['TX:MGMT']);
  });
  it('a channel scan visits every channel from 11 to 26 in turn at that channel\'s frequency', () => {
    const r = runEngine(makeConfig(['thread_scan'], { windowUs: 1_000_000 }));
    const listens = live(r).filter((b) => b.kind === 'SCAN' && b.dir === 'RX');
    expect(listens.map((b) => b.channelIndex)).toEqual(threadChannels(data));
    for (const b of listens) expect(b.freqCenter).toBe(threadCenterMHz(data, b.channelIndex));
    const four = runEngine(makeConfig([['thread_scan', { scanChannels: '15,20,25,26' }]], { windowUs: 1_000_000 }));
    expect(live(four).filter((b) => b.kind === 'SCAN' && b.dir === 'RX').map((b) => b.channelIndex)).toEqual([15, 20, 25, 26]);
  });
  it('scheduled listening needs Thread 1.2 and a full-size frame cannot be longer than 127 bytes', () => {
    expect(data.taskIndex.get('thread_csl')!.minVersion).toBe(1.2);
    for (const b of expandTask(makeConfig([['thread_bulk', { payloadBytes: 100 }]], { windowUs: 100_000 }), 't1', data)) expect(b.duration).toBeLessThanOrEqual((6 + 127) * 32);
  });
});

describe('Thread against Wi-Fi: the same platform rules as Bluetooth', () => {
  const video: TaskSpec = ['wifi_video_stream', { bitrateMbps: 30 }];
  const win = { windowUs: 1_000_000 };
  it('shared antenna: hard conflicts, and the higher priority wins; the Thread frame is delayed, not lost', () => {
    const r = runEngine(makeConfig(['thread_report', video], win));
    expect(r.metrics.conflicts.bySeverity.HARD).toBeGreaterThan(0);
    const thread = Object.values(r.metrics.perTask).find((t) => t.tech === 'THREAD')!;
    expect(thread.counts.delayed).toBeGreaterThan(0);
    expect(thread.counts.lost).toBe(0);
    expect(r.decisions.some((d) => /Video streaming \(priority 60\) was granted over Sensor report \(CoAP\) \(priority 45\)/.test(d.text))).toBe(true);
    expect(r.metrics.airtime.THREAD.totalPct).toBeGreaterThan(0);
  });
  it('conflict and decision texts name Thread, never Bluetooth', () => {
    const r = runEngine(makeConfig(['thread_report', video], win));
    for (const c of r.conflicts) expect(c.reason).not.toMatch(/Bluetooth/);
    expect(r.conflicts.some((c) => /Thread is transmitting/.test(c.reason))).toBe(true);
  });
  it('separate antennas, low isolation, Thread under the Wi-Fi channel: degraded; moved to channel 25: no degraded frames', () => {
    const under = runEngine(makeConfig(['thread_report', video], { ...sepLow, ...win, threadChannel: 18 }));
    const clear = runEngine(makeConfig(['thread_report', video], { ...sepLow, ...win, threadChannel: 25 }));
    expect(under.metrics.conflicts.bySeverity.DEGRADED).toBeGreaterThan(0);
    expect(clear.metrics.conflicts.bySeverity.DEGRADED).toBe(0);
    expect(Object.values(under.metrics.perTask).find((t) => t.tech === 'THREAD')!.throughputImpactPct).toBeGreaterThan(0);
    expect(Object.values(clear.metrics.perTask).find((t) => t.tech === 'THREAD')!.throughputImpactPct).toBe(0);
  });
  it('high isolation makes the same overlap harmless', () => {
    const r = runEngine(makeConfig(['thread_report', video], { ...sepHigh, ...win, threadChannel: 18 }));
    expect(r.metrics.conflicts.bySeverity.HARD + r.metrics.conflicts.bySeverity.DEGRADED).toBe(0);
    expect(r.metrics.conflicts.bySeverity.TOLERATED).toBeGreaterThan(0);
  });
  it('channels 15, 20, 25 and 26 are clear of Wi-Fi channel 6, and the channels under it are not', () => {
    const run = (ch: number) => runEngine(makeConfig(['thread_report', video], { ...sepLow, ...win, threadChannel: ch })).conflicts.filter((c) => c.freqOverlap).length;
    for (const ch of [15, 20, 25, 26]) expect(run(ch), `channel ${ch}`).toBe(0);
    for (const ch of [16, 17, 18, 19]) expect(run(ch), `channel ${ch}`).toBeGreaterThan(0);
  });
  it('policy favouring the narrowband side names Thread; time share names Thread as the slice owner', () => {
    const fav = runEngine(makeConfig(['thread_report', video], { ...win, arbitrationPolicy: 'BT_FAVOURED' }));
    expect(fav.decisions.some((d) => /favours Thread/.test(d.text))).toBe(true);
    const ts = runEngine(makeConfig(['thread_report', 'wifi_web'], { ...win, arbitrationPolicy: 'TIME_SHARE' }));
    expect(ts.decisions.some((d) => /belongs to Wi-Fi/.test(d.text) && /Sensor report/.test(d.text))).toBe(true);
  });
  it('a Thread frame that loses and cannot be delayed is retried after the acknowledgement timeout plus a random backoff', () => {
    // Scheduled listening is a fixed receive window, so it cannot move: it is denied and the parent sends again.
    const r = runEngine(makeConfig(['thread_csl', ['wifi_video_stream', { bitrateMbps: 100 }]], { ...win, arbitrationPolicy: 'WIFI_FAVOURED' }));
    const retries = r.blocks.filter((b) => b.taskId === 't1' && b.attempt === 2 && b.dir === 'RX' && b.kind === 'DATA');
    expect(retries.length).toBeGreaterThan(0);
    const t = data.threadTiming;
    for (const rt of retries) {
      const orig = r.blocks.find((b) => b.id === rt.retryOf) as AirBlock;
      const gap = rt.plannedStart - (orig.plannedStart + orig.duration + data.threadTiming.turnaroundUs + 352);
      expect(gap).toBeGreaterThanOrEqual(t.ackWaitUs - 1);
      expect(gap).toBeLessThanOrEqual(t.ackWaitUs + (2 ** t.macMinBE - 1) * t.unitBackoffUs + t.ccaUs + 200_000);
    }
  });
  it('Bluetooth and Thread together still run, each against Wi-Fi', () => {
    const r = runEngine(makeConfig(['bt_a2dp', 'thread_report', 'wifi_web'], win));
    expect(new Set(r.blocks.map((b) => b.tech))).toEqual(new Set(['BT', 'THREAD', 'WIFI']));
    expect(r.metrics.airtime.BT.totalPct).toBeGreaterThan(0);
    expect(r.metrics.airtime.THREAD.totalPct).toBeGreaterThan(0);
  });
  it('the priority table can be edited for Thread classes', () => {
    const base = runEngine(makeConfig(['thread_report', video], win));
    const cfg = makeConfig(['thread_report', video], win);
    const high = runEngine({ ...cfg, overrides: { base: { THREAD_DATA: 90 } } });
    const baseWon = base.metrics.conflicts.hardWonByBluetooth, highWon = high.metrics.conflicts.hardWonByBluetooth;
    expect(highWon).toBeGreaterThan(baseWon);
  });
});

describe('Thread validation rules', () => {
  it('T-1: scheduled listening on a Thread 1.1 device is an error, with a fix that raises the version', () => {
    const issues = validate(makeConfig(['thread_csl'], { threadVersion: 1.1 }));
    const t1 = issues.find((i) => i.id === 'T-1')!;
    expect(t1.severity).toBe('ERROR');
    expect(t1.fixes.some((f) => f.id === 'raiseThread' || /Thread version/.test(f.label))).toBe(true);
    expect(ids(makeConfig(['thread_csl'], { threadVersion: 1.2 }))).not.toContain('T-1');
  });
  it('V-1: a Thread channel outside 11 to 26 is clamped by the fix', () => {
    const v = validate(makeConfig(['thread_report'], { threadChannel: 30 })).find((i) => i.id === 'V-1')!;
    expect(v.severity).toBe('ERROR');
    expect(v.fixes[0].changes[0]).toMatchObject({ op: 'setPlatform', field: 'threadChannel', value: 26 });
    expect(ids(makeConfig(['thread_report'], { threadChannel: 10 }))).toContain('V-1');
  });
  it('F-7 suggests the nearest clear channel and the fix moves Thread there', () => {
    const f7 = validate(makeConfig(['thread_report', 'wifi_video_stream'], { threadChannel: 18 })).find((i) => i.id === 'F-7')!;
    expect(f7.severity).toBe('INFO');
    const ch = (f7.fixes[0].changes[0] as { value: number }).value;
    expect([15, 20]).toContain(ch);
    expect(f7.message).toMatch(/Thread channel 18/);
  });
  it('F-7 is silent without Wi-Fi, and for Wi-Fi on 5 GHz', () => {
    expect(ids(makeConfig(['thread_report'], { threadChannel: 18 }))).not.toContain('F-7');
    expect(ids(makeConfig(['thread_report', 'wifi_video_stream'], { threadChannel: 18, wifiBand: '5', wifiChannel: 36 }))).not.toContain('F-7');
  });
  it('T-5 covers Thread: Wi-Fi at 5 GHz does not overlap Thread in frequency', () => {
    expect(ids(makeConfig(['thread_report', 'wifi_video_stream'], { wifiBand: '5', wifiChannel: 36 }))).toContain('T-5');
  });
  it('P-8 warns that Bluetooth and Thread together are not simulated against each other', () => {
    const p8 = validate(makeConfig(['bt_a2dp', 'thread_report', 'wifi_web'])).find((i) => i.id === 'P-8')!;
    expect(p8.severity).toBe('WARNING');
    expect(p8.message).toMatch(/does not simulate/);
  });
  it('R-3: more Thread airtime than exists is an error', () => {
    const issues = validate(makeConfig([['thread_bulk', { frameIntervalMs: 2 }]]));
    expect(issues.some((i) => i.id === 'R-3' && /Thread/.test(i.message))).toBe(true);
  });
});
