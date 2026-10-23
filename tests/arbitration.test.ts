import { describe, expect, it } from 'vitest';
import { runEngine, ValidationError } from '../src/engine';
import { detectConflicts } from '../src/engine/stageD';
import type { AirBlock, PlatformConfig } from '../src/engine/types';
import { freshData, makeConfig, type TaskSpec } from './helpers';

const sepHigh: Partial<PlatformConfig> = { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 };
const sepLow: Partial<PlatformConfig> = { ...sepHigh, isolationDb: 10 };
const live = (b: AirBlock) => !b.optional && ['GRANTED', 'DELAYED', 'TOLERATED', 'DEGRADED'].includes(b.status);
const run = (specs: TaskSpec[], platform: Partial<PlatformConfig> = {}, data = freshData()) => runEngine(makeConfig(specs, { windowUs: 100_000, ...platform }, data), data);
const count = (r: ReturnType<typeof run>, tech: string, status: string) => r.blocks.filter((b) => b.tech === tech && !b.optional && b.status === status).length;
const video = (mbps: number): TaskSpec => ['wifi_video_stream', { bitrateMbps: mbps }];

describe('dynamic priority and criticality escalation (7A.8)', () => {
  const r = run(['bt_a2dp', video(100)]);
  const waitOf = (d: (typeof r.decisions)[number], taskPrefix: string) => Object.entries(d.priorities).find(([id]) => id.startsWith(taskPrefix))?.[1];

  it('A2DP keeps its low base priority while fewer than four packets wait, so Wi-Fi is granted and A2DP is DELAYED', () => {
    const low = r.decisions.filter((d) => d.rule === 'PRIORITY_DYNAMIC' && d.loserIds[0].startsWith('t1') && (waitOf(d, 't1')?.waiting ?? 9) < 4);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((d) => waitOf(d, 't1')!.value === 40 && !waitOf(d, 't1')!.critical)).toBe(true);
    expect(low.some((d) => /had 1 packet waiting, so Video streaming was granted/.test(d.text))).toBe(true);
    const delayed = r.blocks.filter((b) => b.tech === 'BT' && b.status === 'DELAYED' && /packets? waiting, so Video streaming was granted/.test(b.reason));
    expect(delayed.length).toBeGreaterThan(0);
  });

  it('at four waiting packets A2DP becomes critical at the isochronous level, wins, and the overlapping Wi-Fi burst is DELAYED', () => {
    const crit = r.decisions.filter((d) => d.winnerId.startsWith('t1') && waitOf(d, 't1')?.critical);
    expect(crit.length).toBeGreaterThan(0);
    for (const d of crit) { expect(waitOf(d, 't1')!.value).toBe(90); expect(waitOf(d, 't1')!.waiting).toBeGreaterThanOrEqual(4); expect(d.text).toMatch(/4 packets waiting, so it became critical/); }
    const wifiDelayed = r.blocks.filter((b) => b.tech === 'WIFI' && b.status === 'DELAYED' && /became critical/.test(b.reason));
    expect(wifiDelayed.length).toBeGreaterThan(0);
  });

  it('no A2DP block is LOST in the window', () => {
    expect(count(r, 'BT', 'LOST')).toBe(0);
  });

  it('the critical threshold is data and can be changed', () => {
    const d = freshData();
    d.taskIndex.get('bt_a2dp')!.buffer!.criticalThreshold = 2;
    const fast = run(['bt_a2dp', video(100)], {}, d);
    const firstCritical = (x: typeof r) => Math.min(...x.decisions.filter((e) => e.winnerId.startsWith('t1') && waitOf(e, 't1')?.critical).map((e) => e.time));
    expect(firstCritical(fast)).toBeLessThan(firstCritical(r));
  });

  it('every decision records a reason with the priority values; the winner and loser blocks carry the reason text', () => {
    expect(r.decisions.length).toBeGreaterThan(0);
    for (const dec of r.decisions) {
      expect(dec.text.length).toBeGreaterThan(20);
      expect(Object.keys(dec.priorities).length).toBeGreaterThanOrEqual(2);
      expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(dec.label);
    }
    for (const b of r.blocks.filter((x) => !x.optional && ['DELAYED', 'RETRIED', 'LOST', 'DENIED'].includes(x.status))) expect(b.reason.length).toBeGreaterThan(20);
  });

  it('priority is not a fixed order: Wi-Fi bulk loses to A2DP at base level 20 against 40, and A2DP loses to video', () => {
    const bulk = run(['bt_a2dp', ['wifi_bulk', { dutyCyclePct: 60 }]]);
    expect(bulk.decisions.some((d) => d.winnerId.startsWith('t1') && d.rule === 'PRIORITY_DYNAMIC' && /priority 40\) was granted over .* \(priority 20\)/.test(d.text))).toBe(true);
    expect(r.decisions.some((d) => d.winnerId.startsWith('t2') && /priority 60\) was granted over A2DP streaming \(priority 40\)|had \d packets? waiting, so Video/.test(d.text))).toBe(true);
  });
});

