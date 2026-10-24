// Lessons, tour and glossary (spec 7B.11). All content is data (src/data/lessons.json, tour.json, glossary.json, helpTopics.json).
import lessonsRaw from '../data/lessons.json';
import tourRaw from '../data/tour.json';
import glossaryRaw from '../data/glossary.json';
import helpRaw from '../data/helpTopics.json';
import type { SpecLabel } from '../engine/types';

export type LessonAction = { type: 'openFirstConflict' } | { type: 'freqMode'; value: 'WATERFALL' | 'HISTOGRAM' } | { type: 'zoom'; value: string } | { type: 'tab'; value: string };
export interface LessonStep { area: string; caption: string; action?: LessonAction }
export interface Verify { path: string; op: '==' | '>' | '<' | '>=' | '<='; value: number | boolean | string }
export interface LessonCheck { question: string; options: string[]; answer: number; explanation: string; label: SpecLabel }
export interface Lesson { id: string; title: string; example: number; preset: string; level: number; goal: string; label: SpecLabel; steps: LessonStep[]; verify: Verify[]; check: LessonCheck }
export interface TourStep { area: string; title: string; text: string }
export interface Term { id: string; term: string; definition: string; label: SpecLabel; match: string[] }
export interface HelpTopic { id: string; title: string; body: string; label: SpecLabel }

export const lessons = (lessonsRaw.lessons as unknown as Lesson[]).slice().sort((a, b) => a.level - b.level);
export const tourSteps = tourRaw.steps as TourStep[];
export const glossary = glossaryRaw.terms as Term[];
export const helpTopics = helpRaw.topics as HelpTopic[];

/** Read a dotted path such as "metrics.conflicts.bySeverity.HARD". */
export function readPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a !== null && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
}
export function checkVerify(o: unknown, v: Verify): { ok: boolean; actual: unknown } {
  const actual = readPath(o, v.path);
  let ok = false;
  switch (v.op) {
    case '==': ok = actual === v.value; break;
    case '>': ok = typeof actual === 'number' && actual > (v.value as number); break;
    case '<': ok = typeof actual === 'number' && actual < (v.value as number); break;
    case '>=': ok = typeof actual === 'number' && actual >= (v.value as number); break;
    case '<=': ok = typeof actual === 'number' && actual <= (v.value as number); break;
  }
  return { ok, actual };
}

// ---- Lesson progress: a small state machine, so it can be tested without a page ----
export type LessonState = { lessonId: string; step: number; answer?: number; checked: boolean };
export const startLesson = (id: string): LessonState => ({ lessonId: id, step: 0, checked: false });
export function lessonOf(s: LessonState): Lesson | undefined { return lessons.find((l) => l.id === s.lessonId); }
/** Steps are 0..steps.length-1; the step after the last one is the check. */
export function nextStep(s: LessonState): LessonState { const l = lessonOf(s); return l && s.step < l.steps.length ? { ...s, step: s.step + 1 } : s; }
export const prevStep = (s: LessonState): LessonState => (s.step > 0 ? { ...s, step: s.step - 1 } : s);
export const isCheck = (s: LessonState) => { const l = lessonOf(s); return !!l && s.step >= l.steps.length; };
export const choose = (s: LessonState, i: number): LessonState => (s.checked ? s : { ...s, answer: i });
export const submit = (s: LessonState): LessonState => (s.answer === undefined ? s : { ...s, checked: true });
export const isCorrect = (s: LessonState) => { const l = lessonOf(s); return !!l && s.checked && s.answer === l.check.answer; };

// ---- Glossary links ----
export interface Segment { text: string; term?: string }
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAcronym = (m: string) => m === m.toUpperCase() && /[A-Z]/.test(m);
const patterns = glossary.flatMap((t) => t.match.map((m) => ({ id: t.id, m }))).sort((a, b) => b.m.length - a.m.length);
// Case-insensitive search; idFor then rejects acronyms (TX, AFH) that are not written in capitals.
const regex = new RegExp(`(?<![A-Za-z0-9-])(?:${patterns.map((p) => esc(p.m)).join('|')})(?![A-Za-z0-9-])`, 'giu');
const idFor = (word: string) => (patterns.find((p) => p.m === word) ?? patterns.find((p) => !isAcronym(p.m) && p.m.toLowerCase() === word.toLowerCase()))?.id;

/** Split text into plain pieces and glossary terms. Each term is linked at its first use only, so the text stays readable. */
export function linkify(text: string, skip: string[] = []): Segment[] {
  const out: Segment[] = [];
  const seen = new Set(skip);
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const id = idFor(m[0]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], term: id });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
export const termById = (id: string) => glossary.find((t) => t.id === id);
