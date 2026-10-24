// Application shell (spec 7B.2): a top bar, a left panel, the views in the centre, the explanation on the right and the
// summary strip at the bottom. Milestone M7 loads the five worked examples; M8 adds task selection and platform controls.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultData, defaultPlatform } from './engine/data';
import { runEngine, ValidationError, type EngineResult } from './engine';
import { presetConfig } from './engine/presets';
import { applyChanges, fixAllSafe, validate } from './engine/validator';
import type { Change, Fix, IssueItem, ParamValue, ScenarioConfig, Tech, ValidationIssue } from './engine/types';
import { addTask, applyPlatformPreset, applyUseCase, clearTasks, gateOf, removeTask, resetPlatform, resetTask, setOverride, setParam, setPlatform } from './lib/draft';
import { amend, canRedo, canUndo, createHistory, pushState, redo, undo, type History } from './lib/history';
import { parseScenario, serializeScenario } from './lib/scenarioFile';
import { decodeShare, shareFromHash, shareHash } from './lib/shareLink';
import { download, fileSafe } from './lib/download';
import { summaryItems } from './lib/summary';
import { explainConflict } from './lib/explanation';
import { makeCtx } from './lib/context';
import { conflictList, neighbour, type SortKey } from './lib/explanation';
import { advance, eventTimes, nextEvent, prevEvent, replaySteps, type Speed } from './lib/playback';
import { colorOf, cssVariables, type ThemeName } from './lib/tokens';
import { clampViewport, pan, presetViewport, span, zoomAt, type PresetName, type Viewport } from './lib/viewport';
import { ExplanationPanel } from './ui/ExplanationPanel';
import { FrequencyView, type FreqMode } from './ui/FrequencyView';
import { HelpPanel } from './ui/HelpPanel';
import { ShortcutsDialog, WarningsDialog } from './ui/Dialogs';
import { GlossContext } from './ui/Gloss';
import { LessonCard, TourCard } from './ui/Learn';
import { lessonOf, lessons, tourSteps, type LessonState, startLesson } from './lib/learn';
import { IssuesPanel } from './ui/IssuesPanel';
import { Legend } from './ui/Legend';
import { PlatformPanel } from './ui/PlatformPanel';
import { TaskPicker } from './ui/TaskPicker';
import { PlatformDiagram } from './ui/PlatformDiagram';
import { PlaybackBar } from './ui/PlaybackBar';
import { SummaryStrip } from './ui/SummaryStrip';
import { TimeView } from './ui/TimeView';
import { TooltipProvider } from './ui/Tooltip';

const data = defaultData;
const CompareView = lazy(() => import('./ui/CompareView').then((m) => ({ default: m.CompareView })));
const LessonMenu = lazy(() => import('./ui/Panels').then((m) => ({ default: m.LessonMenu })));
const GlossaryPanel = lazy(() => import('./ui/Panels').then((m) => ({ default: m.GlossaryPanel })));
const AssumptionsPanel = lazy(() => import('./ui/Panels').then((m) => ({ default: m.AssumptionsPanel })));

