// Seeded random generator (SR-4, SR-25). mulberry32 over a 32-bit state. Each consumer gets its own
// stream derived from the scenario seed and a label, so adding or removing one task never changes
// the random numbers another task sees.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
  /** Exponential variate with the given mean. */
  exp(mean: number): number;
}

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed: number, label = ''): Rng {
  let a = (hashString(label) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    exp: (mean) => -Math.log(1 - next()) * mean,
  };
}
