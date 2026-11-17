// Physical effect of station work on the assembly in a mover's fixture: which parts it has,
// and its true quality (what inspections later measure, plus sensor noise).
import type { LineConfig, QualityKey, StationDef } from './config';
import { type RngState, normal, random } from './rng';
import type { CycleResult, InspectOp, Mover, PlaceOp, PlantState } from './types';

export function moverById(p: PlantState, id: number): Mover {
  return p.movers[id - 1];
}

function trueQuality(cfg: LineConfig, rng: RngState, key: QualityKey, m: Mover, fragile: boolean): number {
  const q = cfg.quality[key];
  let v = normal(rng, q.mean, q.sd) + m.profile.fixtureOffset * q.perMmOffset;
  if (fragile && 'fragileShift' in q) v += q.fragileShift;
  return v;
}

/**
 * A robot puts parts on the mover. Returns what the station measured while doing so, or null if
 * there was nothing to assemble onto (empty fixture) and the parts fell off.
 */
export function placeOnMover(p: PlantState, cfg: LineConfig, rng: RngState, def: StationDef, op: PlaceOp, moverId: number): CycleResult | null {
  const m = moverById(p, moverId);
  if (op.kind === 'load') {
    // The laser marks the body after it is placed (see the station's laser in plant.ts).
    m.load = { srId: op.srId, mark: '', parts: ['body'], quality: {}, fragile: 0 };
    return { measurement: null };
  }
  const load = m.load;
  if (!load) return null;
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

/** An inspection camera looks at the mover: measures quality and, if asked, reads the DataMatrix. */
export function inspectMover(p: PlantState, cfg: LineConfig, rng: RngState, op: InspectOp, moverId: number): CycleResult {
  const load = moverById(p, moverId).load;
  const truth = load?.quality[op.measure];
  const measurement = truth === undefined ? null : truth + normal(rng, 0, op.noise);
  if (!op.readCode) return { measurement };
  const unreadable = !load || !load.mark || random(rng) < cfg.dataMatrix.readFailRate;
  return { measurement, code: unreadable ? null : load.mark };
}
