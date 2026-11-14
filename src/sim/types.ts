// Simulation state. Everything here is plain, JSON-serializable data so it can be
// snapshotted and sent to other browsers (no classes, Maps, Sets or functions).
import type { MoverProfile, PartType, QualityKey, Step } from './config';
import type { RngState } from './rng';

export type MachineState = 'Stopped' | 'Starting' | 'Execute' | 'Completing' | 'Complete' | 'Stopping' | 'Holding' | 'Held' | 'Aborted';

/** Contents of a mover's RFID tag — what the PLC believes. */
export interface Tag {
  srId: number | null;
  status: 'empty' | 'ok' | 'nok';
  done: Step[];
  reason: string | null;
}

/** The physical assembly sitting in a mover's fixture — the truth. */
export interface Load {
  srId: number;
  /** GS1 element string laser-marked on the body ('' until the laser has marked it). */
  mark: string;
  parts: PartType[];
  quality: Partial<Record<QualityKey, number>>;
  fragile: number;
}

export interface Mover {
  /** Printed number, 1..count. */
  id: number;
  s: number;
  v: number;
  profile: MoverProfile;
  tag: Tag;
  load: Load | null;
  /** Index into plant.gateOrder of the next gate ahead. */
  nextGate: number;
  /** Sim time the mover came to rest at a gate, or null while not resting at one. */
  stoppedAt: number | null;
  laps: number;
  lapStart: number;
  lastLap: number | null;
}

/** What a station does to the mover in front of it, decided by the PLC. */
export type Op =
  | { kind: 'load'; srId: number; mark: string }
  | { kind: 'assemble'; parts: PartType[]; fragile: boolean; measure: QualityKey | null }
  | { kind: 'inspect'; measure: QualityKey; noise: number; readCode: boolean }
  | { kind: 'reject'; bin: string }
  | { kind: 'unload'; good: boolean; bin: string };

/** Ops a robot carries out by placing parts on the mover. */
export type PlaceOp = Extract<Op, { kind: 'load' | 'assemble' }>;
export type InspectOp = Extract<Op, { kind: 'inspect' }>;

export interface CycleResult {
  measurement: number | null;
  /** Decoded DataMatrix, or null if unreadable. Undefined when not read. */
  code?: string | null;
}

/** Inspection camera: the PLC triggers a cycle and waits for `done`. */
export interface Camera {
  cycle: { op: InspectOp; moverId: number; mechLeft: number; fixedLeft: number } | null;
  done: boolean;
  result: CycleResult | null;
}

export interface Reader {
  busy: boolean;
  kind: 'read' | 'write';
  left: number;
  moverId: number;
  write: Tag | null;
  /** Set when the operation finishes. */
  done: boolean;
  ok: boolean;
  data: Tag | null;
}

/** What a robot gripper holds. */
export type Held = { kind: 'part'; parts: PartType[] } | { kind: 'pen'; load: Load };

export type RobotJob = 'prepick' | 'place' | 'pickMover' | 'drop';

/** One step of a robot job program. Targets are resolved when the step starts. */
export type RobotStep =
  | { k: 'z'; to: 'safe' | 'approach' | 'mover' | 'source' | 'drop' }
  | { k: 'xy'; to: 'home' | 'source' | 'drop' }
  | { k: 'waitSource' }
  | { k: 'waitDrop' }
  | { k: 'grip'; from: 'source' | 'mover' }
  | { k: 'release'; to: 'mover' | 'drop' }
  /** Pushes the part home from the approach height to the mover in `mech` seconds (scaled by speed). */
  | { k: 'press'; mech: number }
  | { k: 'dwell'; fixed: number; phase: 'laser' }
  | { k: 'mark' };

export interface Robot {
  a: number;
  r: number;
  z: number;
  va: number;
  vr: number;
  vz: number;
  /** Target of the current motion step. */
  ta: number;
  tr: number;
  tz: number;
  job: RobotJob | null;
  steps: RobotStep[];
  stepStarted: boolean;
  dwellMech: number;
  dwellFixed: number;
  /** Height the current press stroke started from. */
  pressFrom: number;
  /** What the current step is doing, for display. */
  phase: 'idle' | 'move' | 'grip' | 'press' | 'laser' | 'starved' | 'blocked' | 'fault';
  holding: Held | null;
  /** Op applied when placing on a mover. */
  op: PlaceOp | null;
  moverId: number;
  dropTarget: { kind: 'bin'; bin: string } | { kind: 'tray' } | null;
  /** Reserved nest pocket or tray pocket for the current job. */
  slot: number | null;
  /** What the station measured during the last place (e.g. snap force). */
  result: CycleResult | null;
  /** Set when a pen has been let go over its bin or tray; the PLC acknowledges by clearing it. */
  dropped: boolean;
  /** Seconds until an axis fault is repaired; 0 when healthy. The robot is frozen meanwhile. */
  fault: number;
  /** Operating (busy) seconds left until the next random axis fault. */
  nextFault: number;
}

export interface Feeder {
  id: string;
  /** Part positions along the track; 0 = at the pick point, increasing back toward the bowl. */
  items: number[];
  nextIn: number;
  fed: number;
  /** Seconds until a jam is cleared; 0 when feeding normally. */
  jam: number;
}

