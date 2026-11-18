// EM40's snap curve. The press pushes the housing over the pen for the last `stroke` mm while a
// load cell records force against displacement: the force climbs as the housing's clip rides up
// the detent, peaks where it snaps over, drops sharply as it engages, then climbs slowly while the
// housing seats and steeply once it bottoms out. The station judges the snap from the curve
// alone, as a real force monitor does: was there a clear drop, and did the peak come at the
// right force and in the right place?
import type { LineConfig } from './config';
import { type RngState, normal, random } from './rng';
import type { SnapResult } from './types';

/** Fraction of the peak the force has to fall by after it for the snap to count. */
const MIN_DROP = 0.15;
/** How far (mm) after the snap the force falls to its valley, and the valley as a share of the peak. */
const DROP_WIDTH = 0.35;
const VALLEY = 0.45;
/** Last part of the stroke (mm) where the housing bottoms out; peaks there aren't snaps. */
const BOTTOM = 0.6;

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * Records one press stroke of `duration` seconds. `peak` (N) and `position` (mm) are what the
 * sensor sees of this housing's snap; with `engages` false the clip never snaps over.
 */
export function snapCurve(cfg: LineConfig, rng: RngState, peak: number, position: number, duration: number, end: number): SnapResult {
  const { stroke, sampleHz, noise } = cfg.snap;
  const engages = random(rng) >= cfg.snap.noSnap;
  const n = Math.max(2, Math.round(duration * sampleHz));
  const force: number[] = [];
  const displacement: number[] = [];
  const valley = peak * VALLEY;
  for (let i = 0; i < n; i++) {
    const d = (stroke * i) / (n - 1);
    let f: number;
    if (d <= position || !engages) {
      // Climbing the detent; without a snap it just keeps climbing (housing jammed on the clip).
      f = peak * Math.pow(d / position, 1.4);
    } else if (d <= position + DROP_WIDTH) {
      const k = (d - position) / DROP_WIDTH;
      f = peak - (peak - valley) * k * k * (3 - 2 * k);
    } else {
      f = valley + 2.5 * (d - position - DROP_WIDTH);
    }
    // Bottoming out at the end of the stroke.
    const intoBottom = d - (stroke - BOTTOM);
    if (intoBottom > 0) f += 60 * intoBottom * intoBottom;
    force.push(round(Math.max(0, f + normal(rng, 0, noise)), 3));
    displacement.push(round(d, 4));
  }
  return { ...judge(cfg, force, displacement), force, displacement, interval: (duration * 1000) / (n - 1), end };
}

/** What the force monitor makes of a curve: peak, snap position, and whether it's a good snap. */
export function judge(cfg: LineConfig, force: number[], displacement: number[]): Pick<SnapResult, 'peak' | 'position' | 'accepted' | 'reason'> {
  const end = cfg.snap.stroke - BOTTOM;
  let at = 0;
  for (let i = 0; i < force.length && displacement[i] <= end; i++) if (force[i] > force[at]) at = i;
  const peak = force[at];
  const position = displacement[at];
  let low = peak;
  for (let i = at; i < force.length && displacement[i] <= displacement[at] + 2 * DROP_WIDTH; i++) low = Math.min(low, force[i]);
  const lim = cfg.stations.find((d) => d.snap)!.inspect!;
  const [from, to] = cfg.snap.position;
  let reason: string | null = null;
  if (peak <= 0 || (peak - low) / peak < MIN_DROP) reason = 'No snap detected';
  else if (peak > lim.upper) reason = lim.high ?? lim.cause;
  else if (peak < lim.lower) reason = lim.low ?? lim.cause;
  else if (position < from || position > to) reason = 'Snap position out of window';
  return { peak, position, accepted: reason === null, reason };
}
