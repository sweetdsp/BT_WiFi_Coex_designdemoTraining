// Compare mode (spec 7B.10): two stacked time views on the same time axis, a difference table, and the list of settings that changed.
import { useMemo } from 'react';
import type { DataBundle } from '../engine/data';
import type { Tech } from '../engine/types';
import { diffConfigs, diffMetrics } from '../lib/compare';
import { makeCtx } from '../lib/context';
import type { ThemeName } from '../lib/tokens';
import type { Viewport } from '../lib/viewport';
import type { EngineResult } from '../engine';
import { TimeView } from './TimeView';

const noop = () => undefined;
interface Props { a: EngineResult; b: EngineResult; data: DataBundle; theme: ThemeName; viewport: Viewport; onViewport(v: Viewport): void; cursor: number | null; onCursor(t: number): void; collapsed: Record<Tech, boolean>; onToggleGroup(t: Tech): void; onHelp(t: string): void; onClose(): void }

export function CompareView(p: Props) {
  const ca = useMemo(() => makeCtx(p.a, p.data), [p.a, p.data]);
  const cb = useMemo(() => makeCtx(p.b, p.data), [p.b, p.data]);
  const rows = useMemo(() => diffMetrics(p.a.metrics, p.b.metrics), [p.a, p.b]);
  const changes = useMemo(() => diffConfigs(p.a.config, p.b.config, p.data), [p.a, p.b, p.data]);
  const shared = { theme: p.theme, viewport: p.viewport, onViewport: p.onViewport, cursor: p.cursor, onCursor: p.onCursor, onHoverBlock: noop, onSelectBlock: noop, onSelectConflict: noop, muted: new Set<string>(), onToggleMute: noop, collapsed: p.collapsed, onToggleGroup: p.onToggleGroup, reveal: false, onHelp: p.onHelp };
  const better = rows.filter((r) => r.verdict === 'BETTER').length, worse = rows.filter((r) => r.verdict === 'WORSE').length;
  return (
    <section className="compare" data-testid="compare" aria-label="Compare two runs">
      <div className="row"><h2>Compare</h2><span data-testid="compare-summary">{better} improved, {worse} worse, {rows.length - better - worse} unchanged or not graded.</span><button type="button" onClick={p.onClose}>Close compare</button></div>
      <div data-compare="a"><h3>A: {p.a.config.name}</h3><TimeView ctx={ca} {...shared} /></div>
      <div data-compare="b"><h3>B: {p.b.config.name}</h3><TimeView ctx={cb} {...shared} /></div>
      <table className="diff" data-testid="diff-table">
        <caption>Differences, A to B. ▲ is an improvement, ▼ is worse, = is no change. The words say the same thing as the colour.</caption>
        <thead><tr><th>Measure</th><th>A</th><th>B</th><th>Change</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`diff-${r.verdict.toLowerCase()}`} data-metric={r.key} data-verdict={r.verdict}>
              <th scope="row">{r.label}</th><td>{Math.round(r.a * 10) / 10}{r.unit}</td><td>{Math.round(r.b * 10) / 10}{r.unit}</td>
              <td><span aria-hidden="true">{r.arrow}</span> {r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>What you changed</h3>
      {changes.length === 0 ? <p className="muted">The two runs use the same settings.</p> : (
        <ul data-testid="change-list">{changes.map((c, i) => (<li key={i}><strong>{c.what}:</strong> {c.from} → {c.to}</li>))}</ul>
      )}
    </section>
  );
}
