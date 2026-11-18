// Sub-lines off the mover loop that feed UN01: the spring track with its inline check (EM10), the
// spring base orienter (EM13) and the distribution conveyor that brings spring bases to the four
// EM14 presses. The plant side moves parts and takes measurements; the PLC side gives each part
// its SR id, records the inspection and decides where the part goes (shift-register tracking).
import { raise } from './alarms';
import type { LineConfig, SubProcessDef } from './config';
import { nextFailure } from './devices';
import { emit, now, subProcessId } from './machine';
import { evaluate } from './records';
import { type RngState, normal } from './rng';
import type { Distribution, Orienter, PlantState, SimState } from './types';

export function createOrienter(): Orienter {
  return { item: null, phase: 'idle', mechLeft: 0, fixedLeft: 0, start: 0, nextFault: null, result: null, pass: null };
}

export function createDistribution(cfg: LineConfig): Distribution {
  return { items: [], cups: cfg.distribution.stations.map((station) => ({ station, sr: null, full: false, filling: 0 })) };
}

/** The orienter takes a part off its track, turns and measures it, then sends it on or to the chute. */
export function stepOrienter(p: PlantState, cfg: LineConfig, rng: RngState, dt: number): void {
  const def = cfg.orienter;
  const o = p.orienter;
  // It stops with the line, mid-part if need be, and carries on when the line restarts; it
  // also stops on a fault until repaired. Faults come with operating time.
  if (!p.feedersOn || p.alarms.orienter > 0) return;
  // (Drawn only with faults on, so a run without faults keeps its random sequence.)
  if (cfg.faults.enabled && o.nextFault === null) o.nextFault = nextFailure(rng, cfg.faults.orienterMtbf);
  if (cfg.faults.enabled && o.phase !== 'idle' && o.nextFault !== null) {
    o.nextFault -= dt;
    if (o.nextFault <= 0) {
      o.nextFault = nextFailure(rng, cfg.faults.orienterMtbf);
      raise(p, cfg, rng, 'orienter');
      return;
    }
  }
  switch (o.phase) {
    case 'idle': {
      const f = p.feeders.find((x) => x.id === def.feeder)!;
      if (f.items[0]?.x !== 0) return;
      f.items.shift();
      const q = cfg.quality[def.inspect.key];
      o.item = { truth: normal(rng, q.mean, q.sd), sr: null };
      o.start = p.t;
      o.mechLeft = def.mech;
      o.fixedLeft = def.fixed;
      o.phase = 'turning';
      return;
    }
    case 'turning':
      o.mechLeft -= dt * p.speed;
      if (o.mechLeft <= 0) o.phase = 'measuring';
      return;
    case 'measuring':
      o.fixedLeft -= dt;
      if (o.fixedLeft > 0) return;
      o.result = o.item!.truth + normal(rng, 0, def.inspect.noise);
      o.pass = null;
      o.phase = 'decide';
      return;
    case 'decide':
      if (o.pass === null) return;
      if (!o.pass) {
        p.bins[def.id] = (p.bins[def.id] ?? 0) + 1;
        o.item = null;
        o.phase = 'idle';
        return;
      }
      o.phase = 'out';
      return;
    case 'out': {
      // Push onto the conveyor once there's room at its start.
      const d = p.distribution;
      const entry = cfg.distribution.from;
      if (d.items.some((it) => it.x < entry + cfg.distribution.pitch)) return;
      d.items.push({ x: entry, sr: o.item!.sr });
      o.item = null;
      o.phase = 'idle';
      return;
    }
  }
}

/**
 * Parts ride the conveyor toward the end stop and queue there. A part passing an empty cup's
 * diverter is pushed into the cup; the cup is ready once the push is done.
 */
export function stepDistribution(p: PlantState, cfg: LineConfig, dt: number): void {
  const def = cfg.distribution;
  const d = p.distribution;
  const cupAt = def.stations.map((id) => cfg.stations.find((s) => s.id === id)!.s);
  for (const c of d.cups) {
    if (c.filling > 0) {
      c.filling -= dt;
      if (c.filling <= 0) {
        c.filling = 0;
        c.full = true;
      }
    }
  }
  if (!p.feedersOn) return;
  const end = Math.max(...cupAt);
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i];
    const max = i === 0 ? end : d.items[i - 1].x - def.pitch;
    const before = it.x;
    it.x = Math.min(max, it.x + def.speed * dt);
    // The diverter acts on a part anywhere in its window during this step, however far it moved.
    const k = cupAt.findIndex((x) => before <= x + def.pitch / 2 && it.x >= x - def.pitch / 2);
    const cup = d.cups[k];
    if (cup && !cup.full && cup.filling === 0 && cup.sr === null) {
      cup.sr = it.sr;
      cup.filling = def.divert;
      d.items.splice(i--, 1);
    }
  }
}

/** Sub-line inspections: SR ids, records and eject decisions for EM10 and EM13. */
export function scanSublines(s: SimState, cfg: LineConfig): void {
  const { plant, plc } = s;
  cfg.feeders.forEach((def, i) => {
    const inline = def.inline;
    const f = plant.feeders[i];
    if (!inline) return;
    for (const r of f.results) {
      const item = f.items.find((it) => it.uid === r.uid);
      const sr = ++plc.srCounter;
      const at = s.epochMs + r.t * 1000;
      const passed = record(s, cfg, inline, sr, def.part, r.value, at - inline.exposure * 1000, at);
      if (item) {
        item.sr = sr;
        item.eject = !passed;
      }
    }
    f.results = [];
  });
  const o = plant.orienter;
  if (o.phase === 'decide' && o.pass === null) {
    const sr = ++plc.srCounter;
    o.item!.sr = sr;
    o.pass = record(s, cfg, cfg.orienter, sr, 'springBase', o.result, s.epochMs + o.start * 1000, now(s));
  }
}

/** Reports a sub-line inspection on the part. Returns whether it passed. */
function record(s: SimState, cfg: LineConfig, def: SubProcessDef, sr: number, part: string, value: number | null, from: number, to: number): boolean {
  const ev = evaluate(def.inspect, value, s.rng);
  const itemType = part[0].toUpperCase() + part.slice(1);
  emit(s, { kind: 'processed', process: subProcessId(cfg, def), scopedId: sr, itemType, from, to, result: ev.passed ? 'Passed' : 'Failed', properties: ev.props });
  return ev.passed;
}
