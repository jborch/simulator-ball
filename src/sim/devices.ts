// Station devices: cartesian pick-and-place robots, bowl feeders with linear tracks, the
// cartridge nest and the tray outfeed. Robots behave like a robot controller: the PLC starts a
// job (prepick / place / pickMover / drop) and waits for `done`; the robot runs the motion
// program with velocity- and acceleration-limited axes scaled by machine speed.
import { applyOp, moverById } from './assembly';
import type { FeederDef, LineConfig, StationDef } from './config';
import { type RngState, random, uniform } from './rng';
import type { Feeder, Nest, Op, PlantState, Robot, RobotJob, RobotStep } from './types';

/** Operating seconds until the next random fault, exponentially distributed around the MTBF. */
export function nextFailure(rng: RngState, mtbf: number): number {
  return -mtbf * Math.log(1 - random(rng));
}

export function repairTime(rng: RngState, range: [number, number]): number {
  return uniform(rng, range[0], range[1]);
}

export function createRobot(z: number, nextFault: number): Robot {
  return {
    a: 0,
    r: 0,
    z,
    va: 0,
    vr: 0,
    vz: 0,
    ta: 0,
    tr: 0,
    tz: z,
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
    done: false,
    result: null,
    fault: 0,
    nextFault,
  };
}

export function createFeeder(def: FeederDef): Feeder {
  // Start with a full track so the line doesn't begin starved.
  const n = Math.floor(def.track / def.pitch + 1e-9);
  const items = Array.from({ length: n }, (_, i) => i * def.pitch);
  return { id: def.id, items, nextIn: def.interval, fed: 0, jam: 0 };
}

export function createNest(cfg: LineConfig, station: string): Nest {
  return { station, slots: new Array(cfg.nestSize).fill(1), changing: 0, count: 1 };
}

// ---- Geometry (station-local: a along travel, r outward, z gripper height above belt) ----

export function nestPocket(cfg: LineConfig, slot: number): { a: number; r: number } {
  const n = cfg.layout.nest;
  const col = slot % n.cols;
  const row = Math.floor(slot / n.cols);
  return { a: n.a + (col - (n.cols - 1) / 2) * n.pitch, r: n.r + (row - (n.rows - 1) / 2) * n.pitch };
}

export function trayPocket(cfg: LineConfig, slot: number): { a: number; r: number } {
  const t = cfg.layout.tray;
  const col = slot % t.cols;
  const row = Math.floor(slot / t.cols);
  return { a: t.a + (col - (t.cols - 1) / 2) * t.pitch, r: t.r + (row - (t.rows - 1) / 2) * t.pitch };
}

function sourcePos(cfg: LineConfig, def: StationDef, robot: Robot): { a: number; r: number; z: number } {
  const z = cfg.layout.z;
  if (def.source === 'nest') return { ...nestPocket(cfg, robot.slot ?? 0), z: z.nest };
  const feeder = cfg.feeders.find((f) => f.id === def.source);
  return { a: 0, r: cfg.layout.feederR, z: feeder?.pickZ ?? z.mover };
}

function dropPos(cfg: LineConfig, robot: Robot): { a: number; r: number; z: number } {
  const t = robot.dropTarget!;
  if (t.kind === 'bin') return { ...cfg.layout.bins[t.bin], z: cfg.layout.z.bin };
  return { ...trayPocket(cfg, robot.slot ?? 0), z: cfg.layout.z.tray };
}

// ---- Jobs ----

export interface JobArgs {
  op?: Op;
  moverId?: number;
  dropTarget?: Robot['dropTarget'];
}

export function startJob(robot: Robot, cfg: LineConfig, def: StationDef, job: RobotJob, args: JobArgs = {}): void {
  const z = cfg.layout.z;
  let steps: RobotStep[];
  switch (job) {
    case 'prepick':
      steps = [{ k: 'z', z: z.safe }, { k: 'waitSource' }, { k: 'xy', to: 'source' }, { k: 'z', z: 0 }, { k: 'grip', from: 'source' }, { k: 'z', z: z.safe }, { k: 'xy', to: 'home' }];
      break;
    case 'place':
      steps = [{ k: 'z', z: z.mover }];
      if (def.mech > 0) steps.push({ k: 'dwell', mech: def.mech, fixed: 0, phase: 'press' });
      steps.push({ k: 'release', to: 'mover' });
      if (def.kind === 'load') steps.push({ k: 'z', z: z.safe }, { k: 'dwell', mech: 0, fixed: def.fixed, phase: 'laser' }, { k: 'mark' });
      else steps.push({ k: 'z', z: z.safe });
      break;
    case 'pickMover':
      steps = [{ k: 'xy', to: 'home' }, { k: 'z', z: z.mover }, { k: 'grip', from: 'mover' }, { k: 'z', z: z.safe }];
      break;
    case 'drop':
      steps = [{ k: 'waitDrop' }, { k: 'xy', to: 'drop' }, { k: 'z', z: 0 }, { k: 'release', to: 'drop' }, { k: 'z', z: z.safe }, { k: 'xy', to: 'home' }];
      break;
  }
  robot.job = job;
  robot.steps = steps;
  robot.stepStarted = false;
  robot.done = false;
  robot.result = null;
  if (args.op) robot.op = args.op;
  if (args.moverId) robot.moverId = args.moverId;
  if (args.dropTarget !== undefined) robot.dropTarget = args.dropTarget;
}

