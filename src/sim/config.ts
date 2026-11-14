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

export interface StationDef {
  id: string;
  name: string;
  kind: StationKind;
  /** Stop gate position along the loop (mover centre stops here). */
  s: number;
  /**
   * Process time at 100 % speed that scales with machine speed. For robot stations this is the
   * press/insert dwell with the part held down on the mover; robot travel comes on top.
   */
  mech: number;
  /** Process time that doesn't scale (camera exposure, laser marking). */
  fixed: number;
  /** Where the station's robot picks parts: a feeder id or the shared cartridge nest. */
  source?: string;
  /** Step written to the mover tag when this station completes. */
  step?: Step;
  requires?: Step[];
  parts?: PartType[];
  inspect?: Limits;
  /**
   * Robot stations: how far above its seated position the part is brought before it is pushed
   * home. The push takes `mech` seconds (fast z move when mech is 0).
   */
  insert?: number;
  /** Downstream partner of a same-belt twin station; this station passes movers to it when it's free. */
  twin?: string;
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
    { id: 'bodies', part: 'body', interval: 1.0, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3 },
    { id: 'springs', part: 'spring', interval: 1.0, track: 0.24, pitch: 0.02, speed: 0.12, pickZ: 0.22 },
    { id: 'housings', part: 'housing', interval: 1.1, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3 },
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
  robot: { vH: 2.0, aH: 12, vZ: 1.0, aZ: 12, gripTime: 0.08 },
  /** Device positions in station-local coordinates (a along travel, r outward from belt centre), metres. */
  layout: {
    feederR: 0.32,
    /** Each nest-fed station has its own nest, in station-local coordinates. */
    nest: { a: 0, r: 0.34, cols: 6, rows: 4, pitch: 0.016 },
    tray: { station: 'ST70', a: 0.05, r: 0.3, cols: 4, rows: 3, pitch: 0.03 },
    bins: { BIN1: { a: 0, r: 0.3 }, BIN2: { a: -0.3, r: 0.3 } } as Record<string, { a: number; r: number }>,
    /**
     * Gripper tip heights above the belt surface. The gripper holds a part (or a pen) by its top,
     * so on the mover the tip height follows from the part geometry (see layout.ts).
     */
    z: { safe: 0.36, nest: 0.073, bin: 0.2, tray: 0.159 },
  },
  gs1: { gtin: '0571234500001', expiryYears: 3 },
  stations: [
    { id: 'ST10', name: 'Laser mark + load body', kind: 'load', s: 0.35, mech: 0, fixed: 0.3, step: 'body', parts: ['body'], source: 'bodies', insert: 0.03 },
    { id: 'ST20', name: 'Mount spring', kind: 'assemble', s: 0.85, mech: 0.3, fixed: 0, step: 'spring', requires: ['body'], parts: ['spring'], source: 'springs', insert: 0.11 },
    {
      id: 'ST30', name: 'Spring inspection', kind: 'inspect', s: 1.35, mech: 0.3, fixed: 0.5, step: 'springInsp', requires: ['spring'],
      inspect: { key: 'springAngle', lower: 35, upper: 55, noise: 0.4, unit: 'deg', cause: 'Spring angle out of tolerance' },
    },
    { id: 'R1', name: 'Early reject', kind: 'reject', s: 1.85, mech: 0, fixed: 0, bin: 'BIN1' },
    { id: 'ST40A', name: 'Insert cartridge A', kind: 'assemble', s: 2.45, mech: 3.0, fixed: 0, step: 'cartridge', requires: ['springInsp'], parts: ['cartridge'], source: 'nest', insert: 0.065, twin: 'ST40B' },
    { id: 'ST40B', name: 'Insert cartridge B', kind: 'assemble', s: 2.7, mech: 3.0, fixed: 0, step: 'cartridge', requires: ['springInsp'], parts: ['cartridge'], source: 'nest', insert: 0.065, fragile: true },
    {
      id: 'ST50', name: 'Mount housing + cap', kind: 'assemble', s: BOTTOM + 0.6, mech: 0.6, fixed: 0, step: 'housing', requires: ['cartridge'], parts: ['housing', 'cap'], source: 'housings', insert: 0.11,
      inspect: { key: 'snapForce', lower: 25, upper: 39, noise: 0.3, unit: 'N', cause: 'Snap force out of window' },
    },
    {
      id: 'ST60', name: 'Final vision', kind: 'inspect', s: BOTTOM + 1.2, mech: 0.4, fixed: 0.6, step: 'final', requires: ['housing'], readsCode: true,
      inspect: { key: 'seatDepth', lower: -0.3, upper: 0.3, noise: 0.02, unit: 'mm', cause: 'Cartridge seating depth' },
    },
    { id: 'ST70', name: 'Unload: tray / reject', kind: 'unload', s: BOTTOM + 2.3, mech: 0, fixed: 0, bin: 'BIN2' },
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
