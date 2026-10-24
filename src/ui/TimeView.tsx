// Time view (spec 7A.11, 7B.4): Bluetooth lanes on top, Wi-Fi lanes below, one lane per task, TX in the upper half and
// RX in the lower half, conflict bands behind the blocks, a shared cursor, a minimap, zoom and pan, and level of detail.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AirBlock, Tech } from '../engine/types';
import { readoutAt, readoutText } from '../lib/cursor';
import { bandsFor, buildLanes, densityBars, inView, labelFor, lodMode, lookOf, minimapTicks, partnersOf, type Lane } from '../lib/layout';
import { blockTip, conflictTip } from '../lib/tooltips';
import { colorOf, laneTint, type ThemeName } from '../lib/tokens';
import { pan, slotLines, span, timeTicks, tOf, xOf, zoomAt, type Viewport } from '../lib/viewport';
import type { ViewCtx } from '../lib/context';
import { Mark, PatternDefs } from './Marks';
import { useTip } from './Tooltip';

export const RULER_H = 30;
export const GROUP_H = 26;
export const LANE_H = 44;
const TX_Y = 4, RX_Y = 24, BAR_H = 16;
const MAX_FOCUSABLE = 300;

export interface TimeViewProps {
  ctx: ViewCtx;
  theme: ThemeName;
  viewport: Viewport;
  onViewport(v: Viewport): void;
  cursor: number | null;
  onCursor(t: number): void;
  selectedBlockId?: string;
  selectedConflictId?: string;
  hoverBlockId?: string;
  onHoverBlock(id?: string): void;
  onSelectBlock(id: string): void;
  onSelectConflict(id: string): void;
  muted: Set<string>;
  onToggleMute(laneId: string): void;
  collapsed: Record<Tech, boolean>;
  onToggleGroup(t: Tech): void;
  /** While playing, only blocks that have started by the cursor are shown (playback never changes the results). */
  reveal: boolean;
  /** During a conflict replay, the two blocks of the selected conflict stand out. */
  focusIds?: Set<string>;
  flashBand?: boolean;
  onHelp(topic: string): void;
  width?: number;
}

interface Geometry { laneY: Map<string, number>; groupY: Record<Tech, number>; height: number }

function geometry(lanes: { bt: Lane[]; wifi: Lane[] }, collapsed: Record<Tech, boolean>): Geometry {
  let y = RULER_H;
  const laneY = new Map<string, number>();
  const groupY = { BT: 0, WIFI: 0 } as Record<Tech, number>;
  for (const [tech, list] of [['BT', lanes.bt], ['WIFI', lanes.wifi]] as const) {
    groupY[tech] = y; y += GROUP_H;
    if (!collapsed[tech]) for (const l of list) { laneY.set(l.id, y); y += LANE_H; }
  }
  return { laneY, groupY, height: y };
}

