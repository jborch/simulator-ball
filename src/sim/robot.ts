// Cartesian pick-and-place robots (a along the belt, r across it, z up). They behave like a
// robot controller: the PLC starts a job (prepick / place / pickMover / drop) and watches for
// the job to end; the robot runs the motion program with velocity- and acceleration-limited
// axes scaled by machine speed. All physical effects (parts leaving feeders, landing on movers,
// falling into bins) happen here, at grip and release.
import { moverById, placeOnMover } from './assembly';
import type { LineConfig, RobotDef, StationDef } from './config';
import { nextFailure, repairTime } from './devices';
import { dialPick, takeFromDial } from './dial';
import { colletAtPick } from './cartridges';
import { seatedTip, trayPocket } from './layout';
import { type RngState, random } from './rng';
import type { Distribution, Feeder, PlaceOp, PlantState, Robot, RobotJob, RobotStep } from './types';

export function createRobot(safeZ: number, home: number, nextFault: number): Robot {
  return {
    a: home,
    r: 0,
    z: safeZ,
    va: 0,
    vr: 0,
    vz: 0,
    ta: home,
    tr: 0,
    tz: safeZ,
    job: null,
    steps: [],
    stepStarted: false,
    dwellMech: 0,
    dwellFixed: 0,
    pressFrom: safeZ,
    pressTime: 0,
    pressEnd: 0,
    phase: 'idle',
    holding: null,
    op: null,
    moverId: 0,
    dropTarget: null,
    slot: null,
    result: null,
    dropped: false,
    fault: 0,
    nextFault,
  };
}

interface Target {
  a: number;
  r: number;
  z: number;
}

/** A robot's part source sits at its home along the belt. */
function sourcePos(cfg: LineConfig, rdef: RobotDef): Target {
  if (rdef.source === 'cup') return { a: rdef.home, r: cfg.distribution.cupR, z: cfg.distribution.cupZ };
  if (rdef.source === 'dial') return { a: cfg.dial.a, r: cfg.dial.r - cfg.dial.radius, z: cfg.dial.pickZ };
  if (rdef.source === 'collet') {
    const c = cfg.cartridges.collets;
    return { a: rdef.home, r: c.pick, z: c.base + cfg.parts.cartridge.length };
  }
  const feeder = cfg.feeders.find((f) => f.id === rdef.source)!;
  return { a: rdef.home, r: feeder.r ?? cfg.layout.feederR, z: feeder.pickZ };
}

function dropPos(cfg: LineConfig, robot: Robot): Target {
  const t = robot.dropTarget!;
  if (t.kind === 'bin') return { ...cfg.layout.bins[t.bin], z: cfg.layout.z.bin };
  return { ...trayPocket(cfg, robot.slot ?? 0), z: cfg.layout.z.tray };
}

/** Gripper height for placing this station's parts on a mover, or for picking up the pen on it. */
function moverHeight(p: PlantState, cfg: LineConfig, rdef: RobotDef, robot: Robot): number {
  if (robot.job === 'place') return seatedTip(cfg, rdef.parts!);
  return seatedTip(cfg, moverById(p, robot.moverId).load?.parts ?? ['body']);
}

function height(p: PlantState, cfg: LineConfig, rdef: RobotDef, robot: Robot, to: Extract<RobotStep, { k: 'z' }>['to']): number {
  switch (to) {
    case 'safe':
      return cfg.layout.z.safe;
    case 'approach':
      return moverHeight(p, cfg, rdef, robot) + (rdef.insert ?? 0);
    case 'mover':
      return moverHeight(p, cfg, rdef, robot);
    case 'source':
      return sourcePos(cfg, rdef).z;
    case 'drop':
      return dropPos(cfg, robot).z;
    case 'lift':
      return robot.z + cfg.robot.lift;
  }
}

export interface JobArgs {
  op?: PlaceOp;
  moverId?: number;
  dropTarget?: Robot['dropTarget'];
}

const PROGRAMS: Record<Exclude<RobotJob, 'place'>, RobotStep[]> = {
  prepick: [
    { k: 'z', to: 'safe' },
    { k: 'waitSource' },
    { k: 'xy', to: 'source' },
    { k: 'z', to: 'source' },
    { k: 'grip', from: 'source' },
    { k: 'z', to: 'safe' },
    { k: 'xy', to: 'home' },
  ],
  pickMover: [{ k: 'xy', to: 'mover' }, { k: 'z', to: 'mover' }, { k: 'grip', from: 'mover' }, { k: 'z', to: 'safe' }],
  drop: [{ k: 'waitDrop' }, { k: 'xy', to: 'drop' }, { k: 'z', to: 'drop' }, { k: 'release', to: 'drop' }, { k: 'z', to: 'safe' }, { k: 'xy', to: 'home' }],
};

