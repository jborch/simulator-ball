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
  /** Times a station has sent the pen round again for a retest (EM50's Inconclusive). */
  retests: number;
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

/** What one robot does when it places its parts on the mover. */
export type PlaceOp =
  | { kind: 'load'; srId: number; mark: string }
  | { kind: 'assemble'; parts: PartType[]; fragile: boolean; measure: QualityKey | null };

/** What a station does to the mover in front of it, decided by the PLC. */
export type Op =
  /** One place op per placing robot, in the order the robots work. */
  | { kind: 'place'; places: PlaceOp[] }
  | { kind: 'inspect'; measure: QualityKey; noise: number; readCode: boolean }
  | { kind: 'reject'; bin: string }
  | { kind: 'unload'; good: boolean; bin: string };

export type InspectOp = Extract<Op, { kind: 'inspect' }>;

/** EM40's snap: the force curve of the press stroke and what was judged from it. */
export interface SnapResult {
  peak: number;
  /** Displacement (mm into the stroke) where the force peaked and the clip snapped. */
  position: number;
  accepted: boolean;
  reason: string | null;
  /** Samples, `interval` ms apart from the start of the stroke. */
  force: number[];
  displacement: number[];
  interval: number;
  /** Sim time the stroke ended (the last sample). */
  end: number;
}

