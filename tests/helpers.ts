import { buildDataBundle, defaultData, defaultPlatform, type DataBundle } from '../src/engine/data';
import { defaultParams } from '../src/engine/params';
import type { ParamMap, PlatformConfig, ScenarioConfig, TaskInstance } from '../src/engine/types';

export type TaskSpec = string | [string, ParamMap];

/** Build a scenario from task ids with optional parameter overrides and platform overrides. */
export function makeConfig(tasks: TaskSpec[], platform: Partial<PlatformConfig> = {}, data: DataBundle = defaultData, name = 'test'): ScenarioConfig {
  const instances: TaskInstance[] = tasks.map((t, i) => {
    const [id, over] = typeof t === 'string' ? [t, {}] : t;
    const def = data.taskIndex.get(id);
    if (!def) throw new Error(`No such task ${id}`);
    return { instanceId: `t${i + 1}`, taskId: id, params: { ...defaultParams(def), ...over } };
  });
  return { name, tasks: instances, platform: { ...defaultPlatform(data), ...platform } };
}

export function freshData(): DataBundle {
  return buildDataBundle();
}
