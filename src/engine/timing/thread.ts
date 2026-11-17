// Thread (IEEE 802.15.4) frame timing and channel plan. Every figure comes from data/threadTiming.json.
import type { DataBundle } from '../data';

export type ThreadFrame = 'DATA' | 'MGMT' | 'COMMAND' | 'ACK';

/** PSDU (MAC frame) bytes for a frame kind. DATA is the application bytes plus the MAC header, security and checksum overhead. */
export function threadPsduBytes(data: DataBundle, frame: ThreadFrame, bytes: number): number {
  const t = data.threadTiming;
  const raw = frame === 'ACK' ? t.ackPsduBytes : frame === 'COMMAND' ? t.commandPsduBytes : frame === 'MGMT' ? (bytes > 0 ? bytes : t.mleFrameBytes) : t.dataOverheadBytes + Math.max(0, bytes);
  return Math.min(t.maxPsduBytes, Math.max(1, Math.round(raw)));
}

/** On-air time in microseconds: physical header plus the frame, at 32 us per byte (250 kbps). */
export function threadFrameDurationUs(data: DataBundle, frame: ThreadFrame, bytes: number): number {
  const t = data.threadTiming;
  return (t.phyOverheadBytes + threadPsduBytes(data, frame, bytes)) * t.usPerByte;
}

/** Centre frequency of a Thread channel (11 to 26) in MHz. */
export function threadCenterMHz(data: DataBundle, channel: number): number {
  const t = data.threadTiming;
  return t.channelBaseMHz + t.channelSpacingMHz * (channel - t.firstChannel);
}

export function threadChannels(data: DataBundle): number[] {
  const t = data.threadTiming;
  return Array.from({ length: t.lastChannel - t.firstChannel + 1 }, (_, i) => t.firstChannel + i);
}

/** Average medium-access wait before a transmit: half the first backoff window plus one clear-channel check (used for load estimates). */
export function averageThreadAccessUs(data: DataBundle): number {
  const t = data.threadTiming;
  return ((2 ** t.macMinBE - 1) / 2) * t.unitBackoffUs + t.ccaUs;
}