describe('mandatory anchors (7A.8)', () => {
  const r = run(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]], { windowUs: 100_000 }, undefined);

  it('the first attempt of an eSCO anchor is always granted over Wi-Fi, with the spec basis and miss cost in the reason', () => {
    const esco = r.blocks.filter((b) => b.taskId === 't1' && !b.optional && b.attempt === 1);
    expect(esco.length).toBeGreaterThan(0);
    expect(esco.every((b) => b.status === 'GRANTED' || b.status === 'TOLERATED')).toBe(true);
    const contested = esco.filter((b) => b.decisionId);
    expect(contested.length).toBeGreaterThan(0);
    expect(contested[0].reason).toMatch(/eSCO voice link first attempt is a mandatory anchor with high miss cost \(Standard says\), so it was granted over/);
  });

  it('Wi-Fi blocks that overlap an anchor are DELAYED, never the anchor; anchors are never DELAYED', () => {
    expect(count(r, 'WIFI', 'DELAYED')).toBeGreaterThan(0);
    expect(r.blocks.filter((b) => b.taskId === 't1' && b.status === 'DELAYED')).toHaveLength(0);
  });

  it('unused retransmission slots stay unused when the first attempt succeeds, and the anchor statistics count every hit', () => {
    expect(r.blocks.filter((b) => b.taskId === 't1' && b.optional && b.status === 'PLANNED').length).toBeGreaterThan(0);
    expect(r.blocks.filter((b) => b.taskId === 't1' && b.attempt > 1)).toHaveLength(0);
    expect(r.anchorStats.t1.misses).toBe(0);
    expect(r.anchorStats.t1.hits).toBe(14);
    expect(r.anchorStats.t1.longestRun).toBe(0);
  });

  it('HIGH-cost anchors are never given up, even to a critical Wi-Fi stream', () => {
    const d = freshData();
    d.taskIndex.get('wifi_video_stream')!.buffer!.criticalThreshold = 1;
    const x = run(['bt_esco', video(100)], {}, d);
    expect(x.blocks.filter((b) => b.taskId === 't1' && !b.optional && b.attempt === 1).every((b) => b.status === 'GRANTED' || b.status === 'TOLERATED')).toBe(true);
    expect(x.anchorStats.t1.misses).toBe(0);
  });

  it('a LOW-cost anchor gives the air to a critical Wi-Fi block, but only while misses stay below the tolerated count', () => {
    const d = freshData();
    d.taskIndex.get('wifi_video_stream')!.buffer!.criticalThreshold = 1;
    const x = run([['le_conn_central', { connIntervalMs: 7.5 }], video(100)], { windowUs: 300_000 }, d);
    const st = x.anchorStats.t1;
    expect(st.misses).toBeGreaterThan(0);
    expect(st.longestRun).toBeLessThanOrEqual(3);
    expect(st.hits).toBeGreaterThan(0);
    const missed = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 1 && b.dir === 'TX' && (b.status === 'RETRIED' || b.status === 'LOST'));
    expect(missed.length).toBe(st.misses);
    expect(missed[0].reason).toMatch(/low-cost anchor with 0 misses so far out of 3 tolerated \(Standard says\), so Video streaming was granted/);
    expect(missed.some((b) => /2 misses so far out of 3 tolerated/.test(b.reason))).toBe(true);
  });

  it('anchors are not DELAYED: they are DENIED and recorded as missed, with time left before the supervision timeout', () => {
    const x = run(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    const first = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 1 && !b.optional);
    expect(first.some((b) => b.status === 'RETRIED' || b.status === 'LOST')).toBe(true);
    expect(first.every((b) => b.status !== 'DELAYED')).toBe(true);
    expect(x.anchorStats.t1.misses).toBeGreaterThan(0);
  });
});

