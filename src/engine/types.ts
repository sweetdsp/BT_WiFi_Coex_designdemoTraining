// Data model (spec 7A.2) plus the configuration and validation types (7C.6).
// Pure TypeScript: no DOM, no Node. All times are integer microseconds, all frequencies MHz.

export type Tech = 'BT' | 'WIFI';
export type Dir = 'TX' | 'RX';
export type SpecLabel = 'STANDARD' | 'IMPLEMENTATION_VARIES';
export type ParamValue = number | string | boolean;
export type ParamMap = Record<string, ParamValue>;

export type BlockStatus = 'PLANNED' | 'GRANTED' | 'DENIED' | 'DELAYED' | 'TOLERATED' | 'LOST' | 'RETRIED' | 'DEGRADED';
export type BlockKind =
  | 'DATA' | 'ACK' | 'MGMT' | 'POLL' | 'SCAN' | 'ADV' | 'VOICE' | 'ISO' | 'TONE' | 'ID' | 'CTRL' | 'BEACON';

export type ChanMode = 'CLASSIC_HOP' | 'BLE_ADV' | 'BLE_DATA' | 'WIFI';

/**
 * Air-time block (7A.2). The fields after `reason` are engine bookkeeping that stages B to G need
 * (channel mode, planned start, grouping) and do not change the meaning of the spec fields.
 */
export interface AirBlock {
  id: string;
  taskId: string;
  tech: Tech;
  dir: Dir;
  start: number;
  duration: number;
  freqCenter: number;
  freqWidth: number;
  channelIndex: number;
  priority: number;
  kind: BlockKind | string;
  retryOf: string;
  status: BlockStatus;
  reason: string;
  /** Order of creation within the task, used for stable sorting and tie breaks. */
  seq: number;
  /** Start time before any arbitration delay. */
  plannedStart: number;
  /** Blocks of one event share an id; BLE data events use one channel per event. */
  eventId: string;
  chanMode: ChanMode;
  /** Fixed Bluetooth channel index (BLE advertising 37, 38, 39). */
  fixedChannel?: number;
  /** Wi-Fi band, channel and width for this block (scans and MLO links override the platform). */
  wifiBand?: string;
  wifiChannel?: number;
  wifiWidth?: number;
  /** Exists only when a retry is triggered (eSCO retransmission window, spare ISO subevents). */
  optional?: boolean;
  /** For buffered streams: when the payload became available to send. */
  arrivalUs?: number;
  /** Seeded uniform draw in [0, 1) that picks this hop from the allowed channel set; reused when AFH narrows the set. */
  hopU?: number;
  /** Blocks that must move together (a master packet and its reply, a Wi-Fi burst and its acknowledgement). */
  groupId: string;
  /** Pool of blocks one event owns, used to find its retransmission opportunities. */
  eventKey: string;
  /** 1 for the first attempt, 2 and up for retries. */
  attempt: number;
  /** Id of the arbitration decision that settled this block. */
  decisionId?: string;
  /** Involved in at least one conflict of any severity. */
  contested?: boolean;
  /** Probably corrupted by interference: airtime is drawn but payload does not count (7A.8). */
  corrupted?: boolean;
  /** Involved in a WARNING conflict (out-of-band risk). */
  warning?: boolean;
  /** Retransmission of an anchor task: a fallback that is not protected (7A.8). */
  retx?: boolean;
  /** How many times arbitration has moved this block later. */
  delayCount?: number;
  /** Frequency before arbitration re-tuned the block, so the planned overlap can be shown. */
  plannedFreqCenter?: number;
  plannedChannelIndex?: number;
  /** Application payload this block carries, in bytes (0 for control frames, tones and listen windows). */
  payloadBytes?: number;
}

export type ConflictSeverity = 'HARD' | 'DEGRADED' | 'WARNING' | 'TOLERATED';
/** Direction class from the Bluetooth block's point of view first, then the Wi-Fi block's. */
export type DirClass = 'TX_TX' | 'TX_RX' | 'RX_TX' | 'RX_RX';
export type InteractionTest = 'TIME' | 'FREQUENCY' | 'ANTENNA' | 'CORE' | 'SIMULTANEOUS' | 'ISOLATION';
export type PlatformColumn = 'SHARED' | 'SEP_LOW' | 'SEP_HIGH';

/** One Bluetooth block overlapping one Wi-Fi block in time, classified by stage D (7A.7). */
export interface Conflict {
  id: string;
  btBlockId: string;
  wifiBlockId: string;
  btTaskId: string;
  wifiTaskId: string;
  overlapStart: number;
  overlapEnd: number;
  overlapUs: number;
  freqOverlap: boolean;
  dirClass: DirClass;
  /** Which tests made the pair interact. TIME is always present. */
  tests: InteractionTest[];
  column: PlatformColumn;
  severity: ConflictSeverity;
  reason: string;
  label: SpecLabel;
  /** PLANNED: found at the planned times. ACTUAL: appeared only after a block moved. */
  geometry?: 'PLANNED' | 'ACTUAL';
  /** The arbitration decision that settled this pair, when it was a HARD conflict. */
  decisionId?: string;
  winnerBlockId?: string;
  btStatus?: BlockStatus;
  wifiStatus?: BlockStatus;
}

