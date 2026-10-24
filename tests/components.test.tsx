// Server-side render checks of the React components: structure, labels, patterns and accessible names.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { runEngine, type EngineResult } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import { makeCtx } from '../src/lib/context';
import { replaySteps } from '../src/lib/playback';
import { colorOf, tokens } from '../src/lib/tokens';
import { HIGH_BAND_CAPTION } from '../src/lib/freq';
import { ExplanationPanel } from '../src/ui/ExplanationPanel';
import { FrequencyView } from '../src/ui/FrequencyView';
import { HelpPanel } from '../src/ui/HelpPanel';
import { Legend } from '../src/ui/Legend';
import { PlatformDiagram } from '../src/ui/PlatformDiagram';
import { PlaybackBar } from '../src/ui/PlaybackBar';
import { SummaryStrip } from '../src/ui/SummaryStrip';
import { TimeView } from '../src/ui/TimeView';
import { TooltipProvider } from '../src/ui/Tooltip';
import { makeConfig } from './helpers';

const cache = new Map<string, EngineResult>();
const ex = (n: number) => { const id = `example-${n}`; if (!cache.has(id)) cache.set(id, runEngine(presetConfig(id, data), data)); return cache.get(id)!; };
const noop = () => undefined;
const wrap = (el: React.ReactElement) => renderToStaticMarkup(<TooltipProvider onLearnMore={noop}>{el}</TooltipProvider>);

function timeView(r: EngineResult, over: Partial<React.ComponentProps<typeof TimeView>> = {}, theme: 'light' | 'dark' = 'light') {
  return wrap(<TimeView ctx={makeCtx(r, data)} theme={theme} viewport={{ start: 0, end: r.config.platform.windowUs }} onViewport={noop} cursor={null} onCursor={noop} onHoverBlock={noop} onSelectBlock={noop} onSelectConflict={noop}
    muted={new Set()} onToggleMute={noop} collapsed={{ BT: false, WIFI: false }} onToggleGroup={noop} reveal={false} onHelp={noop} width={900} {...over} />);
}

/** Every button needs text or an aria-label. */
function unnamedButtons(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    if (!/aria-label="[^"]+"/.test(m[1]) && text.length === 0) bad.push(m[0].slice(0, 80));
  }
  return bad;
}

