// Dynamic priority (spec 7A.8): a base priority per class, raised by escalation rules held in data.
// Also the per-task state the rules need: packets waiting in a buffer, consecutive anchor misses,
// and the time since the last successful anchor.
import type { DataBundle } from '../data';
import type { AirBlock, ScenarioConfig } from '../types';
import type { TaskRuntime } from './runtime';

export interface TaskState {
  /** Planned start of each packet that entered the buffer, ascending. */
  arrivals: number[];
  delivered: number;
  hits: number;
  misses: number;
  consecutive: number;
  maxRun: number;
  lastSuccessUs: number;
  /** Smallest remaining time before the supervision timeout seen at a miss. */
  minMarginUs: number;
}

export interface PriorityInfo {
  value: number;
  base: number;
  critical: boolean;
  anchor: boolean;
  /** Packets waiting, for buffered tasks. */
  waiting?: number;
  /** The next miss would drop the link. */
  nextMissDrops?: boolean;
  /** Short note on why the value is what it is. */
  note: string;
}

export class PriorityModel {
  readonly state = new Map<string, TaskState>();
  /** Once the first block of a group has won, the rest of the group keeps the priority it won with. */
  readonly pinned = new Map<string, PriorityInfo>();

  constructor(
    private readonly data: DataBundle,
    private readonly runtime: Map<string, TaskRuntime>,
    blocks: AirBlock[],
    private readonly config: ScenarioConfig,
  ) {
    const kinds = data.priorityTable.bufferPacketKinds;
    for (const rt of runtime.values()) {
      this.state.set(rt.instanceId, { arrivals: [], delivered: 0, hits: 0, misses: 0, consecutive: 0, maxRun: 0, lastSuccessUs: 0, minMarginUs: Infinity });
    }
    for (const b of blocks) {
      const rt = runtime.get(b.taskId);
      if (rt?.def.buffer?.enabled && this.isPacket(b, kinds)) this.state.get(b.taskId)!.arrivals.push(b.plannedStart);
    }
    for (const st of this.state.values()) st.arrivals.sort((a, b) => a - b);
  }

  private get kinds(): string[] {
    return this.data.priorityTable.bufferPacketKinds;
  }

  isPacket(b: AirBlock, kinds: string[] = this.kinds): boolean {
    return !b.optional && b.attempt === 1 && kinds.includes(String(b.kind));
  }

  /** Packets that have arrived by time t and are not yet delivered. */
  waiting(taskId: string, t: number): number {
    const st = this.state.get(taskId);
    if (!st) return 0;
    let lo = 0, hi = st.arrivals.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (st.arrivals[mid] <= t) lo = mid + 1; else hi = mid; }
    return Math.max(0, lo - st.delivered);
  }

  /** A first-attempt block of an anchor task. Retransmissions of anchor tasks are a fallback and are not protected. */
  isAnchor(b: AirBlock): boolean {
    const rt = this.runtime.get(b.taskId);
    return !!rt?.anchor?.isAnchor && b.attempt === 1 && !b.retx;
  }

  pin(leader: AirBlock, info: PriorityInfo): void {
    this.pinned.set(leader.groupId, info);
  }

  priorityOf(b: AirBlock, t: number): PriorityInfo {
    const pin = this.pinned.get(b.groupId);
    if (pin && !b.retx) return { ...pin, note: `${pin.note}${pin.note ? '; ' : ''}this block follows the first block of its pair, which already won`.trim() };
    const rt = this.runtime.get(b.taskId)!;
    const table = this.data.priorityTable;
    const base = table.classes[rt.def.priorityClass].base;
    const anchor = this.isAnchor(b);
    let value = base;
    let critical = false;
    let waiting: number | undefined;
    let nextMissDrops = false;
    const notes: string[] = [];

    if (b.retx) {
      value = table.anchorRetxPriority;
      notes.push('retransmission of an anchor task is a fallback and is not protected');
    } else if (b.attempt > 1) {
      const frac = Number((table.escalation.find((e) => e.id === 'RETRY_INHERIT') as { deadlineNearFraction?: number } | undefined)?.deadlineNearFraction ?? 0.25);
      const near = b.attempt - 1 >= Math.ceil(this.config.platform.retryLimit * (1 - frac));
      if (near) { value = base + table.priorityLevelStep; notes.push('retry near its deadline, raised one level'); }
    }

    if (!b.retx) {
      for (const rule of table.escalation) {
        if (rule.type === 'BUFFER_LEVEL' && rule.classes?.includes(rt.def.priorityClass) && rt.def.buffer?.enabled) {
          waiting = this.waiting(b.taskId, t);
          const threshold = rt.criticalThreshold ?? rule.criticalThreshold ?? 4;
          if (waiting >= threshold) {
            critical = true;
            value = Math.max(value, rule.criticalPriorityByClass?.[rt.def.priorityClass] ?? rule.criticalPriority ?? base);
            notes.push(`${waiting} packets waiting, at or above the critical threshold of ${threshold}`);
          }
        } else if (rule.type === 'SUPERVISION_APPROACH' && rule.classes?.includes(rt.def.priorityClass) && rt.supervisionUs) {
          const st = this.state.get(b.taskId)!;
          const elapsed = t - st.lastSuccessUs;
          const from = Number(rule.raiseFromFraction ?? 0.5);
          if (elapsed + rt.intervalUs >= rt.supervisionUs) {
            nextMissDrops = true;
            critical = true;
            value = Math.max(value, Number(rule.maxWhenNextMissDropsLink));
            notes.push('the next missed event would drop the link');
          } else if (elapsed >= from * rt.supervisionUs) {
            const f = (elapsed / rt.supervisionUs - from) / (1 - from);
            value = Math.max(value, Math.round(base + f * (Number(rule.raiseToPriority) - base)));
            notes.push('time since the last successful event is approaching the supervision timeout');
          }
        }
      }
    }
    return { value, base, critical, anchor, waiting, nextMissDrops, note: notes.join('; ') };
  }
}
