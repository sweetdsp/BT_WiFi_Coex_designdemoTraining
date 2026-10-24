// Learn mode (spec 7B.11): lesson menu, the lesson card, the first-visit tour, the glossary and the assumptions panel.
import { useMemo, useState } from 'react';
import assumptionsRaw from '../data/assumptions.json';
import { glossary, lessons, tourSteps, type LessonState, choose, isCheck, isCorrect, lessonOf, nextStep, prevStep, submit } from '../lib/learn';
import { labelText } from '../lib/context';
import type { SpecLabel } from '../engine/types';
import { Gl } from './Gloss';
import { Modal } from './Dialogs';

export function LessonMenu({ onStart, onClose, done }: { onStart(id: string): void; onClose(): void; done: Record<string, boolean> }) {
  return (
    <Modal title="Learn" label="Lessons" onClose={onClose} testid="lesson-menu" wide>
      <p>Five guided lessons, from easiest to hardest. Each loads a prepared scenario, walks you through it in a few steps, and ends with one question.</p>
      <ol className="lessons">
        {lessons.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onStart(l.id)} data-lesson={l.id}><strong>{l.title}</strong>{done[l.id] ? <span className="badge"> <span aria-hidden="true">✔</span> done</span> : null}</button>
            <p className="muted"><Gl text={l.goal} /></p>
          </li>
        ))}
      </ol>
      <div className="row"><button type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export function LessonCard({ state, onChange, onExit, onFinish }: { state: LessonState; onChange(s: LessonState): void; onExit(): void; onFinish(correct: boolean): void }) {
  const l = lessonOf(state);
  if (!l) return null;
  const check = isCheck(state);
  const total = l.steps.length;
  return (
    <section className="lesson-card" aria-label={`Lesson: ${l.title}`} data-testid="lesson-card">
      <header><h2>{l.title}</h2><button type="button" onClick={onExit} aria-label="Leave the lesson">Leave</button></header>
      {state.step === 0 && !check && <p className="muted lesson-goal" data-testid="lesson-goal"><Gl text={l.goal} /></p>}
      {!check ? (
        <>
          <p className="lesson-progress" data-testid="lesson-progress">Step {state.step + 1} of {total}</p>
          <p className="lesson-caption" aria-live="polite" data-testid="lesson-caption"><Gl text={l.steps[state.step].caption} /></p>
        </>
      ) : (
        <fieldset className="lesson-check" data-testid="lesson-check">
          <legend>Check your understanding</legend>
          <p>{l.check.question}</p>
          {l.check.options.map((o, i) => (
            <label key={i} className="check block"><input type="radio" name="lesson-answer" checked={state.answer === i} disabled={state.checked} onChange={() => onChange(choose(state, i))} /> {o}</label>
          ))}
          {state.checked && (
            <p role="status" data-testid="lesson-result"><strong>{isCorrect(state) ? '✔ Correct.' : '✖ Not quite.'}</strong> {l.check.explanation} <span className="spec-label">{labelText(l.check.label as SpecLabel)}</span></p>
          )}
        </fieldset>
      )}
      <div className="row">
        <button type="button" onClick={() => onChange(prevStep(state))} disabled={state.step === 0}>Back</button>
        {!check && <button type="button" className="primary" onClick={() => onChange(nextStep(state))} data-testid="lesson-next">{state.step === total - 1 ? 'Go to the question' : 'Next'}</button>}
        {check && !state.checked && <button type="button" className="primary" onClick={() => onChange(submit(state))} disabled={state.answer === undefined} data-testid="lesson-submit">Check answer</button>}
        {check && state.checked && <button type="button" className="primary" onClick={() => onFinish(isCorrect(state))} data-testid="lesson-finish">Finish lesson</button>}
      </div>
    </section>
  );
}

export function TourCard({ step, onStep, onClose }: { step: number; onStep(n: number): void; onClose(): void }) {
  const s = tourSteps[step];
  return (
    <section className="tour-card" role="dialog" aria-label="Tour of the page" data-testid="tour-card" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <p className="lesson-progress">Tour, step {step + 1} of {tourSteps.length}</p>
      <h2>{s.title}</h2>
      <p><Gl text={s.text} /></p>
      <div className="row">
        <button type="button" onClick={() => onStep(step - 1)} disabled={step === 0}>Back</button>
        {step < tourSteps.length - 1 ? <button type="button" className="primary" onClick={() => onStep(step + 1)} data-testid="tour-next" autoFocus>Next</button> : <button type="button" className="primary" onClick={onClose} data-testid="tour-done" autoFocus>Done</button>}
        <button type="button" className="link" onClick={onClose} data-testid="tour-skip">Skip the tour</button>
      </div>
    </section>
  );
}

export function GlossaryPanel({ focus, onClose }: { focus?: string; onClose(): void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => glossary.filter((t) => !q || (t.term + ' ' + t.definition).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.term.localeCompare(b.term)), [q]);
  return (
    <Modal title="Glossary" label="Glossary" onClose={onClose} testid="glossary" wide>
      <label>Search <input type="text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the glossary" /></label>
      <dl className="glossary">
        {list.map((t) => (
          <div key={t.id} id={`g-${t.id}`} className={t.id === focus ? 'focus' : undefined} data-term-entry={t.id} ref={(el) => { if (el && t.id === focus) el.scrollIntoView({ block: 'center' }); }}>
            <dt>{t.term} <span className="spec-label">{labelText(t.label)}</span></dt><dd>{t.definition}</dd>
          </div>
        ))}
        {list.length === 0 && <p className="muted">No term matches.</p>}
      </dl>
      <div className="row"><button type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

interface Assumption { id: string; source: string; text: string; label: SpecLabel; milestone?: string; area?: string }
const all = assumptionsRaw.assumptions as unknown as Assumption[];

export function AssumptionsPanel({ onClose }: { onClose(): void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<'spec' | 'added'>('spec');
  const spec = all.filter((a) => a.id.startsWith('S-')), added = all.filter((a) => !a.id.startsWith('S-'));
  const shown = (group === 'spec' ? spec : added).filter((a) => !q || (a.id + a.text + (a.area ?? '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Assumptions" label="Assumptions" onClose={onClose} testid="assumptions-panel" wide>
      <p>Every choice the tool makes where the specification or the real world leaves room. Each is labelled <em>Standard says</em> (fixed by a public specification) or <em>Implementations vary</em> (a choice real products make differently).</p>
      <div role="tablist" className="tabs" aria-label="Which assumptions">
        <button type="button" role="tab" aria-selected={group === 'spec'} onClick={() => setGroup('spec')} data-testid="as-spec">Stated in the requirements ({spec.length})</button>
        <button type="button" role="tab" aria-selected={group === 'added'} onClick={() => setGroup('added')} data-testid="as-added">Added while building ({added.length})</button>
      </div>
      <label>Search <input type="text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the assumptions" /></label>
      <ul className="assumptions">
        {shown.map((a) => (<li key={a.id} data-assumption={a.id}><p><span className="id">{a.id}</span> <span className="muted">{a.source}{a.area ? ` · ${a.area}` : ''}</span> <span className="spec-label">{labelText(a.label)}</span></p><p>{a.text}</p></li>))}
      </ul>
      <div className="row"><button type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
