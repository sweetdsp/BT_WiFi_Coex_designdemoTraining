// Task selection (spec 6.1, 6.2, 7B.12): two tabs, add and remove tasks, edit every parameter, filter by Core version,
// grey out what the device cannot do, and one-click use cases. Every change goes up to the app, which records it for undo.
import { useEffect, useState } from 'react';
import type { DataBundle } from '../engine/data';
import { defaultParams } from '../engine/params';
import type { ParamDef, ParamValue, PlatformConfig, ScenarioConfig, Tech, TaskDef, ValidationIssue } from '../engine/types';
import { issuesFor } from '../lib/draft';
import { taskSupport, valueSupport } from '../lib/support';
import { Info, settingTip } from './Info';

interface Props {
  cfg: ScenarioConfig; data: DataBundle; issues: ValidationIssue[];
  onAdd(taskId: string): void; onRemove(id: string): void; onParam(id: string, name: string, v: ParamValue): void; onResetTask(id: string): void;
  reveal?: { id: string; n: number };
  onUseCase(id: string): void; onClear(): void; onResetAll(): void; onHelp(topic: string): void;
}

const CATEGORY_ORDER: Record<string, string> = { CLASSIC: 'Bluetooth Classic', LE: 'Bluetooth Low Energy', WIFI: 'Wi-Fi' };
const range = (d: ParamDef) => d.type === 'number' ? `${d.min ?? '–'} to ${d.max ?? '–'}${d.unit ? ' ' + d.unit : ''}` : d.type === 'boolean' ? 'on or off' : (d.choices ?? []).join(', ');

