// Station devices other than robots: bowl feeders with linear tracks, cartridge nests and the
// tray outfeed, plus the random-failure helpers shared with the robots.
import type { FeederDef, LineConfig } from './config';
import { type RngState, normal, random, uniform } from './rng';
import type { Feeder, FeederItem, Nest, PlantState } from './types';

/** Operating seconds until the next random fault, exponentially distributed around the MTBF. */
export function nextFailure(rng: RngState, mtbf: number): number {
  return -mtbf * Math.log(1 - random(rng));
}

export function repairTime(rng: RngState, range: [number, number]): number {
  return uniform(rng, range[0], range[1]);
}

export function createFeeder(def: FeederDef): Feeder {
  // Start with a full track so the line doesn't begin starved. A track with an inline camera
  // starts empty instead: every part on it has to have passed the camera.
  const n = def.inline ? 0 : Math.floor(def.track / def.pitch + 1e-9);
  const items = Array.from({ length: n }, (_, i): FeederItem => ({ x: i * def.pitch, uid: i, truth: null, measured: false, sr: null, eject: false }));
  return { id: def.id, items, nextIn: def.interval, fed: 0, jam: 0, nextUid: n, results: [] };
}

/**
 * Bowl feeder and its linear track. Parts move toward the pick point and queue there. On a track
 * with an inline camera (EM10), each part is measured as it passes the camera, and the air jet a
 * little further on blows it into the chute if the PLC has marked it for ejection.
 */
export function stepFeeder(p: PlantState, f: Feeder, def: FeederDef, cfg: LineConfig, rng: RngState, dt: number): void {
  // The operator clears a jam whether or not the line is running.
  if (f.jam > 0) f.jam = Math.max(0, f.jam - dt);
  if (!p.feedersOn) return;
  const inline = def.inline;
  for (let i = 0; i < f.items.length; i++) {
    const it = f.items[i];
    const min = i === 0 ? 0 : f.items[i - 1].x + def.pitch;
    it.x = Math.max(min, it.x - def.speed * dt);
    if (!inline) continue;
    if (!it.measured && it.x <= inline.at && it.truth !== null) {
      it.measured = true;
      f.results.push({ uid: it.uid, value: it.truth + normal(rng, 0, inline.inspect.noise), t: p.t });
    }
    // A part waits at the jet until the PLC has decided about it (it never has to with the
    // default timing), so no unchecked part gets past; a part marked for ejection is blown off there.
    if (it.measured && it.sr === null) it.x = Math.max(it.x, inline.jetAt);
    if (it.x <= inline.jetAt && it.eject) {
      f.items.splice(i--, 1);
      p.bins[inline.id] = (p.bins[inline.id] ?? 0) + 1;
    }
  }
  // A jammed bowl feeds nothing; the track drains until the operator clears it.
  if (f.jam > 0) return;
  f.nextIn -= dt;
  const last = f.items.at(-1);
  if (f.nextIn <= 0 && (last === undefined || last.x <= def.track - def.pitch)) {
    const q = inline ? cfg.quality[inline.inspect.key] : null;
    f.items.push({ x: def.track, uid: f.nextUid++, truth: q ? normal(rng, q.mean, q.sd) : null, measured: false, sr: null, eject: false });
    f.fed++;
    f.nextIn = def.interval * uniform(rng, 0.6, 1.4);
    if (cfg.faults.enabled && random(rng) < cfg.faults.feederJamPerPart) f.jam = repairTime(rng, cfg.faults.feederRepair);
  }
}

export function createNest(cfg: LineConfig, station: string): Nest {
  return { station, slots: new Array(cfg.nestSize).fill(1), changing: 0, count: 1 };
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