/**
 * Place: over the mover, down to just above it, push the part home (slowly when the robot has a
 * press time), let go, lift clear (starting the laser marker on a loaded body), then climb back
 * home in one blended move.
 */
function placeProgram(rdef: RobotDef): RobotStep[] {
  const steps: RobotStep[] = [{ k: 'xy', to: 'mover' }, { k: 'z', to: 'approach' }];
  steps.push(rdef.mech > 0 ? { k: 'press', mech: rdef.mech } : { k: 'z', to: 'mover' });
  steps.push({ k: 'release', to: 'mover' }, { k: 'z', to: 'lift' });
  if (rdef.laser) steps.push({ k: 'mark', seconds: rdef.laser });
  steps.push({ k: 'leave' });
  return steps;
}

export function startJob(robot: Robot, rdef: RobotDef, job: RobotJob, args: JobArgs = {}): void {
  robot.job = job;
  robot.steps = job === 'place' ? placeProgram(rdef) : [...PROGRAMS[job]];
  robot.stepStarted = false;
  robot.result = null;
  if (args.op) robot.op = args.op;
  if (args.moverId) robot.moverId = args.moverId;
  if (args.dropTarget !== undefined) robot.dropTarget = args.dropTarget;
}

/** One axis toward its target with a trapezoidal velocity profile. */
function axis(pos: number, vel: number, target: number, vmax: number, amax: number, dt: number): [number, number, boolean] {
  const d = target - pos;
  if (Math.abs(d) < 1e-5 && Math.abs(vel) < amax * dt * 2) return [target, 0, true];
  const dir = Math.sign(d);
  const want = dir * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(d)));
  const dv = amax * dt;
  vel = vel < want ? Math.min(want, vel + dv) : Math.max(want, vel - dv);
  let next = pos + vel * dt;
  if (Math.sign(target - next) !== dir) {
    next = target;
    vel = 0;
  }
  return [next, vel, next === target && vel === 0];
}

/** Range along the beam an arm may use without coming too close to its neighbours. */
interface Lane {
  lo: number;
  hi: number;
}

/**
 * Anti-collision of arms sharing a gantry beam: an arm keeps `armClearance` from each neighbour's
 * current position, whatever the neighbour is doing (even frozen by a fault). Arms are ordered
 * along the beam by their home.
 */
function laneOf(p: PlantState, cfg: LineConfig, def: StationDef, rdef: RobotDef): Lane {
  const lane = { lo: -Infinity, hi: Infinity };
  const robots = p.stations.find((x) => x.id === def.id)!.robots;
  def.robots!.forEach((other, k) => {
    if (other === rdef) return;
    if (other.home < rdef.home) lane.lo = Math.max(lane.lo, robots[k].a + cfg.robot.armClearance);
    else lane.hi = Math.min(lane.hi, robots[k].a - cfg.robot.armClearance);
  });
  return lane;
}

/** Moves all axes toward their targets; true when every axis has arrived. */
/** Anything driven by three trapezoidal axes: a station robot or EM00's de-nest robot. */
export type Axes = Pick<Robot, 'a' | 'r' | 'z' | 'va' | 'vr' | 'vz' | 'ta' | 'tr' | 'tz'>;

export function moveAxes(robot: Axes, cfg: LineConfig, speed: number, dt: number, lane: Lane = { lo: -Infinity, hi: Infinity }): boolean {
  const { vH, aH, vZ, aZ } = cfg.robot;
  let atA: boolean;
  let atR: boolean;
  let atZ: boolean;
  // Head for the target, but stop short of a neighbouring arm in the way (and never pass it).
  const ta = Math.min(lane.hi, Math.max(lane.lo, robot.ta));
  [robot.a, robot.va, atA] = axis(robot.a, robot.va, ta, vH * speed, aH * speed, dt);
  if (robot.a < lane.lo || robot.a > lane.hi) {
    robot.a = Math.min(lane.hi, Math.max(lane.lo, robot.a));
    robot.va = 0;
  }
  atA = atA && ta === robot.ta;
  [robot.r, robot.vr, atR] = axis(robot.r, robot.vr, robot.tr, vH * speed, aH * speed, dt);
  [robot.z, robot.vz, atZ] = axis(robot.z, robot.vz, robot.tz, vZ * speed, aZ * speed, dt);
  return atA && atR && atZ;
}


