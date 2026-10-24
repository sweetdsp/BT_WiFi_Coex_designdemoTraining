import { describe, expect, it } from 'vitest';
import metricsHelp from '../src/data/metricsHelp.json';
import { defaultData as data } from '../src/engine/data';
import { runEngine, type EngineResult } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import { applyChanges } from '../src/engine/validator';
import { makeCtx } from '../src/lib/context';
import { activeAt, readoutAt, readoutText } from '../src/lib/cursor';
import { conflictList, explainConflict, neighbour } from '../src/lib/explanation';
import { channelTip, freqModel, HIGH_BAND_CAPTION } from '../src/lib/freq';
import { bandsFor, buildLanes, densityBars, inView, labelFor, lodMode, lookOf, minimapTicks, partnersOf } from '../src/lib/layout';
import { activityAt, platformModel, sharedElementFor } from '../src/lib/platform';
import { advance, eventTimes, nextEvent, prevEvent, replaySteps, revealed, SPEEDS } from '../src/lib/playback';
import { summaryItems, taskRows } from '../src/lib/summary';
import { blockTip, conflictTip, legendTip, metricTip } from '../src/lib/tooltips';
import { tokens } from '../src/lib/tokens';
import { clampViewport, MIN_SPAN_US, pan, presetViewport, slotLines, span, timeTicks, zoomAt } from '../src/lib/viewport';
import { makeConfig } from './helpers';

const results = new Map<number, EngineResult>();
const ex = (n: number) => { if (!results.has(n)) results.set(n, runEngine(presetConfig(`example-${n}`, data), data)); return results.get(n)!; };

describe('viewport: zoom and pan (7B.4)', () => {
  const W = 1_000_000;
  it('clamps to the window and to the 50 microsecond minimum span', () => {
    expect(clampViewport({ start: -5, end: 100 }, W)).toEqual({ start: 0, end: 105 });
    expect(clampViewport({ start: 990_000, end: 1_100_000 }, W)).toEqual({ start: 890_000, end: 1_000_000 });
    expect(span(clampViewport({ start: 10, end: 11 }, W))).toBe(MIN_SPAN_US);
    expect(span(clampViewport({ start: 0, end: 5_000_000 }, W))).toBe(W);
  });
  it('zooming keeps the time under the pointer fixed', () => {
    const v = { start: 100_000, end: 300_000 };
    const z = zoomAt(v, 150_000, 0.5, W);
    expect(span(z)).toBe(100_000);
    expect((150_000 - z.start) / span(z)).toBeCloseTo((150_000 - v.start) / span(v), 6);
  });
  it('can zoom from the whole window down to 50 microseconds and back', () => {
    let v = { start: 0, end: W };
    for (let i = 0; i < 60; i++) v = zoomAt(v, 500_000, 0.5, W);
    expect(span(v)).toBe(MIN_SPAN_US);
    for (let i = 0; i < 60; i++) v = zoomAt(v, 500_000, 2, W);
    expect(v).toEqual({ start: 0, end: W });
  });
  it('panning stops at the edges', () => {
    expect(pan({ start: 0, end: 1000 }, -500, W)).toEqual({ start: 0, end: 1000 });
    expect(pan({ start: 0, end: 1000 }, 5000, W)).toEqual({ start: 5000, end: 6000 });
  });
  it('presets: whole window, 10 ms, 1 ms and a single 625 microsecond slot aligned to a slot boundary', () => {
    expect(presetViewport('whole', W, 400_000)).toEqual({ start: 0, end: W });
    expect(span(presetViewport('10ms', W, 400_000))).toBe(10_000);
    expect(span(presetViewport('1ms', W, 400_000))).toBe(1000);
    const s = presetViewport('slot', W, 1300);
    expect(s).toEqual({ start: 1250, end: 1875 });
  });
  it('tick spacing adapts to the zoom level and units change from ms to µs', () => {
    const wide = timeTicks({ start: 0, end: 1_000_000 }, 900);
    const narrow = timeTicks({ start: 1000, end: 1600 }, 900);
    expect(wide.stepUs).toBeGreaterThanOrEqual(50_000);
    expect(wide.ticks[1].label).toMatch(/ms$/);
    expect(narrow.stepUs).toBeLessThan(200);
    expect(narrow.ticks[0].label).toMatch(/µs$/);
  });
  it('slot boundaries with numbers appear only when zoomed in far enough', () => {
    expect(slotLines({ start: 0, end: 1_000_000 }, 900)).toHaveLength(0);
    const s = slotLines({ start: 0, end: 3000 }, 900);
    expect(s.map((x) => x.n)).toEqual([0, 1, 2, 3, 4]);
    expect(s[1].t).toBe(625);
  });
});

