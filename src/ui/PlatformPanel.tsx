// Platform configuration (spec 6.3, FR-7 to FR-14a): built from src/data/platformFields.json, grouped, with an info
// tooltip on every setting, an editable priority table (FR-13) and the three platform presets.
import { useState } from 'react';
import type { DataBundle, PlatformField } from '../engine/data';
import type { ParamValue, ScenarioConfig, ValidationIssue } from '../engine/types';
import { issuesFor } from '../lib/draft';
import { wifiOptions } from '../lib/support';
import { Info, settingTip } from './Info';
import { IssueBadge } from './TaskPicker';

interface Props {
  cfg: ScenarioConfig; data: DataBundle; issues: ValidationIssue[];
  onField(field: PlatformField['field'], v: ParamValue): void; onPreset(id: string): void; onResetPlatform(): void;
  onOverride(kind: 'base' | 'bufferThreshold', key: string, v: number | undefined): void;
}

function Field({ f, cfg, data, issues, onField }: { f: PlatformField; cfg: ScenarioConfig; data: DataBundle; issues: ValidationIssue[]; onField: Props['onField'] }) {
  const v = cfg.platform[f.field] as ParamValue;
  const mine = issuesFor(issues, { field: f.field });
  const id = `pf-${f.field}`;
  const wo = wifiOptions(cfg.platform, data);
  let choices: (string | number)[] = f.choices ?? [];
  const disabledWhy = (c: string | number): string | undefined => {
    if (f.field === 'wifiBand' && !wo.bands.includes(String(c))) return 'this Wi-Fi generation does not use it';
    if (f.field === 'wifiBandwidth' && !wo.bandwidths.includes(Number(c))) return 'not available for this generation and band';
    return undefined;
  };
  if (f.field === 'wifiBandwidth') choices = [20, 40, 80, 160, 320].filter((c) => f.choices?.includes(c) ?? true);
  const range = f.type === 'number' ? `${f.min ?? '–'} to ${f.max ?? '–'}${f.unit ? ' ' + f.unit : ''}` : f.type === 'boolean' ? 'on or off' : (f.choices ?? []).map((c) => f.choiceLabels?.[String(c)] ?? c).join(', ');
  let input;
  if (f.type === 'number') input = <input id={id} type="number" value={Number.isFinite(v as number) ? (v as number) : ''} min={f.min} max={f.max} step={f.step ?? 'any'} aria-invalid={mine.some((i) => i.severity === 'ERROR')} onChange={(e) => onField(f.field, e.target.value === '' ? NaN : Number(e.target.value))} />;
  else if (f.type === 'boolean') input = <input id={id} type="checkbox" checked={v === true} onChange={(e) => onField(f.field, e.target.checked)} />;
  else input = (
    <select id={id} value={String(v)} onChange={(e) => { const c = choices.find((x) => String(x) === e.target.value); onField(f.field, c ?? e.target.value); }}>
      {choices.map((c) => { const why = disabledWhy(c); return <option key={String(c)} value={String(c)} disabled={!!why}>{f.choiceLabels?.[String(c)] ?? String(c)}{why ? ` (${why})` : ''}</option>; })}
    </select>
  );
  return (
    <div className="param" data-field={f.field}>
      <label htmlFor={id}>{f.label}{f.unit ? <span className="muted"> ({f.unit})</span> : null}</label>
      {input}
      <Info tip={settingTip(f.label, { help: f.help, effect: f.effect, typical: f.typical, range, spec: f.spec })} name={f.label} />
      <IssueBadge issues={mine} />
      {mine.map((b) => (<p key={b.id} className="param-err" role="alert"><span aria-hidden="true">{b.severity === 'ERROR' ? '✖' : '▲'}</span> {b.message}</p>))}
    </div>
  );
}

export function PlatformPanel(p: Props) {
  const groups = [...new Set(p.data.platformFields.map((f) => f.group))];
  const [open, setOpen] = useState<Record<string, boolean>>({ 'Wi-Fi': true, 'Front end': true, Cores: true, Arbitration: true });
  const classes = Object.entries(p.data.priorityTable.classes);
  const buffered = p.data.tasks.filter((t) => t.buffer);
  return (
    <div className="platform-panel" data-testid="platform-panel">
      <div className="row">
        <label>Preset <select value="" aria-label="Load a platform preset" data-testid="platform-preset" onChange={(e) => e.target.value && p.onPreset(e.target.value)}>
          <option value="">Choose…</option>{p.data.platformDefaults.presets.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></label>
        <button type="button" onClick={p.onResetPlatform}>Reset platform</button>
      </div>
      {groups.map((g) => (
        <fieldset key={g} className="group">
          <legend><button type="button" className="link" aria-expanded={open[g] !== false} onClick={() => setOpen({ ...open, [g]: open[g] === false })}><span aria-hidden="true">{open[g] === false ? '▸' : '▾'}</span> {g}</button></legend>
          {open[g] !== false && p.data.platformFields.filter((f) => f.group === g).map((f) => (<Field key={f.field} f={f} cfg={p.cfg} data={p.data} issues={p.issues} onField={p.onField} />))}
        </fieldset>
      ))}
      <fieldset className="group">
        <legend><button type="button" className="link" aria-expanded={open.prio === true} onClick={() => setOpen({ ...open, prio: !open.prio })}><span aria-hidden="true">{open.prio ? '▾' : '▸'}</span> Priority table</button></legend>
        {open.prio && (<>
          <p className="muted small-note">Starting priority of each kind of traffic (higher wins). It is raised while the traffic is urgent. <span className="spec-label">Implementations vary</span></p>
          <table className="prio" data-testid="priority-table">
            <thead><tr><th>Traffic</th><th>Priority</th></tr></thead>
            <tbody>
              {classes.map(([k, c]) => {
                const cur = p.cfg.overrides?.base?.[k] ?? c.base;
                return (<tr key={k}><td><label htmlFor={`pr-${k}`}>{c.name}</label></td><td><input id={`pr-${k}`} type="number" value={Number.isFinite(cur) ? cur : ''} step="1" onChange={(e) => p.onOverride('base', k, e.target.value === '' ? undefined : Number(e.target.value))} /> {p.cfg.overrides?.base?.[k] !== undefined && <button type="button" className="link" onClick={() => p.onOverride('base', k, undefined)}>default {c.base}</button>}</td></tr>);
              })}
            </tbody>
          </table>
          <h4>Buffered streams: packets waiting before the stream turns critical</h4>
          <table className="prio"><tbody>
            {buffered.map((t) => {
              const cur = p.cfg.overrides?.bufferThreshold?.[t.id] ?? t.buffer!.criticalThreshold;
              return (<tr key={t.id}><td><label htmlFor={`bt-${t.id}`}>{t.name}</label></td><td><input id={`bt-${t.id}`} type="number" min="1" value={Number.isFinite(cur) ? cur : ''} onChange={(e) => p.onOverride('bufferThreshold', t.id, e.target.value === '' ? undefined : Number(e.target.value))} /> {p.cfg.overrides?.bufferThreshold?.[t.id] !== undefined && <button type="button" className="link" onClick={() => p.onOverride('bufferThreshold', t.id, undefined)}>default {t.buffer!.criticalThreshold}</button>}</td></tr>);
            })}
          </tbody></table>
        </>)}
      </fieldset>
    </div>
  );
}
