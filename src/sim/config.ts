// Line configuration. SI units throughout: metres, seconds, m/s.

export type Step = 'body' | 'spring' | 'springInsp' | 'cartridge' | 'housing' | 'final';
export type PartType = 'body' | 'spring' | 'cartridge' | 'housing' | 'cap';
export type QualityKey = 'springAngle' | 'seatDepth' | 'snapForce';
export type StationKind = 'load' | 'assemble' | 'inspect' | 'reject' | 'unload';

export interface Limits {
  key: QualityKey;
  lower: number;
  upper: number;
  /** Measurement noise (1σ) added by the sensor on top of the true value. */
  noise: number;
  unit: string;
  cause: string;
}

export interface UnitDef {
  /** Unit id as in the original line, e.g. "UN01". */
  id: string;
  name: string;
}

/**
 * A pick-and-place robot of a station. A station can have several; they work on the mover one
 * after the other, in the order listed, each on its own arm of the station's gantry.
 */
export interface RobotDef {
  /** Unique on the line: fault injection target and fault events. */
  id: string;
  /** Where the arm waits along the belt (station-local a); its part source sits there too. */
  home: number;
  /** Where it picks parts: a feeder id or the station's cartridge nest. Pickers (reject, unload) have none. */
  source?: string;
  parts?: PartType[];
  /** Step written to the mover tag once this robot has placed its parts ('body' loads a new pen). */
  step?: Step;
  /**
   * How far above its seated position the part is brought before it is pushed home. The push
   * takes `mech` seconds at 100 % speed (fast z move when mech is 0); robot travel comes on top.
   */
  insert?: number;
  mech: number;
  /** Laser-marks the placed body for this many seconds (doesn't scale with speed). */
  laser?: number;
}

export interface StationDef {
  /** Station id as in the original line (e.g. "EM12"), plus R1/R2 for our reject stations. */
  id: string;
  name: string;
  unit: string;
  kind: StationKind;
  /** Stop gate position along the loop (mover centre stops here). */
  s: number;
  /** Camera stations: process time at 100 % speed that scales with machine speed. */
  mech: number;
  /** Camera stations: process time that doesn't scale (exposure). */
  fixed: number;
  robots?: RobotDef[];
  /** Camera stations: step written to the mover tag when the inspection completes. */
  step?: Step;
  requires?: Step[];
  inspect?: Limits;
  /**
   * N-up group on one belt: the members (in loop order) take consecutive movers and work at the
   * same time. A member passes a mover on to the furthest free member downstream.
   */
  group?: string;
  /** Degrades the assembly it touches (like EM14B in the C# sim). */
  fragile?: boolean;
  /** Also verifies the DataMatrix identifier against tracking. */
  readsCode?: boolean;
  bin?: string;
}

const STRAIGHT = 3.6;
const RADIUS = 0.4;
const BOTTOM = STRAIGHT + Math.PI * RADIUS;

