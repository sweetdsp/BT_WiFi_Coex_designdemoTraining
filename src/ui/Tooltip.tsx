// Tooltips (spec 7B.5): appear after 300 ms of hovering, stay while the pointer is on them, are available by keyboard focus,
// and never cover the thing they describe. Content is built by the pure functions in src/lib/tooltips.ts.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tip } from '../lib/tooltips';

export const HOVER_DELAY_MS = 300;

interface Shown { tip: Tip; rect: DOMRect }
interface Api {
  show(tip: Tip, el: Element, immediate?: boolean): void;
  hide(): void;
  keep(): void;
  openHelp(topic: string): void;
}

const Ctx = createContext<Api | null>(null);

export function TooltipProvider({ children, onLearnMore }: { children: ReactNode; onLearnMore: (topic: string) => void }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const clear = () => { window.clearTimeout(timer.current); window.clearTimeout(hideTimer.current); };
  const show = useCallback((tip: Tip, el: Element, immediate = false) => {
    clear();
    const rect = el.getBoundingClientRect();
    if (immediate) setShown({ tip, rect });
    else timer.current = window.setTimeout(() => setShown({ tip, rect }), HOVER_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    // A short grace period lets the pointer travel onto the tooltip itself, which stays while the pointer is on it.
    hideTimer.current = window.setTimeout(() => setShown(null), 120);
  }, []);
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(null); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clear(); };
  }, []);

  return (
    <Ctx.Provider value={{ show, hide, keep, openHelp: onLearnMore }}>
      {children}
      {shown && <FloatingTip shown={shown} api={{ show, hide, keep, openHelp: onLearnMore }} />}
    </Ctx.Provider>
  );
}

function FloatingTip({ shown, api }: { shown: Shown; api: Api }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const r = shown.rect;
    // Above the item if there is room, otherwise below it, so the tip never sits on the item.
    const top = r.top - h - 8 >= 4 ? r.top - h - 8 : Math.min(window.innerHeight - h - 4, r.bottom + 8);
    const left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
    setPos({ left, top });
  }, [shown]);
  const { tip } = shown;
  return (
    <div ref={ref} role="tooltip" className="tooltip" style={{ left: pos.left, top: pos.top }} onMouseEnter={api.keep} onMouseLeave={api.hide} data-testid="tooltip">
      <div className="tooltip-title">{tip.title}</div>
      {tip.fields.length > 0 && (
        <dl className="tooltip-fields">
          {tip.fields.map((f) => (<div key={f.label}><dt>{f.label}</dt><dd className={/^(Time|Frequency|Delay)$/.test(f.label) ? 'mono' : undefined}>{f.value}</dd></div>))}
        </dl>
      )}
      <p className="tooltip-sentence">{tip.sentence}</p>
      <div className="tooltip-foot">
        <span className="spec-label">{tip.label}</span>
        {tip.learnMore && <button type="button" className="link" onClick={() => api.openHelp(tip.learnMore!)}>Learn more</button>}
      </div>
    </div>
  );
}

/** Handlers that show a tooltip on hover (after 300 ms) and on keyboard focus (at once). */
export function useTip(getTip: () => Tip | undefined) {
  const api = useContext(Ctx);
  return {
    onMouseEnter: (e: React.MouseEvent) => { const t = getTip(); if (t && api) api.show(t, e.currentTarget); },
    onMouseLeave: () => api?.hide(),
    onFocus: (e: React.FocusEvent) => { const t = getTip(); if (t && api) api.show(t, e.currentTarget, true); },
    onBlur: () => api?.hide(),
  };
}

export function useTooltipApi() { return useContext(Ctx); }
