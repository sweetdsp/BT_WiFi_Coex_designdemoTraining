// Validation gate (spec 7C). Pure TypeScript: takes a configuration, returns every issue from every stage.
import { defaultData, type DataBundle } from '../data';
import type { Change, Finding, Fix, RuleFix, ScenarioConfig, Severity, ValidationIssue } from '../types';
import { conditions } from './conditions';
import { buildContext } from './context';

const SEVERITY_ORDER: Record<Severity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

export function validate(config: ScenarioConfig, data: DataBundle = defaultData): ValidationIssue[] {
  const ctx = buildContext(config, data);
  const issues: ValidationIssue[] = [];
  for (const rule of [...data.rules].sort((a, b) => a.stage - b.stage)) {
    const fn = conditions[rule.condition];
    if (!fn) throw new Error(`Rule ${rule.id} names unknown condition ${rule.condition}`);
    const findings: Finding[] = fn(ctx, rule.params ?? {});
    for (const f of findings) {
      const vars = f.vars;
      const fixes: Fix[] = (f.fixes ?? []).map((rf: RuleFix, i) => ({
        id: `${rule.id}:${rf.fixId}:${i}`,
        label: fill(rule.fixes[rf.fixId] ?? rf.fixId, { ...vars, ...(rf.vars ?? {}) }),
        safe: rf.safe === true,
        changes: rf.changes,
        helpTopic: rule.helpTopic,
      }));
      issues.push({
        id: rule.id,
        severity: f.severity ?? rule.severity,
        stage: rule.stage,
        title: rule.title,
        items: f.items,
        message: fill(rule.message, vars),
        reason: fill(rule.reason, vars),
        label: rule.label,
        fixes,
        helpTopic: rule.helpTopic,
      });
    }
  }
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.stage - b.stage);
}

export const hasErrors = (issues: ValidationIssue[]): boolean => issues.some((i) => i.severity === 'ERROR');
export const errorsOf = (issues: ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.severity === 'ERROR');

/** Thrown by the engine when the gate finds an ERROR. Carries every issue so the UI can show them. */
export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Validation failed with ${errorsOf(issues).length} error(s): ${errorsOf(issues).map((i) => i.id).join(', ')}`);
    this.name = 'ValidationError';
  }
}

/** Apply fix changes to a copy of the configuration. The original is never modified. */
export function applyChanges(config: ScenarioConfig, changes: Change[]): ScenarioConfig {
  const next: ScenarioConfig = JSON.parse(JSON.stringify(config));
  for (const c of changes) {
    if (c.op === 'setParam') {
      const t = next.tasks.find((x) => x.instanceId === c.instanceId);
      if (t) t.params[c.param] = c.value;
    } else if (c.op === 'setPlatform') {
      (next.platform as unknown as Record<string, unknown>)[c.field] = c.value;
    } else if (c.op === 'removeTask') {
      next.tasks = next.tasks.filter((x) => x.instanceId !== c.instanceId);
    }
  }
  return next;
}

export const applyFix = (config: ScenarioConfig, fix: Fix): ScenarioConfig => applyChanges(config, fix.changes);

/** "Fix all safe issues" (7C.5): applies only fixes that restore defaults or clamp values. */
export function fixAllSafe(config: ScenarioConfig, data: DataBundle = defaultData): { config: ScenarioConfig; applied: Fix[] } {
  let cur = config;
  const applied: Fix[] = [];
  for (let pass = 0; pass < 5; pass++) {
    const safe = validate(cur, data).flatMap((i) => i.fixes.filter((f) => f.safe).slice(0, 1));
    if (safe.length === 0) break;
    const seen = new Set<string>();
    for (const f of safe) {
      const key = JSON.stringify(f.changes);
      if (seen.has(key)) continue;
      seen.add(key);
      cur = applyFix(cur, f);
      applied.push(f);
    }
  }
  return { config: cur, applied };
}

export { buildContext } from './context';
export { conditions } from './conditions';
