// AC-3: changing the antenna arrangement, isolation, core mode, arbitration policy or adaptive hopping changes the result as 7A describes.
import { describe, expect, it } from 'vitest';
import { runEngine } from '../src/engine';
import { presetConfig } from '../src/engine/presets';
import type { PlatformConfig } from '../src/engine/types';

const run = (id: string, over: Partial<PlatformConfig>) => { const c = presetConfig(id); return runEngine({ ...c, platform: { ...c.platform, ...over } }); };
const sev = (r: ReturnType<typeof run>) => r.metrics.conflicts.bySeverity;

describe('AC-3: platform settings change the result as 7A describes', () => {
  it('antenna arrangement: shared gives hard conflicts and delays, separate with isolation gives none', () => {
    const shared = run('example-1', {});
    const sep = run('example-1', { femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 });
    expect(sev(shared).HARD).toBeGreaterThan(0); expect(sev(sep).HARD).toBe(0);
    expect(shared.metrics.totals.blocksDelayed).toBeGreaterThan(0); expect(sep.metrics.totals.blocksDelayed).toBe(0);
  });
  it('isolation: below the threshold overlapping blocks are degraded, above it they are tolerated', () => {
    const low = run('example-3', { isolationDb: 10 }), high = run('example-3', { isolationDb: 40 });
    expect(sev(low).DEGRADED).toBeGreaterThan(sev(high).DEGRADED);
    const harmful = (r: ReturnType<typeof run>) => sev(r).HARD + sev(r).DEGRADED;
    expect(harmful(high)).toBeLessThan(harmful(low));
    expect(high.metrics.totals.blocksDegraded).toBeLessThan(low.metrics.totals.blocksDegraded);
  });
  it('core mode: one time-division core serialises blocks that two concurrent cores would let overlap', () => {
    const tdd = run('example-2', { coreCount: 1, coreMode: 'TIME_DIVISION', simultaneousWifiTxBtRx: false });
    const conc = run('example-2', {});
    expect(sev(tdd).HARD).toBeGreaterThan(sev(conc).HARD);
  });
  it('arbitration policy: the winners differ between policies on the same traffic', () => {
    const pri = run('example-1', { arbitrationPolicy: 'PRIORITY' }), bt = run('example-1', { arbitrationPolicy: 'BT_FAVOURED' }), wifi = run('example-1', { arbitrationPolicy: 'WIFI_FAVOURED' });
    const winners = (r: typeof pri) => r.decisions.map((d) => d.winnerId).join(',');
    expect(new Set([winners(pri), winners(bt), winners(wifi)]).size).toBeGreaterThan(1);
    // Favouring Bluetooth must not leave Bluetooth worse off than favouring Wi-Fi.
    const bt1 = (r: typeof pri) => Object.values(r.metrics.perTask).find((t) => t.tech === 'BT')!.throughputImpactPct;
    expect(bt1(bt)).toBeLessThanOrEqual(bt1(wifi));
  });
  it('adaptive hopping: turning it on removes channels under Wi-Fi and cuts degraded conflicts', () => {
    const off = run('example-3', { afhEnabled: false }), on = run('example-3', { afhEnabled: true });
    expect(off.afh.enabled).toBe(false); expect(on.afh.enabled).toBe(true);
    expect(sev(on).DEGRADED).toBeLessThan(sev(off).DEGRADED);
  });
});