function stored(key: string, fallback: string): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage can be blocked; the page works without it */ }
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(() => (stored('coex-theme', '') === 'dark' ? 'dark' : 'light'));
  const [reduced, setReduced] = useState<boolean>(() => stored('coex-reduced', '') === '1' || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [hist, setHist] = useState<History<ScenarioConfig>>(() => createHistory({ name: 'New scenario', tasks: [], platform: defaultPlatform(data) }));
  const draft = hist.present.state;
  const [tab, setTab] = useState<'build' | 'platform' | 'issues' | 'examples'>('build');
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmWarn, setConfirmWarn] = useState(false);
  const [skipWarn, setSkipWarn] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [snapshot, setSnapshot] = useState<EngineResult | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [learnMenu, setLearnMenu] = useState(false);
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const [lessonDone, setLessonDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(stored('coex-lessons', '{}')); } catch { return {}; } });
  const [glossaryOpen, setGlossaryOpen] = useState<{ focus?: string } | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [tour, setTour] = useState<number | null>(() => (stored('coex-tour-done', '') === '1' ? null : 0));
  const [helpMenu, setHelpMenu] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; n: number } | undefined>();
  const lastEdit = useRef<{ key: string; t: number }>({ key: '', t: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
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
      setResult(r); setErrors(null);
      if (!keepView) {
        setViewport({ start: 0, end: cfg.platform.windowUs }); setCursor(null); setSelectedConflict(undefined); setSelectedBlock(undefined); setMuted(new Set()); setReplayStep(null); setPlaying(false);
      }
      return r;
    } catch (e) {
      if (e instanceof ValidationError) { setErrors(e.issues.filter((i) => i.severity === 'ERROR')); return undefined; }
      throw e;
    }
  }, []);

  // ---- Editing: every change goes through history, so it can be undone (7B.12). Typing in one box is one step. ----
  const edit = useCallback((label: string, cfg: ScenarioConfig, key?: string) => {
    const now = Date.now();
    const same = key !== undefined && lastEdit.current.key === key && now - lastEdit.current.t < 1200;
    lastEdit.current = { key: key ?? '', t: now };
    setHist((h) => (same ? amend(h, cfg, label) : pushState(h, cfg, label)));
  }, []);

  const issues = useMemo(() => validate(draft, data), [draft]);
  const gate = useMemo(() => gateOf(issues, draft.tasks.length), [issues, draft.tasks.length]);
  const stale = !!result && JSON.stringify(result.config) !== JSON.stringify(draft);
  const say = (...m: string[]) => setNotices(m);

  // Generating is visible: the button shows its state for at least one frame before the engine runs.
  const generateNow = useCallback((cfg: ScenarioConfig, keepView: boolean) => {
    setBusy(true);
    requestAnimationFrame(() => setTimeout(() => { try { load(cfg, keepView); } finally { setBusy(false); } }, 0));
  }, [load]);

  const generate = useCallback(() => {
    if (!gate.canGenerate || busy) return;
    if (gate.needsConfirm && !skipWarn) { setConfirmWarn(true); return; }
    generateNow(draft, !!result);
  }, [gate, busy, skipWarn, draft, result, generateNow]);

  // Test hook for the browser checks in e2e/: only present when the page is opened with ?e2e.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('e2e')) (window as unknown as { __coex: unknown }).__coex = { load: (cfg: ScenarioConfig) => { setHist((h) => pushState(h, cfg, 'Test')); const r = load(cfg); return { ok: !!r, blocks: r?.blocks.length ?? 0, errors: validate(cfg, data).filter((i) => i.severity === 'ERROR').map((i) => i.id) }; } };
  }, [load]);

  const loadPreset = (id: string) => {
    const cfg = presetConfig(id, data);
    setNote(null); setNotices([]); setHist((h) => pushState(h, cfg, `Load ${cfg.name}`)); generateNow(cfg, false);
  };

  // A shared link opens the scenario it holds. It is validated like any other input (7C.5).
  useEffect(() => {
    const code = shareFromHash(window.location.hash);
    if (!code) return;
    const r = decodeShare(code, data);
    if (!r.config) { say(...r.problems); return; }
    const cfg = r.config;
    setHist(createHistory(cfg, 'Shared link'));
    say(...r.notices, 'Loaded from a share link.');
    const g = gateOf(validate(cfg, data), cfg.tasks.length);
    if (g.canGenerate && !g.needsConfirm) generateNow(cfg, false); else setTab(g.errors.length ? 'issues' : 'build');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUndo = useCallback(() => setHist((h) => { if (canUndo(h)) say(`Undid: ${h.present.label}.`); return undo(h); }), []);
  const onRedo = useCallback(() => setHist((h) => { if (canRedo(h)) say(`Redid: ${h.future[0].label}.`); return redo(h); }), []);

  const onField = (field: keyof ScenarioConfig['platform'], v: ParamValue) => {
    const label = data.platformFields.find((f) => f.field === field)?.label ?? String(field);
    edit(`Change ${label}`, setPlatform(draft, field, v), `f:${String(field)}`);
    if (field === 'femArrangement') say(`The antenna mode was changed to ${v === 'SEPARATE' ? 'separate' : 'shared'} to match the front-end arrangement. Undo restores the old value.`);
  };
  const onParam = (id: string, name: string, v: ParamValue) => edit(`Change ${name}`, setParam(draft, id, name, v), `p:${id}:${name}`);
  const jump = (item: IssueItem) => {
    if (item.kind === 'task') { setTab('build'); setReveal({ id: item.instanceId, n: Date.now() }); }
    else setTab('platform');
    setTimeout(() => {
      const el = (item.kind === 'task' ? (item.param ? document.getElementById(`p-${item.instanceId}-${item.param}`) : null) ?? document.querySelector(`[data-instance="${item.instanceId}"]`) : document.getElementById(`pf-${item.field}`)) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center' }); el?.focus?.();
    }, 60);
  };
  const onFix = (f: Fix) => { edit(`Fix: ${f.label}`, applyChanges(draft, f.changes)); say(`Applied: ${f.label}. Undo restores the old settings.`); };
  const onFixAll = () => { const r = fixAllSafe(draft, data); if (r.applied.length) { edit('Fix all safe issues', r.config); say(`Applied ${r.applied.length} safe fix${r.applied.length === 1 ? '' : 'es'}: ${r.applied.map((f) => f.label).join('; ')}.`); } };

  // ---- Files, sharing and export ----
  const onSave = () => { download(`${fileSafe(draft.name)}.coex.json`, serializeScenario(draft), 'application/json'); say(`Saved "${draft.name}" as a file.`); };
  const onLoadFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseScenario(await f.text(), data);
    if (!r.config) { say(...r.problems); return; }
    setHist((h) => pushState(h, r.config!, `Load file ${f.name}`));
    const g = gateOf(validate(r.config, data), r.config.tasks.length);
    say(`Loaded "${r.config.name}" from ${f.name}.${g.errors.length ? ` It has ${g.errors.length} problem${g.errors.length === 1 ? '' : 's'} to fix before it can run.` : ''}`, ...r.notices);
    if (g.errors.length) setTab('issues');
  };
  const onShare = async () => {
    const h = shareHash(draft, data);
    window.history.replaceState(null, '', h);
    const url = `${window.location.origin}${window.location.pathname}${h}`;
    try { await navigator.clipboard.writeText(url); say('The share link was copied. It holds the scenario itself, so it works without a server.'); } catch { say(`Copy this link: ${url}`); }
  };
  const mainSection = () => (document.querySelector('[data-compare="b"] [data-testid="time-view"]') ?? document.querySelector('[data-testid="time-view"]')) as HTMLElement | null;
  const diagram = (kind: 'time' | 'freq', ex: typeof import('./lib/exporters')) => {
    const name = result?.config.name ?? 'scenario';
    if (kind === 'time') {
      const sec = mainSection(); const svg = sec?.querySelector('.tv-plot svg') as SVGSVGElement | null;
      if (!sec || !svg) return null;
      return { out: ex.svgFrom(svg, { title: `${name}: time view, ${Math.round(viewport.start)} to ${Math.round(viewport.end)} µs`, labels: ex.timeViewLabels(sec), bg: colorOf(theme, 'bg'), fg: colorOf(theme, 'text') }), name: `${fileSafe(name)}-time` };
    }
    const svg = document.querySelector('.freqview svg') as SVGSVGElement | null;
    if (!svg) return null;
    return { out: ex.svgFrom(svg, { title: `${name}: frequency view`, bg: colorOf(theme, 'bg'), fg: colorOf(theme, 'text') }), name: `${fileSafe(name)}-frequency` };
  };
  const doExport = async (what: 'time-svg' | 'time-png' | 'freq-svg' | 'freq-png' | 'csv' | 'json' | 'pdf') => {
    setExportOpen(false);
    if (!result || !ctx) return;
    try {
      const ex = await import('./lib/exporters');
      const { blocksCsv, makePdf, resultJson, svgToPngBlob } = ex;
      const base = fileSafe(result.config.name);
      if (what === 'csv') download(`${base}-blocks.csv`, blocksCsv(result), 'text/csv');
      else if (what === 'json') download(`${base}-result.json`, resultJson(result), 'application/json');
      else if (what === 'pdf') {
        const d = diagram('time', ex);
        const png = d ? { blob: await svgToPngBlob(d.out.text, d.out.width, d.out.height), width: d.out.width, height: d.out.height } : undefined;
        const lines = summaryItems(result.metrics).map((i) => `${i.label}: ${i.value}`);
        const conflictLines = conflictList(ctx, 'severity', false).slice(0, 5).map(({ conflict, number }) => { const e = explainConflict(conflict, ctx); return `${number}. [${e.severity}] ${e.what.text} ${e.why.text} ${e.who?.text ?? ''} ${e.means.text}`; });
        download(`${base}.pdf`, await makePdf({ result, png, lines, conflictLines, footer: `Coex Learning Tool. Seed ${result.config.platform.seed}. Standard says / Implementations vary labels are in the app.` }), 'application/pdf');
      } else {
        const d = diagram(what.startsWith('time') ? 'time' : 'freq', ex);
        if (!d) { say('There is no diagram to export yet.'); return; }
        if (what.endsWith('svg')) download(`${d.name}.svg`, d.out.text, 'image/svg+xml');
        else download(`${d.name}.png`, await svgToPngBlob(d.out.text, d.out.width, d.out.height), 'image/png');
      }
      say('Export finished. The file was saved by your browser.');
    } catch (e) { say(`The export did not work: ${e instanceof Error ? e.message : 'unknown problem'}.`); }
  };

  const onCompare = () => {
    if (!result) return;
    if (!snapshot) { setSnapshot(result); say('This run is saved as A. Change a setting, generate again, then press Compare to see the differences.'); return; }
    if (snapshot === result) { say('A and the current run are the same. Change a setting and generate again first.'); return; }
    setCompareOn((x) => !x);
  };

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
        case '?': setShortcuts(true); break;
        case 'Home': setViewport({ start: 0, end: windowUs }); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, viewport, windowUs, stepConflict, reduced]);

  // Undo, redo and generate use the control key, so they have their own listener. Text boxes keep their own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target instanceof Element ? e.target : document.body;
      if (e.key === 'Enter') { e.preventDefault(); generate(); return; }
      if (t.closest('input[type="text"], input[type="number"], textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); onUndo(); } else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); onRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [generate, onUndo, onRedo]);

  const applySuggestion = (label: string, changes: Change[]) => {
    if (!result) return;
    const before = result.metrics.conflicts;
    const next = applyChanges(result.config, changes);
    const r = load(next, true);
    if (r) {
      edit(`Apply ${label}`, next);
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

  // ---- Learn mode: highlight the area a step talks about, run the step's action once the lesson's scenario is on screen ----
  const area = lesson ? (lessonOf(lesson)?.steps[lesson.step]?.area ?? null) : tour !== null ? tourSteps[tour].area : null;
  useEffect(() => {
    document.querySelectorAll('[data-hl]').forEach((e) => e.removeAttribute('data-hl'));
    if (!area) return;
    const els = document.querySelectorAll(`[data-area="${area}"]`);
    els.forEach((e) => e.setAttribute('data-hl', '1'));
    (els[0] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }, [area, result, tab, compareOn]);
  const firedAction = useRef('');
  useEffect(() => {
    if (!lesson || !result || !ctx) return;
    const l = lessonOf(lesson);
    const step = l?.steps[lesson.step];
    if (!l || !step?.action || result.config.name !== data.presets.find((p) => p.id === l.preset)?.name) return;
    const key = `${l.id}:${lesson.step}:${result.blocks.length}`;
    if (firedAction.current === key) return;
    firedAction.current = key;
    const a = step.action;
    if (a.type === 'openFirstConflict') { const first = conflictList(ctx, 'time', false)[0]; if (first) focusConflict(first.conflict.id); }
    else if (a.type === 'freqMode') setFreqMode(a.value);
    else if (a.type === 'zoom') setViewport(presetViewport(a.value as PresetName, windowUs, cursor ?? (viewport.start + viewport.end) / 2));
    else if (a.type === 'tab') setTab(a.value as typeof tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, result, ctx]);
  const beginLesson = (id: string) => {
    const l = lessons.find((x) => x.id === id);
    if (!l) return;
    firedAction.current = '';
    setLearnMenu(false); setTour(null); setLesson(startLesson(id)); loadPreset(l.preset);
  };
  const finishLesson = (correct: boolean) => {
    if (lesson && correct) { const d = { ...lessonDone, [lesson.lessonId]: true }; setLessonDone(d); store('coex-lessons', JSON.stringify(d)); }
    setLesson(null);
  };
  const closeTour = () => { setTour(null); store('coex-tour-done', '1'); };
  const openGlossary = useCallback((id?: string) => { setHelp(null); setGlossaryOpen({ focus: id }); }, []);

  const nErr = gate.errors.length, nWarn = gate.warnings.length;
  const badgeText = gate.badge === 'EMPTY' ? 'Add a task to begin' : gate.badge === 'ERRORS' ? `${nErr} error${nErr === 1 ? '' : 's'}` : gate.badge === 'WARNINGS' ? `${nWarn} warning${nWarn === 1 ? '' : 's'}` : 'Ready';
  const badgeIcon = gate.badge === 'ERRORS' ? '✖' : gate.badge === 'WARNINGS' ? '▲' : gate.badge === 'OK' ? '✔' : '•';
  const genWhy = gate.badge === 'EMPTY' ? 'Select at least one task first.' : gate.badge === 'ERRORS' ? `Fix the ${nErr} error${nErr === 1 ? '' : 's'} first: ${gate.errors.map((e) => e.id).join(', ')}.` : '';
  const comparing = compareOn && snapshot && result && snapshot !== result;

  return (
    <TooltipProvider onLearnMore={setHelp}>
     <GlossContext.Provider value={openGlossary}>
      <div className="app" data-theme={theme} data-reduced-motion={reduced} style={vars as React.CSSProperties}>
        <header className="topbar" data-area="topbar">
          <h1>Coex Learning Tool</h1>
          <div className="spacer" />
          <span className={`badge badge-${gate.badge.toLowerCase()}`} role="status" data-testid="validation-badge" data-state={gate.badge}><span aria-hidden="true">{badgeIcon}</span> {badgeText}</span>
          <span className="gen-wrap" title={genWhy}>
            <button type="button" className="primary" onClick={generate} disabled={!gate.canGenerate || busy} aria-describedby="gen-why" data-testid="generate">{busy ? 'Generating…' : 'Generate Coex View'}</button>
            <span id="gen-why" className="sr-only">{genWhy}</span>
          </span>
          {stale && !busy && <span className="muted" data-testid="stale">Settings changed since the last view.</span>}
          <button type="button" onClick={() => setLearnMenu(true)} data-testid="learn-btn">Learn</button>
          <span className="menu">
            <button type="button" aria-expanded={helpMenu} aria-haspopup="true" onClick={() => setHelpMenu((x) => !x)} data-testid="help-menu">Help ▾</button>
            {helpMenu && (
              <ul className="menu-list" role="menu" data-testid="help-menu-list">
                <li role="none"><button type="button" role="menuitem" onClick={() => { setHelpMenu(false); setLesson(null); setTour(0); }} data-testid="replay-tour">Replay the tour</button></li>
                <li role="none"><button type="button" role="menuitem" onClick={() => { setHelpMenu(false); openGlossary(); }} data-testid="open-glossary">Glossary</button></li>
                <li role="none"><button type="button" role="menuitem" onClick={() => { setHelpMenu(false); setAssumptionsOpen(true); }} data-testid="open-assumptions">Assumptions</button></li>
                <li role="none"><button type="button" role="menuitem" onClick={() => { setHelpMenu(false); setShortcuts(true); }}>Keyboard shortcuts</button></li>
                <li role="none"><button type="button" role="menuitem" onClick={() => { setHelpMenu(false); setLegend(true); }}>Legend of colours and shapes</button></li>
              </ul>
            )}
          </span>
          <button type="button" onClick={() => setLegend((x) => !x)} aria-pressed={legend}>Legend</button>
          <button type="button" onClick={() => setShortcuts(true)} aria-label="Keyboard shortcuts">?</button>
          <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-pressed={theme === 'dark'}>Dark theme</button>
          <label className="check"><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduce motion</label>
        </header>

        <div className="scenebar" role="toolbar" aria-label="Scenario">
          <label>Name <input type="text" value={draft.name} maxLength={80} onChange={(e) => edit('Rename scenario', { ...draft, name: e.target.value }, 'name')} data-testid="scenario-name" /></label>
          <button type="button" onClick={onUndo} disabled={!canUndo(hist)} data-testid="undo" title={canUndo(hist) ? `Undo: ${hist.present.label}` : 'Nothing to undo'}>Undo</button>
          <button type="button" onClick={onRedo} disabled={!canRedo(hist)} data-testid="redo">Redo</button>
          <button type="button" onClick={onSave} data-testid="save">Save</button>
          <button type="button" onClick={() => fileInput.current?.click()} data-testid="load-file">Load file</button>
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Scenario file" data-testid="file-input" onChange={(e) => { void onLoadFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => void onShare()} data-testid="share">Share link</button>
          <span className="menu">
            <button type="button" aria-expanded={exportOpen} aria-haspopup="true" onClick={() => setExportOpen((x) => !x)} disabled={!result} data-testid="export">Export ▾</button>
            {exportOpen && (
              <ul className="menu-list" role="menu" data-testid="export-menu">
                {([['time-png', 'Time view as PNG'], ['time-svg', 'Time view as SVG'], ['freq-png', 'Frequency view as PNG'], ['freq-svg', 'Frequency view as SVG'], ['csv', 'All blocks as CSV'], ['json', 'Result as JSON'], ['pdf', 'One-page PDF']] as const).map(([k, l]) => (<li key={k} role="none"><button type="button" role="menuitem" onClick={() => void doExport(k)} data-export={k}>{l}</button></li>))}
              </ul>
            )}
          </span>
          <button type="button" onClick={onCompare} disabled={!result} aria-pressed={!!comparing} data-testid="compare-btn">{!snapshot ? 'Compare: save as A' : comparing ? 'Compare: on' : 'Compare with A'}</button>
          {snapshot && <button type="button" onClick={() => { setSnapshot(null); setCompareOn(false); }}>Forget A</button>}
        </div>

        {notices.length > 0 && (
          <section className="note notices" role="status" data-testid="notices">
            <ul>{notices.map((n, i) => (<li key={i}>{n}</li>))}</ul>
            <button type="button" onClick={() => setNotices([])} aria-label="Dismiss messages">Dismiss</button>
          </section>
        )}

        {errors && (
          <section className="errors" role="alert" data-testid="errors">
            <strong>The scenario cannot be generated yet.</strong>
            <ul>{errors.map((i, k) => (<li key={k}><span className="id">{i.id}</span> {i.message} <span className="muted">{i.reason}</span></li>))}</ul>
          </section>
        )}

        <div className={`workspace${leftOpen ? '' : ' left-closed'}`}>
          <nav className="left" aria-label="Scenario builder" data-area="left">
            <button type="button" className="collapse" onClick={() => setLeftOpen(!leftOpen)} aria-expanded={leftOpen} aria-label={leftOpen ? 'Collapse the scenario panel' : 'Expand the scenario panel'}>{leftOpen ? '‹' : '›'}</button>
            {leftOpen && (<>
              <div role="tablist" aria-label="Builder sections" className="tabs main-tabs">
                {([['build', 'Tasks'], ['platform', 'Platform'], ['issues', `Issues ${issues.length}`], ['examples', 'Examples']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" id={`lt-${k}`} aria-selected={tab === k} aria-controls="left-panel" onClick={() => setTab(k)} data-testid={`ltab-${k}`}>{l}</button>
                ))}
              </div>
              <div role="tabpanel" id="left-panel" aria-labelledby={`lt-${tab}`} className="left-body">
                {tab === 'build' && (
                  <TaskPicker cfg={draft} data={data} issues={issues} reveal={reveal} onHelp={setHelp}
                    onAdd={(id) => edit(`Add ${data.taskIndex.get(id)?.name ?? id}`, addTask(draft, id, data))}
                    onRemove={(id) => edit('Remove a task', removeTask(draft, id))} onParam={onParam}
                    onResetTask={(id) => edit('Reset a task', resetTask(draft, id, data))}
                    onUseCase={(id) => { edit(`Use case: ${data.useCases.find((u) => u.id === id)?.name ?? id}`, applyUseCase(draft, id, data)); say('The task list was replaced by the use case. Undo restores the old list.'); }}
                    onClear={() => { edit('Clear all tasks', clearTasks(draft)); say('All tasks were cleared. Undo brings them back.'); }}
                    onResetAll={() => { edit('Reset everything', { name: 'New scenario', tasks: [], platform: defaultPlatform(data) }); say('Everything was reset to the defaults. Undo brings your settings back.'); }} />
                )}
                {tab === 'platform' && (
                  <PlatformPanel cfg={draft} data={data} issues={issues} onField={onField}
                    onPreset={(id) => { edit(`Platform preset`, applyPlatformPreset(draft, id, data)); say(`Applied the preset "${data.platformDefaults.presets.find((x) => x.id === id)?.name}". Undo restores the old settings.`); }}
                    onResetPlatform={() => { edit('Reset platform', resetPlatform(draft, data)); say('The platform settings were reset. Undo restores them.'); }}
                    onOverride={(kind, key, v) => edit('Edit priority table', setOverride(draft, kind, key, v), `o:${kind}:${key}`)} />
                )}
                {tab === 'issues' && <IssuesPanel issues={issues} onFix={onFix} onFixAllSafe={onFixAll} onJump={jump} onHelp={setHelp} />}
                {tab === 'examples' && (
                  <div>
                    <h2>Worked examples</h2>
                    <ol className="examples">{data.presets.map((p) => (<li key={p.id}><button type="button" className={draft.name === p.name ? 'current' : ''} onClick={() => loadPreset(p.id)} data-preset={p.id}>{p.name}</button></li>))}</ol>
                  </div>
                )}
              </div>
            </>)}
          </nav>

          <main className="centre">
            {!result || !ctx ? (
              <section className="empty" data-testid="empty-state">
                <h2>See how Bluetooth and Wi-Fi share the air</h2>
                <p>Pick activities for each radio, set up the hardware, and watch where they collide and who wins. Everything runs in your browser.</p>
                <button type="button" className="primary" onClick={() => loadPreset('example-1')} data-testid="load-first-example">Load the first example</button>
                <p className="muted">The first example is an audio stream and a Wi-Fi video stream sharing one antenna. Or build your own from the Tasks tab, then press Generate Coex View.</p>
              </section>
            ) : (<>
              {note && <p className="note" role="status" data-testid="note">{note}</p>}
              {comparing && snapshot ? (
                <Suspense fallback={<p className="muted">Loading the compare view…</p>}><CompareView a={snapshot} b={result} data={data} theme={theme} viewport={viewport} onViewport={setViewport} cursor={cursor} onCursor={setCursor} collapsed={collapsed} onToggleGroup={(t) => setCollapsed((c) => ({ ...c, [t]: !c[t] }))} onHelp={setHelp} onClose={() => setCompareOn(false)} /></Suspense>
              ) : (<>
                <section className="guide" data-testid="guide">
                  <strong>Start here.</strong> The blue lane is Bluetooth and the orange lane is Wi-Fi. Each numbered red band marks a moment when they wanted the air together.
                  <button type="button" className="primary" onClick={() => { const first = conflictList(ctx, 'time', false)[0]; if (first) focusConflict(first.conflict.id); }} disabled={result.conflicts.length === 0} data-testid="open-first-conflict">Open the first conflict</button>
                </section>
                <Legend theme={theme} open={legend} onClose={() => setLegend(false)} />
                <TimeView ctx={ctx} theme={theme} viewport={viewport} onViewport={setViewport} cursor={cursor} onCursor={setCursor}
                  selectedBlockId={selectedBlock} selectedConflictId={selectedConflict} hoverBlockId={hoverBlock} onHoverBlock={setHoverBlock}
                  onSelectBlock={selectBlock} onSelectConflict={focusConflict} muted={muted} onToggleMute={(id) => setMuted((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                  collapsed={collapsed} onToggleGroup={(t) => setCollapsed((c) => ({ ...c, [t]: !c[t] }))} reveal={playing} focusIds={focusIds} flashBand={replayStep === 2 || replayStep === 3} onHelp={setHelp} />
              </>)}
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
            {lesson && <LessonCard state={lesson} onChange={setLesson} onExit={() => setLesson(null)} onFinish={finishLesson} />}
            {result && ctx ? (
              <ExplanationPanel ctx={ctx} theme={theme} selectedId={selectedConflict} onSelect={focusConflict} onApply={applySuggestion} hardOnly={hardOnly} onHardOnly={setHardOnly} sort={sort} onSort={setSort} />
            ) : (<aside className="explain" data-area="explain"><h2>Explanation</h2><p className="muted">Load an example, or build a scenario and generate it, to see conflicts and read why they happened.</p></aside>)}
          </div>
        </div>

        <footer className="bottom" data-area="summary">
          {result ? <SummaryStrip metrics={result.metrics} /> : <p className="muted">The summary of the results appears here.</p>}
        </footer>
        <HelpPanel topic={help} data={data} onClose={() => setHelp(null)} />
        {confirmWarn && <WarningsDialog warnings={gate.warnings} onCancel={() => { setConfirmWarn(false); setTab('issues'); }} onConfirm={(remember) => { setConfirmWarn(false); if (remember) setSkipWarn(true); generateNow(draft, !!result); }} />}
        {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
        <Suspense fallback={null}>
        {learnMenu && <LessonMenu done={lessonDone} onStart={beginLesson} onClose={() => setLearnMenu(false)} />}
        {glossaryOpen && <GlossaryPanel focus={glossaryOpen.focus} onClose={() => setGlossaryOpen(null)} />}
        {assumptionsOpen && <AssumptionsPanel onClose={() => setAssumptionsOpen(false)} />}
        </Suspense>
        {tour !== null && <TourCard step={tour} onStep={(n) => setTour(Math.max(0, Math.min(tourSteps.length - 1, n)))} onClose={closeTour} />}
      </div>
     </GlossContext.Provider>
    </TooltipProvider>
  );
}
