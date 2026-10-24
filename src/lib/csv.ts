// CSV of all blocks with their outcomes (spec 7B.12).
import type { EngineResult } from '../engine';

export const CSV_COLUMNS = ['block_id', 'task', 'task_instance', 'tech', 'dir', 'kind', 'start_us', 'end_us', 'duration_us', 'planned_start_us', 'freq_center_mhz', 'freq_width_mhz', 'channel', 'priority', 'status', 'attempt', 'retry_of', 'unused_retransmission_slot', 'corrupted', 'warning', 'payload_bytes', 'decision_id', 'reason'] as const;

export function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function blocksCsv(r: EngineResult): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const b of r.blocks) {
    rows.push([
      b.id, r.taskNames[b.taskId] ?? b.taskId, b.taskId, b.tech, b.dir, b.kind, b.start, b.start + b.duration, b.duration, b.plannedStart, b.freqCenter, b.freqWidth, b.channelIndex,
      b.priority, b.status, b.attempt, b.retryOf, b.optional ? 'yes' : 'no', b.corrupted ? 'yes' : 'no', b.warning ? 'yes' : 'no', b.payloadBytes ?? 0, b.decisionId ?? '', b.reason,
    ].map(csvCell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/** Minimal CSV reader for the file above (used by tests and to check an export). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
