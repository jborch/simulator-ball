// Cartesian pick-and-place robots (a along the belt, r across it, z up). They behave like a
// robot controller: the PLC starts a job (prepick / place / pickMover / drop) and watches for
// the job to end; the robot runs the motion program with velocity- and acceleration-limited
// axes scaled by machine speed. All physical effects (parts leaving feeders, landing on movers,
// falling into bins) happen here, at grip and release.
import { moverById, placeOnMover } from './assembly';
import type { LineConfig, StationDef } from './config';
import { nextFailure, repairTime } from './devices';
import { nestPocket, trayPocket } from './layout';
import { type RngState, random } from './rng';
import type { Feeder, Nest, PlaceOp, PlantState, Robot, RobotJob, RobotStep } from './types';

export function createRobot(safeZ: number, nextFault: number): Robot {
  return {
    a: 0,
    r: 0,
    z: safeZ,
    va: 0,
    vr: 0,
    vz: 0,
    ta: 0,
    tr: 0,
    tz: safeZ,
    job: null,
    steps: [],
    stepStarted: false,
    dwellMech: 0,
    dwellFixed: 0,
    phase: 'idle',
    holding: null,
    op: null,
    moverId: 0,
    dropTarget: null,
    slot: null,
    result: null,
    fault: 0,
    nextFault,
  };
}

interface Target {
  a: number;
  r: number;
  z: number;
}

function sourcePos(cfg: LineConfig, def: StationDef, robot: Robot): Target {
  if (def.source === 'nest') return { ...nestPocket(cfg, robot.slot ?? 0), z: cfg.layout.z.nest };
  const feeder = cfg.feeders.find((f) => f.id === def.source)!;
  return { a: 0, r: cfg.layout.feederR, z: feeder.pickZ };
}

function dropPos(cfg: LineConfig, robot: Robot): Target {
  const t = robot.dropTarget!;
  if (t.kind === 'bin') return { ...cfg.layout.bins[t.bin], z: cfg.layout.z.bin };
  return { ...trayPocket(cfg, robot.slot ?? 0), z: cfg.layout.z.tray };
}

