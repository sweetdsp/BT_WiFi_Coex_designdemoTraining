// Frequency view (spec 7A.11, 7B.6): the 2.4 GHz band, the Wi-Fi footprint with its guard margin, Bluetooth hops as a waterfall
// or a histogram, hops circled in red when they land in the footprint during an overlap, and the adaptive hopping map.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewCtx } from '../lib/context';
import { BAND_HIGH, BAND_LOW, channelTip, freqModel, type FreqModel, type Hop } from '../lib/freq';
import { colorOf, type ThemeName } from '../lib/tokens';
import { PatternDefs } from './Marks';
import { useTip } from './Tooltip';
import type { Tip } from '../lib/tooltips';

export type FreqMode = 'WATERFALL' | 'HISTOGRAM';
const LEFT = 36, RIGHT = 12, TOP = 18;

interface Props {
  ctx: ViewCtx;
  theme: ThemeName;
  mode: FreqMode;
  onMode(m: FreqMode): void;
  /** Time range shown in the waterfall; follows the time view unless unlinked. */
  range: [number, number];
  linked: boolean;
  onLinked(v: boolean): void;
  cursor: number | null;
  selectedBlockId?: string;
  hoverBlockId?: string;
  onHoverBlock(id?: string): void;
  onSelectBlock(id: string): void;
  width?: number;
}

function Cell({ x, y, w, h, tipFn, children, label }: { x: number; y: number; w: number; h: number; tipFn: () => Tip; children?: React.ReactNode; label: string }) {
  const tip = useTip(tipFn);
  return (<g tabIndex={0} role="img" aria-label={label} {...tip}><rect x={x} y={y} width={w} height={h} fill="transparent" />{children}</g>);
}

