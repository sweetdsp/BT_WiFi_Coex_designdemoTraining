import { describe, expect, it } from 'vitest';
import { defaultData as data } from '../src/engine/data';
import { bleDurationUs, classicPacket } from '../src/engine/timing/bt';
import { carriedBytes, streamCount, wifiFrameDurationUs, wifiRateMbps, type WifiTimingCtx } from '../src/engine/timing/wifi';
import { defaultPlatform } from '../src/engine/data';

describe('Bluetooth timing tables (spec 7A.4)', () => {
  it('Classic occupancy is 366, 1622 and 2870 us for 1, 3 and 5 slots; slot is 625 us', () => {
    expect(data.constants.classicSlotUs).toBe(625);
    expect([classicPacket(data, 'DH1'), classicPacket(data, 'DH3'), classicPacket(data, 'DH5')].map((p) => p.durationUs)).toEqual([366, 1622, 2870]);
    expect([classicPacket(data, '2-DH5').slots, classicPacket(data, 'DH3').slots]).toEqual([5, 3]);
  });
  it('BLE per-byte timing is 8, 4, 64 and 16 us for 1M, 2M, Coded S8 and S2', () => {
    const per = (phy: string) => bleDurationUs(data, phy, 11) - bleDurationUs(data, phy, 10);
    expect([per('1M'), per('2M'), per('CODED_S8'), per('CODED_S2')]).toEqual([8, 4, 64, 16]);
    expect(data.constants.bleInterFrameSpacingUs).toBe(150);
  });
  it('rejects an unknown packet type instead of guessing', () => {
    expect(() => classicPacket(data, 'XX')).toThrow();
    expect(() => bleDurationUs(data, 'XX', 1)).toThrow();
  });
});

describe('Wi-Fi timing (spec 7A.5, SR-14, SR-16, SR-17)', () => {
  const ctx = (genId: string, bw: number, streams: number): WifiTimingCtx => ({ data, genId, bandwidthMHz: bw, streams });
  it('rate comes from generation, bandwidth and stream count', () => {
    expect(wifiRateMbps(data, '11be', 20, 1)).toBeCloseTo(154.9);
    expect(wifiRateMbps(data, '11be', 20, 2)).toBeCloseTo(309.8);
    expect(wifiRateMbps(data, '11n', 40, 1)).toBe(150);
    expect(wifiRateMbps(data, '11be', 320, 1)).toBeGreaterThan(wifiRateMbps(data, '11be', 160, 1));
    expect(wifiRateMbps(data, '11n', 80, 1)).toBe(150); // widest width the generation has, not above the request
  });
  it('streams are capped by the chains and the generation maximum', () => {
    const p = { ...defaultPlatform(data) };
    expect(streamCount(data, { ...p, txRxStreams: '2x2', wifiChains: 2 })).toBe(2);
    expect(streamCount(data, { ...p, txRxStreams: '4x4', wifiChains: 2 })).toBe(2);
    expect(streamCount(data, { ...p, txRxStreams: '2x2', wifiGeneration: '11b' })).toBe(1);
  });
  it('802.11b frames are far longer than Wi-Fi 7 frames for the same bytes', () => {
    const b = wifiFrameDurationUs(ctx('11b', 20, 1), 1500, 'DATA', 'DATA');
    const be = wifiFrameDurationUs(ctx('11be', 20, 2), 1500, 'DATA', 'DATA');
    expect(b).toBeGreaterThan(1500 * 8 / 11);
    expect(b).toBeGreaterThan(be * 10);
  });
  it('control frames use the legacy preamble: a 14 byte ACK at 24 Mbps is 20 + 2 symbols', () => {
    expect(wifiFrameDurationUs(ctx('11be', 20, 2), 14, 'ACK', 'CONTROL')).toBe(20 + 2 * 4);
  });
  it('an aggregate never exceeds the 5.484 ms maximum and legacy generations carry one frame', () => {
    const d = wifiFrameDurationUs(ctx('11n', 20, 1), 262143, 'AMPDU', 'DATA');
    expect(d).toBeLessThanOrEqual(data.wifiTiming.maxAggregationUs);
    expect(carriedBytes(ctx('11g', 20, 1), 65535)).toBe(1500);
  });
});
