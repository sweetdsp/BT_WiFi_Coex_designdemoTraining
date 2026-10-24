// Help panel: opened by "Learn more" links, info icons and clicks on the platform diagram. Glossary terms in the text are underlined.
import { tokens } from '../lib/tokens';
import { labelText } from '../lib/context';
import { helpTopics, termById } from '../lib/learn';
import metricsHelp from '../data/metricsHelp.json';
import type { DataBundle } from '../engine/data';
import { Gl } from './Gloss';

export function helpFor(topic: string, data: DataBundle): { title: string; body: string; label: string } | undefined {
  const def = data.taskIndex.get(topic);
  if (def) return { title: def.name, body: `${def.description} ${def.help}`, label: labelText(def.specLabel) };
  const cue = tokens.cues.find((c) => c.id === topic);
  if (cue) return { title: cue.meaning, body: `${cue.pattern}. ${cue.shape}. Used for: ${cue.where}. ${cue.example}`, label: labelText('IMPLEMENTATION_VARIES') };
  const m = (metricsHelp.metrics as { key: string; label: string; help: string; label_spec: 'STANDARD' | 'IMPLEMENTATION_VARIES' }[]).find((x) => x.key === topic);
  if (m) return { title: m.label, body: m.help, label: labelText(m.label_spec) };
  const h = helpTopics.find((x) => x.id === topic);
  if (h) return { title: h.title, body: h.body, label: labelText(h.label) };
  const t = termById(topic);
  if (t) return { title: t.term, body: t.definition, label: labelText(t.label) };
  const kind = data.tasks.find((x) => x.pattern && JSON.stringify(x.pattern).includes(`"kind":"${topic}"`));
  if (kind) return { title: `${topic} packets`, body: `${kind.name}: ${kind.description}`, label: labelText(kind.specLabel) };
  return undefined;
}

export function HelpPanel({ topic, data, onClose }: { topic: string | null; data: DataBundle; onClose: () => void }) {
  if (!topic) return null;
  const h = helpFor(topic, data);
  return (
    <aside className="help-panel" role="dialog" aria-label="Help" data-testid="help-panel">
      <header><h2>{h?.title ?? topic}</h2><button type="button" onClick={onClose} aria-label="Close help">Close</button></header>
      <p>{h ? <Gl text={h.body} /> : 'No help text for this topic yet.'}</p>
      {h && <p className="spec-label">{h.label}</p>}
    </aside>
  );
}
