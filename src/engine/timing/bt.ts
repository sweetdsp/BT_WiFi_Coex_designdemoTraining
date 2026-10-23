// Bluetooth packet duration lookups (spec 7A.4). Durations come from data tables, never from code.
import type { BlePhyDef, BtPacketDef, DataBundle } from '../data';

export function classicPacket(data: DataBundle, key: string): BtPacketDef {
  const p = data.btPackets[key];
  if (!p) throw new Error(`Unknown Classic packet type ${key}`);
  return p;
}

export function blePhyDef(data: DataBundle, phy: string): BlePhyDef {
  const p = data.blePhy.phys[phy];
  if (!p) throw new Error(`Unknown BLE PHY ${phy}`);
  return p;
}

/** Duration = fixed overhead + (header and CRC bytes + payload bytes) times microseconds per byte. */
export function bleDurationUs(data: DataBundle, phy: string, payloadBytes: number): number {
  const p = blePhyDef(data, phy);
  return Math.round(p.fixedOverheadUs + (p.overheadBytes + payloadBytes) * p.usPerByte);
}