/** One axis toward its target with trapezoidal velocity. Returns true when at target. */
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

function moveAxes(robot: Robot, cfg: LineConfig, speed: number, dt: number): boolean {
  const { vH, aH, vZ, aZ } = cfg.robot;
  let ok = true;
  let done: boolean;
  [robot.a, robot.va, done] = axis(robot.a, robot.va, robot.ta, vH * speed, aH * speed, dt);
  ok &&= done;
  [robot.r, robot.vr, done] = axis(robot.r, robot.vr, robot.tr, vH * speed, aH * speed, dt);
  ok &&= done;
  [robot.z, robot.vz, done] = axis(robot.z, robot.vz, robot.tz, vZ * speed, aZ * speed, dt);
  return ok && done;
}

function nestFor(p: PlantState, def: StationDef): Nest {
  return p.nests.find((n) => n.station === def.id)!;
}

function feederFor(p: PlantState, def: StationDef): Feeder | undefined {
  return p.feeders.find((f) => f.id === def.source);
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
  const z = cfg.layout.z;
  let finished = false;

  switch (step.k) {
    case 'z':
      if (!robot.stepStarted) {
        // Heights for pick/drop depend on where the robot is; 0 means "the target's own height".
        robot.tz = step.z === 0 ? (robot.job === 'drop' ? dropPos(cfg, robot).z : sourcePos(cfg, def, robot).z) : step.z;
        robot.ta = robot.a;
        robot.tr = robot.r;
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
        finished = !!f && f.items.length > 0 && f.items[0] === 0;
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
      if (!robot.stepStarted) robot.dwellFixed = cfg.robot.gripTime;
      robot.phase = 'grip';
      robot.dwellFixed -= dt;
      if (robot.dwellFixed <= 0) {
        if (step.from === 'mover') {
          const m = moverById(p, robot.moverId);
          robot.holding = m.load ? { kind: 'pen', load: m.load } : null;
          m.load = null;
        } else if (def.source === 'nest') {
          nestFor(p, def).slots[robot.slot!] = 0;
          robot.holding = { kind: 'part', parts: ['cartridge'] };
        } else {
          feederFor(p, def)?.items.shift();
          robot.holding = { kind: 'part', parts: [...(def.parts ?? [])] };
        }
        finished = true;
      }
      break;

    case 'release':
      if (!robot.stepStarted) robot.dwellFixed = cfg.robot.gripTime;
      robot.phase = 'grip';
      robot.dwellFixed -= dt;
      if (robot.dwellFixed <= 0) {
        if (step.to === 'mover') {
          const m = moverById(p, robot.moverId);
          const misplaced = cfg.faults.enabled && random(rng) < cfg.faults.misplaceRate;
          // A part that doesn't seat, or that's placed into an empty fixture, falls off and is scrap.
          if (misplaced || (robot.op?.kind === 'assemble' && !m.load)) {
            p.scrap[def.id] = (p.scrap[def.id] ?? 0) + 1;
            robot.result = { measurement: null };
          } else {
            robot.result = robot.op ? applyOp(p, cfg, rng, def, robot.op, robot.moverId) : null;
          }
        } else if (robot.holding?.kind === 'pen') {
          const t = robot.dropTarget!;
          if (t.kind === 'bin') p.bins[t.bin] = (p.bins[t.bin] ?? 0) + 1;
          else if (++p.tray.count >= cfg.traySize) p.tray.changing = cfg.trayChange;
        }
        robot.holding = null;
        finished = true;
      }
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
      robot.done = true;
      robot.phase = 'idle';
      // Keep heights tidy for the next job.
      robot.tz = z.safe;
    }
  }
}

export function stepFeeder(f: Feeder, def: FeederDef, cfg: LineConfig, rng: RngState, dt: number): void {
  for (let i = 0; i < f.items.length; i++) {
    const min = i === 0 ? 0 : f.items[i - 1] + def.pitch;
    f.items[i] = Math.max(min, f.items[i] - def.speed * dt);
  }
  // A jammed bowl feeds nothing; the track drains until the operator clears it.
  if (f.jam > 0) {
    f.jam = Math.max(0, f.jam - dt);
    return;
  }
  f.nextIn -= dt;
  const last = f.items.at(-1);
  if (f.nextIn <= 0 && (last === undefined || last <= def.track - def.pitch)) {
    f.items.push(def.track);
    f.fed++;
    f.nextIn = def.interval * uniform(rng, 0.6, 1.4);
    if (cfg.faults.enabled && random(rng) < cfg.faults.feederJamPerPart) f.jam = repairTime(rng, cfg.faults.feederRepair);
  }
}

export function stepNest(n: Nest, cfg: LineConfig, dt: number): void {
  if (n.changing > 0) {
    n.changing -= dt;
    if (n.changing <= 0) {
      n.changing = 0;
      n.slots.fill(1);
      n.count++;
    }
  } else if (n.slots.every((s) => s === 0)) {
    n.changing = cfg.nestChange;
  }
}

export function stepTray(p: PlantState, dt: number): void {
  if (p.tray.changing > 0) {
    p.tray.changing -= dt;
    if (p.tray.changing <= 0) {
      p.tray.changing = 0;
      p.tray.count = 0;
      p.traysOut++;
    }
  }
}