export function FrequencyView(p: Props) {
  const { ctx, theme } = p;
  const box = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMeasured(Math.max(320, Math.floor(el.clientWidth - 16))));
    ro.observe(el);
    setMeasured(Math.max(320, Math.floor(el.clientWidth - 16)));
    return () => ro.disconnect();
  }, []);
  const W = p.width ?? measured ?? 640;
  const model = useMemo(() => freqModel(ctx, p.linked ? p.range : null), [ctx, p.linked, p.range[0], p.range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = useMemo(() => freqModel(ctx, null), [ctx]);
  const plotW = W - LEFT - RIGHT;
  const fx = (f: number) => LEFT + ((f - BAND_LOW) / (BAND_HIGH - BAND_LOW)) * plotW;
  const H = 230;
  const histH = 140;
  const windowUs = ctx.result.config.platform.windowUs;
  const [t0, t1] = p.linked ? p.range : [0, windowUs];
  const ty = (t: number) => TOP + 26 + ((t - t0) / Math.max(1, t1 - t0)) * (H - TOP - 26 - 64);
  const maxCount = Math.max(1, ...model.histogram.map((h) => h.count));
  const c = (k: string) => colorOf(theme, k);

  const axis = [2400, 2420, 2440, 2460, 2480];
  return (
    <section className="freqview" aria-label="Frequency view" data-testid="freq-view" data-area="freq-view" ref={box}>
      <header className="fv-head">
        <h2>Frequency</h2>
        <div role="group" aria-label="Frequency view mode" className="seg">
          <button type="button" aria-pressed={p.mode === 'WATERFALL'} onClick={() => p.onMode('WATERFALL')}>Waterfall</button>
          <button type="button" aria-pressed={p.mode === 'HISTOGRAM'} onClick={() => p.onMode('HISTOGRAM')}>Histogram</button>
        </div>
        <label className="check"><input type="checkbox" checked={p.linked} onChange={(e) => p.onLinked(e.target.checked)} /> Follow the time view</label>
        <span className="muted" data-testid="circled-count">{model.circled} hop{model.circled === 1 ? '' : 's'} circled in red</span>
      </header>
      <svg width={W} height={p.mode === 'WATERFALL' ? H : histH + 90} role="group" aria-label={`Bluetooth hops across the 2.4 GHz band, ${p.mode === 'WATERFALL' ? 'time on the vertical axis' : 'hops per channel'}`}>
        <PatternDefs prefix="fv" hatch={c('degraded')} conflict={c('conflict')} dots={c('afhMark')} bg={c('bg')} />
        <rect x={LEFT} y={TOP} width={plotW} height={(p.mode === 'WATERFALL' ? H : histH + 90) - TOP - 36} fill={c('laneBg')} stroke={c('border')} />
        {/* Wi-Fi footprint: translucent orange band, dashed edges, lighter guard margin */}
        {model.footprints.map((fp) => (
          <g key={`${fp.low}-${fp.high}`} data-testid="footprint">
            <rect x={fx(fp.guardLow)} y={TOP} width={fx(fp.guardHigh) - fx(fp.guardLow)} height={(p.mode === 'WATERFALL' ? H : histH + 90) - TOP - 36} fill={c('wifi')} opacity="0.12" />
            <rect x={fx(fp.low)} y={TOP} width={fx(fp.high) - fx(fp.low)} height={(p.mode === 'WATERFALL' ? H : histH + 90) - TOP - 36} fill={c('wifi')} opacity="0.28" />
            <line x1={fx(fp.low)} y1={TOP} x2={fx(fp.low)} y2={(p.mode === 'WATERFALL' ? H : histH + 90) - 36} stroke={c('wifi')} strokeWidth="1.6" strokeDasharray="5 3" />
            <line x1={fx(fp.high)} y1={TOP} x2={fx(fp.high)} y2={(p.mode === 'WATERFALL' ? H : histH + 90) - 36} stroke={c('wifi')} strokeWidth="1.6" strokeDasharray="5 3" />
            <text x={(fx(fp.low) + fx(fp.high)) / 2} y={TOP + 14} textAnchor="middle" fontSize="12" fontWeight="700" fill={c('text')}>Wi-Fi ch {fp.channel}</text>
          </g>
        ))}
        {axis.map((f) => (<g key={f}><line x1={fx(f)} y1={TOP} x2={fx(f)} y2={(p.mode === 'WATERFALL' ? H : histH + 90) - 36} stroke={c('border')} opacity="0.5" /><text x={fx(f)} y={(p.mode === 'WATERFALL' ? H : histH + 90) - 22} textAnchor="middle" fontSize="12" className="mono" fill={c('textMuted')}>{f}</text></g>))}
        <text x={LEFT + plotW / 2} y={(p.mode === 'WATERFALL' ? H : histH + 90) - 6} textAnchor="middle" fontSize="12" fill={c('textMuted')}>MHz</text>

        {p.mode === 'WATERFALL' ? (
          <g data-mode="waterfall">
            <text x="4" y={TOP + 38} fontSize="12" fill={c('textMuted')}>time</text>
            {p.cursor !== null && p.cursor >= t0 && p.cursor <= t1 && <line data-testid="freq-cursor" x1={LEFT} y1={ty(p.cursor)} x2={LEFT + plotW} y2={ty(p.cursor)} stroke={c('text')} strokeWidth="1" opacity="0.8" />}
            {model.hops.length === 0 && <text x={LEFT + plotW / 2} y={TOP + 70} textAnchor="middle" fontSize="12" fill={c('textMuted')}>No Bluetooth block went out in this time range.</text>}
            {model.hops.map((h) => (<HopDot key={h.blockId} h={h} x={fx(h.freq)} y={ty(h.t)} theme={theme} ctx={ctx} selected={h.blockId === p.selectedBlockId || h.blockId === p.hoverBlockId} onHover={p.onHoverBlock} onSelect={p.onSelectBlock} />))}
          </g>
        ) : (
          <g data-mode="histogram">
            <text x="4" y={TOP + 34} fontSize="12" fill={c('textMuted')}>hops</text>
            <text x="4" y={TOP + 48} fontSize="12" className="mono" fill={c('textMuted')}>max {maxCount}</text>
            {model.histogram.map((hb) => {
              const h = (hb.count / maxCount) * (histH - 10);
              return (
                <Cell key={hb.freq} x={fx(hb.freq) - 3} y={TOP + 20} w={6} h={histH} label={`Channel ${hb.freq - 2402}, ${hb.freq} MHz, ${hb.count} hops`} tipFn={() => { const t = channelTip(model, hb.freq - 2402, 2402); return { title: t.title, fields: t.lines.map((l, i) => ({ label: i === 0 ? 'Adaptive hopping' : 'Hops', value: l })), sentence: 'Bars are taller where more Bluetooth hops landed.', label: 'Implementations vary' }; }}>
                  <rect x={fx(hb.freq) - 2.2} y={TOP + 20 + histH - h} width="4.4" height={Math.max(h, hb.count ? 1.5 : 0)} fill={hb.inFootprint ? c('conflict') : c('bt')} />
                  {hb.inFootprint && <rect x={fx(hb.freq) - 2.2} y={TOP + 20 + histH - h} width="4.4" height={Math.max(h, hb.count ? 1.5 : 0)} fill="url(#fv-hatch)" />}
                  {hb.removed && <rect x={fx(hb.freq) - 2.2} y={TOP + 20} width="4.4" height={histH} fill="url(#fv-dots)" opacity="0.8" />}
                </Cell>
              );
            })}
          </g>
        )}
        {/* adaptive hopping map as a strip under the axis: removed channels in grey with dotted fill */}
        <g data-testid="afh-strip" role="img" aria-label={model.afh.enabled ? `Adaptive hopping map: ${model.afh.classicRemoved.length} channels removed` : 'Adaptive hopping is off: every channel is used'}>
          {full.afhStrip.map((a) => (<rect key={a.channelIndex} x={fx(a.freq) - plotW / 79 / 2} y={(p.mode === 'WATERFALL' ? H : histH + 90) - 34} width={plotW / 79 - 0.4} height="9" fill={a.removed ? 'url(#fv-dots)' : c('bt')} opacity={a.removed ? 1 : 0.45} stroke={a.removed ? c('afhRemoved') : 'none'} strokeWidth="0.6" data-removed={a.removed} />))}
        </g>
      </svg>
      <p className="caption">{model.caption}</p>
      {model.highBands.length > 0 && (
        <div className="highband" data-testid="high-band-panel">
          {model.highBands.map((hb) => (
            <figure key={`${hb.band}-${hb.channel}`}>
              <svg width={W} height="56" role="img" aria-label={`Wi-Fi on ${hb.band} GHz channel ${hb.channel}, centre ${hb.centre} MHz, ${hb.widthMHz} MHz wide`}>
                <rect x={LEFT} y="10" width={plotW} height="26" fill={c('laneBg')} stroke={c('border')} />
                <rect x={LEFT + plotW * 0.4} y="10" width={plotW * 0.2} height="26" fill={c('wifi')} opacity="0.3" stroke={c('wifi')} strokeDasharray="5 3" />
                <text x={LEFT + plotW / 2} y="28" textAnchor="middle" fontSize="12" fontWeight="700" fill={c('text')}>{hb.band} GHz channel {hb.channel} ({hb.centre} MHz, {hb.widthMHz} MHz wide)</text>
              </svg>
              <figcaption>{hb.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function HopDot({ h, x, y, theme, ctx, selected, onHover, onSelect }: { h: Hop; x: number; y: number; theme: ThemeName; ctx: ViewCtx; selected: boolean; onHover(id?: string): void; onSelect(id: string): void }) {
  const m = freqModel; void m;
  const tip = useTip(() => {
    const b = ctx.blockById.get(h.blockId)!;
    return { title: `Channel ${h.channelIndex}, ${h.freq} MHz`, fields: [{ label: 'Block', value: `${ctx.nameOf(b.taskId)} ${b.kind}, ${b.status.toLowerCase()}` }, { label: 'Time', value: `${b.start} µs` }, { label: 'Landed in the Wi-Fi channel during an overlap', value: h.inOverlap ? 'yes' : 'no' }], sentence: h.inOverlap ? 'This hop landed inside the Wi-Fi channel while a Wi-Fi block was on the air.' : 'This hop did not meet Wi-Fi in frequency.', label: 'Implementations vary' };
  });
  const bt = colorOf(theme, 'bt');
  return (
    <g tabIndex={-1} className="hop" data-inoverlap={h.inOverlap} onPointerEnter={() => onHover(h.blockId)} onPointerLeave={() => onHover(undefined)} onClick={() => onSelect(h.blockId)} {...tip}>
      <rect x={x - Math.max(1, h.width * 0.5)} y={y - 1.5} width={Math.max(2, h.width)} height="3" fill={bt} />
      {h.inOverlap && <circle cx={x} cy={y} r="5.5" fill="none" stroke={colorOf(theme, 'conflict')} strokeWidth="1.6" />}
      {selected && <circle cx={x} cy={y} r="8" fill="none" stroke={colorOf(theme, 'selected')} strokeWidth="2" />}
    </g>
  );
}

export type { FreqModel };