/** One arbitration decision (7A.8): who competed, the priorities, who won and why. */
export interface Decision {
  id: string;
  time: number;
  policy: ArbitrationPolicy;
  /** Machine-readable rule that decided, for example ANCHOR_FIRST_ATTEMPT or PRIORITY_DYNAMIC. */
  rule: string;
  winnerId: string;
  loserIds: string[];
  priorities: Record<string, { value: number; base: number; critical: boolean; anchor: boolean; waiting?: number }>;
  text: string;
  label: SpecLabel;
}

// ---------------------------------------------------------------------------
// Task definition (data file, 7A.2 and 6.2)
// ---------------------------------------------------------------------------

export type GeneratorName =
  | 'PERIODIC_EVENT' | 'SLOT_SCHEDULE' | 'BURST_TRAIN' | 'WINDOWED_LISTEN'
  | 'SCAN_SWEEP' | 'IRREGULAR_BURSTS' | 'ONE_SHOT_EXCHANGE';

export interface ParamGate {
  /** Bluetooth Core version needed for this parameter value (FR-6b). */
  btCore?: number;
  /** Gate applies only when a numeric value is above this number. */
  whenGt?: number;
  /** Gate applies only when the value equals one of these. */
  whenIn?: (string | number)[];
}

export interface ParamDef {
  label: string;
  type: 'number' | 'choice' | 'boolean';
  default: ParamValue;
  min?: number;
  max?: number;
  unit?: string;
  choices?: (string | number)[];
  spec: SpecLabel;
  help: string;
  /** Marks a Bluetooth LE PHY parameter, checked by rule T-3. */
  isPhy?: boolean;
  gate?: ParamGate;
}

export type MissCost = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AnchorDef {
  isAnchor: boolean;
  basis: SpecLabel;
  basisNote: string;
  missCost: MissCost;
  toleratedMisses: number;
  /** Parameter holding the supervision timeout in ms, if the link has one. */
  supervisionParam?: string;
}

export type RetryRule =
  | 'NONE' | 'NEXT_SLOT_PAIR' | 'ESCO_WINDOW' | 'BLE_NEXT_PACKET_OR_EVENT' | 'WIFI_BACKOFF';

/**
 * A number, a "$param" reference to a task parameter, an "@file.key" reference to a constant in
 * constants.json or wifiTiming.json, or arithmetic over those.
 */
export type Ref = number | string | { sum: Ref[] } | { mul: Ref[] } | { div: [Ref, Ref] };

/** How a packet duration is obtained. Numbers in µs, tables from the data files. */
export type DurSpec =
  | Ref
  | { sum: DurSpec[] }
  | { mul: DurSpec[] }
  | { bt: string }
  | { ble: { phy: string; payloadBytes: Ref } }
  | { wifi: { bytes: Ref; frame: 'DATA' | 'AMPDU' | 'MGMT' | 'ACK' | 'BA' | 'BEACON' | 'CTRL'; rate?: 'BASIC' | 'CONTROL' | 'DATA' } };

export type DirSpec = Dir | { param: string; map: Record<string, Dir> } | { role: Record<string, Dir> };

export interface PacketSpec {
  dir: DirSpec;
  kind: BlockKind | string;
  dur: DurSpec;
  /** Gap in µs after the previous packet ends (inter-frame space). */
  gapUs?: Ref;
  /** Number of repeats of this packet in sequence. */
  count?: Ref;
  /** Where the packet is sent: ADV3 repeats on 37/38/39, DATA uses one data channel per event. */
  chan?: 'ADV3' | 'DATA' | 'EVENT';
  /** Blocks that exist only when a retry is triggered (eSCO retransmission window). */
  optional?: boolean;
  /** Include the packet only when a parameter has one of the listed values. */
  when?: { param: string; in: (string | number)[] };
}

export type ChannelSpec =
  | { mode: 'CLASSIC_HOP' }
  | { mode: 'BLE_ADV'; interChannelGapUs?: Ref }
  | { mode: 'BLE_DATA'; perPacket?: boolean }
  | { mode: 'WIFI' };

/** Generator-specific pattern. Fields are documented per generator in 7A.3 and in docs of each generator. */
export interface PatternSpec {
  channel: ChannelSpec;
  [field: string]: unknown;
}

