// Validation panel (spec 7C.5): sorted by severity then stage, plain-language text, a fix button for each suggestion,
// "Fix all safe issues", and click-to-jump to the item involved.
import type { Fix, IssueItem, ValidationIssue } from '../engine/types';
import { labelText } from '../lib/context';

const SEV: Record<string, { icon: string; word: string }> = { ERROR: { icon: '✖', word: 'Error' }, WARNING: { icon: '▲', word: 'Warning' }, INFO: { icon: 'ℹ', word: 'Note' } };

export function IssuesPanel({ issues, onFix, onFixAllSafe, onJump, onHelp }: { issues: ValidationIssue[]; onFix(f: Fix): void; onFixAllSafe(): void; onJump(item: IssueItem): void; onHelp(topic: string): void }) {
  const safe = issues.some((i) => i.fixes.some((f) => f.safe));
  return (
    <section className="issues" aria-label="Validation issues" data-testid="issues-panel">
      <div className="row"><h3>Issues <span className="count">{issues.length}</span></h3><button type="button" onClick={onFixAllSafe} disabled={!safe} data-testid="fix-all-safe">Fix all safe issues</button></div>
      {issues.length === 0 && <p className="muted">No problems found. The scenario can be generated.</p>}
      <ul>
        {issues.map((i, k) => (
          <li key={`${i.id}-${k}`} className={`issue issue-${i.severity.toLowerCase()}`} data-issue={i.id}>
            <p><span className="badge"><span aria-hidden="true">{SEV[i.severity].icon}</span> {SEV[i.severity].word}</span> <span className="id">{i.id}</span> <strong>{i.title}</strong></p>
            <p>{i.message}</p>
            <p className="muted">{i.reason} <span className="spec-label">{labelText(i.label)}</span> <button type="button" className="link" onClick={() => onHelp(i.helpTopic)}>Learn more</button></p>
            {i.items.length > 0 && <p className="small-note">Involves: {i.items.map((it, n) => (<button key={n} type="button" className="link" onClick={() => onJump(it)}>{it.label}</button>))}</p>}
            {i.fixes.length > 0 && <div className="fixes">{i.fixes.map((f) => (<button key={f.id} type="button" onClick={() => onFix(f)} data-fix={f.id}>{f.label}{f.safe ? '' : ' (changes your design)'}</button>))}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