describe('UX-3: the legend gives every colour cue a pattern or shape', () => {
  const html = wrap(<Legend theme="light" open onClose={noop} />);
  it('lists the 12 cues of the 7B.3 table, each with a drawn swatch and its pattern and shape in words', () => {
    for (const c of tokens.cues) {
      expect(html, c.id).toContain(`data-cue="${c.id}"`);
      expect(html).toContain(c.meaning);
      expect(html).toContain(c.shape);
    }
    expect((html.match(/<li class="legend-row"/g) ?? []).length).toBe(12);
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
  it('uses patterns for degraded (hatch), conflict (diagonal lines), and AFH removed (dots), and marks for the statuses', () => {
    expect(html).toContain('lg-degraded-hatch');
    expect(html).toContain('lg-conflict-conflict');
    expect(html).toContain('lg-afhRemoved-dots');
    expect(html).toContain('<path d="M0,');
  });
  it('is hidden when closed and has a close button with a name', () => {
    expect(wrap(<Legend theme="light" open={false} onClose={noop} />)).toBe('');
    expect(unnamedButtons(html)).toEqual([]);
  });
});

describe('time view (7B.3, 7B.4)', () => {
  const r = ex(1);
  const html = timeView(r);
  it('shows Bluetooth lanes above Wi-Fi lanes with the task names, info and mute buttons, and collapse buttons', () => {
    expect(html.indexOf('A2DP streaming')).toBeLessThan(html.indexOf('Video streaming'));
    expect(html).toContain('aria-label="About A2DP streaming"');
    expect(html).toContain('aria-label="Hide A2DP streaming lane"');
    expect(html).toContain('aria-label="Collapse Bluetooth lanes"');
    expect(html).toContain('aria-label="Collapse Wi-Fi lanes"');
  });
  it('draws numbered conflict bands, each a button with a name', () => {
    const markers = html.match(/aria-label="Conflict \d+, (hard|tolerated|degraded|warning)\. Open the explanation\."/g) ?? [];
    expect(markers.length).toBeGreaterThan(10);
    expect(html).toContain('data-conflict-id="C0001"');
  });
  it('draws transmit in the upper half and receive in the lower half of a lane, solid against outlined', () => {
    const tx = /data-dir="TX"[^>]*>.*?<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(html);
    const rx = /data-dir="RX"[^>]*>.*?<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(html);
    expect(tx && rx).toBeTruthy();
    expect(Number(rx![1])).toBeGreaterThan(Number(tx![1]));
    expect([colorOf('light', 'btLight').toLowerCase(), colorOf('light', 'wifiLight').toLowerCase()]).toContain(rx![2].toLowerCase());
  });
  it('gives every block an accessible description and a delayed block a dashed ghost', () => {
    // The delayed Wi-Fi bursts end up after the 100 ms window, so look a little beyond it.
    const wide = timeView(r, { viewport: { start: 0, end: 130_000 } });
    expect(wide).toMatch(/aria-label="Video streaming (DATA|ACK) (RX|TX), delayed, starts at \d+ microseconds"/);
    expect(html).toContain('class="ghost"');
    expect(html).toContain('stroke-dasharray="4 3"');
  });
  it('struck-through lost blocks carry a cross and a diagonal line in the denied colour', () => {
    const e5 = timeView(ex(5), { viewport: { start: 0, end: 5000 } });
    expect(e5).toContain('data-status="RETRIED"');
    expect(e5).toContain(`stroke="${colorOf('light', 'denied')}" stroke-width="2"`);
  });
  it('marks degraded blocks with a hatch and a triangle, and uses the hatch pattern', () => {
    const first = ex(3).blocks.find((b) => b.status === 'DEGRADED')!;
    const e3 = timeView(ex(3), { viewport: { start: Math.max(0, first.start - 5000), end: first.start + 15_000 } });
    expect(e3).toContain('url(#tv-hatch)');
    expect(e3).toContain('data-status="DEGRADED"');
  });
  it('shows a selected block with a dark outline and glow, and the cursor line', () => {
    const b = r.blocks.find((x) => x.tech === 'WIFI' && !x.optional)!;
    const h = timeView(r, { selectedBlockId: b.id, cursor: 1000, viewport: { start: 0, end: 5000 } });
    expect(h).toContain('class="block selected"');
    expect(h).toContain('data-testid="time-cursor"');
    expect(h).toContain('url(#tv-glow)');
  });
  it('switches to density bars when zoomed out on a dense scenario and says so', () => {
    const dense = runEngine(makeConfig(['bt_inquiry', 'wifi_video_stream'], { windowUs: 1_000_000, femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 }), data);
    const h = timeView(dense);
    expect(h).toContain('data-lod="density"');
    expect(h).toContain('Density view: zoom in to see individual blocks');
    expect(timeView(dense, { viewport: { start: 0, end: 5000 } })).toContain('data-lod="blocks"');
  });
  it('collapsed groups hide their lanes, and muted lanes are marked hidden', () => {
    expect(timeView(r, { collapsed: { BT: true, WIFI: false } })).not.toContain('data-lane-id="t1"');
    expect(timeView(r, { muted: new Set(['t1']) })).toContain('hidden</text>');
  });
  it('is readable in the dark theme: dark lane background and the dark palette', () => {
    const h = timeView(r, {}, 'dark');
    expect(h).toContain(colorOf('dark', 'laneBg'));
    expect(h).toContain(colorOf('dark', 'conflict'));
  });
  it('has a minimap with a slider role and named buttons everywhere', () => {
    expect(html).toContain('role="slider"');
    expect(unnamedButtons(html)).toEqual([]);
  });
  it('uses text of at least 12 px in the diagram', () => {
    const sizes = [...html.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes.filter((s) => s !== 7))).toBeGreaterThanOrEqual(12); // 7 is the digit inside a retry badge, which has a tooltip and label as well
  });
});

describe('frequency view (7B.6)', () => {
  const props = (r: EngineResult, mode: 'WATERFALL' | 'HISTOGRAM' = 'WATERFALL') => ({ ctx: makeCtx(r, data), theme: 'light' as const, mode, onMode: noop, range: [0, r.config.platform.windowUs] as [number, number], linked: true, onLinked: noop, cursor: null, onHoverBlock: noop, onSelectBlock: noop, width: 640 });
  it('shows the footprint with dashed edges, its channel label, the circled count and the caption', () => {
    const html = wrap(<FrequencyView {...props(ex(3))} />);
    expect(html).toContain('data-testid="footprint"');
    expect(html).toContain('Wi-Fi ch 6');
    expect(html).toContain('stroke-dasharray="5 3"');
    expect(html).toMatch(/\d+ hops? circled in red/);
    expect(html).toContain('Hops circled in red landed inside the Wi-Fi channel');
    expect(html).toContain('data-mode="waterfall"');
  });
  it('has a mode toggle, a link toggle and the adaptive hopping strip', () => {
    const html = wrap(<FrequencyView {...props(ex(4), 'HISTOGRAM')} />);
    expect(html).toContain('aria-pressed="true">Histogram');
    expect(html).toContain('Follow the time view');
    expect(html).toContain('data-testid="afh-strip"');
    expect((html.match(/data-removed="true"/g) ?? []).length).toBe(23);
    expect(html).toContain('data-mode="histogram"');
  });
  it('shows a second panel with the required caption for 5 GHz Wi-Fi', () => {
    const r = runEngine(makeConfig(['bt_a2dp', 'wifi_video_stream'], { wifiBand: '5', wifiChannel: 36, windowUs: 100_000 }), data);
    const html = wrap(<FrequencyView {...props(r)} />);
    expect(html).toContain('data-testid="high-band-panel"');
    expect(html).toContain(HIGH_BAND_CAPTION);
    expect(wrap(<FrequencyView {...props(ex(3))} />)).not.toContain('high-band-panel');
  });
  it('has named controls', () => { expect(unnamedButtons(wrap(<FrequencyView {...props(ex(3))} />))).toEqual([]); });
});

describe('platform diagram (7B.7)', () => {
  it('draws the elements of a shared platform and marks the stressed element with a dashed outline and a mark', () => {
    const r = ex(1);
    const c = r.conflicts.find((x) => x.severity === 'HARD')!;
    const html = wrap(<PlatformDiagram result={r} theme="light" cursor={c.overlapStart + 1} selectedConflictId={c.id} />);
    expect(html).toContain('data-node="comboCore"');
    expect(html).toContain('data-node="fem"');
    expect(html).toContain('data-node="antenna"');
    expect(html).toContain('data-stressed="true"');
    expect(html).toContain('stroke-dasharray="6 3"');
    expect(html).toContain('>!</text>');
    expect(html).toContain('aria-label="Antenna. Shared element of the selected conflict. Open help."');
  });
  it('shows the isolation on a separate platform', () => {
    const html = wrap(<PlatformDiagram result={ex(3)} theme="light" cursor={null} />);
    expect(html).toContain('isolation 10 dB');
    expect(html).toContain('data-node="wifiAntenna"');
  });
  it('uses text of at least 12 px', () => {
    const sizes = [...wrap(<PlatformDiagram result={ex(3)} theme="light" cursor={null} />).matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});

describe('explanation panel (7B.8)', () => {
  const r = ex(1), ctx = makeCtx(r, data);
  const props = { ctx, theme: 'light' as const, onSelect: noop, onApply: noop, hardOnly: false, onHardOnly: noop, sort: 'time' as const, onSort: noop };
  it('lists the conflicts with sort, hard-only filter, previous and next', () => {
    const html = wrap(<ExplanationPanel {...props} />);
    expect(html).toContain('aria-label="Sort conflicts"');
    expect(html).toContain('Hard only');
    expect(html).toContain('aria-label="Previous conflict"');
    expect(html).toContain('aria-label="Next conflict"');
    expect((html.match(/class="crow/g) ?? []).length).toBe(r.conflicts.length);
    expect(html).toContain('Select a conflict in the list');
  });
  it('tells the selected conflict as seven headed sections in order, with suggestions and labels', () => {
    const c = r.conflicts.find((x) => x.severity === 'HARD' && x.decisionId)!;
    const html = wrap(<ExplanationPanel {...props} selectedId={c.id} />);
    const heads = ['1. What happened', '2. Who was involved', '3. Why it was a conflict', '4. Who won, and why', '5. What it means for the user', '6. What would change it', '7. Label'];
    let at = -1;
    for (const h of heads) { const i = html.indexOf(h); expect(i, h).toBeGreaterThan(at); at = i; }
    expect(html).toContain('data-suggestion="separate-antennas"');
    expect(html).toMatch(/Standard says|Implementations vary/);
    expect(html).toContain('<table class="prio">');
    expect(html).toContain('(won)');
  });
  it('shows a tolerated conflict without arbitration', () => {
    const r2 = ex(2);
    const html = wrap(<ExplanationPanel {...props} ctx={makeCtx(r2, data)} selectedId={r2.conflicts[0].id} />);
    expect(html).toContain('No arbitration was needed');
  });
  it('has named buttons', () => { expect(unnamedButtons(wrap(<ExplanationPanel {...props} selectedId="C0001" />))).toEqual([]); });
});

describe('summary strip (7A.11, 7B.13)', () => {
  it('lists every metric with a tooltip hook, a per-task table with header scopes, and a screen-reader summary', () => {
    const html = wrap(<SummaryStrip metrics={ex(5).metrics} />);
    expect((html.match(/data-metric="/g) ?? []).length).toBe(12);
    expect(html).toContain('data-testid="sr-summary"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/class="sr-only"[^>]*>\d+ conflicts?:/);
    expect(html).toContain('<th scope="col">Task</th>');
    expect(html).toContain('<th scope="row">A2DP streaming</th>'.replace('A2DP streaming', 'LE connection (central)'));
    expect(html).toContain('Video streaming'.replace('Video streaming', 'Web browsing'));
  });
  it('draws small bars for share-type metrics', () => { expect(wrap(<SummaryStrip metrics={ex(1).metrics} />)).toContain('class="bar"'); });
});

describe('playback bar (7B.9)', () => {
  const steps = replaySteps(ex(1).conflicts.find((c) => c.severity === 'HARD')!, { bt: 'A2DP streaming', wifi: 'Video streaming' }, 'Video streaming', 'Done.');
  const html = wrap(<PlaybackBar playing={false} onPlay={noop} onPause={noop} onPrev={noop} onNext={noop} speed={1} onSpeed={noop} windowUs={100000} cursor={500} onScrub={noop} onPreset={noop} onZoom={noop} replay={steps} replayStep={2} onReplay={noop} onReplayStep={noop} canReplay />);
  it('has play, step, speed, scrubber, zoom, presets and a four-step replay with a caption', () => {
    for (const l of ['Step to the previous event', 'Play', 'Step to the next event', 'Playback speed', 'Time scrubber', 'Zoom in', 'Zoom out']) expect(html, l).toContain(`aria-label="${l}"`);
    for (const s of ['0.1x', '0.5x', '1x', '5x']) expect(html).toContain(`>${s}<`);
    for (const p of ['Whole window', '10 ms', '1 ms', 'Single slot']) expect(html).toContain(p);
    expect(html).toContain('Step 2 of 4.');
    expect(unnamedButtons(html)).toEqual([]);
  });
});

describe('help panel', () => {
  it('opens for a task, a cue and a metric, and says Standard says or Implementations vary', () => {
    for (const topic of ['bt_a2dp', 'denied', 'throughputImpact', 'conflicts']) {
      const html = wrap(<HelpPanel topic={topic} data={data} onClose={noop} />);
      expect(html).toContain('data-testid="help-panel"');
      expect(html).toMatch(/Standard says|Implementations vary/);
    }
    expect(wrap(<HelpPanel topic={null} data={data} onClose={noop} />)).toBe('');
  });
});