describe('time view layout (7A.11, 7B.3, 7B.4)', () => {
  const r = ex(1);
  const ctx = makeCtx(r, data);
  it('has Bluetooth lanes above Wi-Fi lanes, one lane per selected task, named', () => {
    const lanes = buildLanes(r, data);
    expect(lanes.bt.map((l) => l.name)).toEqual(['A2DP streaming']);
    expect(lanes.wifi.map((l) => l.name)).toEqual(['Video streaming']);
    expect(lanes.bt[0].help.length).toBeGreaterThan(10);
  });
  it('transmit is solid in the upper half and receive is outlined in the lower half', () => {
    const tx = r.blocks.find((b) => b.dir === 'TX')!, rx = r.blocks.find((b) => b.dir === 'RX')!;
    expect(lookOf(tx)).toMatchObject({ fill: 'SOLID', half: 'TOP' });
    expect(lookOf(rx)).toMatchObject({ fill: 'OUTLINE', half: 'BOTTOM' });
  });
  it('status styling: struck through for lost, hatched for degraded, ghost for delayed, ticks and badges', () => {
    const lost = ex(5).blocks.find((b) => b.status === 'RETRIED')!;
    expect(lookOf(lost)).toMatchObject({ strike: true });
    expect(lookOf(lost).marks).toContain('CROSS');
    const deg = ex(3).blocks.find((b) => b.status === 'DEGRADED')!;
    expect(lookOf(deg)).toMatchObject({ hatch: true });
    expect(lookOf(deg).marks).toContain('TRIANGLE');
    const delayed = r.blocks.find((b) => b.status === 'DELAYED' && b.start !== b.plannedStart)!;
    expect(lookOf(delayed).ghost).toBe(true);
    const tol = ex(2).blocks.find((b) => b.status === 'TOLERATED')!;
    expect(lookOf(tol).marks).toContain('TOLERATED_TICK');
    const won = r.blocks.find((b) => b.status === 'GRANTED' && b.contested && b.decisionId)!;
    expect(lookOf(won).marks).toContain('GRANTED_TICK');
    const retry = ex(5).blocks.find((b) => b.attempt > 1)!;
    expect(lookOf(retry).marks).toContain('RETRY');
    const warn = ex(3).blocks.find((b) => b.warning && !b.corrupted)!;
    expect(lookOf(warn).marks).toContain('EXCLAMATION');
  });
  it('labels follow the order of preference: kind and channel, kind only, nothing', () => {
    const b = r.blocks.find((x) => x.kind === 'DATA' && x.tech === 'BT')!;
    expect(labelFor(b, 200)).toMatch(/^DATA ch\d+$/);
    expect(labelFor(b, 40)).toBe('DATA');
    expect(labelFor(b, 10)).toBe('');
  });
  it('lists only the blocks in view, including the ghost of a delayed block', () => {
    const blocks = r.blocks.filter((b) => !b.optional).sort((a, b) => a.start - b.start);
    const v = { start: 0, end: 3000 };
    const vis = inView(blocks, v);
    expect(vis.length).toBeGreaterThan(0);
    expect(vis.every((b) => b.start < v.end && (b.start + b.duration > v.start || b.plannedStart < v.end))).toBe(true);
    expect(inView(blocks, { start: 5_000_000, end: 6_000_000 })).toHaveLength(0);
  });
  it('merges to density bars when blocks are too small to see and switches back when zoomed in', () => {
    const r3 = runEngine(makeConfig(['bt_inquiry', 'wifi_video_stream'], { windowUs: 1_000_000, femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 }), data);
    const blocks = r3.blocks.filter((b) => !b.optional && b.tech === 'BT').sort((a, b) => a.start - b.start);
    expect(lodMode(inView(blocks, { start: 0, end: 1_000_000 }), { start: 0, end: 1_000_000 }, 900)).toBe('DENSITY');
    expect(lodMode(inView(blocks, { start: 0, end: 20_000 }), { start: 0, end: 20_000 }, 900)).toBe('BLOCKS');
    const bars = densityBars(blocks, { start: 0, end: 1_000_000 }, 900);
    expect(bars.length).toBeGreaterThan(50);
    expect(bars.every((b) => b.pct > 0 && b.pct <= 100)).toBe(true);
    const total = bars.reduce((a, b) => a + (b.pct / 100) * (1_000_000 / Math.ceil(900 / 4)), 0);
    const real = blocks.reduce((a, b) => a + Math.min(b.duration, 1_000_000 - b.start), 0);
    expect(Math.abs(total - real) / real).toBeLessThan(0.02);
  });
  it('conflict bands are numbered like the conflict list and clipped to the view', () => {
    const bands = bandsFor(r.conflicts, { start: 0, end: 100_000 }, 900);
    const inWindow = r.conflicts.filter((c) => c.overlapStart < 100_000);
    expect(bands.length).toBe(inWindow.length);
    expect(bands.map((b) => b.number)).toEqual(inWindow.map((c) => r.conflicts.indexOf(c) + 1));
    expect(bands.every((b) => b.x >= 0 && b.x + b.w <= 902)).toBe(true);
    expect(bandsFor(r.conflicts, { start: 99_000, end: 99_500 }, 900).length).toBeLessThan(bands.length);
  });
  it('the minimap shows a tick per conflict and hovering a block finds its partners', () => {
    expect(minimapTicks(r.conflicts, 100_000, 400)).toHaveLength(r.conflicts.length);
    const c = r.conflicts.find((x) => x.severity === 'HARD')!;
    expect(partnersOf(c.btBlockId, r.conflicts)).toContain(c.wifiBlockId);
    expect(ctx.blockById.size).toBe(r.blocks.length);
  });
});