export interface CycleResult {
  measurement: number | null;
  snap?: SnapResult;
  /** SR ids of the parts a robot placed, where they were tracked before (null where not). */
  partIds?: (number | null)[];
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

/**
 * What a robot gripper holds. A part carries the SR id it was tracked by on its sub-line, if any,
 * and a housing the label printed on it.
 */
export type Held = { kind: 'part'; parts: PartType[]; ids?: (number | null)[]; label?: string } | { kind: 'pen'; load: Load };

export type RobotJob = 'prepick' | 'place' | 'pickMover' | 'drop';

/** One step of a robot job program. Targets are resolved when the step starts. */
export type RobotStep =
  /** 'lift': just clear of the part it let go of. */
  | { k: 'z'; to: 'safe' | 'approach' | 'mover' | 'source' | 'drop' | 'lift' }
  /** Back home and up to safe height in one blended move. */
  | { k: 'leave' }
  | { k: 'xy'; to: 'home' | 'mover' | 'source' | 'drop' }
  | { k: 'waitSource' }
  | { k: 'waitDrop' }
  | { k: 'grip'; from: 'source' | 'mover' }
  | { k: 'release'; to: 'mover' | 'drop' }
  /** Pushes the part home from the approach height to the mover in `mech` seconds (scaled by speed). */
  | { k: 'press'; mech: number }
  /** Starts the station's laser marker on the body just placed (it marks while the robot moves on). */
  | { k: 'mark'; seconds: number };

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
  /** Time left of a grip or release. */
  dwellFixed: number;
  /** Height the current press stroke started from. */
  pressFrom: number;
  /** Time the current (or last) press stroke actually ran (frozen time excluded), and when it ended. */
  pressTime: number;
  pressEnd: number;
  /** What the current step is doing, for display. */
  phase: 'idle' | 'move' | 'grip' | 'press' | 'starved' | 'blocked' | 'fault';
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

/** A part on a feeder track. */
export interface FeederItem {
  /** Position along the track; 0 = at the pick point, increasing back toward the bowl. */
  x: number;
  /** Plant-side identity, so the PLC can find the part a camera result belongs to. */
  uid: number;
  /** True value of what the inline camera measures, if the track has one. */
  truth: number | null;
  /** Passed the inline camera; its result is with the PLC. */
  measured: boolean;
  /** PLC shift register: SR id and eject decision once the part has been inspected. */
  sr: number | null;
  eject: boolean;
}

export interface Feeder {
  id: string;
  items: FeederItem[];
  nextIn: number;
  fed: number;
  /** Seconds until a jam is cleared; 0 when feeding normally. */
  jam: number;
  nextUid: number;
  /** Inline camera measurements (and when they were taken) not yet taken by the PLC. */
  results: { uid: number; value: number; t: number }[];
}

/** EM13: takes a spring base, turns it, measures its angle; the PLC decides where it goes. */
export interface Orienter {
  item: { truth: number; sr: number | null } | null;
  phase: 'idle' | 'turning' | 'measuring' | 'decide' | 'out';
  mechLeft: number;
  fixedLeft: number;
  /** Sim time the current part was taken. */
  start: number;
  /** Measured angle once phase is 'decide'. */
  result: number | null;
  /** Set by the PLC: push the part on (true) or into the reject chute (false). */
  pass: boolean | null;
}

/** A housing on the dial. */
export interface DialPart {
  uid: number;
  /** PLC shift register: SR id and the identifier to print (set once loaded), and EM32's verdict. */
  sr: number | null;
  print: string | null;
  ok: boolean | null;
  /** What is physically on it: the printed label (GS1 element string) and the label's true quality. */
  label: string | null;
  quality: number | null;
  inspected: boolean;
}

export type DialOp = 'load' | 'label' | 'inspect' | 'eject';

/** The housing dial (EM30–EM32): parts by position, and each position's job in this dwell. */
export interface Dial {
  slots: (DialPart | null)[];
  phase: 'dwell' | 'index';
  /** Seconds left of the index turn. */
  turn: number;
  /** Per position job: seconds left while running (from = start time), 'done' once done this dwell. */
  jobs: Record<DialOp, { left: number; from: number } | 'done' | null>;
  /** Finished operations for the PLC to record (sim times). */
  results: { op: Exclude<DialOp, 'eject'>; uid: number; from: number; to: number; value?: number; code?: string | null }[];
  nextUid: number;
}

/** Spring base distribution conveyor with a diverter and pick cup per station. */
export interface Distribution {
  /** Parts on the conveyor (loop coordinate x), front first, with their SR ids. */
  items: { x: number; sr: number | null }[];
  cups: { station: string; sr: number | null; full: boolean; filling: number }[];
}

/** A collet on EM41's collet loop: where it is, and the cartridge in it (with its SR id once the PLC has it). */
export interface Collet {
  id: number;
  /** Position along the loop, 0 = pick apex, increasing in the direction of travel. */
  u: number;
  cartridge: { sr: number | null } | null;
  /** Held at its stop until the robot that just filled or emptied it has lifted clear. */
  hold: 'fill' | 'pick' | null;
}

/** EM41's cartridge supply: the tub at the de-nest position, EM00's robot and the collet loop. */
export interface CartridgeCell {
  /** The tub being de-nested: its SR id (from the PLC) and how many cartridges have been gripped out of it; null while changing. */
  tub: { sr: number | null; used: number } | null;
  /** Seconds left of a tub change. */
  changing: number;
  tubs: number;
  robot: DenestRobot;
  collets: Collet[];
  /** Cartridges placed in collets, for the PLC to record (sim times). */
  results: { pocket: number; nest: number; collet: number; from: number; to: number }[];
}

/**
 * EM00's gantry robot, in its own frame: `a` from the fill point out over the tub, `r` across
 * (station-local -a), `z` height. It picks the next pocket, then puts the cartridge into the
 * empty collet waiting at the fill point.
 */
export interface DenestRobot {
  a: number;
  r: number;
  z: number;
  va: number;
  vr: number;
  vz: number;
  ta: number;
  tr: number;
  tz: number;
  step: 'idle' | 'toPocket' | 'down' | 'grip' | 'up' | 'toCollet' | 'waitCollet' | 'place' | 'release' | 'clear';
  timer: number;
  /** The cartridge it holds: tub pocket, the tub's SR id and when it was picked. */
  holding: { pocket: number; nest: number; from: number } | null;
  phase: Robot['phase'];
}

export interface TrayState {
  count: number;
  /** PLC shift register: the SR id of the tray being filled (set once it's in place). */
  sr: number | null;
  /** Seconds left of a tray change, 0 when an empty tray is in place. */
  changing: number;
  /** PLC request to send out a partly filled tray (end of batch). Cleared when it has gone. */
  discharge: boolean;
}

/** A filled tray on the conveyor from EM60 through EM61's check to the stack or reject rack. */
export interface OutTray {
  sr: number | null;
  count: number;
  /** Position along the conveyor (EM60's station-local a). */
  x: number;
  phase: 'toCheck' | 'checking' | 'decide' | 'out';
  /** Seconds left of the check, and when it began. */
  mechLeft: number;
  fixedLeft: number;
  from: number;
  /** True quality EM61 sees, and the PLC's verdict. */
  quality: number;
  ok: boolean | null;
}

export interface TrayLine {
  trays: OutTray[];
  /** Good trays on the outfeed stack, and trays pushed into the reject rack. */
  stacked: number;
  rejected: number;
  /** Finished checks for the PLC to record (sim times). */
  results: { sr: number | null; count: number; value: number; from: number; to: number }[];
}

/** A station's physical equipment: stop gate, RFID reader and either robots or a camera. */
export interface PlantStation {
  id: string;
  gateClosed: boolean;
  reader: Reader;
  /** One per robot in the station's definition, same order. */
  robots: Robot[];
  /** Laser marker at work on a body, if the station has one. Exposure time doesn't scale with speed. */
  laser: { left: number; moverId: number; mark: string } | null;
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
  /** Bowls and sub-line conveyors only run while the machine runs (PLC output). */
  feedersOn: boolean;
  orienter: Orienter;
  distribution: Distribution;
  dial: Dial;
  bins: Record<string, number>;
  feeders: Feeder[];
  cartridges: CartridgeCell;
  /** Parts dropped or lost (didn't seat), by station. */
  scrap: Record<string, number>;
  tray: TrayState;
  trayLine: TrayLine;
  traysOut: number;
  /** Pens in the trays that have gone out. */
  pensOut: number;
}

export type StationStep = 'idle' | 'read' | 'retryRead' | 'waitGroup' | 'waitRobot' | 'working' | 'write' | 'retryWrite' | 'leaving';
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
  /** Mover that an upstream member of this station's N-up group has passed on to work here. */
  reserved: number | null;
  /** Operation in progress, kept to build events when the cycle finishes. */
  op: Op | null;
  /** Place ops: index of the robot whose turn it is. */
  job: number;
  /** Place ops: SR ids of the parts each robot placed (where tracked on a sub-line). */
  placed: (number | null)[][];
  /** What the station measured during the cycle (a camera, or the robot that measures). */
  result: CycleResult | null;
  stats: { cycles: number; passes: number; busy: number; noReads: number; faults: number; faultTime: number };
  /** Last seen fault input of each robot (by robot id), to emit events on change. */
  faulted: Record<string, boolean>;
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
  /** Trays to make (EM61 counts them). */
  target: number;
  loaded: number;
  good: number;
  rejected: number;
  /** Trays checked at EM61: passed, and pushed into the reject rack. */
  trays: number;
  traysRejected: number;
  /** Ended early by the operator: no replacement for rejects, the last tray may be short. */
  ended: boolean;
  startedAt: number;
  state: 'running' | 'completing' | 'complete';
}

