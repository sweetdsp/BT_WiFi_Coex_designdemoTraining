// Turns a preset record into a scenario configuration. Presets are data (src/data/presets.json).
import { defaultData, defaultPlatform, type DataBundle } from './data';
import { defaultParams } from './params';
import type { ScenarioConfig } from './types';

export function presetConfig(id: string, data: DataBundle = defaultData): ScenarioConfig {
  const p = data.presets.find((x) => x.id === id);
  if (!p) throw new Error(`No preset ${id}`);
  return {
    name: p.name,
    tasks: p.tasks.map((t, i) => {
      const def = data.taskIndex.get(t.taskId);
      if (!def) throw new Error(`Preset ${id} names unknown task ${t.taskId}`);
      return { instanceId: `t${i + 1}`, taskId: t.taskId, params: { ...defaultParams(def), ...(t.params ?? {}) } };
    }),
    platform: { ...defaultPlatform(data), ...p.platform },
  };
}
