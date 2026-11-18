// Line configuration. SI units throughout: metres, seconds, m/s.

export type Step = 'body' | 'spring' | 'springInsp' | 'springBase' | 'hookInsp' | 'cartridge' | 'housing' | 'final';
export type PartType = 'body' | 'spring' | 'springBase' | 'cartridge' | 'housing';
export type QualityKey = 'springTension' | 'springAngle' | 'baseAngle' | 'seatForce' | 'hook' | 'labelQuality' | 'snapForce' | 'snapPosition' | 'finalTest' | 'trayCheck';
export type StationKind = 'load' | 'assemble' | 'inspect' | 'reject' | 'unload';

export interface Limits {
  key: QualityKey;
  lower: number;
  upper: number;
  /** Measurement noise (1σ) added by the sensor on top of the true value. */
  noise: number;
  unit: string;
  /** Reject cause (the original line's wording). */
  cause: string;
  /** Cause when the value is above the upper / below the lower limit, if they differ. */
  high?: string;
  low?: string;
  /**
   * Failure modes the station can't tell apart by value, with their shares (the original line's
   * odds); used instead of `cause` where neither `high` nor `low` applies.
   */
  causes?: [string, number][];
}

/** A process on a sub-line, off the mover loop (like EM10 and EM13): parts, not pens, no carrier. */
export interface SubProcessDef {
  id: string;
  name: string;
  unit: string;
  inspect: Limits;
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
  /**
   * Where it picks parts: a feeder id, the station's cartridge nest ('nest') or its pick cup on the
   * distribution conveyor ('cup'). Pickers (reject, unload) have none.
   */
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
  /** This station's own quality of the step it measures, instead of the line's (EM14A–D differ). */
  quality?: { mean: number; sd: number };
  /**
   * Report the station's record on the part it merges, not on the pen (the original's
   * LogProcessedDataOnSourceItem: EM14 on the spring base, EM40 on the housing).
   */
  logOnSource?: boolean;
  /** Records the force/displacement curve of its press stroke and judges the snap from it (EM40). */
  snap?: boolean;
  /** Also verifies the DataMatrix identifier against tracking. */
  readsCode?: boolean;
  /**
   * Share of first tests that come out Inconclusive (the original's eject rate): the pen goes
   * round once more for a retest, which is always conclusive.
   */
  inconclusive?: number;
  bin?: string;
}

