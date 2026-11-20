// Messages between the simulation host (the Node server, src/server) and its viewers (the
// browser), sent as JSON text over a WebSocket at /ws.
import type { ReporterStatus } from '../catchai/reporter';
import type { PartType } from './config';
import type { IncidentKind } from './incidents';
import type { AlarmId, Batch, Lighting, MachineState, Orienter, Robot, SceneState, SimEvent, SimState, StationStatus, Tag } from './types';

export type Command =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'hold' }
  | { type: 'unhold' }
  | { type: 'abort' }
  | { type: 'reset' }
  | { type: 'speed'; percent: number }
  /** Ends the current batch early: stop loading and run the line empty. */
  | { type: 'endBatch' }
  | { type: 'batchSize'; size: number }
  | { type: 'autoBatch'; on: boolean }
  /** Injects a fault on a robot or feeder (by id) for testing and demos. */
  | { type: 'fault'; target: string }
  /**
   * Starts a visible incident (incidents.ts) near a station, or a random one. Only the cameras see
   * it: it raises no alarm and isn't logged as an event.
   */
  | { type: 'incident'; kind: IncidentKind; station?: string }
  /** Changes the surroundings: lighting, or a new scene seed (camera mounts, wear, people). */
  | { type: 'scene'; lighting?: Lighting; seed?: number };

export interface MoverFrame {
  id: number;
  s: number;
  v: number;
  status: Tag['status'];
  parts: PartType[];
  /** Physical item in the fixture: SR id and the GS1 identifier marked on it. */
  srId: number | null;
  mark: string | null;
  laps: number;
  lastLap: number | null;
}

export interface RobotFrame {
  a: number;
  r: number;
  z: number;
  phase: Robot['phase'];
  /** Parts in the gripper (a picked pen shows its parts), or null. */
  holding: PartType[] | null;
  /** What is printed on the held housing or pen, if anything. */
  label: string | null;
}

export interface StationFrame {
  id: string;
  status: StationStatus;
  gateClosed: boolean;
  moverId: number | null;
  /** 0..1 through the current cycle, null when not working. */
  progress: number | null;
  /** The station's robots, in the order of its definition. */
  robots: RobotFrame[];
  /** The station's laser marker is firing. */
  laser: boolean;
  /** Seconds until the last robot fault is repaired, or 0. */
  fault: number;
  scrap: number;
}

/** A visible incident as drawn (see Incident in incidents.ts). */
export interface IncidentFrame {
  id: number;
  kind: IncidentKind;
  station: string;
  moverId?: number;
  s?: number;
  offset?: number;
  parts?: PartType[];
  part?: PartType;
  a?: number;
  r?: number;
  angle: number;
}

export interface Frame {
  t: number;
  scene: SceneState;
  incidents: IncidentFrame[];
  epochMs: number;
  machine: MachineState;
  speed: number;
  speedTarget: number;
  beltSpeed: number;
  movers: MoverFrame[];
  stations: StationFrame[];
  feeders: { id: string; items: number[]; jam: number }[];
  /** EM13: what it's doing, and 0..1 through turning and measuring the current part. */
  orienter: { phase: Orienter['phase']; progress: number };
  /**
   * Housing dial: each position's housing (0 none, 1 loaded, 2 labelled, 3 checked OK, 4 NOK)
   * and the label printed on it, 0..1 through an index turn, and which positions are working.
   */
  dial: { slots: number[]; labels: (string | null)[]; turn: number; roll: number; active: { load: boolean; label: boolean; inspect: boolean; eject: boolean } };
  /** Seconds until each sub-line alarm (dial jam, label roll, orienter, destacker) is cleared, 0 when clear. */
  alarms: Record<AlarmId, number>;
  /** Spring base conveyor: part positions (loop coordinate) and each cup: 0 empty, 1 full, 2 filling. */
  distribution: { items: number[]; cups: number[] };
  /**
   * EM41's cartridge supply: pockets taken from the tub (all of them while it's being changed),
   * seconds left of a tub change, EM00's robot, and each collet's [loop position, full 0/1].
   */
  cartridges: { used: number; changing: number; robot: RobotFrame; collets: [number, number][] };
  /**
   * Tray being filled, the trays on the conveyor ([position, pens, state 0 moving, 1 being checked
   * by EM61, 2 good, 3 rejected]), and how many went onto the stack and into the reject rack.
   */
  tray: { count: number; changing: number; line: [number, number, number][]; stacked: number; rejected: number; stack: number };
  batch: Batch | null;
  /** Applies to the next batch. */
  batchSettings: { size: number; autoNext: boolean };
  counters: {
    good: number;
    rejected: number;
    /** Pens sent round for a retest. */
    retests: number;
    traysOut: number;
    bins: Record<string, number>;
  };
}

/** Client → host. */
export type ToHost =
  | { type: 'command'; command: Command; origin: string }
  | { type: 'snapshot' }
  /** Turns CATCH.AI reporting on or off for the line. */
  | { type: 'catchai'; enabled: boolean };

/** Host → client. On connect a viewer gets the current frame, recent events and reporting status. */
export type ToClient =
  | { type: 'snapshot'; state: SimState }
  | { type: 'frame'; frame: Frame }
  | { type: 'events'; events: SimEvent[] }
  /** Reporting status, about once a second; null when reporting is off. */
  | { type: 'catchai'; status: ReporterStatus | null };