function BlockShape({ b, ctx, theme, x, w, laneIdx, laneY, selected, dim, hot, focusable, label, onSelect, onHover, num }: {
  b: AirBlock; ctx: ViewCtx; theme: ThemeName; x: number; w: number; laneIdx: number; laneY: number; selected: boolean; dim: boolean; hot: boolean; focusable: boolean; label: string;
  onSelect(): void; onHover(on: boolean): void; num?: number;
}) {
  const tip = useTip(() => blockTip(b, ctx));
  const look = lookOf(b);
  const tint = laneTint(theme, b.tech, laneIdx);
  const lightFill = colorOf(theme, b.tech === 'BT' ? 'btLight' : 'wifiLight');
  const denied = colorOf(theme, 'denied');
  const y = laneY + (look.half === 'TOP' ? TX_Y : RX_Y);
  const solid = look.fill === 'SOLID';
  const stroke = look.strike ? denied : tint;
  const marksX = Math.min(x + w, x + w) - 5;
  const markY = y + 1;
  const aria = `${ctx.nameOf(b.taskId)} ${b.kind} ${b.dir}, ${b.status.toLowerCase()}, starts at ${b.start} microseconds`;
  return (
    <g
      className={`block${selected ? ' selected' : ''}${hot ? ' hot' : ''}`} data-block-id={b.id} data-status={b.status} data-dir={b.dir}
      role="img" aria-label={aria} tabIndex={focusable ? 0 : -1} opacity={dim ? 0.22 : 1}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}
      {...tip}
    >
      <rect x={x} y={y} width={w} height={BAR_H} rx="2" fill={solid ? tint : lightFill} stroke={stroke} strokeWidth={look.strike ? 2 : 1.5} filter={selected ? 'url(#tv-glow)' : undefined} />
      {look.hatch && <rect x={x} y={y} width={w} height={BAR_H} rx="2" fill="url(#tv-hatch)" />}
      {look.strike && <line x1={x} y1={y + BAR_H} x2={x + w} y2={y} stroke={denied} strokeWidth="2" />}
      {selected && <rect x={x - 1} y={y - 1} width={w + 2} height={BAR_H + 2} rx="3" fill="none" stroke={colorOf(theme, 'selected')} strokeWidth="2" />}
      {label && <text x={x + 4} y={y + 12} fontSize="12" className="mono" fill={solid ? '#fff' : colorOf(theme, 'text')} pointerEvents="none">{label}</text>}
      {look.marks.map((m, i) => (
        <Mark key={m} kind={m} x={w >= 18 ? marksX - i * 12 : x + w + 7 + i * 12} y={markY} size={9} attempt={b.attempt}
          color={m === 'CROSS' ? denied : m === 'TRIANGLE' ? colorOf(theme, 'degraded') : m === 'EXCLAMATION' ? colorOf(theme, 'warning') : m === 'RETRY' ? colorOf(theme, 'retry') : colorOf(theme, 'granted')} />
      ))}
      {num !== undefined && null}
    </g>
  );
}

function GhostShape({ b, ctx, theme, xPlanned, wPlanned, xNow, laneY }: { b: AirBlock; ctx: ViewCtx; theme: ThemeName; xPlanned: number; wPlanned: number; xNow: number; laneY: number }) {
  const look = lookOf(b);
  const y = laneY + (look.half === 'TOP' ? TX_Y : RX_Y);
  const c = colorOf(theme, 'delayedGhost');
  void ctx;
  return (
    <g className="ghost" aria-hidden="true">
      <rect x={xPlanned} y={y} width={wPlanned} height={BAR_H} rx="2" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={`M${xPlanned + wPlanned},${y + BAR_H / 2} L${Math.max(xPlanned + wPlanned + 4, xNow - 2)},${y + BAR_H / 2}`} stroke={c} strokeWidth="1.5" strokeDasharray="4 3" fill="none" markerEnd="url(#tv-arrow)" />
    </g>
  );
}

