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
  /** Process time at 100 % speed that scales with machine speed. */
  mech: number;
  /** Process time that doesn't scale (camera exposure, dwell). */
  fixed: number;
  /** Step written to the mover tag when this station completes. */
  step?: Step;
  requires?: Step[];
  parts?: PartType[];
  inspect?: Limits;
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
  },
  plantDt: 0.001,
  plcScan: 0.01,
  /** Mover centre within this distance past a gate counts as "at gate". */
  gateZone: 0.02,
  rfid: { readTime: 0.04, writeTime: 0.04, retryDelay: 0.3, maxTries: 3 },
  dataMatrix: { readFailRate: 0.002 },
  nestSize: 24,
  traySize: 12,
  gs1: { gtin: '0571234500001', expiryYears: 3 },
  stations: [
    { id: 'ST10', name: 'Laser mark + load body', kind: 'load', s: 0.35, mech: 1.2, fixed: 0.3, step: 'body', parts: ['body'] },
    { id: 'ST20', name: 'Mount spring', kind: 'assemble', s: 0.85, mech: 1.6, fixed: 0, step: 'spring', requires: ['body'], parts: ['spring'] },
    {
      id: 'ST30', name: 'Spring inspection', kind: 'inspect', s: 1.35, mech: 0.3, fixed: 0.5, step: 'springInsp', requires: ['spring'],
      inspect: { key: 'springAngle', lower: 35, upper: 55, noise: 0.4, unit: 'deg', cause: 'Spring angle out of tolerance' },
    },
    { id: 'R1', name: 'Early reject', kind: 'reject', s: 1.85, mech: 1.0, fixed: 0, bin: 'BIN1' },
    { id: 'ST40A', name: 'Insert cartridge A', kind: 'assemble', s: 2.45, mech: 4.0, fixed: 0, step: 'cartridge', requires: ['springInsp'], parts: ['cartridge'], twin: 'ST40B' },
    { id: 'ST40B', name: 'Insert cartridge B', kind: 'assemble', s: 2.7, mech: 4.0, fixed: 0, step: 'cartridge', requires: ['springInsp'], parts: ['cartridge'], fragile: true },
    {
      id: 'ST50', name: 'Mount housing + cap', kind: 'assemble', s: BOTTOM + 0.6, mech: 1.8, fixed: 0, step: 'housing', requires: ['cartridge'], parts: ['housing', 'cap'],
      inspect: { key: 'snapForce', lower: 25, upper: 39, noise: 0.3, unit: 'N', cause: 'Snap force out of window' },
    },
    {
      id: 'ST60', name: 'Final vision', kind: 'inspect', s: BOTTOM + 1.2, mech: 0.4, fixed: 0.6, step: 'final', requires: ['housing'], readsCode: true,
      inspect: { key: 'seatDepth', lower: -0.3, upper: 0.3, noise: 0.02, unit: 'mm', cause: 'Cartridge seating depth' },
    },
    { id: 'ST70', name: 'Unload: tray / reject', kind: 'unload', s: BOTTOM + 2.3, mech: 1.5, fixed: 0, bin: 'BIN2' },
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

export type LineConfig = typeof LINE;
