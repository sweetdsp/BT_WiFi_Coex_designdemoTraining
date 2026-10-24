// Summary strip (spec 7A.11, 7B.2): metrics as numbers and small bars, a per-task table, and a text summary for screen readers.
import type { Metrics } from '../engine/stageG';
import { summaryItems, taskRows } from '../lib/summary';
import { metricTip } from '../lib/tooltips';
import { useTip } from './Tooltip';

function Item({ it }: { it: ReturnType<typeof summaryItems>[number] }) {
  const tip = useTip(() => metricTip(it.key));
  return (
    <li className="metric" tabIndex={0} {...tip} data-metric={it.key}>
      <span className="metric-label">{it.label}</span>
      <span className="metric-value mono">{it.value}</span>
      {it.bar && <span className="bar" aria-hidden="true"><span className={`fill ${it.bar.tone}`} style={{ width: `${Math.round(it.bar.fraction * 100)}%` }} /></span>}
    </li>
  );
}

export function SummaryStrip({ metrics, before }: { metrics: Metrics; before?: Metrics }) {
  const items = summaryItems(metrics);
  const rows = taskRows(metrics);
  void before;
  return (
    <section className="summary" aria-label="Summary of results" data-testid="summary-strip">
      <p className="sr-only" role="status" aria-live="polite" data-testid="sr-summary">{metrics.summary}</p>
      <ul className="metrics">{items.map((it) => (<Item key={it.key} it={it} />))}</ul>
      <table className="tasks">
        <caption className="sr-only">Results per task</caption>
        <thead><tr><th scope="col">Task</th><th scope="col">Technology</th><th scope="col">Blocks</th><th scope="col">Throughput impact</th><th scope="col">Not delivered by end</th><th scope="col">Queued at end</th><th scope="col">Added latency</th><th scope="col">Anchors</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id}><th scope="row">{r.name}</th><td>{r.tech}</td><td>{r.counts}</td><td className="mono">{r.impact}</td><td className="mono">{r.undelivered}</td><td className="mono">{r.queued}</td><td>{r.latency}</td><td>{r.anchor}</td></tr>))}</tbody>
      </table>
    </section>
  );
}
