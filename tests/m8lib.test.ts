import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/engine/data';
import { runEngine } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import { validate } from '../src/engine/validator';
import { canRedo, canUndo, createHistory, MAX_HISTORY, pushState, redo, undo } from '../src/lib/history';
import { configFromObject, parseScenario, serializeScenario } from '../src/lib/scenarioFile';
import { decodeShare, encodeShare, shareFromHash, shareHash } from '../src/lib/shareLink';
import { blocksCsv, CSV_COLUMNS, csvCell, parseCsv } from '../src/lib/csv';
import { diffConfigs, diffMetrics } from '../src/lib/compare';
import { taskSupport, valueSupport, wifiOptions } from '../src/lib/support';
import { makeConfig } from './helpers';

const d = defaultData;
const ids = d.presets.map((p) => p.id);
const errs = (c: Parameters<typeof validate>[0]) => validate(c, d).filter((i) => i.severity === 'ERROR');

describe('history', () => {
  it('undoes and redoes, skips identical states, and clears redo on a new change', () => {
    let h = createHistory(1);
    h = pushState(h, 2, 'two'); h = pushState(h, 2, 'again'); h = pushState(h, 3, 'three');
    expect(h.past.length).toBe(2);
    h = undo(h); expect(h.present.state).toBe(2); expect(canRedo(h)).toBe(true);
    h = redo(h); expect(h.present.state).toBe(3);
    h = undo(undo(h)); expect(canUndo(h)).toBe(false); expect(undo(h)).toBe(h);
    h = pushState(h, 9, 'nine'); expect(canRedo(h)).toBe(false);
  });
  it('caps its length', () => {
    let h = createHistory(0);
    for (let i = 1; i < MAX_HISTORY + 20; i++) h = pushState(h, i, 'x');
    expect(h.past.length).toBe(MAX_HISTORY);
  });
});

describe('scenario file', () => {
  it.each(ids)('round-trips %s exactly', (id) => {
    const cfg = presetConfig(id, d);
    const r = parseScenario(serializeScenario(cfg), d);
    expect(r.problems).toEqual([]); expect(r.notices).toEqual([]);
    expect(r.config).toEqual(cfg);
  });
  it('reports missing fields as notices, never silently', () => {
    const o = JSON.parse(serializeScenario(presetConfig('example-1', d)));
    delete o.platform.guardMHz; delete o.tasks[0].params.packetType;
    const r = configFromObject(o, d);
    expect(r.notices.length).toBe(2);
    expect(r.config!.platform.guardMHz).toBeDefined();
  });
  it('VAL-6: an edited invalid value loads but is flagged by the validator', () => {
    const o = JSON.parse(serializeScenario(presetConfig('example-1', d)));
    o.tasks[0].params.bitrateKbps = 99999999;
    const r = parseScenario(JSON.stringify(o), d);
    expect(r.config).toBeDefined();
    expect(errs(r.config!).length).toBeGreaterThan(0);
    expect(() => runEngine(r.config!, d)).toThrow();
  });
  it('rejects non-scenarios in plain language', () => {
    expect(parseScenario('{nope', d).problems[0]).toMatch(/not valid JSON/);
    expect(parseScenario('[]', d).problems.length).toBe(1);
    expect(parseScenario('{"format":"other","tasks":[],"platform":{}}', d).problems[0]).toMatch(/does not look like/);
    expect(parseScenario('{"version":9,"tasks":[],"platform":{}}', d).problems[0]).toMatch(/newer version/);
    expect(parseScenario('{"platform":{}}', d).problems[0]).toMatch(/no list of tasks/);
  });
  it('gives unique ids to duplicated instance ids', () => {
    const o = JSON.parse(serializeScenario(presetConfig('example-1', d)));
    o.tasks[1].instanceId = o.tasks[0].instanceId;
    const r = configFromObject(o, d);
    expect(new Set(r.config!.tasks.map((t) => t.instanceId)).size).toBe(2);
  });
});