describe('UX-2: every block type shows a tooltip with every field of 7B.5', () => {
  const required = ['Technology and direction', 'Time', 'Frequency', 'Priority', 'Status', 'Label'];
  const all: [string, EngineResult][] = [1, 2, 3, 4, 5].map((n) => [`Example ${n}`, ex(n)]);
  const extra = runEngine(makeConfig(['bt_esco', ['wifi_bulk', { dutyCyclePct: 90 }]], { arbitrationPolicy: 'WIFI_FAVOURED', windowUs: 100_000 }));
  all.push(['eSCO under Wi-Fi favoured', extra]);

  it.each(all)('%s: all blocks', (_n, r) => {
    const ctx = makeCtx(r, data);
    for (const b of r.blocks.filter((x) => !x.optional)) {
      const t = blockTip(b, ctx);
      expect(t.title.length).toBeGreaterThan(3);
      for (const f of required) expect(t.fields.map((x) => x.label), `${b.id} ${f}`).toContain(f);
      expect(t.fields.find((f) => f.label === 'Time')!.value).toMatch(/start \d+ µs, end \d+ µs, duration \d+ µs/);
      expect(['Standard says', 'Implementations vary']).toContain(t.label);
      expect(t.sentence.length).toBeGreaterThan(10);
      expect(t.learnMore).toBeTruthy();
      if (b.status === 'DELAYED') expect(t.fields.map((x) => x.label)).toContain('Delay');
      if (b.attempt > 1) expect(t.fields.map((x) => x.label)).toContain('Retry');
      if (b.tech === 'BT' && b.chanMode === 'CLASSIC_HOP') expect(t.fields.find((f) => f.label === 'Time')!.value).toMatch(/slot \d+/);
    }
  });
  it('conflict, metric and legend tooltips have their fields', () => {
    const r = ex(1), ctx = makeCtx(r, data);
    const hard = r.conflicts.find((c) => c.severity === 'HARD' && c.decisionId)!;
    const t = conflictTip(hard, r.conflicts.indexOf(hard) + 1, ctx);
    expect(t.title).toMatch(/^Conflict \d+: Hard$/);
    expect(t.fields.map((f) => f.label)).toEqual(['Blocks', 'Overlap', 'Triggered by', 'Winner', 'Label']);
    for (const m of metricsHelp.metrics) expect(metricTip(m.key)!.sentence.length).toBeGreaterThan(40);
    for (const c of tokens.cues) expect(legendTip(c.id)!.fields.map((f) => f.label)).toContain('Example');
  });
});

