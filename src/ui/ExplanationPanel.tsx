// Explanation panel (spec 7B.8): a conflict list on top, and the selected conflict told as a short story in a fixed order.
import { useMemo, useState } from 'react';
import type { Change } from '../engine/types';
import type { ViewCtx } from '../lib/context';
import { conflictList, explainConflict, neighbour, type Explanation, type SortKey } from '../lib/explanation';
import { colorOf, type ThemeName } from '../lib/tokens';
import { conflictTip } from '../lib/tooltips';
import { useTip } from './Tooltip';

interface Props {
  ctx: ViewCtx;
  theme: ThemeName;
  selectedId?: string;
  onSelect(id: string): void;
  onApply(label: string, changes: Change[]): void;
  hardOnly: boolean;
  onHardOnly(v: boolean): void;
  sort: SortKey;
  onSort(s: SortKey): void;
}

const SEV_WORD: Record<string, string> = { HARD: 'Hard', DEGRADED: 'Degraded', WARNING: 'Warning', TOLERATED: 'Tolerated' };
const SEV_MARK: Record<string, string> = { HARD: '■', DEGRADED: '▲', WARNING: '!', TOLERATED: '✓' };

function Row({ ctx, c, number, selected, onSelect }: { ctx: ViewCtx; c: import('../engine/types').Conflict; number: number; selected: boolean; onSelect(): void }) {
  const tip = useTip(() => conflictTip(c, number, ctx));
  return (
    <li>
      <button type="button" className={`crow${selected ? ' selected' : ''}`} aria-current={selected} onClick={onSelect} {...tip} data-conflict-id={c.id}>
        <span className="num">{number}</span>
        <span className={`sev sev-${c.severity.toLowerCase()}`}><span aria-hidden="true">{SEV_MARK[c.severity]}</span> {SEV_WORD[c.severity]}</span>
        <span className="mono">{(c.overlapStart / 1000).toFixed(2)} ms</span>
        <span className="who">{ctx.nameOf(c.btTaskId)} / {ctx.nameOf(c.wifiTaskId)}</span>
      </button>
    </li>
  );
}

function MiniDiagram({ e, theme }: { e: Explanation; theme: ThemeName }) {
  const d = e.why.diagram;
  const c = (k: string) => colorOf(theme, k);
  const t0 = Math.min(d.time.bt[0], d.time.wifi[0]), t1 = Math.max(d.time.bt[1], d.time.wifi[1]);
  const f0 = Math.min(d.freq.bt[0], d.freq.wifi[0] - d.freq.guard) - 2, f1 = Math.max(d.freq.bt[1], d.freq.wifi[1] + d.freq.guard) + 2;
  const X = (t: number) => 6 + ((t - t0) / Math.max(1, t1 - t0)) * 208, Y = (f: number) => 6 + ((f - f0) / Math.max(1, f1 - f0)) * 60;
  const ob = e.involved[0];
  return (
    <svg width="440" height="86" viewBox="0 0 440 86" role="img" aria-label="Small diagram of the overlap in time on the left and in frequency on the right" className="mini">
      <text x="6" y="10" fontSize="12" fill={c('textMuted')} transform="translate(0,72)">time →</text>
      <rect x={X(d.time.bt[0])} y="8" width={Math.max(2, X(d.time.bt[1]) - X(d.time.bt[0]))} height="22" fill={ob.dir === 'TX' ? c('bt') : c('btLight')} stroke={c('bt')} strokeWidth="1.5" rx="2" />
      <rect x={X(d.time.wifi[0])} y="38" width={Math.max(2, X(d.time.wifi[1]) - X(d.time.wifi[0]))} height="22" fill={e.involved[1].dir === 'TX' ? c('wifi') : c('wifiLight')} stroke={c('wifi')} strokeWidth="1.5" rx="2" />
      <rect x={Math.max(X(d.time.bt[0]), X(d.time.wifi[0]))} y="6" width={Math.max(2, Math.min(X(d.time.bt[1]), X(d.time.wifi[1])) - Math.max(X(d.time.bt[0]), X(d.time.wifi[0])))} height="56" fill={c('conflict')} opacity="0.18" stroke={c('conflict')} strokeDasharray="3 2" />
      <g transform="translate(226,0)">
        <text x="6" y="80" fontSize="12" fill={c('textMuted')}>frequency →</text>
        <rect x="6" y={Y(d.freq.wifi[0] - d.freq.guard)} width="200" height={Math.max(2, Y(d.freq.wifi[1] + d.freq.guard) - Y(d.freq.wifi[0] - d.freq.guard))} fill={c('wifi')} opacity="0.15" />
        <rect x="6" y={Y(d.freq.wifi[0])} width="200" height={Math.max(2, Y(d.freq.wifi[1]) - Y(d.freq.wifi[0]))} fill={c('wifi')} opacity="0.3" stroke={c('wifi')} strokeDasharray="4 3" />
        <rect x="6" y={Y(d.freq.bt[0])} width="200" height={Math.max(3, Y(d.freq.bt[1]) - Y(d.freq.bt[0]))} fill={c('bt')} />
        <text x="10" y={Y(d.freq.bt[0]) - 2} fontSize="12" fill={c('text')}>BT {ob.freq} MHz</text>
      </g>
    </svg>
  );
}

