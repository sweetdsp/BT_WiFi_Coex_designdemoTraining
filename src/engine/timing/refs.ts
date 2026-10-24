// Resolves "$param", "@file.key" and arithmetic references used by the data-driven task patterns.
import type { DataBundle } from '../data';
import type { DurSpec, ParamMap, Ref } from '../types';

export interface RefContext {
  params: ParamMap;
  data: DataBundle;
}

export function lookupConstant(path: string, data: DataBundle): number {
  const [file, key] = path.split('.');
  const table = file === 'constants' ? data.constants : file === 'wifiTiming' ? data.wifiTiming : undefined;
  const v = table?.[key];
  if (typeof v !== 'number') throw new Error(`Unknown constant reference @${path}`);
  return v;
}

/** Resolve a numeric reference. Throws on unknown names so data errors are caught by tests. */
export function resolveRef(ref: Ref | DurSpec, ctx: RefContext): number {
  if (typeof ref === 'number') return ref;
  if (typeof ref === 'string') {
    if (ref.startsWith('$')) {
      const v = ctx.params[ref.slice(1)];
      if (v === undefined) throw new Error(`Unknown parameter reference ${ref}`);
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      throw new Error(`Parameter ${ref} is not numeric`);
    }
    if (ref.startsWith('@')) return lookupConstant(ref.slice(1), ctx.data);
    throw new Error(`Bad reference ${ref}`);
  }
  if (typeof ref === 'object' && ref !== null) {
    if ('sum' in ref) return ref.sum.reduce<number>((a, r) => a + resolveRef(r, ctx), 0);
    if ('mul' in ref) return ref.mul.reduce<number>((a, r) => a * resolveRef(r, ctx), 1);
    if ('div' in ref) return resolveRef(ref.div[0], ctx) / resolveRef(ref.div[1], ctx);
  }
  throw new Error(`Not a numeric reference: ${JSON.stringify(ref)}`);
}

/** Resolve a string-valued reference ("$param" gives the parameter's text). */
export function resolveText(ref: string, ctx: RefContext): string {
  if (ref.startsWith('$')) {
    const v = ctx.params[ref.slice(1)];
    if (v === undefined) throw new Error(`Unknown parameter reference ${ref}`);
    return String(v);
  }
  return ref;
}
