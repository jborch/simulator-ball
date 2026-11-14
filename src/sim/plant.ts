// The plant: physical truth of the line. It moves movers on the belt, blocks them at closed
// gates and behind each other, runs station actuators and RFID readers, and changes the
// physical assemblies. It knows nothing about control logic; the PLC only talks to it
// through sensors (readInputs) and actuator fields (gateClosed, cycle, reader, beltRunning, ...).
import { applyOp, moverById } from './assembly';
import type { LineConfig, MoverProfile } from './config';
import { createFeeder, createNest, createRobot, nextFailure, stepFeeder, stepNest, stepRobot, stepTray } from './devices';
import { type RngState, normal, random, uniform } from './rng';
import { forward, trackLength } from './track';
import type { Mover, PlantState, PlantStation, Tag } from './types';

export { moverById };

export const emptyTag = (): Tag => ({ srId: null, status: 'empty', done: [], reason: null });

export function copyTag(t: Tag): Tag {
  return { srId: t.srId, status: t.status, done: [...t.done], reason: t.reason };
}

function makeProfile(cfg: LineConfig, rng: RngState, id: number): MoverProfile {
  const p = cfg.moverProfiles;
  const base: MoverProfile = {
    mu: uniform(rng, ...p.mu),
    slip: uniform(rng, ...p.slip),
    settle: uniform(rng, ...p.settle),
    fixtureOffset: normal(rng, 0, p.fixtureSd),
    rfidOk: p.rfidOk,
  };
  return { ...base, ...p.worn[id] };
}