export interface Nest {
  /** Station whose robot de-nests from it. */
  station: string;
  /** 0 = empty, 1 = full, 2 = reserved by the robot on its way. */
  slots: number[];
  /** Seconds left of a nest change, 0 when a nest is in place. */
  changing: number;
  count: number;
}

export interface TrayState {
  count: number;
  /** Seconds left of a tray change, 0 when an empty tray is in place. */
  changing: number;
  /** PLC request to send out a partly filled tray (end of batch). Cleared when it has gone. */
  discharge: boolean;
}

/** A station's physical equipment: stop gate, RFID reader and either a robot or a camera. */
export interface PlantStation {
  id: string;
  gateClosed: boolean;
  reader: Reader;
  robot: Robot | null;
  camera: Camera | null;
}

export interface PlantState {
  t: number;
  beltSpeed: number;
  beltRunning: boolean;
  /** Actual machine speed fraction (ramps toward PLC target). */
  speed: number;
  speedTarget: number;
  estop: boolean;
  movers: Mover[];
  stations: PlantStation[];
  /** Station indexes sorted by gate position. */
  gateOrder: number[];
  bins: Record<string, number>;
  feeders: Feeder[];
  nests: Nest[];
  /** Parts dropped or lost (didn't seat), by station. */
  scrap: Record<string, number>;
  tray: TrayState;
  traysOut: number;
  /** Pens in the trays that have gone out. */
  pensOut: number;
  /** Pens in the most recent trays out, newest first (the ones still queued on the outfeed). */
  trayQueue: number[];
}

export type StationStep = 'idle' | 'read' | 'retryRead' | 'waitRobot' | 'working' | 'write' | 'retryWrite' | 'leaving';
export type StationStatus = 'waiting' | 'reading' | 'working' | 'passing' | 'stopped' | 'starved' | 'blocked' | 'fault';

export interface PlcStation {
  id: string;
  step: StationStep;
  status: StationStatus;
  timer: number;
  tries: number;
  moverId: number | null;
  tag: Tag | null;
  pendingTag: Tag | null;
  cycleStart: number;
  /** A twin partner upstream has passed a mover to this station. */
  reserved: boolean;
  /** Operation in progress, kept to build events when the cycle finishes. */
  op: Op | null;
  stats: { cycles: number; passes: number; busy: number; noReads: number; faults: number; faultTime: number };
  /** Last seen fault input, to emit events on change. */
  faulted: boolean;
  /** A pen picked off a mover that hasn't been dropped in its tray or bin yet; recorded when it has. */
  output: PendingOutput | null;
}

export interface PendingOutput {
  pen: number;
  good: boolean;
  cause: string;
  bin: string;
  moverId: number;
  /** Sim time the pick started. */
  start: number;
}

export interface Batch {
  name: string;
  target: number;
  loaded: number;
  good: number;
  rejected: number;
  startedAt: number;
  state: 'running' | 'completing' | 'complete';
}

export interface PlcState {
  machine: MachineState;
  stateSince: number;
  speedTarget: number;
  stations: PlcStation[];
  srCounter: number;
  /** Nest currently being de-nested at each nest-fed station (for genealogy). */
  nests: Record<string, { srId: number; used: number }>;
  /** Tray being filled at the unload station: tracking id, pens in it, and when its first pen went in. */
  tray: { srId: number; count: number; start: number };
  batch: Batch | null;
  /** Set by an E-stop: equipment stays halted (even after Reset) until the next Start. */
  interrupted: boolean;
  batchSize: number;
  autoNext: boolean;
  /** Feeder jam state last seen, to emit events on change. */
  jammed: Record<string, boolean>;
}

export interface ItemProcessedEvent {
  kind: 'processed';
  process: string;
  scopedId: number;
  itemType: string;
  from: number;
  to: number;
  carrier?: string;
  result?: 'Passed' | 'Failed';
  identifier?: string;
  sourceScopedId?: number;
  sourcePosition?: number;
  properties?: Record<string, number | string | boolean | null>;
}

export interface ItemsMergedEvent {
  kind: 'merged';
  process: string;
  target: number;
  source: number;
  sourceType: string;
  position: number;
  logged: number;
}

export interface MachineEvent {
  kind: 'machine';
  state: MachineState;
  logged: number;
}

export interface CommandEvent {
  kind: 'command';
  command: string;
  origin: string;
  accepted: boolean;
  logged: number;
}

export interface BatchEvent {
  kind: 'batch';
  name: string;
  state: 'started' | 'completed';
  target: number;
  good: number;
  rejected: number;
  logged: number;
}

export interface StationEvent {
  kind: 'station';
  process: string;
  message: string;
  carrier?: string;
  logged: number;
}

export type SimEvent = ItemProcessedEvent | ItemsMergedEvent | MachineEvent | CommandEvent | StationEvent | BatchEvent;

export interface MesState {
  /** Identifier marked on each pen still on the line, by SR id. */
  identifiers: Record<number, string>;
  good: number;
  rejected: number;
  rejectsByCause: Record<string, number>;
  movers: Record<number, { pens: number; rejects: number }>;
  events: SimEvent[];
}

export interface SimState {
  epochMs: number;
  rng: RngState;
  plant: PlantState;
  plc: PlcState;
  mes: MesState;
}
