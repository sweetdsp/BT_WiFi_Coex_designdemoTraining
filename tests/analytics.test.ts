import { describe, expect, it } from 'vitest';
import { countUrl, dashboardUrl, isConfigured, shouldCount, validCode, analytics } from '../src/lib/analytics';

const live = { provider: 'goatcounter', siteCode: 'coex-demo' };
const prod = { hostname: 'sweetdsp.github.io', search: '', doNotTrack: null };

describe('visitor statistics', () => {
  it('accepts only plain site codes', () => {
    for (const ok of ['coex-demo', 'abc', 'a1']) expect(validCode(ok)).toBe(true);
    for (const bad of ['', 'A', 'x', 'a b', 'a.b', 'a/b', '-a', 'evil.com/x', 'a'.repeat(40)]) expect(validCode(bad)).toBe(false);
  });
  it('builds the dashboard and counting addresses only when set up', () => {
    expect(dashboardUrl(live)).toBe('https://coex-demo.goatcounter.com/');
    expect(countUrl(live)).toBe('https://coex-demo.goatcounter.com/count');
    expect(dashboardUrl({ provider: 'goatcounter', siteCode: '' })).toBeNull();
    expect(isConfigured({ provider: 'other', siteCode: 'coex-demo' })).toBe(false);
  });
  it('counts only on the published site, never locally, in the browser checks, or with Do Not Track', () => {
    expect(shouldCount(prod, live)).toBe(true);
    expect(shouldCount({ ...prod, hostname: 'localhost' }, live)).toBe(false);
    expect(shouldCount({ ...prod, hostname: '127.0.0.1' }, live)).toBe(false);
    expect(shouldCount({ ...prod, search: '?e2e' }, live)).toBe(false);
    expect(shouldCount({ ...prod, doNotTrack: '1' }, live)).toBe(false);
    expect(shouldCount(prod, { provider: 'goatcounter', siteCode: '' })).toBe(false);
  });
  it('the shipped configuration is either empty or valid', () => {
    expect(analytics.siteCode === '' || validCode(analytics.siteCode)).toBe(true);
  });
});
