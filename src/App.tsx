// Application shell (spec 7B.2): a top bar, a left panel, the views in the centre, the explanation on the right and the
// summary strip at the bottom. Milestone M7 loads the five worked examples; M8 adds task selection and platform controls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultData } from './engine/data';
import { runEngine, ValidationError, type EngineResult } from './engine';
import { presetConfig } from './engine/presets';
import { applyChanges, validate } from './engine/validator';
import type { Change, ScenarioConfig, Tech, ValidationIssue } from './engine/types';
import { makeCtx } from './lib/context';
import { conflictList, neighbour, type SortKey } from './lib/explanation';
import { advance, eventTimes, nextEvent, prevEvent, replaySteps, type Speed } from './lib/playback';
import { cssVariables, type ThemeName } from './lib/tokens';
import { clampViewport, pan, presetViewport, span, zoomAt, type PresetName, type Viewport } from './lib/viewport';
import { ExplanationPanel } from './ui/ExplanationPanel';
import { FrequencyView, type FreqMode } from './ui/FrequencyView';
import { HelpPanel } from './ui/HelpPanel';
import { Legend } from './ui/Legend';
import { PlatformDiagram } from './ui/PlatformDiagram';
import { PlaybackBar } from './ui/PlaybackBar';
import { SummaryStrip } from './ui/SummaryStrip';
import { TimeView } from './ui/TimeView';
import { TooltipProvider } from './ui/Tooltip';

const data = defaultData;

