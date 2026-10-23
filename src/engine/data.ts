// Loads the JSON data files into one typed bundle. The engine never reads constants from anywhere else.
import constants from '../data/constants.json';
import btPackets from '../data/btPackets.json';
import blePhy from '../data/blePhy.json';
import wifiGenerations from '../data/wifiGenerations.json';
import wifiChannels from '../data/wifiChannels.json';
import wifiTiming from '../data/wifiTiming.json';
import limits from '../data/limits.json';
import groupRules from '../data/groupRules.json';
import priorityTable from '../data/priorityTable.json';
import platformDefaults from '../data/platformDefaults.json';
import tasks from '../data/tasks.json';
import validationRules from '../data/validationRules.json';
import type { PlatformConfig, RuleDef, SpecLabel, TaskDef } from './types';

export interface BtPacketDef { slots: number; durationUs: number; maxPayloadBytes: number; kind: string; family: string; scoIntervalSlots?: number }
export interface BlePhyDef { label: string; usPerByte: number; fixedOverheadUs: number; overheadBytes: number; minCore: number }
export interface WifiGenDef {
  name: string; rank: number; bands: string[]; bandwidths: Record<string, number[]>; maxStreams: number; features: string[];
  preambleUs: number; symbolUs: number; basicRateMbps: number; slotUs: number; rates1ssMbps: Record<string, number>;
  modulation: string; effect: string;
}
export interface WifiBandDef { baseMHz: number; spacingMHz: number; channels: number[] }
export interface GroupLimitRule { id: string; countTag: string; platformField: keyof PlatformConfig; what: string; reason: string; label: SpecLabel }
export interface ExclusivePair { a: string; b: string; reason: string; label: SpecLabel }
export interface PriorityClassDef { name: string; base: number; label: SpecLabel }
export interface EscalationRule { id: string; type: string; classes?: string[]; criticalThreshold?: number; criticalPriority?: number; criticalPriorityByClass?: Record<string, number>; [k: string]: unknown }

export interface DataBundle {
  constants: Record<string, any>;
  btPackets: Record<string, BtPacketDef>;
  blePhy: { phys: Record<string, BlePhyDef>; isoMinCore: number };
  wifiGenerations: Record<string, WifiGenDef>;
  wifiBands: Record<string, WifiBandDef>;
  wifiTiming: Record<string, any>;
  limits: Record<string, any>;
  groupRules: { exclusivePairs: ExclusivePair[]; groupLimits: GroupLimitRule[] };
  priorityTable: { classes: Record<string, PriorityClassDef>; anchorTierBase: number; escalation: EscalationRule[]; priorityLevelStep: number };
  platformDefaults: { defaults: PlatformConfig; presets: { id: string; name: string; description: string; label: SpecLabel; overrides: Partial<PlatformConfig> }[] };
  tasks: TaskDef[];
  taskIndex: Map<string, TaskDef>;
  rules: RuleDef[];
}

export function buildDataBundle(): DataBundle {
  const taskList = (tasks as unknown as { tasks: TaskDef[] }).tasks;
  return {
    constants: constants as Record<string, any>,
    btPackets: (btPackets as unknown as { packets: Record<string, BtPacketDef> }).packets,
    blePhy: blePhy as unknown as DataBundle['blePhy'],
    wifiGenerations: (wifiGenerations as unknown as { generations: Record<string, WifiGenDef> }).generations,
    wifiBands: (wifiChannels as unknown as { bands: Record<string, WifiBandDef> }).bands,
    wifiTiming: wifiTiming as Record<string, any>,
    limits: limits as Record<string, any>,
    groupRules: groupRules as unknown as DataBundle['groupRules'],
    priorityTable: priorityTable as unknown as DataBundle['priorityTable'],
    platformDefaults: platformDefaults as unknown as DataBundle['platformDefaults'],
    tasks: taskList,
    taskIndex: new Map(taskList.map((t) => [t.id, t])),
    rules: (validationRules as unknown as { rules: RuleDef[] }).rules,
  };
}

export const defaultData: DataBundle = buildDataBundle();

export function defaultPlatform(data: DataBundle = defaultData): PlatformConfig {
  return { ...data.platformDefaults.defaults };
}
