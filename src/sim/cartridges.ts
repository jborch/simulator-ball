// EM41's cartridge supply (UN02). Tubs ("nests" in the original) of 160 cartridges come in on a
// conveyor; EM00's robot takes the cartridges out one by one, pocket after pocket, and puts each
// into an empty collet waiting at the fill point of the collet loop. Collets circulate on the
// loop: empty ones queue at the fill point, full ones at the pick point by the belt, where EM41's
// robot takes the cartridge. The PLC gives each tub and cartridge its SR id and records EM00
// (cartridge from nest, with the collet as carrier), as the original's de-nest step does.
import type { LineConfig } from './config';
import { emit, subProcessId } from './machine';
import { moveAxes } from './robot';
import type { CartridgeCell, Collet, DenestRobot, PlantState, SimState } from './types';

/** Length of the collet loop: two straights and two half circles. */
export function colletLoopLength(cfg: LineConfig): number {
  const c = cfg.cartridges.collets;
  return 2 * (c.fill - c.pick - 2 * c.radius) + 2 * Math.PI * c.radius;
}

/** Position along the loop of the fill point (the far apex); the pick point is at 0. */
export function fillAt(cfg: LineConfig): number {
  return colletLoopLength(cfg) / 2;
}

/**
 * Station-local (a, r) of a point `u` along the collet loop. From the pick apex the collets run
 * out along a = -radius to the fill apex, and back along a = +radius.
 */
export function colletPoint(cfg: LineConfig, u: number): { a: number; r: number } {
  const c = cfg.cartridges.collets;
  const S = c.fill - c.pick - 2 * c.radius;
  const arc = (Math.PI * c.radius) / 2;
  const L = colletLoopLength(cfg);
  u = ((u % L) + L) % L;
  const lowC = c.pick + c.radius;
  const highC = c.fill - c.radius;
  if (u < arc) {
    const t = u / c.radius;
    return { a: -c.radius * Math.sin(t), r: lowC - c.radius * Math.cos(t) };
  }
  u -= arc;
  if (u < S) return { a: -c.radius, r: lowC + u };
  u -= S;
  if (u < 2 * arc) {
    const t = u / c.radius;
    return { a: -c.radius * Math.cos(t), r: highC + c.radius * Math.sin(t) };
  }
  u -= 2 * arc;
  if (u < S) return { a: c.radius, r: highC - u };
  u -= S;
  const t = u / c.radius;
  return { a: c.radius * Math.cos(t), r: lowC - c.radius * Math.sin(t) };
}

/** Station-local (a, r) of tub pocket `i`: cols along the belt, rows outward. */
export function tubPocket(cfg: LineConfig, i: number): { a: number; r: number } {
  const t = cfg.cartridges.tub;
  const col = i % t.cols;
  const row = Math.floor(i / t.cols);
  return { a: t.a + (col - (t.cols - 1) / 2) * t.pitch, r: t.r + (row - (t.rows - 1) / 2) * t.pitch };
}

export function tubSize(cfg: LineConfig): number {
  return cfg.cartridges.tub.cols * cfg.cartridges.tub.rows;
}

/** Gripper heights: over a cartridge in the tub, and over one seated in a collet. */
export function denestHeights(cfg: LineConfig): { tub: number; collet: number } {
  const len = cfg.parts.cartridge.length;
  return { tub: cfg.cartridges.tub.floor + len, collet: cfg.cartridges.collets.base + len };
}

export function createCartridgeCell(cfg: LineConfig): CartridgeCell {
  const c = cfg.cartridges.collets;
  const L = colletLoopLength(cfg);
  // Collets start spread over the loop, empty; they gather at the fill point once running.
  const collets: Collet[] = Array.from({ length: c.count }, (_, i) => ({ id: i + 1, u: (L * (i + 0.5)) / c.count, cartridge: null }));
  const z = cfg.layout.z.safe;
  const robot: DenestRobot = { a: 0, r: 0, z, va: 0, vr: 0, vz: 0, ta: 0, tr: 0, tz: z, step: 'idle', timer: 0, holding: null, phase: 'idle' };
  return { tub: { sr: null, used: 0 }, changing: 0, tubs: 0, robot, collets, results: [] };
}

/** EM00 robot coordinates of a station-local point (its frame starts at the fill apex). */
function robotFrame(cfg: LineConfig, p: { a: number; r: number }): { a: number; r: number } {
  return { a: p.r - cfg.cartridges.collets.fill, r: -p.a };
}

/** The collet waiting empty at the fill point, if any. */
function colletAtFill(cfg: LineConfig, cell: CartridgeCell): Collet | undefined {
  const f = fillAt(cfg);
  return cell.collets.find((c) => !c.cartridge && Math.abs(c.u - f) < 1e-9);
}

/** The full collet waiting at the pick point whose cartridge the PLC knows, if any. */
export function colletAtPick(cell: CartridgeCell): Collet | undefined {
  return cell.collets.find((c) => c.cartridge?.sr != null && c.u === 0);
}

export function stepCartridgeCell(p: PlantState, cfg: LineConfig, dt: number): void {
  if (!p.feedersOn) return;
  const cell = p.cartridges;
  stepTub(p, cfg, cell, dt);
  stepDenest(p, cfg, cell, dt);
  stepCollets(p, cfg, cell, dt);
}