function stored(key: string, fallback: string): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage can be blocked; the page works without it */ }
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(() => (stored('coex-theme', '') === 'dark' ? 'dark' : 'light'));
  const [reduced, setReduced] = useState<boolean>(() => stored('coex-reduced', '') === '1' || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [config, setConfig] = useState<ScenarioConfig | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [errors, setErrors] = useState<ValidationIssue[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [viewport, setViewport] = useState<Viewport>({ start: 0, end: 100_000 });
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<string | undefined>();
  const [selectedBlock, setSelectedBlock] = useState<string | undefined>();
  const [hoverBlock, setHoverBlock] = useState<string | undefined>();
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<Tech, boolean>>({ BT: false, WIFI: false });
  const [freqMode, setFreqMode] = useState<FreqMode>('WATERFALL');
  const [freqLinked, setFreqLinked] = useState(true);
  const [legend, setLegend] = useState(false);
  const [help, setHelp] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [hardOnly, setHardOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('time');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [replayStep, setReplayStep] = useState<number | null>(null);

  const ctx = useMemo(() => (result ? makeCtx(result, data) : null), [result]);
  const windowUs = result?.config.platform.windowUs ?? 100_000;
  const times = useMemo(() => (result ? eventTimes(result) : []), [result]);
  useEffect(() => { store('coex-theme', theme); }, [theme]);
  useEffect(() => { store('coex-reduced', reduced ? '1' : '0'); if (reduced) setPlaying(false); }, [reduced]);

  const load = useCallback((cfg: ScenarioConfig, keepView = false) => {
    try {
      const r = runEngine(cfg, data);
      setConfig(cfg); setResult(r); setErrors(null);
      if (!keepView) {
        setViewport({ start: 0, end: cfg.platform.windowUs }); setCursor(null); setSelectedConflict(undefined); setSelectedBlock(undefined); setMuted(new Set()); setReplayStep(null); setPlaying(false);
      }
      return r;
    } catch (e) {
      if (e instanceof ValidationError) { setErrors(e.issues.filter((i) => i.severity === 'ERROR')); setConfig(cfg); return undefined; }
      throw e;
    }
  }, []);

  // Test hook for the browser checks in e2e/: only present when the page is opened with ?e2e.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('e2e')) (window as unknown as { __coex: unknown }).__coex = { load: (cfg: ScenarioConfig) => { const r = load(cfg); return { ok: !!r, blocks: r?.blocks.length ?? 0, errors: validate(cfg, data).filter((i) => i.severity === 'ERROR').map((i) => i.id) }; } };
  }, [load]);

  const loadPreset = (id: string) => { setNote(null); load(presetConfig(id, data)); };

  // Jump the views to a conflict: centre the time view on it and move the shared cursor to its start.
  const focusConflict = useCallback((id: string) => {
    if (!result) return;
    const c = result.conflicts.find((x) => x.id === id);
    if (!c) return;
    setSelectedConflict(id);
    setSelectedBlock(undefined);
    setReplayStep(null);
    const s = Math.min(windowUs, Math.max(3000, c.overlapUs * 6));
    const mid = (c.overlapStart + c.overlapEnd) / 2;
    setViewport(clampViewport({ start: mid - s / 2, end: mid + s / 2 }, windowUs));
    setCursor(c.overlapStart);
  }, [result, windowUs]);

  const selectBlock = useCallback((id: string) => {
    if (!result) return;
    setSelectedBlock(id);
    const c = result.conflicts.find((x) => x.btBlockId === id || x.wifiBlockId === id);
    if (c) { setSelectedConflict(c.id); setReplayStep(null); }
  }, [result]);

  const stepConflict = useCallback((dir: 1 | -1) => {
    if (!ctx) return;
    const id = neighbour(conflictList(ctx, sort, hardOnly), selectedConflict, dir);
    if (id) focusConflict(id);
  }, [ctx, sort, hardOnly, selectedConflict, focusConflict]);

  const stepEvent = useCallback((dir: 1 | -1) => {
    if (!result) return;
    const t = cursor ?? (dir === 1 ? -1 : windowUs + 1);
    const nt = dir === 1 ? nextEvent(times, t) : prevEvent(times, t);
    if (nt === undefined) return;
    setCursor(nt);
    // Step to the next event jumps the cursor and keeps it in view; the explanation follows the conflict at that time.
    const s = span(viewport);
    if (nt < viewport.start || nt > viewport.end) setViewport(clampViewport({ start: nt - s / 4, end: nt - s / 4 + s }, windowUs));
    const c = result.conflicts.find((x) => x.overlapStart === nt);
    if (c) { setSelectedConflict(c.id); setReplayStep(null); }
  }, [result, cursor, times, viewport, windowUs]);

  // Playback: advance the cursor with real time. It only reveals the results; it never changes them.
  const raf = useRef<number | undefined>(undefined);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = cursor;
  useEffect(() => {
    if (!playing || reduced) return;
    let last = performance.now();
    let t = cursorRef.current ?? 0;
    if (t >= windowUs) t = 0; // playing again from the end starts over
    const tick = (now: number) => {
      const dt = now - last; last = now;
      const r = advance(t, dt, speed, windowUs);
      t = r.t;
      setCursor(t);
      if (r.done) { setPlaying(false); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== undefined) cancelAnimationFrame(raf.current); };
  }, [playing, speed, windowUs, reduced]);

  // Keyboard shortcuts for zoom, pan, next and previous conflict, playback and the legend.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target instanceof Element ? e.target : document.body) as HTMLElement;
      if (t.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      const centre = cursor ?? (viewport.start + viewport.end) / 2;
      switch (e.key) {
        case '+': case '=': setViewport((v) => zoomAt(v, centre, 0.5, windowUs)); break;
        case '-': case '_': setViewport((v) => zoomAt(v, centre, 2, windowUs)); break;
        case 'ArrowRight': if (t.closest('[role="slider"], select')) return; setViewport((v) => pan(v, span(v) / 8, windowUs)); break;
        case 'ArrowLeft': if (t.closest('[role="slider"], select')) return; setViewport((v) => pan(v, -span(v) / 8, windowUs)); break;
        case 'n': stepConflict(1); break;
        case 'p': stepConflict(-1); break;
        case ' ': if (t.closest('button, [role="button"]')) return; e.preventDefault(); if (!reduced) setPlaying((x) => !x); break;
        case 'l': setLegend((x) => !x); break;
        case 'Home': setViewport({ start: 0, end: windowUs }); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, viewport, windowUs, stepConflict, reduced]);

  const applySuggestion = (label: string, changes: Change[]) => {
    if (!result) return;
    const before = result.metrics.conflicts;
    const next = applyChanges(result.config, changes);
    const r = load(next, true);
    if (r) {
      setNote(`Applied "${label}". Hard conflicts ${before.bySeverity.HARD} → ${r.metrics.conflicts.bySeverity.HARD}, degraded ${before.bySeverity.DEGRADED} → ${r.metrics.conflicts.bySeverity.DEGRADED}, tolerated ${before.bySeverity.TOLERATED} → ${r.metrics.conflicts.bySeverity.TOLERATED}.`);
      setSelectedConflict(undefined);
    }
  };

  const conflict = result?.conflicts.find((c) => c.id === selectedConflict);
  const replay = useMemo(() => {
    if (!conflict || !ctx) return null;
    const dec = conflict.decisionId ? ctx.decisionById.get(conflict.decisionId) : undefined;
    const w = dec ? ctx.blockById.get(dec.winnerId) : undefined;
    const bt = ctx.blockById.get(conflict.btBlockId)!, wf = ctx.blockById.get(conflict.wifiBlockId)!;
    return replaySteps(conflict, { bt: ctx.nameOf(bt.taskId), wifi: ctx.nameOf(wf.taskId) }, w ? ctx.nameOf(w.taskId) : undefined, `${ctx.nameOf(bt.taskId)} ended ${bt.status.toLowerCase()}; ${ctx.nameOf(wf.taskId)} ended ${wf.status.toLowerCase()}.`);
  }, [conflict, ctx]);
  const focusIds = replayStep && conflict ? new Set([conflict.btBlockId, conflict.wifiBlockId]) : undefined;

  const vars = cssVariables(theme);

  return (
    <TooltipProvider onLearnMore={setHelp}>
      <div className="app" data-theme={theme} data-reduced-motion={reduced} style={vars as React.CSSProperties}>
        <header className="topbar">
          <h1>Coex Learning Tool</h1>
          <span className="scenario-name" data-testid="scenario-name">{config?.name ?? 'No scenario loaded'}</span>
          <div className="spacer" />
          <label>Example <select value="" onChange={(e) => e.target.value && loadPreset(e.target.value)} aria-label="Load a worked example"><option value="">Load an example…</option>{data.presets.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></label>
          <button type="button" onClick={() => config && load(config, true)} disabled={!config}>Generate Coex View</button>
          <button type="button" onClick={() => setLegend((x) => !x)} aria-pressed={legend}>Legend</button>
          <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-pressed={theme === 'dark'}>Dark theme</button>
          <label className="check"><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduce motion</label>
        </header>

        {errors && (
          <section className="errors" role="alert" data-testid="errors">
            <strong>The scenario cannot be generated yet.</strong>
            <ul>{errors.map((i, k) => (<li key={k}><span className="id">{i.id}</span> {i.message} <span className="muted">{i.reason}</span></li>))}</ul>
          </section>
        )}

        <div className={`workspace${leftOpen ? '' : ' left-closed'}`}>
          <nav className="left" aria-label="Scenario">
            <button type="button" className="collapse" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-label={leftOpen ? 'Collapse the scenario panel' : 'Expand the scenario panel'}>{leftOpen ? '‹' : '›'}</button>
            {leftOpen && (<>
              <h2>Worked examples</h2>
              <ol className="examples">{data.presets.map((p) => (<li key={p.id}><button type="button" className={config?.name === p.name ? 'current' : ''} onClick={() => loadPreset(p.id)} data-preset={p.id}>{p.name}</button></li>))}</ol>
              {config && result && (<div className="scenario-info">
                <h3>Tasks</h3><ul>{result.config.tasks.map((t) => (<li key={t.instanceId}>{result.taskNames[t.instanceId]}</li>))}</ul>
                <h3>Platform</h3>
                <dl className="mono">
                  <dt>Antenna</dt><dd>{result.config.platform.antennaMode === 'SHARED' ? 'shared' : `separate, ${result.config.platform.isolationDb} dB`}</dd>
                  <dt>Cores</dt><dd>{result.config.platform.coreCount} ({result.config.platform.coreMode.toLowerCase().replace('_', ' ')})</dd>
                  <dt>Policy</dt><dd>{result.config.platform.arbitrationPolicy.toLowerCase().replace('_', ' ')}</dd>
                  <dt>Wi-Fi</dt><dd>{result.config.platform.wifiGeneration} ch {result.config.platform.wifiChannel}, {result.config.platform.wifiBandwidth} MHz</dd>
                  <dt>AFH</dt><dd>{result.config.platform.afhEnabled ? 'on' : 'off'}</dd>
                  <dt>Window</dt><dd>{result.config.platform.windowUs / 1000} ms, seed {result.config.platform.seed}</dd>
                </dl>
              </div>)}
            </>)}
          </nav>

          <main className="centre">
            {!result || !ctx ? (
              <section className="empty" data-testid="empty-state">
                <h2>See how Bluetooth and Wi-Fi share the air</h2>
                <p>Pick activities for each radio, set up the hardware, and watch where they collide and who wins. Everything runs in your browser.</p>
                <button type="button" className="primary" onClick={() => loadPreset('example-1')} data-testid="load-first-example">Load the first example</button>
                <p className="muted">The first example is an audio stream and a Wi-Fi video stream sharing one antenna.</p>
              </section>
            ) : (<>
              {note && <p className="note" role="status" data-testid="note">{note}</p>}
              <section className="guide" data-testid="guide">
                <strong>Start here.</strong> The blue lane is Bluetooth and the orange lane is Wi-Fi. Each numbered red band marks a moment when they wanted the air together.
                <button type="button" className="primary" onClick={() => { const first = conflictList(ctx, 'time', false)[0]; if (first) focusConflict(first.conflict.id); }} disabled={result.conflicts.length === 0} data-testid="open-first-conflict">Open the first conflict</button>
              </section>
              <Legend theme={theme} open={legend} onClose={() => setLegend(false)} />
              <TimeView ctx={ctx} theme={theme} viewport={viewport} onViewport={setViewport} cursor={cursor} onCursor={setCursor}
                selectedBlockId={selectedBlock} selectedConflictId={selectedConflict} hoverBlockId={hoverBlock} onHoverBlock={setHoverBlock}
                onSelectBlock={selectBlock} onSelectConflict={focusConflict} muted={muted} onToggleMute={(id) => setMuted((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                collapsed={collapsed} onToggleGroup={(t) => setCollapsed((c) => ({ ...c, [t]: !c[t] }))} reveal={playing} focusIds={focusIds} flashBand={replayStep === 2 || replayStep === 3} onHelp={setHelp} />
              <PlaybackBar playing={playing} onPlay={() => !reduced && setPlaying(true)} onPause={() => setPlaying(false)} onPrev={() => stepEvent(-1)} onNext={() => stepEvent(1)} speed={speed} onSpeed={setSpeed}
                windowUs={windowUs} cursor={cursor} onScrub={(t) => setCursor(t)} onPreset={(n: PresetName) => setViewport(presetViewport(n, windowUs, cursor ?? (viewport.start + viewport.end) / 2))}
                onZoom={(f) => setViewport((v) => zoomAt(v, cursor ?? (v.start + v.end) / 2, f, windowUs))} replay={replay} replayStep={replayStep} onReplay={() => setReplayStep(1)} onReplayStep={setReplayStep} canReplay={!!conflict} />
              {reduced && <p className="muted small">Reduce motion is on: playback animation is off, and step-through still works.</p>}
              <div className="lower">
                <FrequencyView ctx={ctx} theme={theme} mode={freqMode} onMode={setFreqMode} range={[viewport.start, viewport.end]} linked={freqLinked} onLinked={setFreqLinked} cursor={cursor}
                  selectedBlockId={selectedBlock} hoverBlockId={hoverBlock} onHoverBlock={setHoverBlock} onSelectBlock={selectBlock} />
                <PlatformDiagram result={result} theme={theme} cursor={cursor} selectedConflictId={selectedConflict} />
              </div>
            </>)}
          </main>

          <div className="right">
            {result && ctx ? (
              <ExplanationPanel ctx={ctx} theme={theme} selectedId={selectedConflict} onSelect={focusConflict} onApply={applySuggestion} hardOnly={hardOnly} onHardOnly={setHardOnly} sort={sort} onSort={setSort} />
            ) : (<aside className="explain"><h2>Explanation</h2><p className="muted">Load an example to see conflicts and read why they happened.</p></aside>)}
          </div>
        </div>

        <footer className="bottom">
          {result ? <SummaryStrip metrics={result.metrics} /> : <p className="muted">The summary of the results appears here.</p>}
        </footer>
        <HelpPanel topic={help} data={data} onClose={() => setHelp(null)} />
      </div>
    </TooltipProvider>
  );
}
