// Platform diagram model (spec 7B.7): nodes drawn from the settings, active paths at the cursor, the shared element of a conflict.
import type { EngineResult } from '../engine';
import type { Conflict, PlatformConfig } from '../engine/types';
import { activeAt } from './cursor';

export type NodeId = 'wifiCore' | 'btCore' | 'comboCore' | 'fem' | 'wifiAntenna' | 'btAntenna' | 'antenna';
export interface PlatformNode { id: NodeId; label: string; x: number; y: number; w: number; h: number; help: string }
export interface PlatformEdge { from: NodeId; to: NodeId; tech: 'BT' | 'WIFI' | 'SHARED'; label?: string }
export interface PlatformModel { nodes: PlatformNode[]; edges: PlatformEdge[]; isolationLabel?: { x: number; y: number; text: string } }

const HELP: Record<string, string> = {
  wifiCore: 'The Wi-Fi radio core. Standard says: Wi-Fi and Bluetooth can share one core (a combo chip) or use separate cores.',
  btCore: 'The Bluetooth radio core. Implementations vary: how it is connected to the Wi-Fi core depends on the product.',
  comboCore: 'One core serving both Wi-Fi and Bluetooth. It can only do one at a time unless the hardware allows concurrent operation.',
  switch: 'A front-end switch connects one antenna to either Wi-Fi or Bluetooth, one at a time. Implementations vary.',
  diplexer: 'A diplexer or combiner lets Wi-Fi and Bluetooth share one antenna at the same time by splitting the signal by frequency. Implementations vary.',
  antenna: 'The antenna. When Wi-Fi and Bluetooth share it, only one can transmit at a time, and a transmit blocks a receive.',
  separate: 'Separate antennas. How much one radio leaks into the other is set by the isolation value in dB.',
};

export function platformModel(p: PlatformConfig): PlatformModel {
  const shared = p.antennaMode === 'SHARED';
  const combo = p.coreCount <= 1;
  const nodes: PlatformNode[] = [];
  const edges: PlatformEdge[] = [];
  if (combo) nodes.push({ id: 'comboCore', label: 'Combo core', x: 20, y: 80, w: 100, h: 60, help: HELP.comboCore });
  else {
    nodes.push({ id: 'wifiCore', label: 'Wi-Fi core', x: 20, y: 30, w: 100, h: 50, help: HELP.wifiCore });
    nodes.push({ id: 'btCore', label: 'Bluetooth core', x: 20, y: 140, w: 100, h: 50, help: HELP.btCore });
  }
  const wf: NodeId = combo ? 'comboCore' : 'wifiCore';
  const bt: NodeId = combo ? 'comboCore' : 'btCore';
  if (shared) {
    const label = p.femArrangement === 'SHARED_DIPLEXER' ? 'Diplexer' : 'Switch';
    nodes.push({ id: 'fem', label, x: 190, y: 80, w: 90, h: 60, help: p.femArrangement === 'SHARED_DIPLEXER' ? HELP.diplexer : HELP.switch });
    nodes.push({ id: 'antenna', label: 'Antenna', x: 350, y: 80, w: 90, h: 60, help: HELP.antenna });
    edges.push({ from: wf, to: 'fem', tech: 'WIFI' }, { from: bt, to: 'fem', tech: 'BT' }, { from: 'fem', to: 'antenna', tech: 'SHARED' });
    return { nodes, edges };
  }
  nodes.push({ id: 'wifiAntenna', label: 'Wi-Fi antenna', x: 350, y: 30, w: 100, h: 50, help: HELP.separate });
  nodes.push({ id: 'btAntenna', label: 'Bluetooth antenna', x: 350, y: 140, w: 100, h: 50, help: HELP.separate });
  edges.push({ from: wf, to: 'wifiAntenna', tech: 'WIFI' }, { from: bt, to: 'btAntenna', tech: 'BT' });
  return { nodes, edges, isolationLabel: { x: 400, y: 112, text: `isolation ${p.isolationDb} dB` } };
}

export interface PlatformActivity { active: Set<NodeId>; activeTech: { BT: boolean; WIFI: boolean }; sharedElement?: NodeId | 'isolation' | 'air'; conflictId?: string }

/** Which element caused a conflict: the shared antenna, shared core, the isolation between paths, or the air. */
export function sharedElementFor(c: Conflict, p: PlatformConfig): NodeId | 'isolation' | 'air' {
  const shared = p.antennaMode === 'SHARED';
  const combo = p.coreCount <= 1;
  if (c.tests.includes('ANTENNA')) return 'antenna';
  if (c.tests.includes('CORE')) return combo ? 'comboCore' : 'fem';
  if (c.tests.includes('SIMULTANEOUS')) return shared ? 'fem' : combo ? 'comboCore' : 'wifiCore';
  if (c.tests.includes('ISOLATION')) return 'isolation';
  return 'air';
}

/** What is happening at time t: which paths carry a block, and which element a selected conflict stresses. */
export function activityAt(result: EngineResult, t: number, selectedConflict?: Conflict): PlatformActivity {
  const p = result.config.platform;
  const model = platformModel(p);
  const act = activeAt(result, t);
  const tech = { BT: act.some((b) => b.tech === 'BT'), WIFI: act.some((b) => b.tech === 'WIFI') };
  const active = new Set<NodeId>();
  for (const e of model.edges) {
    if (e.tech === 'SHARED' ? tech.BT || tech.WIFI : tech[e.tech]) { active.add(e.from); active.add(e.to); }
  }
  const sel = selectedConflict ?? result.conflicts.find((c) => c.severity !== 'TOLERATED' && c.overlapStart <= t && t < c.overlapEnd);
  return { active, activeTech: tech, sharedElement: sel ? sharedElementFor(sel, p) : undefined, conflictId: sel?.id };
}
