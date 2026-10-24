import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { applyFix, fixAllSafe, hasErrors, validate } from '../src/engine/validator';
import type { ScenarioConfig, TaskDef, ValidationIssue } from '../src/engine/types';
import { freshData, makeConfig, type TaskSpec } from './helpers';

const ids = (issues: ValidationIssue[]) => issues.map((i) => i.id);
const has = (c: ScenarioConfig, id: string, d = data) => ids(validate(c, d)).includes(id);
const sepConcurrent = { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 } as const;
const base = () => makeConfig(['bt_a2dp', 'wifi_video_stream']);

describe('validator basics', () => {
  it('passes a clean configuration with no ERROR (Example 1 setup)', () => {
    const issues = validate(base());
    expect(hasErrors(issues)).toBe(false);
  });

  it('runs in under 50 ms for a typical selection (7C.7)', () => {
    const c = makeConfig(['bt_a2dp', 'bt_avrcp_hid', 'le_conn_central', 'wifi_video_stream', 'wifi_web', 'wifi_beacon']);
    validate(c);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) validate(c);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });

  it('collects every issue from every stage rather than stopping at the first (VAL-5)', () => {
    const c = makeConfig([['le_scan_passive', { scanWindowMs: 200, scanIntervalMs: 100 }], ['le_channel_sounding', {}], 'wifi_mlo'], { btMaxVersion: 4.0, wifiGeneration: '11n', isolationDb: 150, windowUs: 0 });
    const found = new Set(ids(validate(c)));
    for (const id of ['V-3', 'V-5', 'T-1', 'T-4', 'F-2']) expect(found.has(id), id).toBe(true);
  });

  it('sorts by severity then stage', () => {
    const c = makeConfig(['bt_a2dp', 'bt_esco', 'wifi_video_stream'], { isolationDb: 150, afhEnabled: true });
    const sev = validate(c).map((i) => i.severity);
    const order = { ERROR: 0, WARNING: 1, INFO: 2 };
    expect(sev.map((s) => order[s])).toEqual([...sev.map((s) => order[s])].sort());
  });

  it('every issue has id, severity, title, items, message, reason with a label, and at least one fix or help link', () => {
    const c = makeConfig([['bt_esco', {}], ['bt_esco', {}], 'bt_a2dp', 'wifi_beacon', ['wifi_beacon', { role: 'AP' }]], { isolationDb: 150, windowUs: 0 });
    for (const i of validate(c)) {
      expect(i.title).toBeTruthy();
      expect(i.message).not.toMatch(/\{\w+\}/);
      expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(i.label);
      expect(i.fixes.length + (i.helpTopic ? 1 : 0)).toBeGreaterThan(0);
      for (const f of i.fixes) expect(f.label).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('acceptance tests VAL-1 to VAL-6', () => {
  it('VAL-1: Wi-Fi 7 tasks on a device limited to 802.11n show an ERROR', () => {
    const issues = validate(makeConfig(['bt_a2dp', 'wifi_mlo'], { wifiGeneration: '11n' }));
    expect(issues.some((i) => i.severity === 'ERROR' && i.id === 'T-4')).toBe(true);
    expect(hasErrors(issues)).toBe(true);
  });

  it('VAL-2: two eSCO links with the same slot offset give P-1 with a fix that moves an offset', () => {
    const c = makeConfig([['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 0 }]], { maxEscoLinks: 2 });
    const p1 = validate(c).find((i) => i.id === 'P-1')!;
    expect(p1.severity).toBe('ERROR');
    const move = p1.fixes.find((f) => f.changes[0].op === 'setParam' && (f.changes[0] as { param: string }).param === 'offsetSlots')!;
    expect(move).toBeDefined();
    expect(has(applyFix(c, move), 'P-1')).toBe(false);
  });

  it('VAL-2b: with the default one-eSCO limit the second link also trips P-3', () => {
    const c = makeConfig([['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 0 }]]);
    expect(has(c, 'P-3')).toBe(true);
  });

  it('VAL-3: A2DP and a voice link together show P-4 INFO and do not block Generate', () => {
    const issues = validate(makeConfig(['bt_a2dp', 'bt_esco']));
    expect(issues.find((i) => i.id === 'P-4')!.severity).toBe('INFO');
    expect(hasErrors(issues)).toBe(false);
  });

  it('VAL-4: a scan window above its interval shows V-3 and the fix corrects it', () => {
    const c = makeConfig([['le_scan_passive', { scanWindowMs: 200, scanIntervalMs: 100 }]]);
    const v3 = validate(c).find((i) => i.id === 'V-3')!;
    const fixed = applyFix(c, v3.fixes[0]);
    expect(has(fixed, 'V-3')).toBe(false);
    expect(fixed.tasks[0].params.scanWindowMs).toBe(100);
  });

  it('VAL-5: several problems are all shown at once', () => {
    const c = makeConfig([['le_scan_passive', { scanWindowMs: 200, scanIntervalMs: 100 }], ['bt_a2dp', { bitrateKbps: 99999 }]], { isolationDb: 500 });
    const found = ids(validate(c));
    expect(found).toEqual(expect.arrayContaining(['V-1', 'V-3', 'F-2']));
  });

  it('VAL-6: a scenario file edited to hold an invalid value is rejected when validated', () => {
    const json = JSON.stringify(base()).replace('"bitrateKbps":328', '"bitrateKbps":-5');
    const loaded = JSON.parse(json) as ScenarioConfig;
    expect(validate(loaded).some((i) => i.id === 'V-1' && i.severity === 'ERROR')).toBe(true);
  });
});

describe('rule behaviour details', () => {
  it('V-2 catches unknown tasks and empty values and restores defaults', () => {
    const c = makeConfig(['bt_a2dp']);
    c.tasks.push({ instanceId: 'x', taskId: 'no_such_task', params: {} });
    c.tasks[0].params.bitrateKbps = null as unknown as number;
    const v2 = validate(c).filter((i) => i.id === 'V-2');
    expect(v2).toHaveLength(2);
    const fixed = applyFix(c, v2.find((i) => i.items[0].kind === 'task' && (i.items[0] as { param?: string }).param === 'bitrateKbps')!.fixes[0]);
    expect(fixed.tasks[0].params.bitrateKbps).toBe(328);
  });

  it('V-4 flags a packet that is longer than the allowed slots and a payload above the packet maximum', () => {
    expect(has(makeConfig([['bt_acl_active', { packetType: 'DH5', slotLimit: 3 }]]), 'V-4')).toBe(true);
    expect(has(makeConfig([['bt_acl_active', { packetType: 'DH1', payloadBytes: 100 }]]), 'V-4')).toBe(true);
  });

  it('V-1 rejects a Wi-Fi channel that does not exist in the chosen band', () => {
    expect(has(makeConfig(['wifi_web'], { wifiChannel: 14 }), 'V-1')).toBe(true);
    expect(has(makeConfig([['wifi_web', { channel: 40 }]]), 'V-1')).toBe(true);
  });

  it('T-5 becomes INFO with separate antennas and high isolation', () => {
    const c = makeConfig(['bt_a2dp', 'wifi_video_stream'], { wifiBand: '5', ...sepConcurrent });
    expect(validate(c).find((i) => i.id === 'T-5')!.severity).toBe('INFO');
    expect(validate(makeConfig(['bt_a2dp', 'wifi_video_stream'], { wifiBand: '5' })).find((i) => i.id === 'T-5')!.severity).toBe('WARNING');
  });

  it('T-2 rejects 80 MHz on 802.11n, 320 MHz outside 6 GHz and 5 GHz on 802.11b', () => {
    expect(has(makeConfig(['wifi_web'], { wifiGeneration: '11n', wifiBandwidth: 80, wifiBand: '5', wifiChannel: 36 }), 'T-2')).toBe(true);
    expect(has(makeConfig(['wifi_web'], { wifiBandwidth: 320, wifiBand: '5', wifiChannel: 36 }), 'T-2')).toBe(true);
    expect(has(makeConfig(['wifi_web'], { wifiGeneration: '11b', wifiBand: '5', wifiChannel: 36 }), 'T-2')).toBe(true);
    expect(has(makeConfig(['wifi_web'], { wifiBandwidth: 320, wifiBand: '6', wifiChannel: 5 }), 'T-2')).toBe(false);
  });

  it('T-1 gates parameter values such as subrating and 2M data rates by Core version', () => {
    expect(has(makeConfig([['le_conn_central', { subrateFactor: 4 }]], { btMaxVersion: 5.2 }), 'T-1')).toBe(true);
    expect(has(makeConfig([['le_conn_central', { subrateFactor: 4 }]], { btMaxVersion: 5.3 }), 'T-1')).toBe(false);
  });

  it('T-3 flags LE Audio below Core 5.2 and Coded PHY below 5.0', () => {
    expect(has(makeConfig(['le_cis'], { btMaxVersion: 5.0 }), 'T-3')).toBe(true);
    expect(has(makeConfig([['le_conn_central', { phy: 'CODED_S8' }]], { btMaxVersion: 4.2 }), 'T-3')).toBe(true);
  });

  it('P-1 suggests an offset that does not collide with any other link', () => {
    const c = makeConfig([['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 6 }]], { maxEscoLinks: 3 });
    const issues = validate(c).filter((i) => i.id === 'P-1');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('P-2 starts without Classic discovery pairs: inquiry and page may run together', () => {
    const c = makeConfig(['bt_inquiry', 'bt_page', 'bt_inquiry_scan', 'bt_page_scan']);
    expect(has(c, 'P-2')).toBe(false);
    expect(hasErrors(validate(c))).toBe(false);
  });

  it('P-3 counts BLE connections against the editable device limit', () => {
    const many = Array.from({ length: 9 }, (_, i): TaskSpec => ['le_conn_central', { connIntervalMs: 30 + i }]);
    expect(has(makeConfig(many), 'P-3')).toBe(true);
    expect(has(makeConfig(many, { maxBleConnections: 9 }), 'P-3')).toBe(false);
  });

  it('F-5 compares the AFH minimum against channels left outside the Wi-Fi footprint', () => {
    expect(has(makeConfig(['bt_a2dp', 'wifi_video_stream'], { afhEnabled: true, afhMinChannelsClassic: 79 }), 'F-5')).toBe(true);
  });
});

describe('fixes', () => {
  it('fixAllSafe only restores defaults or clamps, and never removes tasks', () => {
    const c = makeConfig([['bt_a2dp', { bitrateKbps: 99999 }], ['le_scan_passive', { scanWindowMs: 200, scanIntervalMs: 100 }]], { isolationDb: 500 });
    const { config, applied } = fixAllSafe(c);
    expect(applied.every((f) => f.safe && f.changes.every((ch) => ch.op !== 'removeTask'))).toBe(true);
    const left = ids(validate(config));
    for (const id of ['V-1', 'V-3', 'F-2']) expect(left).not.toContain(id);
    expect(config.tasks).toHaveLength(2);
    expect(c.platform.isolationDb).toBe(500); // original untouched
  });
});

// ---------------------------------------------------------------------------
// VAL-10: every rule in the rules file has one failing and one passing configuration.
// ---------------------------------------------------------------------------
interface Case { fail: (d: ReturnType<typeof freshData>) => ScenarioConfig; pass: (d: ReturnType<typeof freshData>) => ScenarioConfig; data?: (d: ReturnType<typeof freshData>) => void }
const cases: Record<string, Case> = {
  'V-1': { fail: () => makeConfig([['bt_a2dp', { bitrateKbps: 5000 }]]), pass: () => base() },
  'V-2': { fail: () => makeConfig([['bt_a2dp', { bitrateKbps: null as unknown as number }]]), pass: () => base() },
  'V-3': { fail: () => makeConfig([['le_scan_passive', { scanWindowMs: 200, scanIntervalMs: 100 }]]), pass: () => makeConfig(['le_scan_passive']) },
  'V-4': { fail: () => makeConfig([['bt_acl_active', { packetType: 'DH5', slotLimit: 3 }]]), pass: () => makeConfig(['bt_acl_active']) },
  'V-5': { fail: () => makeConfig(['bt_a2dp'], { windowUs: 0 }), pass: () => base() },
  'T-1': { fail: () => makeConfig(['le_channel_sounding'], { btMaxVersion: 5.0 }), pass: () => makeConfig(['le_channel_sounding']) },
  'T-2': { fail: () => makeConfig(['wifi_web'], { wifiGeneration: '11b', wifiBand: '5', wifiChannel: 36 }), pass: () => makeConfig(['wifi_web']) },
  'T-3': { fail: () => makeConfig([['le_conn_central', { phy: 'CODED_S8' }]], { btMaxVersion: 4.2 }), pass: () => makeConfig([['le_conn_central', { phy: 'CODED_S8' }]]) },
  'T-4': { fail: () => makeConfig(['wifi_twt'], { wifiGeneration: '11n' }), pass: () => makeConfig(['wifi_twt']) },
  'T-5': { fail: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], { wifiBand: '5' }), pass: () => base() },
  'T-6': { fail: () => makeConfig([['wifi_beacon', { role: 'AP' }], 'wifi_web']), pass: () => makeConfig([['wifi_beacon', { role: 'AP' }], 'wifi_web'], { wifiMultiRole: true }) },
  'P-1': { fail: () => makeConfig([['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 0 }]], { maxEscoLinks: 2 }), pass: () => makeConfig([['bt_esco', { offsetSlots: 0 }], ['bt_esco', { offsetSlots: 6 }]], { maxEscoLinks: 2 }) },
  'P-2': {
    data: (d) => d.groupRules.exclusivePairs.push({ a: 'bt_sco', b: 'bt_esco', reason: 'Test pair.', label: 'IMPLEMENTATION_VARIES' }),
    fail: (d) => makeConfig(['bt_sco', ['bt_esco', { offsetSlots: 6 }]], { maxEscoLinks: 2 }, d),
    pass: (d) => makeConfig(['bt_sco'], {}, d),
  },
  'P-3': { fail: () => makeConfig(Array.from({ length: 9 }, (_, i): TaskSpec => ['le_conn_central', { connIntervalMs: 30 + i }])), pass: () => makeConfig(['le_conn_central']) },
  'P-4': { fail: () => makeConfig(['bt_a2dp', 'bt_esco']), pass: () => makeConfig(['bt_a2dp']) },
  'P-5': { fail: () => makeConfig(['wifi_web', 'wifi_web']), pass: () => makeConfig(['wifi_web']) },
  'P-6': { fail: () => makeConfig(['bt_inquiry', 'bt_page', 'bt_a2dp', 'bt_avrcp_hid', 'le_adv_legacy', 'le_scan_passive', 'le_conn_central', 'le_mesh', 'bt_role_supervision']), pass: () => base() },
  'P-7': { fail: () => makeConfig([['wifi_ul_burst', { channel: 6 }], ['wifi_web', { channel: 11 }]]), pass: () => makeConfig([['wifi_ul_burst', { channel: 6 }], ['wifi_web', { channel: 6 }]]) },
  'R-1': { fail: () => makeConfig([['bt_esco', { intervalSlots: 4, retxWindowSlots: 2 }], ['bt_esco', { intervalSlots: 4, retxWindowSlots: 2, offsetSlots: 2 }]], { maxEscoLinks: 2 }), pass: () => makeConfig(['bt_esco']) },
  'R-2': { fail: () => makeConfig([['bt_esco', { intervalSlots: 12, retxWindowSlots: 8 }]]), pass: () => makeConfig(['bt_esco']) },
  'R-3': { fail: () => makeConfig([['wifi_video_stream', { bitrateMbps: 1000 }]]), pass: () => makeConfig(['wifi_video_stream']) },
  'R-4': { fail: () => makeConfig([['wifi_video_stream', { bitrateMbps: 235 }]]), pass: () => makeConfig(['wifi_video_stream']) },
  'R-5': { fail: () => makeConfig(['bt_a2dp'], { coreCount: 1, coreMode: 'TIME_DIVISION', simultaneousWifiTxBtRx: true }), pass: () => makeConfig(['bt_a2dp'], { simultaneousWifiTxBtRx: false }) },
  'F-1': { fail: () => makeConfig(['bt_a2dp'], { femArrangement: 'SEPARATE', antennaMode: 'SHARED' }), pass: () => base() },
  'F-2': { fail: () => makeConfig(['bt_a2dp'], { isolationDb: 150 }), pass: () => base() },
  'F-3': { fail: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], { ...sepConcurrent, isolationDb: 10 }), pass: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], sepConcurrent) },
  'F-4': { fail: () => makeConfig(['bt_a2dp'], { afhEnabled: true }), pass: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], { afhEnabled: true }) },
  'F-5': { fail: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], { afhEnabled: true, afhMinChannelsClassic: 79 }), pass: () => makeConfig(['bt_a2dp', 'wifi_video_stream'], { afhEnabled: true }) },
  'F-6': { fail: () => makeConfig(['bt_a2dp'], { arbitrationPolicy: 'TIME_SHARE', timeShareBtPercent: 0 }), pass: () => makeConfig(['bt_a2dp'], { arbitrationPolicy: 'TIME_SHARE' }) },
  'W-1': { fail: () => makeConfig(['bt_inquiry_scan']), pass: () => base() },
  'W-2': { fail: () => makeConfig([['wifi_ul_burst', { bitrateMbps: 2000, aggregationBytes: 1500 }]], { windowUs: 10_000_000 }), pass: () => base() },
  'W-3': { fail: () => makeConfig([['wifi_ul_burst', { bitrateMbps: 200, aggregationBytes: 1500 }]], { windowUs: 1_000_000 }), pass: () => base() },
};

describe('VAL-10: every rule has one failing and one passing configuration', () => {
  it('covers every rule id in the rules file', () => {
    expect(Object.keys(cases).sort()).toEqual(data.rules.map((r) => r.id).sort());
  });

  describe.each(Object.keys(cases))('%s', (id) => {
    const c = cases[id];
    const severity = data.rules.find((r) => r.id === id)!.severity;
    it('fires on the failing configuration', () => {
      const d = freshData();
      c.data?.(d);
      const issues = validate(c.fail(d), d);
      const hit = issues.find((i) => i.id === id);
      expect(hit, `issues: ${ids(issues).join(',')}`).toBeDefined();
      if (id !== 'T-5') expect(hit!.severity).toBe(severity);
    });
    it('stays silent on the passing configuration', () => {
      const d = freshData();
      c.data?.(d);
      const issues = validate(c.pass(d), d);
      expect(ids(issues), `issues: ${ids(issues).join(',')}`).not.toContain(id);
    });
  });
});

describe('data-driven rules and tasks', () => {
  it('a new Wi-Fi task with a minimum generation is gated by T-1 with no code change', () => {
    const d = freshData();
    const extra: TaskDef = { ...structuredClone(d.taskIndex.get('wifi_web')!), id: 'wifi_new', name: 'New Wi-Fi 6 thing', minVersion: 5 };
    d.tasks.push(extra);
    d.taskIndex.set(extra.id, extra);
    expect(has(makeConfig(['wifi_new'], { wifiGeneration: '11n' }, d), 'T-1', d)).toBe(true);
    expect(has(makeConfig(['wifi_new'], { wifiGeneration: '11ax' }, d), 'T-1', d)).toBe(false);
  });
});

// Keep the type import used.
export type _Unused = TaskDef;
