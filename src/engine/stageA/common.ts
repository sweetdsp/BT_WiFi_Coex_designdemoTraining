// Shared machinery for the stage A pattern generators (spec 7A.3).
// Generators know nothing about individual tasks: they read only the fields of the task definition.
import type { DataBundle } from '../data';
import { packetIncluded, resolveDurationUs, type DurationContext } from '../estimate';
import { effectiveWifi } from '../params';
import { resolveRef } from '../timing/refs';
import { streamCount, wifiGen } from '../timing/wifi';
import type { Rng } from '../util/rng';
import type { AirBlock, ChanMode, Dir, DirSpec, PacketSpec, ParamMap, PlatformConfig, TaskDef } from '../types';

export interface GenContext extends DurationContext {
  instanceId: string;
  windowUs: number;
  rng: Rng;
  blocks: AirBlock[];
  /** Hard cap on blocks per task; protects the browser if a caller skips validation. */
  maxBlocks: number;
}

export function pattern(g: GenContext): Record<string, any> {
  return g.task.pattern as Record<string, any>;
}

export const num = (g: GenContext, r: unknown): number => resolveRef(r as never, g);

export function resolveDir(spec: DirSpec, params: ParamMap): Dir {
  if (typeof spec === 'string') return spec;
  if ('role' in spec) return spec.role[String(params.role)] ?? 'TX';
  return spec.map[String(params[spec.param])] ?? 'TX';
}

export interface EmitOptions {
  eventId: string;
  optional?: boolean;
  arrivalUs?: number;
  /** Override the Wi-Fi channel and band (scan steps, MLO links). */
  wifi?: { band: string; channel: number; width: number };
  /** Gap in microseconds between advertising channels. */
  advGapUs?: number;
}

export function priorityBase(g: GenContext): number {
  return g.data.priorityTable.classes[g.task.priorityClass].base;
}

function pushBlock(g: GenContext, partial: Pick<AirBlock, 'dir' | 'start' | 'duration' | 'kind' | 'chanMode' | 'eventId'> & Partial<AirBlock>): AirBlock | undefined {
  // The window is a hard cutoff: nothing that would start after it is created.
  if (Math.round(partial.start) >= g.windowUs) return undefined;
  if (g.blocks.length >= g.maxBlocks) throw new Error(`Task ${g.task.id} would exceed ${g.maxBlocks} blocks; validate before generating`);
  const seq = g.blocks.length;
  const isWifi = g.task.tech === 'WIFI';
  const w = effectiveWifi(g.platform, g.params);
  const { dir, start, duration, kind, chanMode, eventId, plannedStart, ...extra } = partial;
  const b: AirBlock = {
    id: `${g.instanceId}:${String(seq).padStart(6, '0')}`,
    taskId: g.instanceId,
    tech: g.task.tech,
    dir,
    start: Math.round(start),
    duration: Math.max(1, Math.round(duration)),
    freqCenter: 0,
    freqWidth: isWifi ? w.bandwidth : g.data.constants[g.task.category === 'CLASSIC' ? 'classicChannelWidthMHz' : 'bleChannelWidthMHz'],
    channelIndex: -1,
    priority: priorityBase(g),
    kind,
    retryOf: '',
    status: 'PLANNED',
    reason: '',
    seq,
    plannedStart: Math.round(plannedStart ?? start),
    eventId,
    chanMode,
    ...(isWifi ? { wifiBand: w.band, wifiChannel: w.channel, wifiWidth: w.bandwidth } : {}),
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (b as unknown as Record<string, unknown>)[k] = v;
  g.blocks.push(b);
  return b;
}

export { pushBlock };

/** Default channel mode for a task, from its pattern. */
export function patternChanMode(g: GenContext): ChanMode {
  return (pattern(g).channel?.mode ?? 'WIFI') as ChanMode;
}

/**
 * Lay a packet sequence on the timeline starting at t0. Handles repeat counts, conditional packets,
 * advertising on all three channels, and optional (retry-only) blocks. Returns the end time.
 */
export function emitSequence(g: GenContext, packets: PacketSpec[], t0: number, o: EmitOptions): number {
  let cursor = t0;
  const mode = patternChanMode(g);
  const perPacket = pattern(g).channel?.perPacket === true;
  for (const p of packets) {
    if (!packetIncluded(p, g.params)) continue;
    const count = p.count === undefined ? 1 : Math.max(0, Math.round(num(g, p.count)));
    for (let i = 0; i < count; i++) {
      const gap = p.gapUs === undefined ? 0 : num(g, p.gapUs);
      const dur = resolveDurationUs(p.dur, g);
      const dir = resolveDir(p.dir, g.params);
      if (p.chan === 'ADV3') {
        const advGap = o.advGapUs ?? 0;
        let t = cursor + gap;
        for (const ch of g.data.constants.bleAdvChannels as { index: number; mhz: number }[]) {
          pushBlock(g, { dir, start: t, duration: dur, kind: p.kind, chanMode: 'BLE_ADV', fixedChannel: ch.index, eventId: o.eventId, optional: p.optional || o.optional, arrivalUs: o.arrivalUs });
          cursor = t + dur;
          t = cursor + advGap;
        }
      } else {
        const start = cursor + gap;
        const evId = mode === 'BLE_DATA' && perPacket ? `${o.eventId}.${g.blocks.length}` : o.eventId;
        pushBlock(g, {
          dir, start, duration: dur, kind: p.kind, chanMode: mode, eventId: evId, optional: p.optional || o.optional, arrivalUs: o.arrivalUs,
          ...(o.wifi ? { wifiBand: o.wifi.band, wifiChannel: o.wifi.channel, wifiWidth: o.wifi.width, freqWidth: o.wifi.width } : {}),
        });
        cursor = start + dur;
      }
    }
  }
  return cursor;
}

/** Wi-Fi medium access before a burst: DIFS plus a random backoff from the seeded generator (SR-15). */
export function accessDelayUs(g: GenContext): number {
  if (g.task.tech !== 'WIFI') return 0;
  const t = g.data.wifiTiming;
  const slot = wifiGen(g.data, g.platform.wifiGeneration).slotUs;
  return t.sifsUs + 2 * slot + g.rng.int(0, t.contentionWindowSlots) * slot;
}

export function wifiTimingCtx(g: GenContext) {
  const w = effectiveWifi(g.platform, g.params);
  return { data: g.data, genId: w.genId, bandwidthMHz: w.bandwidth, streams: streamCount(g.data, g.platform) };
}

export type { DataBundle, PlatformConfig, TaskDef };