export interface BufferDef {
  /** The task keeps a queue of waiting packets that drives priority escalation (7A.8). */
  enabled: boolean;
  /** Parameter that sets the stream bitrate in kbps or Mbps. */
  bitrateParam?: string;
  criticalThreshold: number;
}

export interface TaskDef {
  id: string;
  name: string;
  tech: Tech;
  category: 'CLASSIC' | 'LE' | 'WIFI';
  description: string;
  introducedIn: string;
  /** Numeric Core version for BT (4.0, 5.2...) or generation rank for Wi-Fi. */
  minVersion: number;
  roles: string[];
  generator: GeneratorName;
  pattern: PatternSpec;
  params: Record<string, ParamDef>;
  priorityClass: string;
  anchor: AnchorDef | null;
  retry: RetryRule;
  delayable: boolean;
  buffer?: BufferDef;
  tags: string[];
  /** Wi-Fi feature the task needs (T-4). */
  requiresFeature?: string;
  /** Isochronous stream: needs Core 5.2 or later (T-3). */
  isoStream?: boolean;
  /** Exempt from the single-radio channel rule P-7 (scans sweep many channels). */
  sweepsChannels?: boolean;
  /** Slot reservation for rule P-1 and R-1: interval and offset parameters, retransmission window parameter. */
  slotReservation?: { intervalParam: string; offsetParam?: string; windowParam?: string; pairsParam?: string; exclusive: boolean };
  help: string;
  specLabel: SpecLabel;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type WifiBand = '2.4' | '5' | '6';
export type AntennaMode = 'SHARED' | 'SEPARATE';
export type FemArrangement = 'SHARED_SWITCH' | 'SEPARATE' | 'SHARED_DIPLEXER';
export type CoreMode = 'TIME_DIVISION' | 'CONCURRENT' | 'PRIORITY';
export type ArbitrationPolicy = 'PRIORITY' | 'FIRST_COME' | 'BT_FAVOURED' | 'WIFI_FAVOURED' | 'TIME_SHARE';

export interface PlatformConfig {
  wifiGeneration: string;
  wifiBand: WifiBand;
  wifiChannel: number;
  wifiBandwidth: number;
  btMaxVersion: number;
  femArrangement: FemArrangement;
  antennaMode: AntennaMode;
  isolationDb: number;
  coreCount: number;
  coreMode: CoreMode;
  txRxStreams: string;
  wifiChains: number;
  simultaneousWifiTxBtRx: boolean;
  wifiMultiRole: boolean;
  mloSimultaneousTxRx: boolean;
  arbitrationPolicy: ArbitrationPolicy;
  timeShareBtPercent: number;
  timeShareSliceUs: number;
  afhEnabled: boolean;
  afhMinChannelsClassic: number;
  afhMinChannelsBle: number;
  afhDelayUs: number;
  guardMHz: number;
  interactionThresholdDb: number;
  retryLimit: number;
  seed: number;
  windowUs: number;
  maxBleConnections: number;
  maxEscoLinks: number;
  maxIsoStreams: number;
}

export interface TaskInstance {
  instanceId: string;
  taskId: string;
  params: ParamMap;
}

export interface ScenarioConfig {
  name: string;
  tasks: TaskInstance[];
  platform: PlatformConfig;
}

// ---------------------------------------------------------------------------
// Validation (7C)
// ---------------------------------------------------------------------------

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export type IssueItem =
  | { kind: 'task'; instanceId: string; label: string; param?: string }
  | { kind: 'platform'; field: string; label: string };

export type Change =
  | { op: 'setParam'; instanceId: string; param: string; value: ParamValue }
  | { op: 'setPlatform'; field: keyof PlatformConfig; value: ParamValue }
  | { op: 'removeTask'; instanceId: string };

export interface Fix {
  id: string;
  label: string;
  /** Safe fixes only restore defaults or clamp values (7C.5 "Fix all safe issues"). */
  safe: boolean;
  changes: Change[];
  helpTopic?: string;
}

export interface ValidationIssue {
  id: string;
  severity: Severity;
  stage: number;
  title: string;
  items: IssueItem[];
  message: string;
  reason: string;
  label: SpecLabel;
  fixes: Fix[];
  helpTopic: string;
}

export interface RuleFix {
  fixId: string;
  safe?: boolean;
  vars?: Record<string, string | number>;
  changes: Change[];
}

/** What a rule condition function returns for each problem it finds. */
export interface Finding {
  items: IssueItem[];
  vars: Record<string, string | number>;
  severity?: Severity;
  fixes?: RuleFix[];
}

export interface RuleDef {
  id: string;
  stage: number;
  severity: Severity;
  title: string;
  condition: string;
  params?: Record<string, unknown>;
  message: string;
  reason: string;
  label: SpecLabel;
  /** Fix id to label template, filled with the finding's vars. */
  fixes: Record<string, string>;
  helpTopic: string;
}