describe('share link', () => {
  it.each(ids)('round-trips %s and gives the same engine result', (id) => {
    const cfg = presetConfig(id, d);
    const r = decodeShare(encodeShare(cfg, d), d);
    expect(r.problems).toEqual([]);
    expect(r.config!.platform).toEqual(cfg.platform);
    expect(r.config!.tasks.map((t) => [t.taskId, t.params])).toEqual(cfg.tasks.map((t) => [t.taskId, t.params]));
    expect(runEngine(r.config!, d).metrics).toEqual(runEngine(cfg, d).metrics);
  });
  it('stays short and uses only url-safe characters', () => {
    const s = encodeShare(presetConfig('example-1', d), d);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/); expect(s.length).toBeLessThan(600);
  });
  it('handles tampered strings without throwing', () => {
    for (const bad of ['', '!!!', 'abc', btoa('{"t":5}'), btoa('null'), btoa('{"v":1,"t":[["nope"]]}')]) {
      const r = decodeShare(bad, d);
      if (r.config) expect(errs(r.config).length).toBeGreaterThan(0); else expect(r.problems.length).toBeGreaterThan(0);
    }
  });
  it('reads the hash and keeps unicode names', () => {
    const cfg = { ...presetConfig('example-1', d), name: 'Größe µs ✓' };
    const h = shareHash(cfg, d);
    expect(decodeShare(shareFromHash(h)!, d).config!.name).toBe(cfg.name);
    expect(shareFromHash('#other=1')).toBeNull();
  });
});