export function IssueBadge({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null;
  const e = issues.some((i) => i.severity === 'ERROR');
  return <span className={`badge ${e ? 'badge-error' : 'badge-warn'}`} title={issues.map((i) => i.message).join(' ')}><span aria-hidden="true">{e ? '✖' : '▲'}</span> {e ? 'Error' : 'Warning'}</span>;
}

function ParamRow({ inst, def, name, pd, p, data, issues, onParam }: { inst: { instanceId: string; params: Record<string, ParamValue> }; def: TaskDef; name: string; pd: ParamDef; p: PlatformConfig; data: DataBundle; issues: ValidationIssue[]; onParam: Props['onParam'] }) {
  const v = inst.params[name];
  const bad = issues.filter((i) => i.items.some((it) => it.kind === 'task' && it.instanceId === inst.instanceId && it.param === name));
  const id = `p-${inst.instanceId}-${name}`;
  const tip = settingTip(pd.label, { help: pd.help, range: range(pd), typical: `default ${String(pd.default)}${pd.unit ? ' ' + pd.unit : ''}`, spec: pd.spec });
  let input;
  if (pd.type === 'number') {
    input = <input id={id} type="number" value={Number.isFinite(v as number) ? (v as number) : ''} min={pd.min} max={pd.max} step="any" aria-invalid={bad.length > 0} onChange={(e) => onParam(inst.instanceId, name, e.target.value === '' ? NaN : Number(e.target.value))} />;
  } else if (pd.type === 'boolean') {
    input = <input id={id} type="checkbox" checked={v === true} onChange={(e) => onParam(inst.instanceId, name, e.target.checked)} />;
  } else {
    input = (
      <select id={id} value={String(v)} aria-invalid={bad.length > 0} onChange={(e) => { const c = pd.choices?.find((x) => String(x) === e.target.value); onParam(inst.instanceId, name, c ?? e.target.value); }}>
        {(pd.choices ?? []).map((c) => { const s = valueSupport(def, name, c, p, data); return <option key={String(c)} value={String(c)} disabled={!s.ok}>{String(c)}{!s.ok ? ` (${s.reason})` : ''}</option>; })}
      </select>
    );
  }
  return (
    <div className="param">
      <label htmlFor={id}>{pd.label}{pd.unit ? <span className="muted"> ({pd.unit})</span> : null}</label>
      {input}
      <Info tip={tip} name={pd.label} />
      {bad.map((b) => (<p key={b.id} className="param-err" role="alert"><span aria-hidden="true">✖</span> {b.message}</p>))}
    </div>
  );
}

export function TaskPicker(p: Props) {
  const [tech, setTech] = useState<Tech>('BT');
  const [core, setCore] = useState<number>(0);
  const [openId, setOpenId] = useState<string | undefined>();
  useEffect(() => { if (p.reveal) setOpenId(p.reveal.id); }, [p.reveal]);
  const defs = p.data.tasks.filter((t) => t.tech === tech && (tech === 'WIFI' || core === 0 || t.minVersion <= core));
  const cores = [...new Set(p.data.tasks.filter((t) => t.tech === 'BT').map((t) => t.minVersion))].sort((a, b) => a - b);
  const selected = p.cfg.tasks;
  const counts = { BT: selected.filter((t) => p.data.taskIndex.get(t.taskId)?.tech === 'BT').length, WIFI: selected.filter((t) => p.data.taskIndex.get(t.taskId)?.tech === 'WIFI').length };
  const groups = [...new Set(defs.map((d) => d.category))];

  return (
    <div className="tasks-panel" data-testid="task-picker">
      <div role="tablist" aria-label="Task type" className="tabs">
        {(['BT', 'WIFI'] as const).map((t) => (
          <button key={t} role="tab" type="button" id={`tab-${t}`} aria-selected={tech === t} aria-controls="task-tabpanel" onClick={() => setTech(t)} data-testid={`tab-${t}`}>
            {t === 'BT' ? 'Bluetooth Tasks' : 'Wi-Fi Tasks'} <span className="count">{counts[t]}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="task-tabpanel" aria-labelledby={`tab-${tech}`}>
        {tech === 'BT' && (
          <div className="row">
            <label>Use case <select value="" aria-label="Load a Bluetooth use case" data-testid="use-case" onChange={(e) => e.target.value && p.onUseCase(e.target.value)}>
              <option value="">Choose…</option>{p.data.useCases.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}</select></label>
            <label>Core version <select value={core} aria-label="Show tasks up to this Core version" onChange={(e) => setCore(Number(e.target.value))}>
              <option value={0}>All</option>{cores.map((c) => (<option key={c} value={c}>up to {c.toFixed(1)}</option>))}</select></label>
          </div>
        )}
        <ul className="catalogue">
          {groups.map((g) => (
            <li key={g}><h4>{CATEGORY_ORDER[g] ?? g}</h4>
              <ul>
                {defs.filter((d) => d.category === g).map((d) => {
                  const s = taskSupport(d, p.cfg.platform, p.data);
                  return (
                    <li key={d.id} className="task-def">
                      <button type="button" className="add" disabled={!s.ok} onClick={() => p.onAdd(d.id)} data-task={d.id} aria-label={`Add ${d.name}`} title={s.ok ? d.description : `Not available: ${s.reason}`}>+ {d.name}</button>
                      <Info tip={settingTip(d.name, { help: d.description, effect: d.help, typical: d.introducedIn, spec: d.specLabel, learnMore: d.id })} name={d.name} />
                      {!s.ok && <span className="muted small-note">{s.reason}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <h3>Selected tasks <span className="count">{selected.length}</span></h3>
      {selected.length === 0 && <p className="muted" data-testid="no-tasks">Nothing selected yet. Add a task above, or pick a use case.</p>}
      <ul className="selected" data-testid="selected-tasks">
        {selected.map((t) => {
          const def = p.data.taskIndex.get(t.taskId);
          if (!def) return (<li key={t.instanceId}><span className="badge badge-error">✖ Unknown task</span> {t.taskId} <button type="button" onClick={() => p.onRemove(t.instanceId)}>Remove</button></li>);
          const mine = issuesFor(p.issues, { instanceId: t.instanceId });
          const open = openId === t.instanceId;
          const changed = JSON.stringify(t.params) !== JSON.stringify(defaultParams(def));
          return (
            <li key={t.instanceId} className={`sel ${def.tech === 'BT' ? 'sel-bt' : 'sel-wifi'}`} data-instance={t.instanceId}>
              <div className="sel-head">
                <button type="button" className="link" aria-expanded={open} aria-controls={`pe-${t.instanceId}`} onClick={() => setOpenId(open ? undefined : t.instanceId)}>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span> {def.tech === 'BT' ? 'BT' : 'Wi-Fi'}: {def.name}{changed ? ' (edited)' : ''}
                </button>
                <IssueBadge issues={mine} />
                <button type="button" className="icon" onClick={() => p.onRemove(t.instanceId)} aria-label={`Remove ${def.name}`} data-testid={`remove-${t.instanceId}`}>✕</button>
              </div>
              {open && (
                <div id={`pe-${t.instanceId}`} className="params">
                  {Object.entries(def.params).map(([name, pd]) => (<ParamRow key={name} inst={t} def={def} name={name} pd={pd} p={p.cfg.platform} data={p.data} issues={p.issues} onParam={p.onParam} />))}
                  <button type="button" onClick={() => p.onResetTask(t.instanceId)}>Reset this task to its defaults</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button type="button" onClick={p.onClear} disabled={selected.length === 0} data-testid="clear-tasks">Clear all tasks</button>
        <button type="button" onClick={p.onResetAll} data-testid="reset-all">Reset everything</button>
      </div>
    </div>
  );
}
