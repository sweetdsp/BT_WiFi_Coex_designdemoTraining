import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/engine/data';
import { runEngine } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import { validate } from '../src/engine/validator';
import { checkVerify, choose, glossary, helpTopics, isCheck, isCorrect, lessons, linkify, nextStep, prevStep, readPath, startLesson, submit, termById, tourSteps } from '../src/lib/learn';

const AREAS = new Set(['topbar', 'left', 'time-view', 'freq-view', 'platform', 'explain', 'summary', 'playback']);

describe('lessons are data and match the engine (UX-7)', () => {
  it('there are six lessons, ordered easiest first, one per worked example', () => {
    expect(lessons.map((l) => l.example)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lessons.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it.each(lessons.map((l) => [l.id, l] as const))('%s has the structure the spec asks for', (_id, l) => {
    expect(l.goal.split('\n').length).toBe(1);
    expect(l.steps.length).toBeGreaterThanOrEqual(3); expect(l.steps.length).toBeLessThanOrEqual(6);
    for (const s of l.steps) { expect(AREAS.has(s.area)).toBe(true); expect(s.caption.length).toBeGreaterThan(20); }
    expect(l.check.options.length).toBeGreaterThanOrEqual(3);
    expect(l.check.answer).toBeGreaterThanOrEqual(0); expect(l.check.answer).toBeLessThan(l.check.options.length);
    expect(l.check.explanation.length).toBeGreaterThan(20);
    expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(l.check.label);
  });
  it.each(lessons.map((l) => [l.id, l] as const))('%s loads a valid preset and its stated facts are true', (_id, l) => {
    const cfg = presetConfig(l.preset, defaultData);
    expect(validate(cfg, defaultData).filter((i) => i.severity === 'ERROR')).toEqual([]);
    const r = runEngine(cfg, defaultData);
    for (const v of l.verify) { const c = checkVerify(r, v); expect(c.ok, `${v.path} ${v.op} ${String(v.value)} but was ${String(c.actual)}`).toBe(true); }
    expect(l.verify.length).toBeGreaterThan(0);
  });
  it('actions use known types and zoom presets', () => {
    for (const l of lessons) for (const s of l.steps) if (s.action) expect(['openFirstConflict', 'freqMode', 'zoom', 'tab']).toContain(s.action.type);
  });
  it('runs from start to the check and scores the answer', () => {
    for (const l of lessons) {
      let s = startLesson(l.id);
      for (let i = 0; i < l.steps.length; i++) { expect(isCheck(s)).toBe(false); s = nextStep(s); }
      expect(isCheck(s)).toBe(true);
      expect(submit(s).checked).toBe(false);
      const wrong = (l.check.answer + 1) % l.check.options.length;
      const bad = submit(choose(s, wrong)); expect(isCorrect(bad)).toBe(false);
      expect(choose(bad, l.check.answer).answer).toBe(wrong); // cannot change after checking
      expect(isCorrect(submit(choose(s, l.check.answer)))).toBe(true);
      expect(prevStep(startLesson(l.id)).step).toBe(0);
    }
  });
  it('lesson text is vendor neutral and every correct answer differs in position or content', () => {
    const text = JSON.stringify(lessons).toLowerCase();
    for (const bad of ['broadcom', 'qualcomm', 'synaptics', 'intel', 'mediatek', 'apple']) expect(text).not.toContain(bad);
    expect(new Set(lessons.map((l) => l.check.answer)).size).toBeGreaterThan(1);
  });
});

describe('tour', () => {
  it('has six steps on known areas', () => { expect(tourSteps.length).toBe(6); for (const s of tourSteps) expect(AREAS.has(s.area)).toBe(true); });
});

describe('glossary', () => {
  it('defines the terms the spec names, in one or two sentences', () => {
    for (const t of ['TX', 'RX', 'slot', 'hop', 'footprint', 'isolation', 'desense', 'arbitration', 'AFH', 'eSCO']) expect(glossary.some((g) => g.match.includes(t)), t).toBe(true);
    for (const g of glossary) { expect((g.definition.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2); expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(g.label); }
    expect(new Set(glossary.map((g) => g.id)).size).toBe(glossary.length);
  });
  it('links terms at first use only, with exact acronym case', () => {
    const seg = linkify('The TX block and a second TX block. Isolation helps; isolation again. A hop, tx lower.');
    const terms = seg.filter((s) => s.term).map((s) => s.term);
    expect(terms).toEqual(['tx', 'isolation', 'hop']);
    expect(seg.map((s) => s.text).join('')).toBe('The TX block and a second TX block. Isolation helps; isolation again. A hop, tx lower.');
  });
  it('does not link inside longer words', () => {
    expect(linkify('Slotted and hopscotch and RXs').some((s) => s.term)).toBe(false);
  });
  it('prefers the longest match', () => { expect(linkify('adaptive frequency hopping').find((s) => s.term)?.term).toBe('afh'); });
  it('every term resolves', () => { for (const g of glossary) expect(termById(g.id)).toBe(g); });
});

describe('help topics', () => {
  it('cover every validation rule topic, labelled', () => {
    const rules = (JSON.parse(JSON.stringify(defaultData.rules)) as { helpTopic: string }[]);
    for (const r of rules) expect(helpTopics.some((h) => h.id === r.helpTopic), r.helpTopic).toBe(true);
    for (const h of helpTopics) expect(['STANDARD', 'IMPLEMENTATION_VARIES']).toContain(h.label);
  });
  it('readPath returns undefined for missing paths', () => { expect(readPath({ a: { b: 1 } }, 'a.b')).toBe(1); expect(readPath({}, 'a.b.c')).toBeUndefined(); });
});