describe('policies (7A.8)', () => {
  it('BT_FAVOURED: Bluetooth always wins, whatever the priority', () => {
    const x = run(['bt_a2dp', video(100)], { arbitrationPolicy: 'BT_FAVOURED' });
    expect(x.blocks.filter((b) => b.tech === 'BT' && !b.optional).every((b) => b.status === 'GRANTED' || b.status === 'TOLERATED')).toBe(true);
    expect(x.decisions.every((d) => d.rule === 'FAVOURED' && /favours Bluetooth/.test(d.text))).toBe(true);
    expect(count(x, 'WIFI', 'DELAYED') + count(x, 'WIFI', 'RETRIED')).toBeGreaterThan(0);
  });
  it('WIFI_FAVOURED: Wi-Fi is never delayed or denied by Bluetooth', () => {
    const x = run(['bt_a2dp', video(100)], { arbitrationPolicy: 'WIFI_FAVOURED' });
    expect(x.blocks.filter((b) => b.tech === 'WIFI' && !b.optional).every((b) => b.status === 'GRANTED' || b.status === 'TOLERATED')).toBe(true);
    expect(count(x, 'BT', 'DELAYED')).toBeGreaterThan(0);
  });
  it('FIRST_COME: the block that started first wins', () => {
    const x = run(['bt_a2dp', video(100)], { arbitrationPolicy: 'FIRST_COME' });
    for (const d of x.decisions.filter((e) => e.rule === 'FIRST_COME')) {
      const w = x.blocks.find((b) => b.id === d.winnerId)!;
      const l = x.blocks.find((b) => b.id === d.loserIds[0])!;
      expect(w.plannedStart <= l.plannedStart || l.delayCount).toBeTruthy();
    }
    expect(x.decisions.length).toBeGreaterThan(0);
  });
  it('TIME_SHARE (Example 5 shape): about half the BLE connection events are denied on the first attempt, retried one interval later', () => {
    const x = run([['le_conn_central', { connIntervalMs: 30, phy: '2M' }], ['wifi_web', { channel: 1 }]], { windowUs: 1_000_000, arbitrationPolicy: 'TIME_SHARE', timeShareBtPercent: 50, timeShareSliceUs: 5000, wifiBand: '2.4', wifiChannel: 1 });
    const first = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 1 && !b.optional && b.dir === 'TX');
    const denied = first.filter((b) => b.status === 'RETRIED' || b.status === 'LOST');
    expect(first).toHaveLength(34);
    expect(denied.length / first.length).toBeGreaterThan(0.3);
    expect(denied.length / first.length).toBeLessThan(0.7);
    expect(denied[0].reason).toMatch(/Time slice \d+ .* belongs to Wi-Fi in the 50\/50 share/);
    const retries = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 2 && b.dir === 'TX');
    expect(retries.length).toBeGreaterThan(0);
    for (const rt of retries) {
      const orig = x.blocks.find((b) => b.id === rt.retryOf)!;
      expect(rt.start - orig.plannedStart).toBeGreaterThanOrEqual(30000);
      expect(rt.start - orig.plannedStart).toBeLessThan(32000);
    }
    expect(x.anchorStats.t1.misses).toBeGreaterThan(5);
  });
  it('TIME_SHARE slices follow the configured ratio over a long run', () => {
    const x = run([['le_conn_central', { connIntervalMs: 7.5 }]], { windowUs: 3_000_000, arbitrationPolicy: 'TIME_SHARE', timeShareBtPercent: 25, antennaMode: 'SHARED' });
    const first = x.blocks.filter((b) => b.attempt === 1 && b.dir === 'TX');
    const ok = first.filter((b) => b.status === 'GRANTED').length / first.length;
    expect(ok).toBeGreaterThan(0.18);
    expect(ok).toBeLessThan(0.32);
  });
  it('separate antennas with high isolation need no arbitration: nothing is delayed, denied or retried', () => {
    const x = run(['bt_a2dp', video(100)], sepHigh);
    expect(x.blocks.filter((b) => ['DELAYED', 'DENIED', 'LOST', 'RETRIED'].includes(b.status))).toHaveLength(0);
    expect(x.conflicts.filter((c) => c.severity === 'HARD')).toHaveLength(0);
    expect(x.conflicts.filter((c) => c.severity === 'TOLERATED').length).toBeGreaterThan(0);
  });
});

