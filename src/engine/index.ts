// The engine: validation gate, then stages A to G (spec 7A.1).
// The engine calls the validator itself and refuses to run on any ERROR, so the gate cannot be bypassed (7C.7).
import { arbitrate, type AnchorStats } from './arbitration/arbitrate';
import { defaultData, type DataBundle } from './data';
import { finalizeConflicts } from './finalize';
import { expandAll } from './stageA';
import { resolveFrequencies } from './stageB';
import { computeMetrics, type Metrics } from './stageG';
import { applyAfh, type AfhMap } from './stageC';
import type { AirBlock, Conflict, Decision, ScenarioConfig, ValidationIssue } from './types';
import { ValidationError, hasErrors, validate } from './validator';

export interface EngineResult {
  config: ScenarioConfig;
  /** Warnings and notes from the validation gate (there are no errors if the engine ran). */
  issues: ValidationIssue[];
  blocks: AirBlock[];
  conflicts: Conflict[];
  decisions: Decision[];
  afh: AfhMap;
  anchorStats: Record<string, AnchorStats>;
  metrics: Metrics;
  /** Display name of each task instance. */
  taskNames: Record<string, string>;
}

export function runEngine(config: ScenarioConfig, data: DataBundle = defaultData): EngineResult {
  const issues = validate(config, data);
  if (hasErrors(issues)) throw new ValidationError(issues);
  const a = expandAll(config, data);
  const b = resolveFrequencies(a, config, data);
  const { blocks: c, map } = applyAfh(b, config, data);
  const arb = arbitrate(c, config, data, map);
  const fin = finalizeConflicts(arb.blocks, arb.decisions, config, data);
  const taskNames: Record<string, string> = {};
  for (const [id, rt] of arb.runtime) taskNames[id] = rt.name;
  const metrics = computeMetrics(fin.blocks, fin.conflicts, arb.decisions, config, data, arb.runtime, arb.anchorStats);
  return { config, issues, blocks: fin.blocks, conflicts: fin.conflicts, decisions: arb.decisions, afh: map, anchorStats: arb.anchorStats, metrics, taskNames };
}

export { ValidationError, validate, hasErrors };
export type { AnchorStats, Metrics };
