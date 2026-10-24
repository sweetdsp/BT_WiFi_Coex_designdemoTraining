// Legend (spec FR-21, 7B.3): every colour cue with its pattern and shape, so it reads in greyscale (UX-3).
import { colorOf, tokens, type ThemeName } from '../lib/tokens';
import { legendTip } from '../lib/tooltips';
import { Mark, PatternDefs, type MarkKind } from './Marks';
import { useTip } from './Tooltip';

function Swatch({ id, theme }: { id: string; theme: ThemeName }) {
  const c = (k: string) => colorOf(theme, k);
  const W = 44, H = 22;
  const prefix = `lg-${id}`;
  const base = (fill: string, stroke: string, extra?: React.ReactNode) => (<><rect x="3" y="3" width={W - 6} height={H - 6} rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />{extra}</>);
  let body: React.ReactNode;
  let mark: MarkKind | undefined;
  switch (id) {
    case 'bluetooth': body = (<>{base(c('bt'), c('bt'))}<rect x="3" y={H - 8} width={W - 6} height="5" fill={c('btLight')} stroke={c('bt')} strokeWidth="1.5" /></>); break;
    case 'wifi': body = (<>{base(c('wifi'), c('wifi'))}<rect x="3" y={H - 8} width={W - 6} height="5" fill={c('wifiLight')} stroke={c('wifi')} strokeWidth="1.5" /></>); break;
    case 'conflict': body = (<><rect width={W} height={H} fill={c('conflict')} opacity={Number(c('conflictOpacity'))} /><rect width={W} height={H} fill={`url(#${prefix}-conflict)`} /><rect x="0" y="0" width="2" height={H} fill={c('conflict')} /><rect x={W - 2} y="0" width="2" height={H} fill={c('conflict')} /></>); break;
    case 'granted': body = base(c('bt'), c('bt')); mark = 'GRANTED_TICK'; break;
    case 'denied': body = (<>{base(c('btLight'), c('denied'))}<line x1="3" y1={H - 3} x2={W - 3} y2="3" stroke={c('denied')} strokeWidth="2" /></>); mark = 'CROSS'; break;
    case 'delayed': body = (<><rect x="2" y="5" width="14" height="12" rx="2" fill="none" stroke={c('delayedGhost')} strokeWidth="1.5" strokeDasharray="3 2" /><path d={`M16,11 L${W - 18},11`} stroke={c('delayedGhost')} strokeWidth="1.5" strokeDasharray="3 2" markerEnd={`url(#${prefix}-arrow)`} /><rect x={W - 16} y="5" width="14" height="12" rx="2" fill={c('bt')} /></>); break;
    case 'degraded': body = (<>{base(c('bt'), c('bt'))}<rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#${prefix}-hatch)`} /></>); mark = 'TRIANGLE'; break;
    case 'tolerated': body = base(c('bt'), c('bt')); mark = 'TOLERATED_TICK'; break;
    case 'retry': body = base(c('bt'), c('bt')); mark = 'RETRY'; break;
    case 'warning': body = (<><rect width={W} height={H} fill={c('warning')} opacity="0.35" />{base('none', c('bt'))}</>); mark = 'EXCLAMATION'; break;
    case 'afhRemoved': body = (<rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#${prefix}-dots)`} stroke={c('afhRemoved')} strokeWidth="1.5" />); break;
    default: body = (<rect x="3" y="3" width={W - 6} height={H - 6} rx="2" fill={c('bt')} stroke={c('selected')} strokeWidth="2.5" filter={`url(#${prefix}-glow)`} />);
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <PatternDefs prefix={prefix} hatch={c('degraded')} conflict={c('conflict')} dots={c('afhMark')} bg={c('bg')} />
      {body}
      {mark && <Mark kind={mark} x={W - 8} y={7} color={mark === 'CROSS' ? c('denied') : mark === 'TRIANGLE' ? c('degraded') : mark === 'EXCLAMATION' ? c('warning') : mark === 'RETRY' ? c('retry') : c('granted')} attempt={mark === 'RETRY' ? 2 : undefined} size={9} />}
    </svg>
  );
}

function Row({ id, theme }: { id: string; theme: ThemeName }) {
  const cue = tokens.cues.find((c) => c.id === id)!;
  const tip = useTip(() => legendTip(id));
  return (
    <li className="legend-row" tabIndex={0} {...tip} data-cue={id}>
      <Swatch id={id} theme={theme} />
      <span className="legend-text"><strong>{cue.meaning}</strong><span className="muted"> {cue.pattern}; {cue.shape}</span></span>
    </li>
  );
}

export function Legend({ theme, open, onClose }: { theme: ThemeName; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <section className="legend" aria-label="Legend" data-testid="legend">
      <header><h2>Legend</h2><button type="button" onClick={onClose} aria-label="Close legend">Close</button></header>
      <p className="muted">Each colour is paired with a pattern or shape, so the picture also reads in greyscale. TX sits in the upper half of a lane and RX in the lower half. Lanes are labelled with the task name.</p>
      <ul>{tokens.cues.map((c) => (<Row key={c.id} id={c.id} theme={theme} />))}</ul>
    </section>
  );
}
