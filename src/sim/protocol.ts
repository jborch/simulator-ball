// Messages between the simulation host (the Node server, src/server) and its viewers (the
// browser), sent as JSON text over a WebSocket at /ws.
import type { ReporterStatus } from '../catchai/reporter';
import type { PartType } from './config';
import type { Batch, MachineState, Robot, SimEvent, SimState, StationStatus, Tag } from './types';

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
  | { type: 'fault'; target: string };

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

export interface Frame {
  t: number;
  epochMs: number;
  machine: MachineState;
  speed: number;
  speedTarget: number;
  beltSpeed: number;
  movers: MoverFrame[];
  stations: StationFrame[];
  feeders: { id: string; items: number[]; jam: number }[];
  nests: { station: string; slots: number[]; changing: number }[];
  /** Tray being filled, and the pen counts of the trays queued on the outfeed (newest first). */
  tray: { count: number; changing: number; queue: number[] };
  batch: Batch | null;
  /** Applies to the next batch. */
  batchSettings: { size: number; autoNext: boolean };
  counters: {
    good: number;
    rejected: number;
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