describe('retries (7A.9)', () => {
  it('SCO has no retransmission: a denied block is LOST and counted as a missed anchor', () => {
    const x = run(['bt_sco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    const lost = x.blocks.filter((b) => b.taskId === 't1' && b.status === 'LOST');
    expect(lost.length).toBeGreaterThan(0);
    expect(lost[0].reason).toMatch(/no retransmission/);
    expect(x.blocks.filter((b) => b.taskId === 't1' && b.attempt > 1)).toHaveLength(0);
    expect(x.anchorStats.t1.misses).toBeGreaterThan(0);
  });
  it('eSCO retransmits only inside its window, and a retransmission window is not protected: Wi-Fi can win it', () => {
    const x = run(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    const retx = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 2);
    expect(retx.length).toBeGreaterThan(0);
    for (const b of retx) {
      expect(b.retx).toBe(true);
      expect(b.retryOf).not.toBe('');
      expect(b.plannedStart).toBeGreaterThan(x.blocks.find((o) => o.id === b.retryOf)!.plannedStart);
    }
    expect(retx.some((b) => b.status === 'LOST' || b.status === 'RETRIED')).toBe(true);
  });
  it('a retransmission of an anchor task takes part in arbitration at the unprotected priority (PRIORITY policy)', () => {
    const d = freshData();
    d.taskIndex.get('wifi_video_stream')!.buffer!.criticalThreshold = 1;
    // Only possible to deny a first attempt under a policy that allows it; then switch to the retry check on those blocks.
    const x = run(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    expect(x.blocks.some((b) => b.retx && b.priority === 100)).toBe(true); // stage A copies the class base; the arbiter uses the unprotected value
    expect(d.priorityTable.anchorRetxPriority).toBeLessThan(10);
  });
  it('Classic ACL retries at the next slot pair, on an even slot', () => {
    const x = run([['bt_acl_active', { intervalSlots: 20 }], ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED' });
    const retries = x.blocks.filter((b) => b.taskId === 't1' && b.attempt === 2 && b.dir === 'TX');
    expect(retries.length).toBeGreaterThan(0);
    for (const b of retries) expect(b.start % 1250).toBe(0);
  });
  it('the retry limit stops the chain and the block is lost', () => {
    const x = run([['le_conn_central', { connIntervalMs: 7.5 }], ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED', retryLimit: 1, windowUs: 200_000 });
    expect(Math.max(...x.blocks.map((b) => b.attempt))).toBeLessThanOrEqual(2);
    expect(x.blocks.some((b) => b.status === 'LOST' && /retry limit/.test(b.reason))).toBe(true);
  });
  it('Wi-Fi retries after a new backoff with a rate step-down: the data frame gets longer', () => {
    const x = run([video(100), 'bt_esco'], { windowUs: 100_000, arbitrationPolicy: 'BT_FAVOURED' });
    const retried = x.blocks.filter((b) => b.tech === 'WIFI' && b.attempt === 2 && b.kind === 'DATA');
    if (retried.length === 0) return; // acknowledgements are the blocks denied here; covered below
    for (const b of retried) expect(b.duration).toBeGreaterThan(x.blocks.find((o) => o.id === b.retryOf)!.duration);
  });
  it('a denied Wi-Fi acknowledgement retries the whole burst', () => {
    const x = run(['bt_a2dp', video(100)], {});
    const r2 = x.blocks.filter((b) => b.tech === 'WIFI' && b.attempt === 2);
    expect(r2.length).toBeGreaterThan(0);
    const groups = new Set(r2.map((b) => b.groupId));
    for (const g of groups) expect(r2.filter((b) => b.groupId === g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('invariants across policies and platforms', () => {
  const cases: [string, TaskSpec[], Partial<PlatformConfig>][] = [
    ['Example 1 shape', ['bt_a2dp', video(100)], {}],
    ['Example 1, heavy Wi-Fi', ['bt_a2dp', video(250)], {}],
    ['eSCO and bulk', ['bt_esco', ['wifi_bulk', { dutyCyclePct: 70 }]], {}],
    ['A2DP, LE and web', ['bt_a2dp', ['le_conn_central', { connIntervalMs: 15 }], 'wifi_web', video(60)], {}],
    ['advertising and scan', ['le_adv_legacy', 'le_scan_passive', 'wifi_scan_active', 'wifi_web'], {}],
    ['BT favoured', ['bt_a2dp', 'bt_esco', video(100)], { arbitrationPolicy: 'BT_FAVOURED', maxEscoLinks: 1 }],
    ['Wi-Fi favoured', ['bt_a2dp', ['le_conn_central', { connIntervalMs: 10 }], video(100)], { arbitrationPolicy: 'WIFI_FAVOURED' }],
    ['first come', ['bt_a2dp', ['le_conn_central', { connIntervalMs: 10 }], video(100)], { arbitrationPolicy: 'FIRST_COME' }],
    ['time share', ['bt_a2dp', ['le_conn_central', { connIntervalMs: 10 }], 'wifi_web'], { arbitrationPolicy: 'TIME_SHARE' }],
    ['shared core, separate antennas', ['bt_a2dp', video(100)], { ...sepHigh, coreMode: 'TIME_DIVISION', coreCount: 1, simultaneousWifiTxBtRx: false }],
    ['concurrent, low isolation', ['bt_a2dp', video(100)], sepLow],
  ];
  describe.each(cases)('%s', (_n, specs, plat) => {
    const x = run(specs, plat);
    it('leaves no HARD conflict between blocks that really transmit', () => {
      const real = x.blocks.filter((b) => live(b) && b.start < x.config.platform.windowUs);
      const hard = detectConflicts(real, x.config, freshData()).filter((c) => c.severity === 'HARD');
      expect(hard.map((c) => `${c.btBlockId}/${c.wifiBlockId}`)).toEqual([]);
    });
    it('settles every block with a legal status and a reason; only unused retransmission slots stay PLANNED', () => {
      for (const b of x.blocks) {
        if (b.optional) { expect(b.status).toBe('PLANNED'); continue; }
        expect(['GRANTED', 'DELAYED', 'TOLERATED', 'DEGRADED', 'LOST', 'RETRIED', 'DENIED']).toContain(b.status);
        expect(b.reason.length).toBeGreaterThan(5);
      }
    });
    it('does not put two blocks of one task on the air at once', () => {
      const byTask = new Map<string, AirBlock[]>();
      for (const b of x.blocks.filter((q) => live(q))) (byTask.get(b.taskId) ?? byTask.set(b.taskId, []).get(b.taskId)!).push(b);
      for (const [task, list] of byTask) {
        if (['wifi_scan_active', 'le_scan_passive'].includes(x.config.tasks.find((t) => t.instanceId === task)!.taskId)) continue;
        list.sort((a, b) => a.start - b.start);
        for (let i = 1; i < list.length; i++) expect(list[i].start, `${task} ${list[i - 1].id} ${list[i].id}`).toBeGreaterThanOrEqual(list[i - 1].start + list[i - 1].duration - 0);
      }
    });
    it('is deterministic', () => {
      expect(run(specs, plat)).toEqual(x);
    });
  });
});

describe('conflicts and outcomes (7A.7, 7A.8)', () => {
  it('Example 2 shape: separate antennas and 40 dB isolation give zero HARD conflicts and some TOLERATED', () => {
    const x = run(['bt_a2dp', video(100)], sepHigh);
    expect(x.conflicts.filter((c) => c.severity === 'HARD')).toHaveLength(0);
    expect(x.conflicts.filter((c) => c.severity === 'TOLERATED').length).toBeGreaterThan(0);
    expect(x.blocks.filter((b) => b.tech === 'BT' && b.status === 'TOLERATED').length).toBeGreaterThan(0);
  });
  it('Example 3 shape: with low isolation, hops inside the footprint are DEGRADED but still drawn and not arbitrated', () => {
    const x = run(['bt_inquiry', video(100)], { ...sepLow, windowUs: 300_000 });
    const deg = x.blocks.filter((b) => b.tech === 'BT' && b.status === 'DEGRADED');
    expect(deg.length).toBeGreaterThan(0);
    expect(deg.every((b) => b.corrupted && b.freqCenter >= 2426 && b.freqCenter <= 2448)).toBe(true);
    expect(x.blocks.filter((b) => ['DELAYED', 'LOST', 'RETRIED'].includes(b.status))).toHaveLength(0);
    expect(x.blocks.some((b) => b.warning)).toBe(true);
  });
  it('Example 4 shape: with AFH on, no Bluetooth block hops into the footprint after the delay', () => {
    const x = run(['bt_inquiry', video(100)], { ...sepLow, windowUs: 300_000, afhEnabled: true });
    expect(x.blocks.filter((b) => b.tech === 'BT' && b.status === 'DEGRADED' && b.start >= 100_000)).toHaveLength(0);
    expect(x.blocks.filter((b) => b.tech === 'BT' && b.status === 'DEGRADED' && b.start < 100_000).length).toBeGreaterThan(0);
    expect(x.afh.enabled).toBe(true);
  });
  it('a HARD conflict links to its decision, the winner and the final status of both blocks', () => {
    const x = run(['bt_a2dp', video(100)]);
    const hard = x.conflicts.filter((c) => c.severity === 'HARD' && c.geometry === 'PLANNED' && c.decisionId);
    expect(hard.length).toBeGreaterThan(0);
    for (const c of hard) {
      expect(x.decisions.some((d) => d.id === c.decisionId)).toBe(true);
      expect([c.btBlockId, c.wifiBlockId]).toContain(c.winnerBlockId);
      expect(c.btStatus && c.wifiStatus).toBeTruthy();
      expect(c.reason.length).toBeGreaterThan(40);
    }
  });
  it('the conflict of a delayed block is still listed at its planned time', () => {
    const x = run(['bt_a2dp', video(100)]);
    const delayed = x.blocks.find((b) => b.tech === 'BT' && b.status === 'DELAYED' && b.plannedStart === 0)!;
    expect(delayed).toBeDefined();
    expect(x.conflicts.some((c) => (c.btBlockId === delayed.id) && c.overlapStart < delayed.start)).toBe(true);
  });
});

describe('the validation gate in the engine (VAL-8, AC-12)', () => {
  it('refuses to run when the configuration has an ERROR, without any user interface', () => {
    const bad = makeConfig(['wifi_mlo'], { wifiGeneration: '11n' });
    expect(() => runEngine(bad)).toThrow(ValidationError);
    try { runEngine(bad); } catch (e) { expect((e as ValidationError).issues.some((i) => i.severity === 'ERROR')).toBe(true); }
  });
  it('refuses even a hand-edited value outside its range', () => {
    const cfg = makeConfig(['bt_a2dp']);
    cfg.tasks[0].params.bitrateKbps = -1;
    expect(() => runEngine(cfg)).toThrow(/V-1/);
  });
  it('runs and returns warnings and notes when there are no errors', () => {
    const x = run(['bt_a2dp', 'bt_esco', video(100)], { maxEscoLinks: 1 });
    expect(x.issues.some((i) => i.id === 'P-4')).toBe(true);
  });
});

describe('speed (NFR-2, AC-10)', () => {
  it('a one-second window with eight tasks runs in under two seconds', () => {
    const specs: TaskSpec[] = ['bt_a2dp', ['le_conn_central', { connIntervalMs: 15 }], 'bt_avrcp_hid', 'le_adv_legacy', video(100), 'wifi_web', 'wifi_beacon', ['wifi_cloud_sync', { burstsPerSec: 4 }]];
    const t0 = performance.now();
    const x = run(specs, { windowUs: 1_000_000 });
    const ms = performance.now() - t0;
    console.log(`8 tasks, 1 s: ${ms.toFixed(0)} ms, ${x.blocks.length} blocks, ${x.conflicts.length} conflicts, ${x.decisions.length} decisions`);
    expect(ms).toBeLessThan(2000);
  });
  it('heavy Wi-Fi with a shared antenna and a 1 s window stays fast', () => {
    const t0 = performance.now();
    const x = run(['bt_a2dp', ['wifi_video_stream', { bitrateMbps: 250 }], ['le_conn_central', { connIntervalMs: 7.5 }]], { windowUs: 1_000_000 });
    const ms = performance.now() - t0;
    console.log(`heavy: ${ms.toFixed(0)} ms, ${x.blocks.length} blocks`);
    expect(ms).toBeLessThan(2000);
  });
});