function feederFor(p: PlantState, rdef: RobotDef): Feeder {
  return p.feeders.find((f) => f.id === rdef.source)!;
}

function cupFor(p: PlantState, def: StationDef): Distribution['cups'][number] {
  return p.distribution.cups.find((c) => c.station === def.id)!;
}

/** Counts down a timed step (grip/release); true when it's over. */
function timer(robot: Robot, seconds: number, dt: number): boolean {
  if (!robot.stepStarted) robot.dwellFixed = seconds;
  robot.dwellFixed -= dt;
  return robot.dwellFixed <= 0;
}

/** Advances a station robot one plant step. */
export function stepRobot(p: PlantState, cfg: LineConfig, rng: RngState, def: StationDef, rdef: RobotDef, robot: Robot, dt: number): void {
  // An axis fault freezes the robot until the (simulated) operator has repaired it.
  if (robot.fault > 0) {
    robot.phase = 'fault';
    robot.va = robot.vr = robot.vz = 0;
    robot.fault -= dt;
    if (robot.fault <= 0) {
      robot.fault = 0;
      robot.nextFault = nextFailure(rng, cfg.faults.robotMtbf);
    }
    return;
  }
  if (cfg.faults.enabled && robot.job !== null) {
    robot.nextFault -= dt;
    if (robot.nextFault <= 0) {
      robot.fault = repairTime(rng, cfg.faults.robotRepair);
      return;
    }
  }

  const step = robot.steps[0];
  if (!step) {
    robot.phase = 'idle';
    return;
  }
  let finished = false;

  switch (step.k) {
    case 'z':
      if (!robot.stepStarted) {
        robot.ta = robot.a;
        robot.tr = robot.r;
        robot.tz = height(p, cfg, rdef, robot, step.to);
      }
      robot.phase = 'move';
      finished = moveAxes(robot, cfg, p.speed, dt, laneOf(p, cfg, def, rdef));
      break;

    case 'xy':
      if (!robot.stepStarted) {
        const t =
          step.to === 'home' ? { a: rdef.home, r: 0 } : step.to === 'mover' ? { a: 0, r: 0 } : step.to === 'source' ? sourcePos(cfg, rdef) : dropPos(cfg, robot);
        robot.ta = t.a;
        robot.tr = t.r;
        robot.tz = robot.z;
      }
      robot.phase = 'move';
      finished = moveAxes(robot, cfg, p.speed, dt, laneOf(p, cfg, def, rdef));
      break;

    case 'leave':
      if (!robot.stepStarted) {
        robot.ta = rdef.home;
        robot.tr = 0;
        robot.tz = cfg.layout.z.safe;
      }
      robot.phase = 'move';
      finished = moveAxes(robot, cfg, p.speed, dt, laneOf(p, cfg, def, rdef));
      break;

    case 'waitSource':
      if (rdef.source === 'collet') {
        finished = colletAtPick(p.cartridges) !== undefined;
      } else if (rdef.source === 'cup') {
        finished = cupFor(p, def).full;
      } else if (rdef.source === 'dial') {
        finished = dialPick(p, cfg) !== null;
      } else {
        const f = feederFor(p, rdef);
        finished = f.items.length > 0 && f.items[0].x === 0;
      }
      robot.phase = finished ? 'move' : 'starved';
      break;

    case 'waitDrop':
      if (robot.dropTarget?.kind === 'tray') {
        finished = p.tray.changing === 0 && p.tray.count < cfg.traySize;
        if (finished) robot.slot = p.tray.count;
      } else {
        finished = true;
      }
      robot.phase = finished ? 'move' : 'blocked';
      break;

    case 'grip':
      robot.phase = 'grip';
      finished = timer(robot, cfg.robot.gripTime, dt);
      if (!finished) break;
      if (step.from === 'mover') {
        const m = moverById(p, robot.moverId);
        robot.holding = m.load ? { kind: 'pen', load: m.load } : null;
        m.load = null;
      } else if (rdef.source === 'collet') {
        // The cartridge comes out of its collet; the empty collet goes back round to be refilled.
        const collet = colletAtPick(p.cartridges)!;
        robot.holding = { kind: 'part', parts: [...(rdef.parts ?? [])], ids: [collet.cartridge!.sr] };
        collet.cartridge = null;
      } else if (rdef.source === 'dial') {
        const part = takeFromDial(p, cfg);
        robot.holding = { kind: 'part', parts: [...(rdef.parts ?? [])], ids: [part.sr], label: part.label ?? undefined };
      } else if (rdef.source === 'cup') {
        const cup = cupFor(p, def);
        robot.holding = { kind: 'part', parts: [...(rdef.parts ?? [])], ids: [cup.sr] };
        cup.full = false;
        cup.sr = null;
      } else {
        // The part's SR id from its sub-line (if tracked there) goes with it.
        const item = feederFor(p, rdef).items.shift()!;
        robot.holding = { kind: 'part', parts: [...(rdef.parts ?? [])], ids: [item.sr] };
      }
      break;

    case 'release':
      robot.phase = 'grip';
      finished = timer(robot, cfg.robot.gripTime, dt);
      if (!finished) break;
      if (step.to === 'mover') release(p, cfg, rng, def, robot);
      else drop(p, robot);
      robot.holding = null;
      break;

    case 'press': {
      if (!robot.stepStarted) {
        robot.dwellMech = step.mech;
        robot.pressFrom = robot.z;
        robot.pressTime = 0;
        robot.ta = robot.a;
        robot.tr = robot.r;
        robot.tz = moverHeight(p, cfg, rdef, robot);
      }
      robot.phase = 'press';
      robot.dwellMech = Math.max(0, robot.dwellMech - dt * p.speed);
      const k = robot.dwellMech / step.mech;
      robot.z = robot.tz + (robot.pressFrom - robot.tz) * k;
      robot.vz = robot.dwellMech > 0 ? ((robot.tz - robot.pressFrom) / step.mech) * p.speed : 0;
      // Only time the stroke really ran counts (a frozen robot isn't stepped at all).
      robot.pressTime += dt;
      finished = robot.dwellMech <= 0;
      if (finished) robot.pressEnd = p.t;
      break;
    }

    case 'mark': {
      const ps = p.stations.find((x) => x.id === def.id)!;
      if (robot.op?.kind === 'load') ps.laser = { left: step.seconds, moverId: robot.moverId, mark: robot.op.mark };
      finished = true;
      break;
    }
  }

  robot.stepStarted = true;
  if (finished) {
    robot.steps.shift();
    robot.stepStarted = false;
    if (robot.steps.length === 0) {
      robot.job = null;
      robot.phase = 'idle';
    }
  }
}