/** An empty tub goes out and the next full one comes in, once the robot is clear of it. */
function stepTub(p: PlantState, cfg: LineConfig, cell: CartridgeCell, dt: number): void {
  if (cell.changing > 0) {
    cell.changing -= dt * p.speed;
    if (cell.changing <= 0) {
      cell.changing = 0;
      cell.tub = { sr: null, used: 0 };
      cell.tubs++;
    }
    return;
  }
  const clear = cell.robot.z >= cfg.layout.z.safe - 1e-6;
  if (cell.tub && cell.tub.used >= tubSize(cfg) && clear) {
    cell.tub = null;
    cell.changing = cfg.cartridges.tub.change;
  }
}

function stepDenest(p: PlantState, cfg: LineConfig, cell: CartridgeCell, dt: number): void {
  const r = cell.robot;
  const h = denestHeights(cfg);
  const safe = cfg.layout.z.safe;
  const move = (a: number, rr: number, z: number) => {
    r.ta = a;
    r.tr = rr;
    r.tz = z;
    r.phase = 'move';
    return moveAxes(r, cfg, p.speed, dt);
  };
  switch (r.step) {
    case 'idle': {
      // Pick the next cartridge from the tub (it waits for the PLC to know the tub).
      const tub = cell.tub;
      if (tub && tub.sr !== null && tub.used < tubSize(cfg)) {
        r.holding = { pocket: tub.used++, nest: tub.sr, from: p.t };
        r.step = 'toPocket';
      } else {
        r.phase = 'starved';
      }
      return;
    }
    case 'toPocket': {
      const t = robotFrame(cfg, tubPocket(cfg, r.holding!.pocket));
      if (move(t.a, t.r, safe)) r.step = 'down';
      return;
    }
    case 'down':
      if (move(r.a, r.r, h.tub)) r.step = 'grip';
      return;
    case 'grip':
    case 'release':
      r.phase = 'grip';
      if (r.timer === 0) r.timer = cfg.robot.gripTime;
      r.timer -= dt;
      if (r.timer > 0) return;
      r.timer = 0;
      if (r.step === 'grip') {
        r.step = 'up';
      } else {
        const collet = colletAtFill(cfg, cell)!;
        collet.cartridge = { sr: null };
        cell.results.push({ pocket: r.holding!.pocket, nest: r.holding!.nest, collet: collet.id, from: r.holding!.from, to: p.t });
        r.holding = null;
        r.step = 'clear';
      }
      return;
    case 'up':
      if (move(r.a, r.r, safe)) r.step = 'toCollet';
      return;
    case 'toCollet':
      if (move(0, 0, safe)) r.step = 'waitCollet';
      return;
    case 'waitCollet':
      // Holding the cartridge over the fill point until an empty collet stands there.
      r.phase = colletAtFill(cfg, cell) ? 'move' : 'blocked';
      if (colletAtFill(cfg, cell)) r.step = 'place';
      return;
    case 'place':
      if (move(0, 0, h.collet)) r.step = 'release';
      return;
    case 'clear':
      if (move(0, 0, safe)) r.step = 'idle';
      return;
  }
}

/**
 * Collets ride the loop and queue behind each other: an empty one stops at the fill point until
 * EM00 has filled it, a full one at the pick point until EM41's robot has emptied it.
 */
function stepCollets(p: PlantState, cfg: LineConfig, cell: CartridgeCell, dt: number): void {
  const c = cfg.cartridges.collets;
  const L = colletLoopLength(cfg);
  const fill = fillAt(cfg);
  const fwd = (from: number, to: number) => (((to - from) % L) + L) % L;
  const prev = cell.collets.map((x) => x.u);
  cell.collets.forEach((col, i) => {
    let ds = c.speed * p.speed * dt;
    // The collet ahead along the loop (nearest forward), as it was at the start of the step.
    let gap = Infinity;
    prev.forEach((u, j) => {
      if (j !== i) gap = Math.min(gap, fwd(prev[i], u) - c.pitch);
    });
    ds = Math.min(ds, Math.max(0, gap));
    // Stops: empty at the fill point, full at the pick point. A collet stays at its stop until
    // its state changes (filled or emptied), and then its next stop is the other one.
    const stop = col.cartridge ? 0 : fill;
    if (col.u === stop) return;
    if (fwd(col.u, stop) <= ds) col.u = stop;
    else col.u = (col.u + ds) % L;
  });
}

/** PLC: SR ids for each new tub and each cartridge taken out of it; EM00's records. */
export function scanCartridgeCell(s: SimState, cfg: LineConfig): void {
  const cell = s.plant.cartridges;
  if (cell.tub && cell.tub.sr === null) cell.tub.sr = ++s.plc.srCounter;
  const d = cfg.cartridges.denest;
  for (const r of cell.results) {
    const collet = cell.collets.find((c) => c.id === r.collet)!;
    const sr = ++s.plc.srCounter;
    if (collet.cartridge) collet.cartridge.sr = sr;
    emit(s, {
      kind: 'processed',
      process: subProcessId(cfg, d),
      scopedId: sr,
      itemType: 'Cartridge',
      from: s.epochMs + r.from * 1000,
      to: s.epochMs + r.to * 1000,
      carrier: colletId(r.collet),
      sourceScopedId: r.nest,
      sourceType: 'Nest',
      sourcePosition: r.pocket,
    });
  }
  cell.results = [];
}

/** Collet number as reported, e.g. "C07". */
export function colletId(n: number): string {
  return `C${String(n).padStart(2, '0')}`;
}
