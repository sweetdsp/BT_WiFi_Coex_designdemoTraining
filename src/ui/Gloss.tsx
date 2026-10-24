// Text with glossary terms underlined (spec 7B.11). Clicking a term opens its glossary entry.
import { createContext, useContext } from 'react';
import { linkify } from '../lib/learn';

export const GlossContext = createContext<(termId: string) => void>(() => undefined);

export function Gl({ text, skip }: { text: string; skip?: string[] }) {
  const open = useContext(GlossContext);
  return (
    <>
      {linkify(text, skip).map((s, i) => s.term
        ? <button key={i} type="button" className="gloss" onClick={() => open(s.term!)} aria-label={`${s.text}: open the glossary entry`} data-term={s.term}>{s.text}</button>
        : <span key={i}>{s.text}</span>)}
    </>
  );
}
