// Messages between the simulation host (worker) and any client: the local renderer today,
// remote viewers later. Everything is plain JSON so it can go over any transport.
import type { PartType } from './config';
import type { MachineState, SimEvent, SimState, StationStatus, Tag } from './types';

export type Command =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'hold' }
  | { type: 'unhold' }
  | { type: 'abort' }
  | { type: 'reset' }
  | { type: 'speed'; percent: number };

export interface MoverFrame {
  id: number;
  s: number;
  v: number;
  status: Tag['status'];
  parts: PartType[];
  laps: number;
  lastLap: number | null;
}

export interface StationFrame {
  id: string;
  status: StationStatus;
  gateClosed: boolean;
  moverId: number | null;
  /** 0..1 through the current cycle, null when not working. */
  progress: number | null;
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