export const LINE = {
  id: 'L07',
  name: 'Pen assembly line',
  /** Units of the original line; every station, feeder and nest belongs to one. */
  units: [
    { id: 'UN01', name: 'Spring and spring base' },
    { id: 'UN02', name: 'Housing and final assembly' },
    { id: 'UN03', name: 'Tray packing' },
  ] satisfies UnitDef[] as UnitDef[],
  track: { straight: STRAIGHT, radius: RADIUS },
  belt: {
    /** Nominal belt speed at 100 % machine speed. */
    speed: 0.25,
    /** Belt drive ramp. */
    accel: 0.5,
  },
  /** Machine speed override ramps at this many fractions per second. */
  speedRamp: 0.5,
  speedMin: 0.1,
  mover: {
    count: 32,
    length: 0.12,
    gravity: 9.81,
    /** Height of the fixture seat (bottom of the pen body) above the belt surface. */
    seat: 0.03,
  },
  /**
   * Part geometry along the pen axis: where each part's base sits above the fixture seat in the
   * finished assembly, and its length. The body is an open tube: the spring and the cartridge go
   * inside it, the housing slides over it and the cap closes the housing.
   */
  parts: {
    body: { seat: 0, length: 0.11, radius: 0.0065 },
    spring: { seat: 0.006, length: 0.045, radius: 0.0048 },
    cartridge: { seat: 0.051, length: 0.073, radius: 0.0048 },
    housing: { seat: 0.008, length: 0.12, radius: 0.0085 },
    cap: { seat: 0.128, length: 0.035, radius: 0.009 },
  } satisfies Record<PartType, PartGeometry> as Record<PartType, PartGeometry>,
  plantDt: 0.001,
  plcScan: 0.01,
  /** Mover centre within this distance past a gate counts as "at gate". */
  gateZone: 0.02,
  /** After maxTries failed writes the station holds the mover and retries every stuckRetryDelay. */
  rfid: { readTime: 0.04, writeTime: 0.04, retryDelay: 0.3, maxTries: 3, stuckRetryDelay: 2 },
  dataMatrix: { readFailRate: 0.002 },
  nestSize: 24,
  traySize: 12,
  /** Swapping an empty cartridge nest for a full one. */
  nestChange: 4,
  /** Indexing a full tray out and an empty one in. */
  trayChange: 3,
  /** Bowl feeders push parts onto a linear track toward the robot's pick point. */
  feeders: [
    { id: 'bodies', unit: 'UN01', part: 'body', interval: 1.0, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3 },
    { id: 'springs', unit: 'UN01', part: 'spring', interval: 1.0, track: 0.24, pitch: 0.02, speed: 0.12, pickZ: 0.22 },
    { id: 'housings', unit: 'UN02', part: 'housing', interval: 1.1, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3 },
  ] as FeederDef[],
  /** Random faults, all drawn from the seeded RNG. Repair times are uniform in [min, max] seconds. */
  faults: {
    enabled: true,
    /** Probability that feeding one part jams the bowl. */
    feederJamPerPart: 1 / 450,
    feederRepair: [20, 60] as [number, number],
    /** Mean operating seconds (robot busy) between axis faults, per robot. */
    robotMtbf: 1800,
    robotRepair: [30, 90] as [number, number],
    /** Probability that a placed part doesn't seat and is lost. */
    misplaceRate: 0.003,
  },
  batch: {
    /** Pens loaded per batch; the line runs out (empties) once this many are loaded. */
    size: 300,
    /** Start the next batch automatically after a completed one. */
    autoNext: true,
    /** Pause between batches. */
    pause: 20,
  },
  /** Cartesian pick-and-place robots: along belt (a), across belt toward the outside (r), height (z). */
  robot: { vH: 2.0, aH: 12, vZ: 1.0, aZ: 12, gripTime: 0.08, lift: 0.02 },
  /** Device positions in station-local coordinates (a along travel, r outward from belt centre), metres. */
  layout: {
    feederR: 0.32,
    /** Each nest-fed station has its own nest, in station-local coordinates. */
    nest: { a: 0, r: 0.34, cols: 6, rows: 4, pitch: 0.016 },
    tray: { station: 'EM60', a: 0.05, r: 0.3, cols: 4, rows: 3, pitch: 0.03 },
    bins: { BIN1: { a: 0, r: 0.3 }, BIN2: { a: -0.3, r: 0.3 } } as Record<string, { a: number; r: number }>,
    /**
     * Gripper tip heights above the belt surface. The gripper holds a part (or a pen) by its top,
     * so on the mover the tip height follows from the part geometry (see layout.ts).
     */
    z: { safe: 0.36, nest: 0.073, bin: 0.2, tray: 0.159 },
  },
  gs1: { gtin: '0571234500001', expiryYears: 3 },
  stations: [
    {
      id: 'EM11', name: 'Load body + mount spring', unit: 'UN01', kind: 'load', s: 0.6, mech: 0, fixed: 0,
      robots: [
        { id: 'EM11-BODY', home: -0.15, source: 'bodies', parts: ['body'], step: 'body', insert: 0.03, mech: 0, laser: 0.3 },
        { id: 'EM11-SPRING', home: 0.15, source: 'springs', parts: ['spring'], step: 'spring', insert: 0.11, mech: 0.3 },
      ],
    },
    {
      id: 'EM12', name: 'Measure spring angle', unit: 'UN01', kind: 'inspect', s: 1.35, mech: 0.3, fixed: 0.5, step: 'springInsp', requires: ['spring'],
      inspect: { key: 'springAngle', lower: 35, upper: 55, noise: 0.4, unit: 'deg', cause: 'Spring angle out of tolerance' },
    },
    { id: 'R1', name: 'Early reject', unit: 'UN01', kind: 'reject', s: 1.85, mech: 0, fixed: 0, bin: 'BIN1', robots: [{ id: 'R1', home: 0, mech: 0 }] },
    {
      id: 'EM41A', name: 'Insert cartridge A', unit: 'UN02', kind: 'assemble', s: 2.45, mech: 0, fixed: 0, requires: ['springInsp'], group: 'EM41',
      robots: [{ id: 'EM41A', home: 0, source: 'nest', parts: ['cartridge'], step: 'cartridge', insert: 0.065, mech: 3.0 }],
    },
    {
      id: 'EM41B', name: 'Insert cartridge B', unit: 'UN02', kind: 'assemble', s: 2.7, mech: 0, fixed: 0, requires: ['springInsp'], group: 'EM41', fragile: true,
      robots: [{ id: 'EM41B', home: 0, source: 'nest', parts: ['cartridge'], step: 'cartridge', insert: 0.065, mech: 3.0 }],
    },
    {
      id: 'EM40', name: 'Mount housing + cap', unit: 'UN02', kind: 'assemble', s: BOTTOM + 0.6, mech: 0, fixed: 0, requires: ['cartridge'],
      robots: [{ id: 'EM40', home: 0, source: 'housings', parts: ['housing', 'cap'], step: 'housing', insert: 0.11, mech: 0.6 }],
      inspect: { key: 'snapForce', lower: 25, upper: 39, noise: 0.3, unit: 'N', cause: 'Snap force out of window' },
    },
    {
      id: 'EM50', name: 'Final inspection', unit: 'UN02', kind: 'inspect', s: BOTTOM + 1.2, mech: 0.4, fixed: 0.6, step: 'final', requires: ['housing'], readsCode: true,
      inspect: { key: 'seatDepth', lower: -0.3, upper: 0.3, noise: 0.02, unit: 'mm', cause: 'Cartridge seating depth' },
    },
    { id: 'EM60', name: 'Pen to tray', unit: 'UN03', kind: 'unload', s: BOTTOM + 2.3, mech: 0, fixed: 0, bin: 'BIN2', robots: [{ id: 'EM60', home: 0, mech: 0 }] },
  ] satisfies StationDef[] as StationDef[],
  /** True quality of each assembly step (mean, σ) plus mover fixture and fragile-station effects. */
  quality: {
    springAngle: { mean: 45, sd: 4.2, perMmOffset: 8 },
    seatDepth: { mean: 0, sd: 0.1, fragileShift: 0.1, perMmOffset: 0.3 },
    snapForce: { mean: 32, sd: 2.5, perMmOffset: 4 },
  },
  moverProfiles: {
    mu: [0.115, 0.125] as [number, number],
    slip: [0, 0.02] as [number, number],
    settle: [0.08, 0.15] as [number, number],
    fixtureSd: 0.03,
    rfidOk: 0.999,
    /** Deliberately worn movers, keyed by mover number. */
    worn: {
      2: { rfidOk: 0.95 },
      6: { mu: 0.06 },
      11: { settle: 0.35 },
      19: { slip: 0.06 },
      24: { fixtureOffset: 0.4 },
    } as Record<number, Partial<MoverProfile>>,
  },
};

export interface PartGeometry {
  /** Base of the part above the fixture seat in the finished pen. */
  seat: number;
  length: number;
  /** Outer radius (where the gripper jaws close on it). */
  radius: number;
}

export interface MoverProfile {
  /** Drive-pad friction coefficient against the belt; limits acceleration. */
  mu: number;
  /** Fraction of belt speed lost to slip at cruise. */
  slip: number;
  /** Time after stopping at a gate before "in position" is reported. */
  settle: number;
  /** Fixture position error in mm; biases measurements. */
  fixtureOffset: number;
  /** Probability that an RFID read/write succeeds on the first try. */
  rfidOk: number;
}

export interface FeederDef {
  id: string;
  unit: string;
  part: PartType;
  /** Mean seconds between parts leaving the bowl (jittered ±40 %). */
  interval: number;
  track: number;
  pitch: number;
  speed: number;
  /** Gripper height when picking from the end of the track; feeders sit on stands so parts are near safe height. */
  pickZ: number;
}

export type LineConfig = typeof LINE;