export interface PlcState {
  machine: MachineState;
  stateSince: number;
  speedTarget: number;
  stations: PlcStation[];
  srCounter: number;
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
  result?: 'Passed' | 'Failed' | 'Inconclusive';
  /** Long unique id marked on the item (the pen's GS1 code). */
  identifier?: string;
  sourceScopedId?: number;
  sourceType?: string;
  sourcePosition?: number;
  properties?: Record<string, number | string | boolean | null>;
}

export interface ItemsMergedEvent {
  kind: 'merged';
  process: string;
  target: number;
  targetType: string;
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

export type StationCode = 'axisFault' | 'axisFaultCleared' | 'feederJam' | 'feederJamCleared' | 'rfidNoRead' | 'rfidWriteFailed' | 'rfidWriteRecovered';

export interface StationEvent {
  kind: 'station';
  process: string;
  code: StationCode;
  message: string;
  carrier?: string;
  logged: number;
}

/** A time series of device data (EM40's snap curve), sent to CATCH.AI one row per sample. */
export interface SeriesEvent {
  kind: 'series';
  process: string;
  /** Item the series belongs to, for the start event. */
  scopedId: number;
  /** Wall-clock ms of the first sample, and ms between samples. */
  start: number;
  interval: number;
  /** One array of samples per property name. */
  values: Record<string, number[]>;
  /** Event logged with the first sample. */
  startEvent: string;
}

export type SimEvent = ItemProcessedEvent | ItemsMergedEvent | MachineEvent | CommandEvent | StationEvent | BatchEvent | SeriesEvent;

export interface MesState {
  /** Identifier marked on each pen still on the line, by SR id. */
  identifiers: Record<number, string>;
  good: number;
  rejected: number;
  rejectsByCause: Record<string, number>;
  movers: Record<number, { pens: number; rejects: number }>;
  /** Pens sent round again for a retest. */
  retests: number;
  events: SimEvent[];
}

export interface SimState {
  epochMs: number;
  rng: RngState;
  plant: PlantState;
  plc: PlcState;
  mes: MesState;
}
