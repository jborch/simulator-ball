// Station devices other than robots: bowl feeders with linear tracks, cartridge nests and the
// tray outfeed, plus the random-failure helpers shared with the robots.
import type { FeederDef, LineConfig } from './config';
import { type RngState, random, uniform } from './rng';
import type { Feeder, Nest, PlantState } from './types';

/** Operating seconds until the next random fault, exponentially distributed around the MTBF. */
export function nextFailure(rng: RngState, mtbf: number): number {
  return -mtbf * Math.log(1 - random(rng));
}

export function repairTime(rng: RngState, range: [number, number]): number {
  return uniform(rng, range[0], range[1]);
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

/** Swaps an empty nest for a full one, once the robot's gripper is clear of it. */
export function stepNest(n: Nest, cfg: LineConfig, toolClear: boolean, dt: number): void {
  if (n.changing > 0) {
    n.changing -= dt;
    if (n.changing <= 0) {
      n.changing = 0;
      n.slots.fill(1);
      n.count++;
    }
  } else if (toolClear && n.slots.every((s) => s === 0)) {
    n.changing = cfg.nestChange;
  }
}

/**
 * Indexes the tray out (full, or partly filled on a discharge request) and an empty one in, once
 * the unload robot's gripper is clear of it.
 */
export function stepTray(p: PlantState, cfg: LineConfig, toolClear: boolean, dt: number): void {
  const t = p.tray;
  if (t.changing > 0) {
    t.changing -= dt;
    if (t.changing <= 0) {
      t.changing = 0;
      p.pensOut += t.count;
      p.trayQueue = [t.count, ...p.trayQueue].slice(0, 2);
      t.count = 0;
      t.discharge = false;
      p.traysOut++;
    }
  } else if (t.discharge && t.count === 0) {
    t.discharge = false;
  } else if (toolClear && (t.count >= cfg.traySize || (t.discharge && t.count > 0))) {
    t.changing = cfg.trayChange;
  }
}