export function ExplanationPanel({ ctx, theme, selectedId, onSelect, onApply, hardOnly, onHardOnly, sort, onSort }: Props) {
  const list = useMemo(() => conflictList(ctx, sort, hardOnly), [ctx, sort, hardOnly]);
  const conflict = ctx.conflictById.get(selectedId ?? '');
  const e = useMemo(() => (conflict ? explainConflict(conflict, ctx) : null), [conflict, ctx]);
  const [open, setOpen] = useState(true);
  void open; void setOpen;
  return (
    <aside className="explain" aria-label="Explanation" data-testid="explanation-panel">
      <header className="ex-head">
        <h2>Conflicts <span className="muted">({list.length})</span></h2>
        <div className="ex-controls">
          <label>Sort <select value={sort} onChange={(ev) => onSort(ev.target.value as SortKey)} aria-label="Sort conflicts"><option value="time">by time</option><option value="severity">by severity</option><option value="task">by task</option></select></label>
          <label className="check"><input type="checkbox" checked={hardOnly} onChange={(ev) => onHardOnly(ev.target.checked)} /> Hard only</label>
          <button type="button" onClick={() => { const id = neighbour(list, selectedId, -1); if (id) onSelect(id); }} aria-label="Previous conflict" disabled={list.length === 0}>‹ Previous</button>
          <button type="button" onClick={() => { const id = neighbour(list, selectedId, 1); if (id) onSelect(id); }} aria-label="Next conflict" disabled={list.length === 0}>Next ›</button>
        </div>
      </header>
      {list.length === 0 ? <p className="muted">No conflicts to show. Either the traffic never meets, or the settings keep Bluetooth and Wi-Fi apart.</p> : (
        <ul className="clist" aria-label="Conflict list">{list.map((x) => (<Row key={x.conflict.id} ctx={ctx} c={x.conflict} number={x.number} selected={x.conflict.id === selectedId} onSelect={() => onSelect(x.conflict.id)} />))}</ul>
      )}
      {!e ? <p className="empty-note">Select a conflict in the list or click a numbered band in the time view to read what happened and why.</p> : (
        <article className="story" aria-live="polite" data-testid="story">
          <h3>Conflict {e.number}: {SEV_WORD[e.severity]}</h3>
          <section><h4>1. What happened</h4><p>{e.what.text} <span className="spec-label">{e.what.label}</span></p></section>
          <section><h4>2. Who was involved</h4>
            <ul className="involved">{e.involved.map((i) => (
              <li key={i.blockId}><span className="chip" style={{ background: colorOf(theme, i.tech === 'BT' ? (i.dir === 'TX' ? 'bt' : 'btLight') : (i.dir === 'TX' ? 'wifi' : 'wifiLight')), borderColor: colorOf(theme, i.tech === 'BT' ? 'bt' : 'wifi') }} aria-hidden="true" />
                <strong>{i.role}:</strong> {i.name}, {i.kind} {i.dir}, <span className="mono">{i.start}–{i.end} µs, {i.freq} MHz ({i.width} MHz wide)</span>, final status {i.status.toLowerCase()}</li>))}</ul></section>
          <section><h4>3. Why it was a conflict</h4><MiniDiagram e={e} theme={theme} /><p>{e.why.text} <span className="spec-label">{e.why.label}</span></p></section>
          <section><h4>4. Who won, and why</h4>
            {e.who ? (<>
              <table className="prio"><thead><tr><th scope="col">Block</th><th scope="col">Priority</th><th scope="col">Base</th><th scope="col">Waiting</th><th scope="col">Anchor</th></tr></thead>
                <tbody>{e.who.priorities.map((r, i) => (<tr key={i} className={r.name === e.who!.winner ? 'winner' : ''}><th scope="row">{r.name}{r.name === e.who!.winner ? ' (won)' : ''}</th><td className="mono">{r.value}{r.critical ? ' critical' : ''}</td><td className="mono">{r.base}</td><td className="mono">{r.waiting ?? '–'}</td><td>{r.anchor ? 'yes' : 'no'}</td></tr>))}</tbody></table>
              <p>{e.who.text} <span className="spec-label">{e.who.label}</span></p></>) : <p>No arbitration was needed for this {e.severity.toLowerCase()} overlap. <span className="spec-label">Implementations vary</span></p>}</section>
          <section><h4>5. What it means for the user</h4><p>{e.means.text} <span className="spec-label">{e.means.label}</span></p></section>
          <section><h4>6. What would change it</h4>
            {e.changes.length === 0 ? <p className="muted">No simple change is suggested for this conflict.</p> : (
              <ul className="suggest">{e.changes.map((s) => (<li key={s.id}><button type="button" onClick={() => onApply(s.label, s.changes)} data-suggestion={s.id}>{s.label}</button><span className="muted"> {s.why} </span><span className="spec-label">{s.spec}</span></li>))}</ul>)}</section>
          <section><h4>7. Label</h4><p className="muted">Each statement above carries "Standard says" or "Implementations vary". Arbitration rules, priorities and thresholds are implementation choices; the shared-antenna rule that a transmit blocks a receive is physics.</p></section>
        </article>
      )}
    </aside>
  );
}
