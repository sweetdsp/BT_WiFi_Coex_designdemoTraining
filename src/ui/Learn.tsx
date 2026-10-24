// Learn mode (spec 7B.11): lesson menu, the lesson card, the first-visit tour, the glossary and the assumptions panel.
import { tourSteps, type LessonState, choose, isCheck, isCorrect, lessonOf, nextStep, prevStep, submit } from '../lib/learn';
import { labelText } from '../lib/context';
import type { SpecLabel } from '../engine/types';
import { Gl } from './Gloss';

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