describe('explanation panel (7B.8)', () => {
  const r = ex(1), ctx = makeCtx(r, data);
  const hard = r.conflicts.find((c) => c.severity === 'HARD' && c.decisionId)!;
  const e = explainConflict(hard, ctx);
  it('tells the story in the fixed order with labels', () => {
    expect(e.what.text).toMatch(/was (sending|receiving) while .* was (sending|receiving)/);
    expect(e.what.text).toMatch(/share one antenna/);
    expect(e.involved.map((i) => i.role)).toEqual(['Bluetooth', 'Wi-Fi']);
    expect(e.why.tests).toContain('shared antenna');
    expect(e.why.diagram.time.bt[1]).toBeGreaterThan(e.why.diagram.time.bt[0]);
    expect(e.who).not.toBeNull();
    expect(e.who!.priorities).toHaveLength(2);
    expect(e.who!.priorities.every((p) => typeof p.value === 'number')).toBe(true);
    expect(e.who!.winner).toBeTruthy();
    expect(e.means.text.length).toBeGreaterThan(20);
    for (const s of [e.what, e.why, e.who!, e.means]) expect(['Standard says', 'Implementations vary']).toContain(s.label);
  });
  it('offers two or three one-click suggestions, each with a change set', () => {
    expect(e.changes.length).toBeGreaterThanOrEqual(1);
    expect(e.changes.length).toBeLessThanOrEqual(3);
    for (const s of e.changes) { expect(s.changes.length).toBeGreaterThan(0); expect(s.why.length).toBeGreaterThan(10); }
  });
  it('UX-6: applying a suggestion changes the result', () => {
    const sep = e.changes.find((s) => s.id === 'separate-antennas')!;
    const after = runEngine(applyChanges(r.config, sep.changes), data);
    expect(r.metrics.conflicts.bySeverity.HARD).toBeGreaterThan(0);
    expect(after.metrics.conflicts.bySeverity.HARD).toBe(0);
  });
  it('turning on adaptive hopping is suggested for a frequency conflict and cuts the degraded blocks', () => {
    const r3 = ex(3);
    const c = r3.conflicts.find((x) => x.severity === 'DEGRADED')!;
    const s = explainConflict(c, makeCtx(r3, data)).changes.find((x) => x.id === 'afh-on')!;
    expect(s).toBeDefined();
    const after = runEngine(applyChanges(r3.config, s.changes), data);
    expect(after.metrics.conflicts.bySeverity.DEGRADED).toBeLessThan(r3.metrics.conflicts.bySeverity.DEGRADED / 4);
  });
  it('a tolerated conflict needs no arbitration and says so', () => {
    const r2 = ex(2);
    const x = explainConflict(r2.conflicts[0], makeCtx(r2, data));
    expect(x.who).toBeNull();
    expect(x.severity).toBe('TOLERATED');
  });
  it('every conflict of every example can be explained', () => {
    for (const n of [1, 2, 3, 4, 5]) { const rr = ex(n), c2 = makeCtx(rr, data); for (const c of rr.conflicts) expect(explainConflict(c, c2).what.text.length).toBeGreaterThan(20); }
  });
  it('the conflict list sorts by time, severity and task, filters hard conflicts, and next/previous wrap around', () => {
    const r3 = ex(3), c3 = makeCtx(r3, data);
    const byTime = conflictList(c3, 'time', false);
    expect(byTime.map((x) => x.conflict.overlapStart)).toEqual([...byTime.map((x) => x.conflict.overlapStart)].sort((a, b) => a - b));
    const bySev = conflictList(c3, 'severity', false).map((x) => x.conflict.severity);
    expect(bySev[0]).toBe('DEGRADED');
    expect(conflictList(makeCtx(r, data), 'time', true).every((x) => x.conflict.severity === 'HARD')).toBe(true);
    expect(conflictList(c3, 'task', false).length).toBe(r3.conflicts.length);
    const list = conflictList(makeCtx(r, data), 'time', false);
    expect(neighbour(list, undefined, 1)).toBe(list[0].conflict.id);
    expect(neighbour(list, list[0].conflict.id, -1)).toBe(list[list.length - 1].conflict.id);
    expect(neighbour(list, list[list.length - 1].conflict.id, 1)).toBe(list[0].conflict.id);
  });
});

