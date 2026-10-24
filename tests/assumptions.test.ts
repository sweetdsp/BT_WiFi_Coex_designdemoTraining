import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ESM script without types
import { render } from '../scripts/gen-assumptions.mjs';
import assumptions from '../src/data/assumptions.json';

describe('assumptions', () => {
  it('ASSUMPTIONS.md is in sync with the data file', () => {
    expect(readFileSync('ASSUMPTIONS.md', 'utf8')).toBe(render());
  });
  it('lists every item required by spec 7A.13', () => {
    expect(assumptions.assumptions.filter((a) => a.id.startsWith('S-'))).toHaveLength(6);
  });
});
