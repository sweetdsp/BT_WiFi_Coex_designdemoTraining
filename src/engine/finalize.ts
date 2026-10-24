// After arbitration: classify the remaining (non-HARD) overlaps, mark blocks, and build the final
// conflict list. The list shows each overlap at its planned time (so a delayed block's ghost still
// has its conflict) plus any overlap that only appeared after a block moved.
import type { DataBundle } from './data';
import { detectConflicts } from './stageD';
import type { AirBlock, Conflict, Decision, ScenarioConfig } from './types';

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function finalizeConflicts(blocks: AirBlock[], decisions: Decision[], config: ScenarioConfig, data: DataBundle): { blocks: AirBlock[]; conflicts: Conflict[] } {
  const out = blocks.map((b) => ({ ...b }));
  const byId = new Map(out.map((b) => [b.id, b]));
  const live = out.filter((b) => !b.optional);

  const planned = detectConflicts(live.map((b) => ({ ...b, start: b.plannedStart, freqCenter: b.plannedFreqCenter ?? b.freqCenter, channelIndex: b.plannedChannelIndex ?? b.channelIndex })), config, data);
  const actual = detectConflicts(live, config, data);

  const dec = new Map<string, Decision>();
  for (const d of decisions) for (const l of d.loserIds) if (d.winnerId) dec.set(pairKey(d.winnerId, l), d);

  const merged = new Map<string, Conflict>();
  for (const c of planned) merged.set(pairKey(c.btBlockId, c.wifiBlockId), { ...c, geometry: 'PLANNED' });
  for (const c of actual) if (!merged.has(pairKey(c.btBlockId, c.wifiBlockId))) merged.set(pairKey(c.btBlockId, c.wifiBlockId), { ...c, geometry: 'ACTUAL' });
  const conflicts = [...merged.values()].sort((a, b) => a.overlapStart - b.overlapStart || (a.btBlockId < b.btBlockId ? -1 : 1));

  conflicts.forEach((c, i) => {
    c.id = `C${String(i + 1).padStart(4, '0')}`;
    const d = dec.get(pairKey(c.btBlockId, c.wifiBlockId));
    if (d) { c.decisionId = d.id; c.winnerBlockId = d.winnerId; if (c.severity === 'HARD') c.reason = `${c.reason} ${d.text}`; }
    c.btStatus = byId.get(c.btBlockId)?.status;
    c.wifiStatus = byId.get(c.wifiBlockId)?.status;
    for (const id of [c.btBlockId, c.wifiBlockId]) byId.get(id)!.contested = true;
  });

  // Remaining overlaps do not change who transmits (7A.8), but they change what the block is worth.
  for (const c of actual) {
    const pair = [byId.get(c.btBlockId)!, byId.get(c.wifiBlockId)!];
    for (const b of pair) {
      b.contested = true;
      if (c.severity === 'DEGRADED') {
        b.corrupted = true;
        if (b.status === 'GRANTED' || b.status === 'TOLERATED') b.status = 'DEGRADED';
        if (b.reason === 'No other-technology block contests this time.') b.reason = c.reason;
      } else if (c.severity === 'WARNING') {
        b.warning = true;
        if (b.status === 'GRANTED' && !b.decisionId) b.reason = c.reason;
      } else if (c.severity === 'TOLERATED' && b.status === 'GRANTED' && !b.decisionId && !b.corrupted) {
        b.status = 'TOLERATED';
        b.reason = c.reason;
      }
    }
  }
  // A block that was degraded stays degraded even if a tolerated overlap was seen first.
  for (const b of out) if (b.corrupted && (b.status === 'TOLERATED')) b.status = 'DEGRADED';
  return { blocks: out, conflicts };
}