function height(cfg: LineConfig, def: StationDef, robot: Robot, to: Extract<RobotStep, { k: 'z' }>['to']): number {
  switch (to) {
    case 'safe':
      return cfg.layout.z.safe;
    case 'mover':
      return cfg.layout.z.mover;
    case 'source':
      return sourcePos(cfg, def, robot).z;
    case 'drop':
      return dropPos(cfg, robot).z;
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
  pickMover: [{ k: 'xy', to: 'home' }, { k: 'z', to: 'mover' }, { k: 'grip', from: 'mover' }, { k: 'z', to: 'safe' }],
  drop: [{ k: 'waitDrop' }, { k: 'xy', to: 'drop' }, { k: 'z', to: 'drop' }, { k: 'release', to: 'drop' }, { k: 'z', to: 'safe' }, { k: 'xy', to: 'home' }],
};

/** Place: down onto the mover, press/insert, let go, back up; the load station then laser-marks. */
function placeProgram(def: StationDef): RobotStep[] {
  const steps: RobotStep[] = [{ k: 'z', to: 'mover' }];
  if (def.mech > 0) steps.push({ k: 'dwell', mech: def.mech, fixed: 0, phase: 'press' });
  steps.push({ k: 'release', to: 'mover' }, { k: 'z', to: 'safe' });
  if (def.kind === 'load') steps.push({ k: 'dwell', mech: 0, fixed: def.fixed, phase: 'laser' }, { k: 'mark' });
  return steps;
}

export function startJob(robot: Robot, def: StationDef, job: RobotJob, args: JobArgs = {}): void {
  robot.job = job;
  robot.steps = job === 'place' ? placeProgram(def) : [...PROGRAMS[job]];
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

/** Moves all axes toward their targets; true when every axis has arrived. */
function moveAxes(robot: Robot, cfg: LineConfig, speed: number, dt: number): boolean {
  const { vH, aH, vZ, aZ } = cfg.robot;
  let atA: boolean;
  let atR: boolean;
  let atZ: boolean;
  [robot.a, robot.va, atA] = axis(robot.a, robot.va, robot.ta, vH * speed, aH * speed, dt);
  [robot.r, robot.vr, atR] = axis(robot.r, robot.vr, robot.tr, vH * speed, aH * speed, dt);
  [robot.z, robot.vz, atZ] = axis(robot.z, robot.vz, robot.tz, vZ * speed, aZ * speed, dt);
  return atA && atR && atZ;
}

function nestFor(p: PlantState, def: StationDef): Nest {
  return p.nests.find((n) => n.station === def.id)!;
}

function feederFor(p: PlantState, def: StationDef): Feeder {
  return p.feeders.find((f) => f.id === def.source)!;
}

/** Counts down a timed step (grip/release); true when it's over. */
function timer(robot: Robot, seconds: number, dt: number): boolean {
  if (!robot.stepStarted) robot.dwellFixed = seconds;
  robot.dwellFixed -= dt;
  return robot.dwellFixed <= 0;
}

/** Advances a station robot one plant step. */
export function stepRobot(p: PlantState, cfg: LineConfig, rng: RngState, def: StationDef, robot: Robot, dt: number): void {
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
        robot.tz = height(cfg, def, robot, step.to);
      }
      robot.phase = 'move';
      finished = moveAxes(robot, cfg, p.speed, dt);
      break;

    case 'xy':
      if (!robot.stepStarted) {
        const t = step.to === 'home' ? { a: 0, r: 0 } : step.to === 'source' ? sourcePos(cfg, def, robot) : dropPos(cfg, robot);
        robot.ta = t.a;
        robot.tr = t.r;
        robot.tz = robot.z;
      }
      robot.phase = 'move';
      finished = moveAxes(robot, cfg, p.speed, dt);
      break;

    case 'waitSource':
      if (def.source === 'nest') {
        const nest = nestFor(p, def);
        const slot = nest.changing > 0 ? -1 : nest.slots.indexOf(1);
        if (slot >= 0) {
          nest.slots[slot] = 2;
          robot.slot = slot;
          finished = true;
        }
      } else {
        const f = feederFor(p, def);
        finished = f.items.length > 0 && f.items[0] === 0;
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
      } else if (def.source === 'nest') {
        nestFor(p, def).slots[robot.slot!] = 0;
        robot.holding = { kind: 'part', parts: ['cartridge'] };
      } else {
        feederFor(p, def).items.shift();
        robot.holding = { kind: 'part', parts: [...(def.parts ?? [])] };
      }
      break;

    case 'release':
      robot.phase = 'grip';
      finished = timer(robot, cfg.robot.gripTime, dt);
      if (!finished) break;
      if (step.to === 'mover') release(p, cfg, rng, def, robot);
      else if (robot.holding?.kind === 'pen') drop(p, cfg, robot);
      robot.holding = null;
      break;

    case 'dwell':
      if (!robot.stepStarted) {
        robot.dwellMech = step.mech;
        robot.dwellFixed = step.fixed;
      }
      robot.phase = step.phase;
      if (robot.dwellMech > 0) robot.dwellMech -= dt * p.speed;
      else robot.dwellFixed -= dt;
      finished = robot.dwellMech <= 0 && robot.dwellFixed <= 0;
      break;

    case 'mark': {
      const load = moverById(p, robot.moverId).load;
      if (load && robot.op?.kind === 'load') load.mark = robot.op.mark;
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
  const result = misplaced || !robot.op ? null : placeOnMover(p, cfg, rng, def, robot.op, robot.moverId);
  if (result === null) p.scrap[def.id] = (p.scrap[def.id] ?? 0) + 1;
  robot.result = result ?? { measurement: null };
}

/** Lets go of a picked pen over its bin or tray pocket. */
function drop(p: PlantState, cfg: LineConfig, robot: Robot): void {
  const t = robot.dropTarget!;
  if (t.kind === 'bin') p.bins[t.bin] = (p.bins[t.bin] ?? 0) + 1;
  else if (++p.tray.count >= cfg.traySize) p.tray.changing = cfg.trayChange;
}