const STRAIGHT = 5.2;
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
   * finished assembly, and its length. The body is an open tube: the spring and spring base go
   * inside it, the housing slides over it, and last the cartridge goes in through the top, its
   * tip standing just proud of the housing.
   */
  parts: {
    body: { seat: 0, length: 0.11, radius: 0.0065 },
    spring: { seat: 0.006, length: 0.045, radius: 0.0048 },
    springBase: { seat: 0.051, length: 0.006, radius: 0.0048 },
    cartridge: { seat: 0.057, length: 0.073, radius: 0.0048 },
    housing: { seat: 0.008, length: 0.12, radius: 0.0085 },
  } satisfies Record<PartType, PartGeometry> as Record<PartType, PartGeometry>,
  plantDt: 0.001,
  plcScan: 0.01,
  /** Mover centre within this distance past a gate counts as "at gate". */
  gateZone: 0.02,
  /** After maxTries failed writes the station holds the mover and retries every stuckRetryDelay. */
  rfid: { readTime: 0.04, writeTime: 0.04, retryDelay: 0.3, maxTries: 3, stuckRetryDelay: 2 },
  dataMatrix: { readFailRate: 0.002 },
  /** Pens per tray (the original packs 32). */
  traySize: 32,
  /**
   * EM41's cartridge supply, in EM41's station-local coordinates. Tubs ("nests") of 160
   * cartridges come in on a conveyor; EM00 de-nests them one by one into collets that circulate
   * on a small loop running out from the belt. Empty collets wait at the fill point (the far end)
   * for EM00, full ones queue at the pick point (the end by the belt) for EM41's robot, so the
   * loop is a buffer that covers a tub change.
   */
  cartridges: {
    station: 'EM41',
    tub: {
      /** Pockets: cols along the belt, rows outward; tub centre and pocket floor height. */
      cols: 10, rows: 16, pitch: 0.015, a: 0, r: 0.86, floor: 0.09,
      /** Taking the empty tub out and the next full one in. */
      change: 8,
    },
    collets: {
      count: 12, pitch: 0.05, speed: 0.2,
      /** Loop: pick apex by the belt, fill apex further out, end radius; collet base height. */
      pick: 0.26, fill: 0.62, radius: 0.05, base: 0.12,
    },
    denest: { id: 'EM00', name: 'De-nest', unit: 'UN02' },
  },
  /** Indexing a full tray out and an empty one in. */
  trayChange: 3,
  /**
   * UN03's tray line, in EM60's station-local coordinates (a along the belt). Empty trays come off
   * a destacker beside the packing position; a full tray indexes out onto a conveyor, stops under
   * EM61's camera, then goes onto the outfeed stack, or is pushed off into the reject rack.
   */
  trays: {
    /** Where the destacker stands, EM61's camera, and the end of the conveyor (along a). */
    destack: -0.12, end: 0.44,
    speed: 0.15, pitch: 0.12,
    /** Stack of empty trays the destacker holds (refilled by the operator, never runs out here). */
    stack: 8,
    check: { id: 'EM61', name: 'Tray inspection', unit: 'UN03', a: 0.22, mech: 1.0, fixed: 1.0,
      inspect: { key: 'trayCheck', lower: 6, upper: 14, noise: 0.05, unit: '', cause: 'Tray packing incomplete', causes: [['Tray packing incomplete', 0.5], ['Tray seal defect', 0.5]] } as Limits },
  },
  /** Bowl feeders push parts onto a linear track toward the robot's pick point (or the orienter). */
  feeders: [
    { id: 'bodies', unit: 'UN01', part: 'body', interval: 1.0, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3 },
    {
      id: 'springs', unit: 'UN01', part: 'spring', interval: 0.9, track: 0.24, pitch: 0.02, speed: 0.12, pickZ: 0.22,
      // EM10 checks every spring on the track as it passes, and an air jet blows bad ones into a chute.
      inline: {
        id: 'EM10', name: 'Spring verification', unit: 'UN01', at: 0.17, jetAt: 0.12, exposure: 0.02,
        inspect: { key: 'springTension', lower: 3, upper: 7, noise: 0.05, unit: 'N', cause: 'Spring tension out of range', causes: [['Spring tension out of range', 0.5], ['Spring deformation detected', 0.5]] },
      },
    },
    { id: 'bases', unit: 'UN01', part: 'springBase', interval: 0.8, track: 0.2, pitch: 0.012, speed: 0.12, pickZ: 0.2 },
    // Housings go onto the dial at EM30: the track ends at the dial's load position.
    { id: 'housings', unit: 'UN02', part: 'housing', interval: 1.1, track: 0.24, pitch: 0.03, speed: 0.12, pickZ: 0.3, r: 0.61 },
  ] as FeederDef[],
  /**
   * EM13 takes spring bases off the end of their feeder track, turns each to the right angle and
   * checks it, then pushes good ones onto the distribution conveyor and bad ones into a chute.
   * It stands beside the loop at `s`, in that point's station-local coordinates.
   */
  orienter: {
    id: 'EM13', name: 'Rotate spring base', unit: 'UN01', s: 2.2, feeder: 'bases', mech: 1.0, fixed: 0.2,
    inspect: { key: 'baseAngle', lower: 75, upper: 105, noise: 0.3, unit: 'deg', cause: 'Spring base rotation angle incorrect' },
  } as OrienterDef,
  /**
   * Distribution conveyor beside the loop, from the orienter past the EM14 stations (in loop
   * coordinates, along the straight). A diverter at each station pushes a passing part into the
   * station's pick cup when the cup is empty; parts nobody takes queue at the end stop.
   */
  /**
   * The housing line (EM30–EM32) on an indexing dial beside EM40 (station-local a, r of its
   * centre). Every dwell each position does its work at once, then the dial turns one pitch:
   * EM30 loads a housing from the feeder, EM31 prints the pen's GS1 identifier on a label and
   * wraps it on, EM32 checks the label and reads the code back, rejects are pushed off, and
   * EM40's robot picks good housings at the unload position, the one nearest the belt.
   */
  dial: {
    station: 'EM40', a: 0, r: 0.47, radius: 0.14, nests: 8, feeder: 'housings', index: 0.5, eject: 0.2,
    /** Positions around the dial, counted in the direction it turns from the one facing outward... */
    positions: { load: 2, label: 3, inspect: 4, eject: 5, unload: 6 },
    /** ...so position 6 faces the belt, where the robot picks. Gripper tip height there. */
    pickZ: 0.3,
    load: { id: 'EM30', name: 'Housing infeed', unit: 'UN02', mech: 0.5 },
    label: { id: 'EM31', name: 'Label assembly', unit: 'UN02', mech: 1.0 },
    inspect: {
      id: 'EM32', name: 'Label inspection', unit: 'UN02', fixed: 0.3,
      inspect: { key: 'labelQuality', lower: 0.6, upper: 1.0, noise: 0.01, unit: '', cause: 'Label unreadable', high: 'Label damaged', low: 'Label misaligned' } as Limits,
    },
  },
  distribution: { from: 2.2, speed: 0.12, pitch: 0.012, r: 0.3, cupR: 0.24, divert: 0.3, cupZ: 0.21, stations: ['EM14A', 'EM14B', 'EM14C', 'EM14D'] },
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
    /**
     * Trays per batch, counted when EM61 has checked them (the original counts its last process).
     * EM11 keeps loading until the pens still on the line can make the last tray full.
     */
    size: 10,
    /** Start the next batch automatically after a completed one. */
    autoNext: true,
    /** Pause between batches. */
    pause: 20,
  },
  /** Cartesian pick-and-place robots: along belt (a), across belt toward the outside (r), height (z). */
  robot: {
    vH: 2.0,
    aH: 12,
    vZ: 1.0,
    aZ: 12,
    gripTime: 0.08,
    lift: 0.02,
    /** Closest two arms on one gantry beam may come (centre to centre, along the belt). */
    armClearance: 0.07,
  },
  /** Device positions in station-local coordinates (a along travel, r outward from belt centre), metres. */
  layout: {
    feederR: 0.32,
    /** Each nest-fed station has its own nest, in station-local coordinates. */
    tray: { station: 'EM60', a: 0.05, r: 0.3, cols: 4, rows: 8, pitch: 0.021 },
    bins: { BIN1: { a: 0, r: 0.3 }, BIN2: { a: -0.3, r: 0.3 }, BIN3: { a: 0, r: 0.3 } } as Record<string, { a: number; r: number }>,
    /**
     * Gripper tip heights above the belt surface. The gripper holds a part (or a pen) by its top,
     * so on the mover the tip height follows from the part geometry (see layout.ts).
     */
    z: { safe: 0.36, bin: 0.2, tray: 0.126 },
  },
  gs1: { gtin: '0571234500001', expiryYears: 3 },
  stations: [
    {
      id: 'EM11', name: 'Load body + mount spring', unit: 'UN01', kind: 'load', s: 0.6, mech: 0, fixed: 0,
      robots: [
        { id: 'EM11-BODY', home: -0.15, source: 'bodies', parts: ['body'], step: 'body', insert: 0.03, mech: 0 },
        { id: 'EM11-SPRING', home: 0.15, source: 'springs', parts: ['spring'], step: 'spring', insert: 0.11, mech: 0.3 },
      ],
    },
    {
      id: 'EM12', name: 'Measure spring angle', unit: 'UN01', kind: 'inspect', s: 1.35, mech: 0.3, fixed: 0.5, step: 'springInsp', requires: ['spring'],
      inspect: { key: 'springAngle', lower: 35, upper: 55, noise: 0.4, unit: 'deg', cause: 'Spring angle out of tolerance' },
    },
    { id: 'R1', name: 'Early reject', unit: 'UN01', kind: 'reject', s: 1.85, mech: 0, fixed: 0, bin: 'BIN1', robots: [{ id: 'R1', home: 0, mech: 0 }] },
    // Four spring base presses work side by side (4-up). EM14B's is mis-adjusted and fragile: the original line's outlier.
    ...(
      [
        ['EM14A', 2.6, 2.1, 0.3],
        ['EM14B', 2.87, 2.5, 0.4],
        ['EM14C', 3.14, 2.05, 0.3],
        ['EM14D', 3.41, 2.15, 0.3],
      ] as const
    ).map(
      ([id, s, mean, sd]): StationDef => ({
        id, name: 'Mount spring base', unit: 'UN01', kind: 'assemble', s, mech: 0, fixed: 0, requires: ['springInsp'], group: 'EM14',
        fragile: id === 'EM14B', quality: { mean, sd }, logOnSource: true,
        robots: [{ id, home: 0, source: 'cup', parts: ['springBase'], step: 'springBase', insert: 0.03, mech: 6.0 }],
        inspect: { key: 'seatForce', lower: 1.5, upper: 2.7, noise: 0.02, unit: 'N', cause: 'Spring base seating force out of range', high: 'Spring base seating force too high', low: 'Spring base misalignment' },
      }),
    ),
    {
      id: 'EM15', name: 'Inspect spring hook present', unit: 'UN01', kind: 'inspect', s: 4.1, mech: 0.3, fixed: 0.3, step: 'hookInsp', requires: ['springBase'],
      inspect: { key: 'hook', lower: 0.5, upper: 1.5, noise: 0.02, unit: '', cause: 'Spring hook not present' },
    },
    { id: 'R2', name: 'Reject', unit: 'UN01', kind: 'reject', s: 4.6, mech: 0, fixed: 0, bin: 'BIN3', robots: [{ id: 'R2', home: 0, mech: 0 }] },
    {
      // Snaps the labelled housing over the pen and judges the snap from its force curve. Its
      // record goes on the housing, as in the original.
      id: 'EM40', name: 'Mount housing', unit: 'UN02', kind: 'assemble', s: BOTTOM + 0.6, mech: 0, fixed: 0, requires: ['hookInsp'], logOnSource: true, snap: true,
      robots: [{ id: 'EM40', home: 0, source: 'dial', parts: ['housing'], step: 'housing', insert: 0.11, mech: 0.6 }],
      inspect: { key: 'snapForce', lower: 25, upper: 39, noise: 0.3, unit: 'N', cause: 'Snap force out of window', high: 'Peak force too high', low: 'Peak force too low' },
    },
    {
      // After the housing, as in the original: the cartridge goes in through the top. It comes from a collet.
      id: 'EM41', name: 'Insert cartridge', unit: 'UN02', kind: 'assemble', s: BOTTOM + 1.45, mech: 0, fixed: 0, requires: ['housing'],
      robots: [{ id: 'EM41', home: 0, source: 'collet', parts: ['cartridge'], step: 'cartridge', insert: 0.065, mech: 0.8 }],
    },
    {
      // Final test (the original's 50 ± 5 in 35–65) plus the code on the label. Now and then it
      // can't decide (Inconclusive): the pen goes round once more and is tested again.
      id: 'EM50', name: 'Final inspection', unit: 'UN02', kind: 'inspect', s: BOTTOM + 2.25, mech: 0.4, fixed: 0.6, step: 'final', requires: ['cartridge'], readsCode: true, inconclusive: 0.01,
      inspect: {
        key: 'finalTest', lower: 35, upper: 65, noise: 0.3, unit: '', cause: 'Assembly incomplete',
        causes: [['Assembly incomplete', 0.3], ['Cosmetic defect', 0.2], ['Functional test failed', 0.2], ['Dimensional out of tolerance', 0.3]],
      },
    },
    { id: 'EM60', name: 'Pen to tray', unit: 'UN03', kind: 'unload', s: BOTTOM + 3.3, mech: 0, fixed: 0, bin: 'BIN2', robots: [{ id: 'EM60', home: 0, mech: 0 }] },
  ] satisfies StationDef[] as StationDef[],
  /**
   * True quality of each step (mean, σ, as in the original line where it has one) and how much a
   * mover's fixture offset (per mm) biases it.
   */
  quality: {
    springTension: { mean: 5.0, sd: 0.8, perMmOffset: 0 },
    springAngle: { mean: 45, sd: 3.0, perMmOffset: 8 },
    baseAngle: { mean: 90, sd: 5.0, perMmOffset: 0 },
    seatForce: { mean: 2.1, sd: 0.3, perMmOffset: 0.3 },
    hook: { mean: 1.0, sd: 0.15, perMmOffset: 0.1 },
    finalTest: { mean: 50, sd: 5, perMmOffset: 3 },
    trayCheck: { mean: 10, sd: 1.2, perMmOffset: 0 },
    labelQuality: { mean: 0.85, sd: 0.08, perMmOffset: 0 },
    snapForce: { mean: 32, sd: 2.5, perMmOffset: 4 },
    snapPosition: { mean: 4.2, sd: 0.15, perMmOffset: 0.3 },
  } satisfies Record<QualityKey, { mean: number; sd: number; perMmOffset: number }>,
  /**
   * Each pass through a fragile station, and each point of the mover's badness, shifts every
   * later measurement of the pen down by this many σ (the original line's rule).
   */
  fragileShift: 0.15,
  /**
   * EM40's snap curve: force over the last `stroke` mm of the press, sampled at `sampleHz` (the
   * original samples every ms). The snap must come within `position` (mm), and a housing whose
   * clip doesn't engage (rate `noSnap`) shows no drop at all.
   */
  snap: { stroke: 6, position: [3.6, 4.8] as [number, number], sampleHz: 1000, noSnap: 0.003, noise: 0.25 },
  moverProfiles: {
    mu: [0.115, 0.125] as [number, number],
    slip: [0, 0.02] as [number, number],
    settle: [0.08, 0.15] as [number, number],
    fixtureSd: 0.03,
    rfidOk: 0.999,
    /**
     * Deliberately worn movers, keyed by mover number. The badness of 2, 6 and 24 is the original
     * line's bad carriers: every inspection of a pen on them reads badness × 0.15 σ low.
     */
    worn: {
      2: { rfidOk: 0.95, badness: 22 },
      6: { mu: 0.06, badness: 4 },
      11: { settle: 0.35 },
      19: { slip: 0.06 },
      24: { fixtureOffset: 0.4, badness: 12 },
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
  /** Worn fixture that biases every inspection, like the original's bad carriers (0 = good). */
  badness: number;
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
  /** Where the track's pick end is (station-local r), if not at `layout.feederR`. */
  r?: number;
  /** Inline inspection on the track: camera at `at`, air jet at `jetAt` (track positions, 0 = pick end). */
  inline?: SubProcessDef & { at: number; jetAt: number; exposure: number };
}

export interface OrienterDef extends SubProcessDef {
  /** Where it stands beside the loop. */
  s: number;
  /** Feeder whose track ends at the orienter. */
  feeder: string;
  /** Turning time at 100 % speed, and camera time that doesn't scale. */
  mech: number;
  fixed: number;
}

export type LineConfig = typeof LINE;
