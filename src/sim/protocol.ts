// Messages between the simulation host (worker) and any client: the local renderer today,
// remote viewers later. Everything is plain JSON so it can go over any transport.
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
  /** Injects a fault on a station robot or feeder (by id) for testing and demos. */
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
  robot: RobotFrame | null;
  /** Seconds until a robot fault is repaired, or 0. */
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
  tray: { count: number; changing: number };
  batch: (Batch & { size: number; autoNext: boolean }) | { name: null; size: number; autoNext: boolean };
  counters: {
    good: number;
    rejected: number;
    traysOut: number;
    trayFill: number;
    bins: Record<string, number>;
  };
}

/** Client → host. */
export type ToHost = { type: 'command'; command: Command; origin: string } | { type: 'snapshot' };

/** Host → client. */
export type ToClient =
  | { type: 'snapshot'; state: SimState }
  | { type: 'frame'; frame: Frame }
  | { type: 'events'; events: SimEvent[] };