function BandShape({ band, number, ctx, theme, height, selected, flash, onSelect }: { band: { x: number; w: number; conflict: import('../engine/types').Conflict }; number: number; ctx: ViewCtx; theme: ThemeName; height: number; selected: boolean; flash: boolean; onSelect(): void }) {
  const tip = useTip(() => conflictTip(band.conflict, number, ctx));
  const red = colorOf(theme, 'conflict');
  const sev = band.conflict.severity;
  return (
    <g className={`band${selected ? ' selected' : ''}${flash ? ' flash' : ''}`} data-conflict-id={band.conflict.id} data-severity={sev}>
      <rect x={band.x} y={RULER_H} width={band.w} height={height - RULER_H} fill={red} opacity={Number(colorOf(theme, 'conflictOpacity')) * (sev === 'TOLERATED' ? 0.5 : 1)} />
      <rect x={band.x} y={RULER_H} width={band.w} height={height - RULER_H} fill="url(#tv-conflict)" opacity={sev === 'TOLERATED' ? 0.4 : 1} />
      <line x1={band.x} y1={RULER_H} x2={band.x} y2={height} stroke={red} strokeWidth="1" opacity="0.7" />
      <line x1={band.x + band.w} y1={RULER_H} x2={band.x + band.w} y2={height} stroke={red} strokeWidth="1" opacity="0.7" />
      <g role="button" tabIndex={0} aria-label={`Conflict ${number}, ${sev.toLowerCase()}. Open the explanation.`} className="band-marker" {...tip}
        onClick={(e) => { e.stopPropagation(); onSelect(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}>
        <circle cx={band.x + Math.min(band.w, 12) / 2} cy={RULER_H + 9} r="9" fill={selected ? colorOf(theme, 'selected') : colorOf(theme, 'bg')} stroke={red} strokeWidth="1.8" />
        <text x={band.x + Math.min(band.w, 12) / 2} y={RULER_H + 13} textAnchor="middle" fontSize="12" fontWeight="700" fill={selected ? colorOf(theme, 'bg') : red} pointerEvents="none">{number > 99 ? '99+' : number}</text>
      </g>
    </g>
  );
}

export function TimeView(p: TimeViewProps) {
  const { ctx, theme, viewport: v } = p;
  const { result } = ctx;
  const windowUs = result.config.platform.windowUs;
  const lanes = useMemo(() => buildLanes(result, ctx.data), [result, ctx.data]);
  const geo = useMemo(() => geometry(lanes, p.collapsed), [lanes, p.collapsed]);
  const wrap = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  // The plot is the container minus the 180 px lane-label column.
  const W = p.width ?? Math.max(300, (measured ?? 1080) - 182);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMeasured(Math.max(300, Math.floor(el.clientWidth))));
    ro.observe(el);
    setMeasured(Math.max(300, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  // Blocks per lane, in time order. Untriggered retransmission slots are not on the air and are not drawn.
  const laneBlocks = useMemo(() => {
    const m = new Map<string, AirBlock[]>();
    for (const b of result.blocks) if (!b.optional) (m.get(b.taskId) ?? m.set(b.taskId, []).get(b.taskId)!).push(b);
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    return m;
  }, [result]);

  // Wheel with the control key zooms; the listener is not passive so the page does not zoom as well.
  const svgRef = useRef<SVGSVGElement>(null);
  const vRef = useRef(v); vRef.current = v;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const t = tOf(vRef.current, e.clientX - rect.left, W);
      p.onViewport(zoomAt(vRef.current, t, e.deltaY > 0 ? 1.25 : 0.8, windowUs));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [W, windowUs, p.onViewport]);

  // Drag the background to pan.
  const drag = useRef<{ x: number; start: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.block, .band-marker')) return;
    drag.current = { x: e.clientX, start: v.start };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    p.onCursor(Math.max(0, Math.min(windowUs, tOf(v, e.clientX - rect.left, W))));
    if (drag.current) {
      const dt = ((drag.current.x - e.clientX) / W) * span(v);
      p.onViewport(pan({ start: drag.current.start, end: drag.current.start + span(v) }, dt, windowUs));
    }
  };
  const onPointerUp = () => { drag.current = null; };

  const { ticks } = timeTicks(v, W);
  const slots = slotLines(v, W);
  const bands = bandsFor(result.conflicts, v, W);
  // Delayed blocks leave a dashed ghost at the planned time, even when the delayed block itself is far outside the view.
  const ghosts = useMemo(() => {
    const m = new Map<string, AirBlock[]>();
    for (const b of result.blocks) if (!b.optional && lookOf(b).ghost) (m.get(b.taskId) ?? m.set(b.taskId, []).get(b.taskId)!).push(b);
    return m;
  }, [result]);
  const partners = p.hoverBlockId ? new Set(partnersOf(p.hoverBlockId, result.conflicts)) : new Set<string>();
  let anyDensity = false;
  let focusCount = 0;

  const ro = readoutAt(result, p.cursor ?? 0);
  const mm = minimapTicks(result.conflicts, windowUs, W);

  return (
    <section className="timeview" aria-label="Time view" data-testid="time-view" data-area="time-view" ref={wrap}>
      <Minimap ticks={mm} windowUs={windowUs} viewport={v} width={W} theme={theme} onViewport={p.onViewport} />
      <div className="tv-body">
        <div className="tv-labels" style={{ width: 180 }}>
          <div style={{ height: RULER_H }} className="tv-ruler-label muted">Time</div>
          {(['BT', 'WIFI'] as const).map((tech) => {
            const list = tech === 'BT' ? lanes.bt : lanes.wifi;
            return (
              <div key={tech}>
                <div className="tv-group" style={{ height: GROUP_H }}>
                  <button type="button" onClick={() => p.onToggleGroup(tech)} aria-expanded={!p.collapsed[tech]} aria-label={`${p.collapsed[tech] ? 'Expand' : 'Collapse'} ${tech === 'BT' ? 'Bluetooth' : 'Wi-Fi'} lanes`}>
                    <span aria-hidden="true">{p.collapsed[tech] ? '▸' : '▾'}</span> {tech === 'BT' ? 'Bluetooth' : 'Wi-Fi'}
                  </button>
                </div>
                {!p.collapsed[tech] && list.map((l) => (
                  <div key={l.id} className={`tv-lane-label${p.muted.has(l.id) ? ' muted-lane' : ''}`} style={{ height: LANE_H }}>
                    <span className="lane-name" title={l.name}>{l.name}</span>
                    <button type="button" className="icon" aria-label={`About ${l.name}`} onClick={() => p.onHelp(l.taskId)}>i</button>
                    <button type="button" className="icon" aria-pressed={p.muted.has(l.id)} aria-label={`${p.muted.has(l.id) ? 'Show' : 'Hide'} ${l.name} lane`} onClick={() => p.onToggleMute(l.id)}>{p.muted.has(l.id) ? '◌' : '●'}</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="tv-plot">
          <svg ref={svgRef} width={W} height={geo.height} role="group" aria-label="Time axis diagram of Bluetooth and Wi-Fi blocks" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={() => undefined}>
            <PatternDefs prefix="tv" hatch={colorOf(theme, 'degraded')} conflict={colorOf(theme, 'conflict')} dots={colorOf(theme, 'afhMark')} bg={colorOf(theme, 'bg')} />
            <rect x="0" y="0" width={W} height={geo.height} fill={colorOf(theme, 'laneBg')} />
            {/* ruler */}
            <g aria-hidden="true">
              {ticks.map((t) => (<g key={t.t}><line x1={xOf(v, t.t, W)} y1={RULER_H - 6} x2={xOf(v, t.t, W)} y2={geo.height} stroke={colorOf(theme, 'border')} strokeWidth="1" opacity="0.5" /><text x={xOf(v, t.t, W) + (xOf(v, t.t, W) > W - 64 ? -3 : 3)} textAnchor={xOf(v, t.t, W) > W - 64 ? 'end' : 'start'} y={RULER_H - 10} fontSize="12" className="mono" fill={colorOf(theme, 'textMuted')}>{t.label}</text></g>))}
              {slots.map((s) => (<g key={`s${s.t}`}><line x1={xOf(v, s.t, W)} y1={RULER_H} x2={xOf(v, s.t, W)} y2={geo.height} stroke={colorOf(theme, 'border')} strokeWidth="1" strokeDasharray="2 3" opacity="0.8" /><text x={xOf(v, s.t, W) + 2} y={RULER_H + 12} fontSize="12" className="mono" fill={colorOf(theme, 'textMuted')} opacity="0.9">{s.n}</text></g>))}
            </g>
            {/* conflict bands sit behind the blocks and span all lanes */}
            <g className="bands">
              {bands.map((b) => (<BandShape key={b.conflict.id} band={b} number={b.number} ctx={ctx} theme={theme} height={geo.height} selected={b.conflict.id === p.selectedConflictId} flash={!!p.flashBand && b.conflict.id === p.selectedConflictId} onSelect={() => p.onSelectConflict(b.conflict.id)} />))}
            </g>
            {/* group headers and lanes */}
            {(['BT', 'WIFI'] as const).map((tech) => (
              <g key={tech}>
                <rect x="0" y={geo.groupY[tech]} width={W} height={GROUP_H} fill={colorOf(theme, 'panel')} opacity="0.9" />
                {p.collapsed[tech] && <text x="8" y={geo.groupY[tech] + 17} fontSize="12" fill={colorOf(theme, 'textMuted')}>collapsed</text>}
                {!p.collapsed[tech] && (tech === 'BT' ? lanes.bt : lanes.wifi).map((l) => {
                  const ly = geo.laneY.get(l.id)!;
                  const all = laneBlocks.get(l.id) ?? [];
                  const vis = p.muted.has(l.id) ? [] : inView(all, v);
                  const mode = lodMode(vis, v, W);
                  if (mode === 'DENSITY') anyDensity = true;
                  return (
                    <g key={l.id} data-lane-id={l.id}>
                      <rect x="0" y={ly} width={W} height={LANE_H} fill={l.index % 2 ? colorOf(theme, 'laneAlt') : colorOf(theme, 'laneBg')} opacity="0.85" />
                      <line x1="0" y1={ly + LANE_H} x2={W} y2={ly + LANE_H} stroke={colorOf(theme, 'border')} strokeWidth="1" />
                      <line x1="0" y1={ly + LANE_H / 2} x2={W} y2={ly + LANE_H / 2} stroke={colorOf(theme, 'border')} strokeWidth="1" strokeDasharray="1 4" opacity="0.7" />
                      {p.muted.has(l.id) && <text x="8" y={ly + 26} fontSize="12" fill={colorOf(theme, 'textMuted')}>hidden</text>}
                      {mode === 'DENSITY' ? (
                        <g data-lod="density">
                          {densityBars(vis, v, W).map((d) => (<rect key={d.x} x={d.x} y={ly + LANE_H - 4 - (d.pct / 100) * (LANE_H - 10)} width={d.w - 1} height={(d.pct / 100) * (LANE_H - 10) + 0.5} fill={laneTint(theme, l.tech, l.index)} opacity="0.85" />))}
                        </g>
                      ) : (
                        <g data-lod="blocks">
                          {vis.filter((b) => !p.reveal || b.start <= (p.cursor ?? 0)).map((b) => {
                            const x = xOf(v, b.start, W), w = Math.max(1.5, (b.duration / span(v)) * W);
                            const dim = (!!p.focusIds && !p.focusIds.has(b.id)) || (!!p.hoverBlockId && p.hoverBlockId !== b.id && !partners.has(b.id) && false);
                            const focusable = focusCount++ < MAX_FOCUSABLE;
                            return (
                              <g key={b.id}>
                                <BlockShape b={b} ctx={ctx} theme={theme} x={x} w={w} laneIdx={l.index} laneY={ly} selected={b.id === p.selectedBlockId} dim={dim} hot={partners.has(b.id)} focusable={focusable} label={labelFor(b, w)} onSelect={() => p.onSelectBlock(b.id)} onHover={(on) => p.onHoverBlock(on ? b.id : undefined)} />
                              </g>
                            );
                          })}
                          {(ghosts.get(l.id) ?? []).filter((b) => b.plannedStart < v.end && b.plannedStart + b.duration > v.start && (!p.reveal || b.plannedStart <= (p.cursor ?? 0))).map((b) => (
                            <GhostShape key={`g${b.id}`} b={b} ctx={ctx} theme={theme} xPlanned={xOf(v, b.plannedStart, W)} wPlanned={Math.max(1.5, (b.duration / span(v)) * W)} xNow={Math.min(W - 2, xOf(v, b.start, W))} laneY={ly} />
                          ))}
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {/* thin lines from a hovered block to its partners in the same conflicts */}
            {p.hoverBlockId && [...partners].map((id) => {
              const a = ctx.blockById.get(p.hoverBlockId!), b = ctx.blockById.get(id);
              if (!a || !b) return null;
              const ya = (geo.laneY.get(a.taskId) ?? 0) + (a.dir === 'TX' ? TX_Y : RX_Y) + BAR_H / 2, yb = (geo.laneY.get(b.taskId) ?? 0) + (b.dir === 'TX' ? TX_Y : RX_Y) + BAR_H / 2;
              return <line key={id} x1={xOf(v, a.start + a.duration / 2, W)} y1={ya} x2={xOf(v, b.start + b.duration / 2, W)} y2={yb} stroke={colorOf(theme, 'conflict')} strokeWidth="1.2" strokeDasharray="3 2" pointerEvents="none" />;
            })}
            {/* shared cursor */}
            {p.cursor !== null && p.cursor >= v.start && p.cursor <= v.end && (<line data-testid="time-cursor" x1={xOf(v, p.cursor, W)} y1={0} x2={xOf(v, p.cursor, W)} y2={geo.height} stroke={colorOf(theme, 'text')} strokeWidth="1" opacity="0.8" pointerEvents="none" />)}
          </svg>
        </div>
      </div>
      <div className="tv-footer">
        <span className="mono readout" data-testid="cursor-readout" aria-live="off">{p.cursor === null ? 'Move the pointer over the diagram to read the time and channels.' : readoutText(ro)}</span>
        <span className="lod" data-testid="lod-label">{anyDensity ? 'Density view: zoom in to see individual blocks' : 'Individual blocks'}</span>
      </div>
      <p className="caption">Look for the numbered red bands: each one is a moment when Bluetooth and Wi-Fi wanted the air together. Select one to read what happened.</p>
    </section>
  );
}

function Minimap({ ticks, windowUs, viewport, width, theme, onViewport }: { ticks: { x: number; severity: string }[]; windowUs: number; viewport: Viewport; width: number; theme: ThemeName; onViewport(v: Viewport): void }) {
  const dragging = useRef<number | null>(null);
  const H = 26;
  const toT = (e: React.PointerEvent) => ((e.clientX - (e.currentTarget as Element).getBoundingClientRect().left) / width) * windowUs;
  const sevColor: Record<string, string> = { HARD: colorOf(theme, 'conflict'), DEGRADED: colorOf(theme, 'degraded'), WARNING: colorOf(theme, 'warning'), TOLERATED: colorOf(theme, 'granted') };
  const box = { x: (viewport.start / windowUs) * width, w: Math.max(6, (span(viewport) / windowUs) * width) };
  return (
    <div className="minimap" style={{ marginLeft: 180 }}>
      <svg width={width} height={H} role="slider" aria-label="Minimap of the whole window. Drag the box to move the view." aria-valuemin={0} aria-valuemax={windowUs} aria-valuenow={Math.round(viewport.start)} tabIndex={0}
        onPointerDown={(e) => { const t = toT(e); dragging.current = t - viewport.start; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); if (t < viewport.start || t > viewport.end) { dragging.current = span(viewport) / 2; onViewport(pan({ start: t - span(viewport) / 2, end: t + span(viewport) / 2 }, 0, windowUs)); } }}
        onPointerMove={(e) => { if (dragging.current !== null) { const t = toT(e) - dragging.current; onViewport(pan({ start: t, end: t + span(viewport) }, 0, windowUs)); } }}
        onPointerUp={() => { dragging.current = null; }}
        onKeyDown={(e) => { const d = span(viewport) / 4; if (e.key === 'ArrowRight') onViewport(pan(viewport, d, windowUs)); if (e.key === 'ArrowLeft') onViewport(pan(viewport, -d, windowUs)); }}>
        <rect width={width} height={H} fill={colorOf(theme, 'panel')} stroke={colorOf(theme, 'border')} />
        {ticks.map((t, i) => (<rect key={i} x={t.x} y="4" width="2" height={H - 8} fill={sevColor[t.severity]} opacity="0.8" />))}
        <rect x={box.x} y="1" width={box.w} height={H - 2} fill={colorOf(theme, 'focus')} fillOpacity="0.12" stroke={colorOf(theme, 'focus')} strokeWidth="2" rx="2" />
      </svg>
    </div>
  );
}
