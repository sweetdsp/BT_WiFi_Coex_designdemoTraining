import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { defaultData as data, defaultPlatform } from '../src/engine/data';
import { estimateLoad } from '../src/engine/estimate';
import { defaultParams, paramValueValid } from '../src/engine/params';
import { lookupConstant } from '../src/engine/timing/refs';
import type { TaskDef } from '../src/engine/types';

const GENERATORS = ['PERIODIC_EVENT', 'SLOT_SCHEDULE', 'BURST_TRAIN', 'WINDOWED_LISTEN', 'SCAN_SWEEP', 'IRREGULAR_BURSTS', 'ONE_SHOT_EXCHANGE'];

function walk(v: unknown, fn: (key: string, value: unknown) => void, key = ''): void {
  fn(key, v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, fn, k);
}

describe('task catalogue data', () => {
  it('has the Bluetooth and Wi-Fi tasks listed in spec 6.2', () => {
    expect(data.tasks.filter((t) => t.category === 'CLASSIC')).toHaveLength(11);
    expect(data.tasks.filter((t) => t.category === 'LE')).toHaveLength(15);
    expect(data.tasks.filter((t) => t.category === 'WIFI')).toHaveLength(20);
    expect(new Set(data.tasks.map((t) => t.id)).size).toBe(data.tasks.length);
  });

  describe.each(data.tasks.map((t) => [t.id, t] as [string, TaskDef]))('%s', (_id, t) => {
    it('uses a known pattern generator, priority class and retry rule', () => {
      expect(GENERATORS).toContain(t.generator);
      expect(data.priorityTable.classes[t.priorityClass]).toBeDefined();
      expect(['NONE', 'NEXT_SLOT_PAIR', 'ESCO_WINDOW', 'BLE_NEXT_PACKET_OR_EVENT', 'WIFI_BACKOFF']).toContain(t.retry);
      expect(t.roles.length).toBeGreaterThan(0);
    });

    it('has parameters whose defaults are valid and labelled', () => {
      for (const [name, p] of Object.entries(t.params)) {
        expect(paramValueValid(p, p.default), `${name} default`).toBe(true);
        expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(p.spec);
        if (p.type === 'number') expect(p.min! <= p.max!).toBe(true);
      }
    });

    it('resolves every reference in its pattern to a parameter, constant or table entry', () => {
      const params = defaultParams(t);
      walk(t.pattern, (key, v) => {
        if (typeof v === 'string' && v.startsWith('$')) expect(params[v.slice(1)], `${key}=${v}`).toBeDefined();
        if (typeof v === 'string' && v.startsWith('@')) expect(() => lookupConstant(v.slice(1), data), v).not.toThrow();
        if (key.endsWith('Param') && typeof v === 'string') expect(t.params[v], `${key}=${v}`).toBeDefined();
        if (key === 'bt' && typeof v === 'string') {
          const keys = v.startsWith('$') ? (t.params[v.slice(1)].choices ?? []).map(String) : [v];
          for (const k of keys) expect(data.btPackets[k], `packet ${k}`).toBeDefined();
        }
        if (key === 'phy' && typeof v === 'string') {
          const keys = v.startsWith('$') ? (t.params[v.slice(1)].choices ?? []).map(String) : [v];
          for (const k of keys) expect(data.blePhy.phys[k], `phy ${k}`).toBeDefined();
        }
      });
    });

    it('anchors carry a spec basis, a miss cost and a tolerated-miss count', () => {
      if (!t.anchor) return;
      expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(t.anchor.basis);
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(t.anchor.missCost);
      expect(t.anchor.toleratedMisses).toBeGreaterThanOrEqual(0);
      if (t.anchor.supervisionParam) expect(t.params[t.anchor.supervisionParam]).toBeDefined();
    });

    it('expands to a positive load estimate using only its pattern fields', () => {
      const e = estimateLoad(t, defaultParams(t), data, { ...defaultPlatform(data), windowUs: 1_000_000 }, 1_000_000);
      expect(e.blocks).toBeGreaterThan(0);
      expect(e.airtimeUs).toBeGreaterThan(0);
    });
  });
});

describe('vendor neutrality (spec NFR-6)', () => {
  it('data and source files contain no vendor or employer names', () => {
    const banned = /\b(broadcom|qualcomm|synaptics|intel|mediatek|realtek|marvell|nordic|texas instruments|cypress|infineon|apple|samsung|airoha|bluez)\b/i;
    const dirs = ['src/data', 'src/engine'];
    const files: string[] = [];
    const scan = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) scan(p); else files.push(p); } };
    dirs.forEach(scan);
    for (const f of files) expect(banned.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
});

describe('priority table data', () => {
  it('lists the base order of spec 7A.8, highest first', () => {
    const order = ['VOICE_LINK', 'ISO_AUDIO', 'BLE_CONN', 'WIFI_CONF', 'WIFI_STREAM', 'WIFI_INTERACTIVE', 'A2DP', 'BT_SCAN_ADV', 'WIFI_BULK', 'WIFI_BACKGROUND'];
    const base = data.priorityTable.classes;
    for (let i = 1; i < order.length; i++) expect(base[order[i - 1]].base).toBeGreaterThan(base[order[i]].base);
  });
  it('makes A2DP critical at 4 packets, equal to isochronous audio priority', () => {
    const rule = data.priorityTable.escalation.find((e) => e.id === 'A2DP_BUFFER')!;
    expect(rule.criticalThreshold).toBe(4);
    expect(rule.criticalPriority).toBe(data.priorityTable.classes.ISO_AUDIO.base);
  });
});
