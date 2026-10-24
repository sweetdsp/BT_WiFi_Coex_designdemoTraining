// Stage A: expand selected tasks into air-time blocks using only the seven pattern generators (spec 7A.3, SR-2).
import { type DataBundle } from '../data';
import { effectiveParams } from '../params';
import { makeRng } from '../util/rng';
import type { AirBlock, GeneratorName, PlatformConfig, ScenarioConfig } from '../types';
import { burstTrain } from './burstTrain';
import type { GenContext } from './common';
import { irregularBursts } from './irregularBursts';
import { oneShotExchange } from './oneShot';
import { periodicEvent } from './periodicEvent';
import { scanSweep } from './scanSweep';
import { slotSchedule } from './slotSchedule';
import { windowedListen } from './windowedListen';

export const generators: Record<GeneratorName, (g: GenContext) => void> = {
  PERIODIC_EVENT: periodicEvent,
  SLOT_SCHEDULE: slotSchedule,
  BURST_TRAIN: burstTrain,
  WINDOWED_LISTEN: windowedListen,
  SCAN_SWEEP: scanSweep,
  IRREGULAR_BURSTS: irregularBursts,
  ONE_SHOT_EXCHANGE: oneShotExchange,
};

/** Expand one task instance into blocks. The random stream depends only on the seed and the instance id. */
export function expandTask(config: ScenarioConfig, instanceId: string, data: DataBundle): AirBlock[] {
  const inst = config.tasks.find((t) => t.instanceId === instanceId);
  if (!inst) throw new Error(`No task instance ${instanceId}`);
  const def = data.taskIndex.get(inst.taskId);
  if (!def) throw new Error(`Unknown task ${inst.taskId}`);
  const platform: PlatformConfig = config.platform;
  const g: GenContext = {
    instanceId, task: def, params: effectiveParams(def, inst), data, platform,
    windowUs: platform.windowUs, rng: makeRng(platform.seed, instanceId), blocks: [], maxBlocks: data.limits.blockLimitError,
  };
  generators[def.generator](g);
  return g.blocks.sort((a, b) => a.start - b.start || a.seq - b.seq);
}

export function expandAll(config: ScenarioConfig, data: DataBundle): AirBlock[] {
  return config.tasks.flatMap((t) => expandTask(config, t.instanceId, data)).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}
