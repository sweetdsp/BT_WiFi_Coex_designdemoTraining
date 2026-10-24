// Small status marks drawn on blocks and in the legend (spec 7B.3). Every colour cue has a shape or pattern as well.
import type { ReactNode } from 'react';

export type MarkKind = 'GRANTED_TICK' | 'TOLERATED_TICK' | 'CROSS' | 'TRIANGLE' | 'EXCLAMATION' | 'RETRY';

interface Props { kind: MarkKind; x: number; y: number; color: string; attempt?: number; size?: number }

/** One mark centred at x, y. size is the box edge in pixels. */
export function Mark({ kind, x, y, color, attempt, size = 10 }: Props): ReactNode {
  const s = size / 2;
  const t = `translate(${x},${y})`;
  switch (kind) {
    case 'GRANTED_TICK':
      return (<g transform={t} aria-hidden="true"><circle r={s} fill={color} /><path d={`M${-s * 0.55},0 L${-s * 0.1},${s * 0.45} L${s * 0.6},${-s * 0.45}`} stroke="#fff" strokeWidth="1.6" fill="none" /></g>);
    case 'TOLERATED_TICK':
      return (<g transform={t} aria-hidden="true"><circle r={s} fill="none" stroke={color} strokeWidth="1.5" /><path d={`M${-s * 0.55},0 L${-s * 0.1},${s * 0.45} L${s * 0.6},${-s * 0.45}`} stroke={color} strokeWidth="1.5" fill="none" /></g>);
    case 'CROSS':
      return (<g transform={t} aria-hidden="true"><circle r={s} fill="#fff" stroke={color} strokeWidth="1.5" /><path d={`M${-s * 0.5},${-s * 0.5} L${s * 0.5},${s * 0.5} M${s * 0.5},${-s * 0.5} L${-s * 0.5},${s * 0.5}`} stroke={color} strokeWidth="1.8" /></g>);
    case 'TRIANGLE':
      return (<g transform={t} aria-hidden="true"><path d={`M0,${-s} L${s},${s * 0.85} L${-s},${s * 0.85} Z`} fill="#fff" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /><path d={`M0,${-s * 0.35} L0,${s * 0.25}`} stroke={color} strokeWidth="1.6" /><circle cy={s * 0.55} r="0.9" fill={color} /></g>);
    case 'EXCLAMATION':
      return (<g transform={t} aria-hidden="true"><circle r={s} fill={color} stroke="#1B1F24" strokeWidth="1" /><path d={`M0,${-s * 0.55} L0,${s * 0.15}`} stroke="#1B1F24" strokeWidth="1.8" /><circle cy={s * 0.5} r="1" fill="#1B1F24" /></g>);
    case 'RETRY':
      return (
        <g transform={t} aria-hidden="true">
          <circle r={s + 1} fill="#fff" stroke={color} strokeWidth="1.4" />
          <path d={`M${-s * 0.55},${-s * 0.1} A${s * 0.6},${s * 0.6} 0 1 1 ${s * 0.1},${s * 0.6}`} fill="none" stroke={color} strokeWidth="1.3" />
          <path d={`M${-s * 0.9},${-s * 0.1} L${-s * 0.2},${-s * 0.1} L${-s * 0.55},${-s * 0.7} Z`} fill={color} />
          {attempt !== undefined && <text y={s * 0.35} textAnchor="middle" fontSize="7" fontWeight="700" fill={color}>{attempt}</text>}
        </g>
      );
  }
}

/** SVG patterns shared by the time view, frequency view and legend. */
export function PatternDefs({ prefix, hatch, conflict, dots, bg }: { prefix: string; hatch: string; conflict: string; dots: string; bg: string }) {
  return (
    <defs>
      <pattern id={`${prefix}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={hatch} strokeWidth="2" /><line x1="0" y1="3" x2="6" y2="3" stroke={hatch} strokeWidth="1" />
      </pattern>
      <pattern id={`${prefix}-conflict`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke={conflict} strokeWidth="1" opacity="0.6" />
      </pattern>
      <pattern id={`${prefix}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" fill={bg} /><circle cx="2.5" cy="2.5" r="1.1" fill={dots} />
      </pattern>
      <filter id={`${prefix}-glow`} x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" floodOpacity="0.55" /></filter>
      <marker id={`${prefix}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" /></marker>
    </defs>
  );
}
