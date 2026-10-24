// Undo and redo for settings changes (spec 7B.12). Pure and generic.
export interface Entry<T> { state: T; label: string }
export interface History<T> { past: Entry<T>[]; present: Entry<T>; future: Entry<T>[] }

export const MAX_HISTORY = 100;

export function createHistory<T>(state: T, label = 'Start'): History<T> {
  return { past: [], present: { state, label }, future: [] };
}

/** Record a new state. Does nothing if it equals the current one. */
export function pushState<T>(h: History<T>, state: T, label: string): History<T> {
  if (JSON.stringify(h.present.state) === JSON.stringify(state)) return h;
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: { state, label }, future: [] };
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** Replace the present state without adding a step, so typing a number in one box is one undo step, not one per key. */
export function amend<T>(h: History<T>, state: T, label: string): History<T> {
  if (JSON.stringify(h.present.state) === JSON.stringify(state)) return h;
  if (h.past.length === 0) return pushState(h, state, label);
  return { ...h, present: { state, label }, future: [] };
}
