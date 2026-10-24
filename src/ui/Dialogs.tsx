// Modal dialogs: the warnings confirmation (7C.5, VAL-7) and the keyboard shortcuts list (7B.12). Focus moves in and Escape closes.
import { useEffect, useRef, useState } from 'react';
import type { ValidationIssue } from '../engine/types';

export function Modal({ title, onClose, children, label, testid, wide }: { title: string; onClose(): void; children: React.ReactNode; label: string; testid?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, a[href], select')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testid ?? (label === 'Warnings' ? 'warn-dialog' : 'shortcuts')}>
        <h2>{title}</h2>{children}
      </div>
    </div>
  );
}

export function WarningsDialog({ warnings, onConfirm, onCancel }: { warnings: ValidationIssue[]; onConfirm(remember: boolean): void; onCancel(): void }) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal title="Generate with warnings?" onClose={onCancel} label="Warnings">
      <p>The scenario has {warnings.length} warning{warnings.length === 1 ? '' : 's'}. It can still run, but the result may not show what you expect.</p>
      <ul>{warnings.map((w, i) => (<li key={i}><span aria-hidden="true">▲</span> {w.message}</li>))}</ul>
      <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Do not ask again in this session</label>
      <div className="row"><button type="button" className="primary" onClick={() => onConfirm(remember)} data-testid="confirm-generate">Generate anyway</button><button type="button" onClick={onCancel}>Go back and fix</button></div>
    </Modal>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['+  and  −', 'Zoom the time view in and out'], ['← and →', 'Pan the time view'], ['Home', 'Show the whole window'], ['N  and  P', 'Next and previous conflict'],
  ['Space', 'Play or pause'], ['L', 'Show or hide the legend'], ['Ctrl+Z', 'Undo the last settings change'], ['Ctrl+Shift+Z  or  Ctrl+Y', 'Redo'], ['Ctrl+Enter', 'Generate the Coex view'], ['?', 'Show this list'], ['Esc', 'Close a panel, tooltip or dialog'],
];

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} label="Keyboard shortcuts">
      <table className="prio"><tbody>{SHORTCUTS.map(([k, v]) => (<tr key={k}><th scope="row"><kbd>{k}</kbd></th><td>{v}</td></tr>))}</tbody></table>
      <div className="row"><button type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