/** Lets go of a part on the mover. A part that doesn't seat, or has nothing to go onto, is scrap. */
function release(p: PlantState, cfg: LineConfig, rng: RngState, def: StationDef, robot: Robot): void {
  const misplaced = cfg.faults.enabled && random(rng) < cfg.faults.misplaceRate;
  const label = robot.holding?.kind === 'part' ? robot.holding.label : undefined;
  const stroke = { duration: robot.pressTime, end: robot.pressEnd };
  const result = misplaced || !robot.op ? null : placeOnMover(p, cfg, rng, def, robot.op, robot.moverId, label, stroke);
  if (result === null) p.scrap[def.id] = (p.scrap[def.id] ?? 0) + 1;
  // The PLC records the parts as placed either way: it can't see that one didn't seat.
  const partIds = robot.holding?.kind === 'part' ? robot.holding.ids : undefined;
  robot.result = { ...(result ?? { measurement: null }), partIds };
}

/**
 * Opens the gripper over the bin or tray pocket. A full tray is changed once the tool is clear.
 * The PLC is told even when the gripper came up empty (the pen was lost upstream), so it can
 * close that pen's record.
 */
function drop(p: PlantState, robot: Robot): void {
  if (robot.holding?.kind === 'pen') {
    const t = robot.dropTarget!;
    if (t.kind === 'bin') p.bins[t.bin] = (p.bins[t.bin] ?? 0) + 1;
    else p.tray.count++;
  }
  robot.dropped = true;
}

/**
 * The robot is done with the mover: idle, or only travelling back home at safe height. The next
 * robot of the station may move in then (the arms come from opposite sides).
 */
export function leftMover(robot: Robot): boolean {
  return robot.job === null || (robot.job === 'place' && robot.steps.every((st) => st.k === 'leave'));
}

/** The gripper is up at safe height, clear of trays and movers. */
export function toolClear(cfg: LineConfig, robot: Robot | null): boolean {
  return !robot || robot.z >= cfg.layout.z.safe - 1e-6;
}