describe('frequency view (7A.11, 7B.6)', () => {
  it('shows the Wi-Fi footprint with its guard, hops, circled hops and a histogram', () => {
    const r = ex(3), m = freqModel(makeCtx(r, data), null);
    expect(m.footprints).toHaveLength(1);
    expect(m.footprints[0]).toMatchObject({ low: 2427, high: 2447, guardLow: 2426, guardHigh: 2448, channel: 6 });
    expect(m.hops.length).toBeGreaterThan(100);
    expect(m.circled).toBeGreaterThan(0);
    expect(m.histogram).toHaveLength(79);
    expect(m.histogram.filter((h) => h.inFootprint)).toHaveLength(23);
    expect(m.histogram.reduce((a, h) => a + h.count, 0)).toBeGreaterThan(50);
  });
  it('the adaptive hopping map greys out the removed channels', () => {
    const m = freqModel(makeCtx(ex(4), data), null);
    expect(m.afhStrip.filter((c) => c.removed)).toHaveLength(23);
    expect(m.afh.enabled).toBe(true);
    expect(freqModel(makeCtx(ex(3), data), null).afhStrip.some((c) => c.removed)).toBe(false);
  });
  it('can be limited to a time range', () => {
    const r = ex(3);
    const all = freqModel(makeCtx(r, data), null).hops.length;
    const part = freqModel(makeCtx(r, data), [0, 100_000]).hops;
    expect(part.length).toBeLessThan(all);
    expect(part.every((h) => h.t <= 100_000)).toBe(true);
  });
  it('after the AFH delay no hop is circled inside the footprint', () => {
    const m = freqModel(makeCtx(ex(4), data), [100_000, 1_000_000]);
    expect(m.hops.filter((h) => h.freq >= 2426 && h.freq <= 2448)).toHaveLength(0);
    expect(m.circled).toBe(0);
  });
  it('channel tooltips give number, centre frequency, map membership and hop count', () => {
    const m = freqModel(makeCtx(ex(4), data), null);
    const t = channelTip(m, 30, 2402);
    expect(t.title).toBe('Channel 30, 2432 MHz');
    expect(t.lines[0]).toMatch(/removed/);
    expect(t.lines[1]).toMatch(/\d+ hops landed here/);
    expect(channelTip(freqModel(makeCtx(ex(3), data), null), 30, 2402).lines[0]).toMatch(/Adaptive hopping is off/);
  });
  it('5 GHz Wi-Fi gets its own panel with the required caption', () => {
    const r = runEngine(makeConfig(['bt_a2dp', 'wifi_video_stream'], { wifiBand: '5', wifiChannel: 36, windowUs: 100_000 }), data);
    const m = freqModel(makeCtx(r, data), null);
    expect(m.footprints).toHaveLength(0);
    expect(m.highBands).toHaveLength(1);
    expect(m.highBands[0]).toMatchObject({ band: '5', centre: 5180, widthMHz: 20, caption: HIGH_BAND_CAPTION });
    expect(HIGH_BAND_CAPTION).toBe('No frequency overlap with Bluetooth. Interaction is only through shared antenna, core, and isolation.');
  });
});

describe('platform diagram (7B.7)', () => {
  it('draws a combo core, switch and one antenna for a shared single-core platform', () => {
    const m = platformModel(ex(1).config.platform);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['antenna', 'comboCore', 'fem']);
    expect(m.isolationLabel).toBeUndefined();
  });
  it('draws two cores, two antennas and the isolation for a separate platform', () => {
    const m = platformModel(ex(3).config.platform);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['btAntenna', 'btCore', 'wifiAntenna', 'wifiCore']);
    expect(m.isolationLabel!.text).toBe('isolation 10 dB');
  });
  it('a diplexer is named as such, and every node has help text', () => {
    const p = { ...ex(1).config.platform, femArrangement: 'SHARED_DIPLEXER' as const };
    const m = platformModel(p);
    expect(m.nodes.find((n) => n.id === 'fem')!.label).toBe('Diplexer');
    expect(m.nodes.find((n) => n.id === 'fem')!.help).toMatch(/diplexer/i);
    for (const n of m.nodes) expect(n.help.length).toBeGreaterThan(30);
  });
  it('active paths follow the cursor and a conflict stresses the shared element', () => {
    const r = ex(1);
    const hard = r.conflicts.find((c) => c.severity === 'HARD')!;
    const both = r.conflicts.find((c) => c.severity === 'TOLERATED' && r.blocks.find((b) => b.id === c.btBlockId)!.start <= c.overlapStart && r.blocks.find((b) => b.id === c.wifiBlockId)!.start <= c.overlapStart)!;
    const a = activityAt(r, both.overlapStart + 1, hard);
    expect(a.activeTech.BT && a.activeTech.WIFI).toBe(true);
    expect(a.active.has('antenna')).toBe(true);
    expect(a.sharedElement).toBe('antenna');
    const idle = activityAt(r, 99_999_999);
    expect(idle.active.size).toBe(0);
    expect(sharedElementFor({ ...hard, tests: ['TIME', 'ISOLATION'] }, ex(3).config.platform)).toBe('isolation');
    expect(sharedElementFor({ ...hard, tests: ['TIME', 'FREQUENCY'] }, ex(3).config.platform)).toBe('air');
  });
});