describe('csv', () => {
  it('escapes cells', () => { expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""'); expect(csvCell(undefined)).toBe(''); });
  it('round-trips every block', () => {
    const r = runEngine(presetConfig('example-1', d), d);
    const rows = parseCsv(blocksCsv(r));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.length).toBe(r.blocks.length + 1);
    expect(rows.every((x) => x.length === CSV_COLUMNS.length)).toBe(true);
    const i = CSV_COLUMNS.indexOf('block_id');
    expect(rows.slice(1).map((x) => x[i])).toEqual(r.blocks.map((b) => b.id));
  });
});

describe('compare', () => {
  it('shows improvement with arrow and words', () => {
    const a = runEngine(presetConfig('example-1', d), d).metrics, b = runEngine(presetConfig('example-2', d), d).metrics;
    const rows = diffMetrics(a, b);
    const hard = rows.find((x) => x.key === 'hard')!;
    expect(hard.verdict).toBe('BETTER'); expect(hard.arrow).toBe('▲'); expect(hard.text).toMatch(/^improved: 20 → 0/);
    const back = diffMetrics(b, a).find((x) => x.key === 'hard')!;
    expect(back.verdict).toBe('WORSE'); expect(back.arrow).toBe('▼');
    expect(diffMetrics(a, a).every((x) => x.verdict === 'SAME')).toBe(true);
  });
  it('lists changed settings', () => {
    const a = presetConfig('example-1', d), b = presetConfig('example-2', d);
    const ch = diffConfigs(a, b, d);
    expect(ch.some((c) => /isolation|antenna/i.test(c.what))).toBe(true);
    expect(diffConfigs(a, a, d)).toEqual([]);
    const c = makeConfig(['bt_a2dp'], {}, d);
    expect(diffConfigs(c, makeConfig(['bt_a2dp', 'wifi_video_stream'], {}, d), d)[0].what).toBe('Task added');
  });
});

describe('support', () => {
  it('greys out tasks the device version cannot do', () => {
    const iso = d.tasks.find((t) => t.isoStream)!;
    const p = presetConfig('example-1', d).platform;
    expect(taskSupport(iso, { ...p, btMaxVersion: 5.0 }, d).ok).toBe(false);
    expect(taskSupport(iso, { ...p, btMaxVersion: 5.4 }, d).ok).toBe(true);
  });
  it('limits Wi-Fi options by generation', () => {
    const p = presetConfig('example-1', d).platform;
    expect(wifiOptions({ ...p, wifiGeneration: '11n', wifiBand: '2.4' }, d).bandwidths).not.toContain(160);
    expect(wifiOptions({ ...p, wifiGeneration: '11n' }, d).bands).not.toContain('6');
  });
  it('gates PHY values', () => {
    const def = d.tasks.find((t) => Object.values(t.params).some((x) => x.isPhy))!;
    const name = Object.keys(def.params).find((k) => def.params[k].isPhy)!;
    const p = presetConfig('example-1', d).platform;
    const results = (def.params[name].choices ?? []).map((c) => valueSupport(def, name, c, { ...p, btMaxVersion: 4.0 }, d).ok);
    expect(results).toContain(true);
  });
});

describe('priority overrides', () => {
  it('change the engine result and are validated', () => {
    const cfg = presetConfig('example-1', d);
    const base = runEngine(cfg, d);
    const lowered = runEngine({ ...cfg, overrides: { bufferThreshold: { bt_a2dp: 1 } } }, d);
    expect(JSON.stringify(lowered.decisions)).not.toBe(JSON.stringify(base.decisions));
    const cls = Object.keys(d.priorityTable.classes)[0];
    expect(errs({ ...cfg, overrides: { base: { [cls]: 99999 } } }).length).toBeGreaterThan(0);
    expect(errs({ ...cfg, overrides: { bufferThreshold: { bt_a2dp: 0 } } }).length).toBeGreaterThan(0);
    expect(errs({ ...cfg, overrides: { base: { [cls]: 50 } } }).length).toBe(0);
  });
  it('is deterministic and does not mutate the shared data', () => {
    const cfg = { ...presetConfig('example-1', d), overrides: { bufferThreshold: { bt_a2dp: 2 } } };
    const before = JSON.stringify(d.tasks);
    const a = runEngine(cfg, d), b = runEngine(cfg, d);
    expect(a.metrics).toEqual(b.metrics);
    expect(JSON.stringify(d.tasks)).toBe(before);
  });
});

import { addTask, applyPlatformPreset, applyUseCase, clearTasks, gateOf, issuesFor, removeTask, setOverride, setParam, setPlatform } from '../src/lib/draft';
describe('draft editing', () => {
  const empty = { ...makeConfig([], {}, d), tasks: [] };
  it('adds tasks with unique ids and defaults, and removes them', () => {
    let c = addTask(addTask(empty, 'bt_a2dp', d), 'bt_a2dp', d);
    expect(new Set(c.tasks.map((t) => t.instanceId)).size).toBe(2);
    c = removeTask(c, 't1'); expect(addTask(c, 'bt_a2dp', d).tasks.map((t) => t.instanceId)).toEqual(['t2', 't3']);
    expect(addTask(empty, 'nope', d)).toBe(empty);
    expect(clearTasks(c).tasks).toEqual([]);
  });
  it('does not mutate its input', () => {
    const c = addTask(empty, 'bt_a2dp', d); const s = JSON.stringify(c);
    setParam(c, 't1', 'bitrateKbps', 1); setPlatform(c, 'isolationDb', 1); removeTask(c, 't1');
    expect(JSON.stringify(c)).toBe(s);
  });
  it('keeps antenna mode in step with the front end', () => {
    const c = setPlatform(empty, 'femArrangement', 'SEPARATE'); expect(c.platform.antennaMode).toBe('SEPARATE');
    expect(setPlatform(c, 'femArrangement', 'SHARED_SWITCH').platform.antennaMode).toBe('SHARED');
  });
  it('applies use cases and platform presets', () => {
    for (const u of d.useCases) { const c = applyUseCase(empty, u.id, d); expect(c.tasks.length).toBe(u.tasks.length); }
    const p = applyPlatformPreset(empty, 'dual-antenna-phone', d); expect(p.platform.coreMode).toBe('CONCURRENT');
  });
  it('every use case validates without errors on the default platform', () => {
    for (const u of d.useCases) expect(errs(applyUseCase(empty, u.id, d)).map((e) => e.id)).toEqual([]);
  });
  it('sets and clears overrides', () => {
    const a = setOverride(empty, 'bufferThreshold', 'bt_a2dp', 3); expect(a.overrides).toEqual({ bufferThreshold: { bt_a2dp: 3 } });
    expect(setOverride(a, 'bufferThreshold', 'bt_a2dp', undefined).overrides).toBeUndefined();
  });
  it('gate: errors block, warnings need confirmation, empty blocks', () => {
    expect(gateOf([], 0).badge).toBe('EMPTY'); expect(gateOf([], 0).canGenerate).toBe(false);
    const bad = presetConfig('example-1', d); bad.tasks[0].params.bitrateKbps = 1e9;
    const g = gateOf(validate(bad, d), 2); expect(g.canGenerate).toBe(false); expect(g.badge).toBe('ERRORS');
    expect(issuesFor(validate(bad, d), { instanceId: 't1' }).length).toBeGreaterThan(0);
    expect(gateOf(validate(presetConfig('example-1', d), d), 2).canGenerate).toBe(true);
  });
});
