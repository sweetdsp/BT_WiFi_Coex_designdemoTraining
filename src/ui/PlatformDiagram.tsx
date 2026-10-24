// Platform diagram (spec 7B.7): cores, front-end and antennas drawn from the settings. Active paths glow in the technology
// colour at the time cursor; the shared element of the selected conflict is outlined in red and pulses (a dashed red outline
// and a mark are used as well, so it does not depend on colour or motion).
import { useMemo, useState } from 'react';
import type { EngineResult } from '../engine';
import { activityAt, platformModel, type NodeId } from '../lib/platform';
import { colorOf, type ThemeName } from '../lib/tokens';

interface Props { result: EngineResult; theme: ThemeName; cursor: number | null; selectedConflictId?: string }

export function PlatformDiagram({ result, theme, cursor, selectedConflictId }: Props) {
  const p = result.config.platform;
  const model = useMemo(() => platformModel(p), [p]);
  const conflict = result.conflicts.find((c) => c.id === selectedConflictId);
  const act = activityAt(result, cursor ?? -1, conflict);
  const [help, setHelp] = useState<NodeId | null>(null);
  const c = (k: string) => colorOf(theme, k);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const stressed = act.sharedElement;
  return (
    <section className="platform" aria-label="Platform diagram" data-testid="platform-diagram">
      <h2>Platform</h2>
      <svg viewBox="0 0 560 220" width="560" height="220" role="group" aria-label="Wi-Fi and Bluetooth cores, front end and antennas">
        {model.edges.map((e, i) => {
          const a = byId.get(e.from)!, b = byId.get(e.to)!;
          const on = e.tech === 'SHARED' ? act.activeTech.BT || act.activeTech.WIFI : act.activeTech[e.tech];
          const col = e.tech === 'BT' ? c('bt') : e.tech === 'WIFI' ? c('wifi') : (act.activeTech.BT && act.activeTech.WIFI ? c('conflict') : act.activeTech.WIFI ? c('wifi') : c('bt'));
          return (<line key={i} data-edge={`${e.from}-${e.to}`} data-active={on} x1={a.x + a.w} y1={a.y + a.h / 2} x2={b.x} y2={b.y + b.h / 2} stroke={on ? col : c('border')} strokeWidth={on ? 4 : 2} strokeDasharray={e.tech === 'BT' ? '6 3' : undefined} />);
        })}
        {model.isolationLabel && (
          <g data-testid="isolation-label">
            <line x1="400" y1="80" x2="400" y2="140" stroke={stressed === 'isolation' ? c('conflict') : c('textMuted')} strokeWidth={stressed === 'isolation' ? 3 : 1.5} strokeDasharray="3 3" />
            <text x="408" y="114" fontSize="12" fill={c('text')}>{model.isolationLabel.text}</text>
          </g>
        )}
        {model.nodes.map((n) => {
          const on = act.active.has(n.id);
          const hot = stressed === n.id;
          const tech = n.id === 'wifiCore' || n.id === 'wifiAntenna' ? 'wifi' : n.id === 'btCore' || n.id === 'btAntenna' ? 'bt' : null;
          const glow = on ? (tech ? c(tech) : act.activeTech.BT && act.activeTech.WIFI ? c('conflict') : act.activeTech.WIFI ? c('wifi') : c('bt')) : c('border');
          return (
            <g key={n.id} data-node={n.id} data-active={on} data-stressed={hot} tabIndex={0} role="button" aria-label={`${n.label}. ${hot ? 'Shared element of the selected conflict. ' : ''}Open help.`} className={`pnode${hot ? ' pulse' : ''}`} onClick={() => setHelp(help === n.id ? null : n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHelp(help === n.id ? null : n.id); } }}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="6" fill={c('panel')} stroke={hot ? c('conflict') : glow} strokeWidth={hot ? 4 : on ? 3.5 : 1.5} strokeDasharray={hot ? '6 3' : undefined} />
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle" fontSize="13" fill={c('text')}>{n.label}</text>
              {hot && <g transform={`translate(${n.x + n.w - 8},${n.y + 8})`} aria-hidden="true"><circle r="9" fill={c('conflict')} /><text y="4" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">!</text></g>}
            </g>
          );
        })}
      </svg>
      {help && <p className="platform-help" role="note" data-testid="platform-help">{byId.get(help)!.help}</p>}
      <p className="caption">{conflict ? `The outlined element is what Conflict ${result.conflicts.indexOf(conflict) + 1} had to share.` : 'Move the time cursor to see which paths are active. Select a conflict to see what it shares.'}</p>
    </section>
  );
}