describe('cursor readout and playback (7B.4, 7B.9)', () => {
  const r = ex(1);
  it('reads out the time and the channels active at that instant', () => {
    const b = r.blocks.find((x) => x.tech === 'BT' && x.status !== 'DELAYED' && !x.optional)!;
    const t = b.start + 5;
    const ro = readoutAt(r, t);
    expect(ro.btChannel).toEqual({ index: b.channelIndex, mhz: b.freqCenter });
    expect(readoutText(ro)).toMatch(/Bluetooth channel \d+ \(\d+ MHz\)/);
    expect(readoutAt(r, 99_999_999).btChannel).toBeUndefined();
    expect(activeAt(r, t).length).toBeGreaterThan(0);
  });
  it('steps to the next and previous event', () => {
    const times = eventTimes(r);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(times[0]).toBe(Math.min(...r.blocks.filter((b) => !b.optional).map((b) => b.start), ...r.conflicts.map((c) => c.overlapStart)));
    expect(nextEvent(times, times[0])).toBe(times[1]);
    expect(prevEvent(times, times[2])).toBe(times[1]);
    expect(prevEvent(times, times[0])).toBeUndefined();
    expect(nextEvent(times, times[times.length - 1])).toBeUndefined();
    for (const c of r.conflicts) expect(times).toContain(c.overlapStart);
  });
  it('speeds are 0.1x, 0.5x, 1x and 5x, and playback ends at the end of the window', () => {
    expect([...SPEEDS]).toEqual([0.1, 0.5, 1, 5]);
    expect(advance(0, 1000, 1, 100_000).t).toBe(10_000);
    expect(advance(0, 1000, 5, 100_000).t).toBe(50_000);
    expect(advance(0, 1000, 0.1, 100_000).t).toBe(1_000);
    expect(advance(99_000, 5000, 1, 100_000)).toEqual({ t: 100_000, done: true });
  });
  it('conflict replay has four captioned steps; playback only reveals, never changes results', () => {
    const c = r.conflicts.find((x) => x.severity === 'HARD')!;
    const steps = replaySteps(c, { bt: 'A2DP streaming', wifi: 'Video streaming' }, 'Video streaming', 'A2DP was delayed.');
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(steps.every((s) => s.caption.length > 10)).toBe(true);
    expect(steps[0].showDecision).toBe(false);
    expect(steps[3].showOutcome).toBe(true);
    const before = JSON.stringify(r.blocks);
    revealed(100, 50, true);
    expect(JSON.stringify(r.blocks)).toBe(before);
    expect(revealed(100, 50, true)).toBe(false);
    expect(revealed(100, 150, true)).toBe(true);
    expect(revealed(100, 50, false)).toBe(true);
  });
});

describe('summary strip (7A.11)', () => {
  it('lists the metrics with values, bars where useful, and a help text for every one', () => {
    const items = summaryItems(ex(5).metrics);
    expect(items.map((i) => i.key)).toEqual(['airtime', 'overlap', 'conflicts', 'blocksDelayed', 'blocksRetried', 'blocksLost', 'blocksTolerated', 'throughputImpact', 'undelivered', 'latency', 'anchorsHit', 'longestMissRun', 'supervisionMargin']);
    const helpKeys = new Set(metricsHelp.metrics.map((m) => m.key));
    for (const i of items) expect(helpKeys.has(i.key), i.key).toBe(true);
    expect(items.find((i) => i.key === 'anchorsHit')!.value).toBe('18 / 16');
    expect(items.every((i) => i.value.length > 0)).toBe(true);
    for (const i of items) if (i.bar) expect(i.bar.fraction).toBeGreaterThanOrEqual(0), expect(i.bar.fraction).toBeLessThanOrEqual(1);
  });
  it('has a per-task table', () => {
    const rows = taskRows(ex(1).metrics);
    expect(rows.map((r) => r.name)).toEqual(['A2DP streaming', 'Video streaming']);
    expect(rows[0].tech).toBe('Bluetooth');
    expect(rows[1].impact).toMatch(/%$/);
  });
});
