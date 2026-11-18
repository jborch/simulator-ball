// Physical effect of station work on the assembly in a mover's fixture: which parts it has,
// and its true quality (what inspections later measure, plus sensor noise).
import type { LineConfig, PartType, QualityKey, StationDef } from './config';
import { type RngState, normal, random } from './rng';
import { snapCurve } from './snap';
import type { CycleResult, InspectOp, Load, Mover, PlaceOp, PlantState } from './types';

export function moverById(p: PlantState, id: number): Mover {
  return p.movers[id - 1];
}

/** What placing each part settles about the pen's quality (what later inspections measure). */
const SETTLES: Partial<Record<PartType, QualityKey[]>> = {
  spring: ['springAngle'],
  springBase: ['seatForce', 'hook'],
  cartridge: ['seatDepth'],
  housing: ['snapForce', 'snapPosition'],
};

/** True value of a quality: the station's own (mean, σ) where it has one, plus the mover's fixture bias. */
function trueQuality(cfg: LineConfig, rng: RngState, key: QualityKey, m: Mover, own?: { mean: number; sd: number }): number {
  const q = cfg.quality[key];
  const { mean, sd } = own ?? q;
  return normal(rng, mean, sd) + m.profile.fixtureOffset * q.perMmOffset;
}

/**
 * A sensor's reading of a quality of the pen: true value plus noise, shifted down by every pass
 * through a fragile station and by the mover's badness (the original line's rule: 0.15 σ each).
 */
function measure(cfg: LineConfig, rng: RngState, m: Mover, load: Load, key: QualityKey, noise: number): number | null {
  const truth = load.quality[key];
  if (truth === undefined) return null;
  return truth + normal(rng, 0, noise) - (load.fragile + m.profile.badness) * cfg.fragileShift * cfg.quality[key].sd;
}

/** The press stroke a robot just did: how long it actually ran and when it ended (sim time). */
export interface Stroke {
  duration: number;
  end: number;
}

/** EM40 records the press stroke it just did, sampled over the time the stroke really took. */
function recordSnap(cfg: LineConfig, rng: RngState, m: Mover, load: Load, stroke: Stroke): CycleResult {
  const peak = measure(cfg, rng, m, load, 'snapForce', 0)!;
  const position = measure(cfg, rng, m, load, 'snapPosition', 0)!;
  const snap = snapCurve(cfg, rng, peak, position, stroke.duration, stroke.end);
  return { measurement: snap.peak, snap };
}

/**
 * A robot puts parts on the mover. Returns what the station measured while doing so, or null if
 * there was nothing to assemble onto (empty fixture) and the parts fell off.
 */
export function placeOnMover(
  p: PlantState,
  cfg: LineConfig,
  rng: RngState,
  def: StationDef,
  op: PlaceOp,
  moverId: number,
  label?: string,
  stroke: Stroke = { duration: 0, end: p.t },
): CycleResult | null {
  const m = moverById(p, moverId);
  if (op.kind === 'load') {
    m.load = { srId: op.srId, mark: '', parts: ['body'], quality: {}, fragile: 0 };
    return { measurement: null };
  }
  const load = m.load;
  if (!load) return null;
  // A labelled housing brings the pen's printed identifier with it.
  if (label) load.mark = label;
  for (const part of op.parts) {
    load.parts.push(part);
    for (const key of SETTLES[part] ?? []) {
      load.quality[key] = trueQuality(cfg, rng, key, m, key === def.inspect?.key ? def.quality : undefined);
    }
  }
  let result: CycleResult = { measurement: null };
  if (op.measure && def.snap) result = recordSnap(cfg, rng, m, load, stroke);
  else if (op.measure) result = { measurement: measure(cfg, rng, m, load, op.measure, def.inspect?.noise ?? 0) };
  // A fragile station's own measurement isn't affected; everything after it is.
  if (op.fragile) load.fragile++;
  return result;
}

/** An inspection camera looks at the mover: measures quality and, if asked, reads the DataMatrix. */
export function inspectMover(p: PlantState, cfg: LineConfig, rng: RngState, op: InspectOp, moverId: number): CycleResult {
  const m = moverById(p, moverId);
  const load = m.load;
  const measurement = load ? measure(cfg, rng, m, load, op.measure, op.noise) : null;
  if (!op.readCode) return { measurement };
  const unreadable = !load || !load.mark || random(rng) < cfg.dataMatrix.readFailRate;
  return { measurement, code: unreadable ? null : load.mark };
}
