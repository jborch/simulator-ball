// Physical effect of station work on the assembly in a mover's fixture: which parts it has,
// and its true quality (what inspections later measure, plus sensor noise).
import type { LineConfig, QualityKey, StationDef } from './config';
import { type RngState, normal, random } from './rng';
import type { CycleResult, Mover, Op, PlantState } from './types';

export function moverById(p: PlantState, id: number): Mover {
  return p.movers[id - 1];
}

function trueQuality(cfg: LineConfig, rng: RngState, key: QualityKey, m: Mover, fragile: boolean): number {
  const q = cfg.quality[key];
  let v = normal(rng, q.mean, q.sd) + m.profile.fixtureOffset * q.perMmOffset;
  if (fragile && 'fragileShift' in q) v += q.fragileShift;
  return v;
}

/** Applies a load/assemble/inspect op to the mover and returns what the station's sensors saw. */
export function applyOp(p: PlantState, cfg: LineConfig, rng: RngState, def: StationDef, op: Op, moverId: number): CycleResult {
  const m = moverById(p, moverId);
  switch (op.kind) {
    case 'load':
      // The laser marks the body after it is placed (see the robot's 'mark' step).
      m.load = { srId: op.srId, mark: '', parts: ['body'], quality: {}, fragile: 0 };
      return { measurement: null };
    case 'assemble': {
      const load = m.load;
      if (!load) return { measurement: null };
      for (const part of op.parts) {
        load.parts.push(part);
        if (part === 'spring') load.quality.springAngle = trueQuality(cfg, rng, 'springAngle', m, false);
        if (part === 'cartridge') load.quality.seatDepth = trueQuality(cfg, rng, 'seatDepth', m, op.fragile);
        if (part === 'housing') load.quality.snapForce = trueQuality(cfg, rng, 'snapForce', m, false);
      }
      if (op.fragile) load.fragile++;
      if (!op.measure) return { measurement: null };
      const truth = load.quality[op.measure];
      return { measurement: truth === undefined ? null : truth + normal(rng, 0, def.inspect?.noise ?? 0) };
    }
    case 'inspect': {
      const truth = m.load?.quality[op.measure];
      const measurement = truth === undefined ? null : truth + normal(rng, 0, op.noise);
      if (!op.readCode) return { measurement };
      const unreadable = !m.load || !m.load.mark || random(rng) < cfg.dataMatrix.readFailRate;
      return { measurement, code: unreadable ? null : m.load!.mark };
    }
    default:
      // Reject/unload are carried out by the station robot (pick from mover, drop to bin/tray).
      return { measurement: null };
  }
}