/** Next gate ahead of (or exactly at) position s. */
function nextGateIndex(cfg: LineConfig, gateOrder: number[], s: number): number {
  const L = trackLength(cfg.track);
  let best = 0;
  let bestD = Infinity;
  gateOrder.forEach((stationIdx, i) => {
    const d = forward(s, cfg.stations[stationIdx].s, L);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function createPlant(cfg: LineConfig, rng: RngState): PlantState {
  const L = trackLength(cfg.track);
  const gateOrder = cfg.stations.map((_, i) => i).sort((a, b) => cfg.stations[a].s - cfg.stations[b].s);
  const n = cfg.mover.count;
  const spacing = L / n;
  // Spread movers evenly, starting just after the lap marker; numbered in loop order.
  const movers: Mover[] = Array.from({ length: n }, (_, i) => {
    const s = 0.01 + i * spacing;
    return {
      id: i + 1,
      s,
      v: 0,
      profile: makeProfile(cfg, rng, i + 1),
      tag: emptyTag(),
      load: null,
      nextGate: nextGateIndex(cfg, gateOrder, s),
      stoppedAt: null,
      laps: 0,
      lapStart: 0,
      lastLap: null,
    };
  });
  const stations: PlantStation[] = cfg.stations.map((d) => ({
    id: d.id,
    gateClosed: true,
    cycle: null,
    cycleDone: false,
    result: null,
    reader: { busy: false, kind: 'read', left: 0, moverId: 0, write: null, done: false, ok: false, data: null },
    robot: d.kind === 'inspect' ? null : createRobot(cfg.layout.z.safe, nextFailure(rng, cfg.faults.robotMtbf)),
  }));
  return {
    t: 0,
    beltSpeed: 0,
    beltRunning: false,
    speed: 1,
    speedTarget: 1,
    estop: false,
    movers,
    stations,
    gateOrder,
    bins: Object.fromEntries(cfg.stations.filter((d) => d.bin).map((d) => [d.bin!, 0])),
    feeders: cfg.feeders.map(createFeeder),
    scrap: {},
    nests: cfg.stations.filter((d) => d.source === 'nest').map((d) => createNest(cfg, d.id)),
    tray: { count: 0, changing: 0 },
    traysOut: 0,
  };
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

export function stepPlant(p: PlantState, cfg: LineConfig, rng: RngState, dt: number): void {
  p.t += dt;
  const L = trackLength(cfg.track);

  // Drives: machine speed ramps, belt follows; e-stop halts the belt at once.
  p.speed = approach(p.speed, p.speedTarget, cfg.speedRamp * dt);
  if (p.estop) {
    p.beltSpeed = 0;
  } else {
    const target = p.beltRunning ? cfg.belt.speed * p.speed : 0;
    p.beltSpeed = approach(p.beltSpeed, target, cfg.belt.accel * dt);
  }

  moveMovers(p, cfg, L, dt);
  if (p.estop) return;
  for (let i = 0; i < p.stations.length; i++) {
    stepStation(p, cfg, rng, i, dt);
    const robot = p.stations[i].robot;
    if (robot) stepRobot(p, cfg, rng, cfg.stations[i], robot, dt);
  }
  p.feeders.forEach((f, i) => stepFeeder(f, cfg.feeders[i], cfg, rng, dt));
  for (const n of p.nests) stepNest(n, cfg, dt);
  stepTray(p, dt);
}

function moveMovers(p: PlantState, cfg: LineConfig, L: number, dt: number): void {
  const movers = p.movers;
  const n = movers.length;
  const len = cfg.mover.length;
  // Gaps use positions from the start of the step; the mover ahead only moves forward, so this never overlaps.
  const prevS = movers.map((m) => m.s);
  const prevV = movers.map((m) => m.v);

  for (let i = 0; i < n; i++) {
    const m = movers[i];
    // Belt drags the mover toward (slipped) belt speed, limited by pad friction.
    const target = p.beltSpeed * (1 - m.profile.slip);
    m.v = approach(m.v, target, m.profile.mu * cfg.mover.gravity * dt);
    let ds = m.v * dt;

    if (n > 1) {
      const j = (i + 1) % n;
      const gap = forward(prevS[i], prevS[j], L) - len;
      if (ds >= gap) {
        ds = Math.max(0, gap);
        m.v = Math.min(m.v, prevV[j]);
      }
    }

    const stationIdx = p.gateOrder[m.nextGate];
    const g = cfg.stations[stationIdx].s;
    const dg = forward(m.s, g, L);
    let atGate = false;
    if (p.stations[stationIdx].gateClosed && ds >= dg) {
      m.s = g;
      m.v = 0;
      atGate = true;
    } else {
      if (ds > dg) m.nextGate = (m.nextGate + 1) % p.gateOrder.length;
      const s = m.s + ds;
      if (s >= L) {
        m.laps++;
        m.lastLap = p.t - m.lapStart;
        m.lapStart = p.t;
      }
      m.s = s >= L ? s - L : s;
    }

    if (atGate) {
      if (m.stoppedAt === null) m.stoppedAt = p.t;
    } else if (ds > 0) {
      m.stoppedAt = null;
    }
  }
}

function stepStation(p: PlantState, cfg: LineConfig, rng: RngState, i: number, dt: number): void {
  const ps = p.stations[i];
  const def = cfg.stations[i];

  const c = ps.cycle;
  if (c) {
    if (c.mechLeft > 0) c.mechLeft -= dt * p.speed;
    else c.fixedLeft -= dt;
    if (c.mechLeft <= 0 && c.fixedLeft <= 0) {
      ps.result = applyOp(p, cfg, rng, def, c.op, c.moverId);
      ps.cycle = null;
      ps.cycleDone = true;
    }
  }

  const r = ps.reader;
  if (r.busy) {
    r.left -= dt;
    if (r.left <= 0) {
      const m = moverById(p, r.moverId);
      r.busy = false;
      r.done = true;
      r.ok = random(rng) < m.profile.rfidOk;
      if (r.ok) {
        if (r.kind === 'read') r.data = copyTag(m.tag);
        else if (r.write) m.tag = copyTag(r.write);
      }
    }
  }
}

export interface Inputs {
  /** Mover number at (or just past) each station's gate. */
  occupant: (number | null)[];
  /** Mover resting at the gate and settled. */
  inPos: boolean[];
  /** Movers between the previous gate and this one (photo-eye zone). */
  zoneCount: number[];
}

/** Sensor image, sampled by the PLC each scan. */
export function readInputs(p: PlantState, cfg: LineConfig): Inputs {
  const L = trackLength(cfg.track);
  const k = cfg.stations.length;
  const occupant: (number | null)[] = new Array(k).fill(null);
  const inPos: boolean[] = new Array(k).fill(false);
  const zoneCount: number[] = new Array(k).fill(0);

  for (let oi = 0; oi < p.gateOrder.length; oi++) {
    const si = p.gateOrder[oi];
    const g = cfg.stations[si].s;
    const prevG = cfg.stations[p.gateOrder[(oi - 1 + p.gateOrder.length) % p.gateOrder.length]].s;
    const span = forward(prevG, g, L);
    let best = Infinity;
    for (const m of p.movers) {
      const past = forward(g, m.s, L);
      if (past <= cfg.gateZone && past < best) {
        best = past;
        occupant[si] = m.id;
        inPos[si] = past === 0 && m.v === 0 && m.stoppedAt !== null && p.t - m.stoppedAt >= m.profile.settle;
      }
      const fromPrev = forward(prevG, m.s, L);
      if (fromPrev > cfg.gateZone && fromPrev <= span) zoneCount[si]++;
    }
  }
  return { occupant, inPos, zoneCount };
}
