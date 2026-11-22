// Small belt conveyors of the sub-lines (spring base distribution, tray line), in station-local
// coordinates (a along the conveyor, y up from the main belt surface, r outward): anodised side
// frames with a slot, end pulleys and end plates, a drive at one end, side guides with gaps where
// parts leave sideways, and profile stands down to the table with foot plates.
import * as THREE from 'three';
import { M, TABLE } from './build';
import { batch, block, finish, hardware, profile, round } from './hardware';
import { contactPatch } from './hall';

export interface MiniConveyorSpec {
  a0: number;
  a1: number;
  /** Centre line (station-local r). */
  r: number;
  /** Belt surface height. */
  y: number;
  /** Belt width. */
  width: number;
  /** Side frame height below the belt surface. */
  frame?: number;
  /** Side guides: clear width between them and height above the belt. */
  guide?: { gap: number; height: number; openings?: { a: number; side: -1 | 1; width: number }[] };
  /** Stand positions along a (profile legs to the table). */
  legs?: number[];
  /** Two belt strands under the load's edges instead of one belt. */
  strands?: number;
  /** End with the drive (a0 or a1) and which side its motor sits (-1 inner, +1 outer). */
  drive?: { end: 0 | 1; side: -1 | 1; scale?: number };
}

const belt = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.74 });

export function miniConveyor(c: MiniConveyorSpec): THREE.Group {
  const g = new THREE.Group();
  const { a0, a1, r, y, width } = c;
  const len = a1 - a0;
  const mid = (a0 + a1) / 2;
  const frame = c.frame ?? 0.03;
  const wall = 0.006;
  const half = width / 2 + 0.002 + wall / 2;
  // Belt (or strands) over end pulleys.
  if (c.strands) {
    for (const s of [-1, 1]) block(g, mid, y - 0.0015, -(r + s * (width / 2 - c.strands / 2)), len - 0.012, 0.003, c.strands, belt);
    block(g, mid, y - 0.008, -r, len - 0.03, 0.004, width - 2 * c.strands, finish.graphite);
  } else block(g, mid, y - 0.0015, -r, len - 0.012, 0.003, width, belt);
  for (const a of [a0 + 0.008, a1 - 0.008]) round(g, a, y - 0.0085, -r, 0.0075, width - 0.002, belt, 20).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const z = -(r + s * half);
    block(g, mid, y - frame / 2 + 0.003, z, len, frame, wall, M.frame);
    // Slot along the outer face of each side frame, and the end plates with pulley screws.
    block(g, mid, y - frame * 0.55, z - s * (wall / 2 + 0.0003), len - 0.02, 0.0032, 0.0008, finish.graphite);
    for (const a of [a0 - 0.002, a1 + 0.002]) {
      block(g, a, y - frame / 2 + 0.004, z, 0.004, frame + 0.004, wall + 0.003, finish.graphite);
      round(g, a + (a > mid ? -0.008 : 0.008), y - 0.0085, z - s * (wall / 2 + 0.0008), 0.0034, 0.0016, finish.zinc, 12).rotation.x = Math.PI / 2;
    }
  }
  // Side guides: flat bars on small posts, broken where parts are pushed off sideways.
  if (c.guide) {
    const { gap, height, openings = [] } = c.guide;
    for (const s of [-1, 1] as const) {
      const gr = r + s * (gap / 2 + 0.0015);
      const cuts = openings.filter((o) => o.side === s).sort((p, q) => p.a - q.a);
      let from = a0 + 0.004;
      for (const o of [...cuts, { a: a1 + 1, width: 0 }]) {
        const to = Math.min(a1 - 0.004, o.a - o.width / 2);
        if (to - from > 0.01) {
          block(g, (from + to) / 2, y + height / 2 + 0.002, -gr, to - from, height, 0.003, M.rail);
          for (let a = from + 0.03; a < to - 0.02; a += 0.14) {
            block(g, a, y + 0.002, -(gr + s * 0.0045), 0.01, 0.006, 0.006, finish.graphite);
            block(g, a, y - 0.004, -(r + s * (half + wall / 2 + 0.002)), 0.01, 0.012, 0.004, finish.graphite);
          }
        }
        from = o.a + o.width / 2;
      }
    }
  }
  // Stands: a profile leg under the centre, a cross block under both frames, a foot plate.
  for (const a of c.legs ?? []) {
    const under = y - frame + 0.003;
    block(g, a, under - 0.006, -r, 0.03, 0.012, 2 * half + wall, finish.graphite);
    if (under - 0.012 - TABLE > 0.02) profile(g, [a, TABLE + 0.008, -r], [a, under - 0.012, -r], 0.025);
    block(g, a, TABLE + 0.004, -r, 0.06, 0.008, 0.05, finish.graphite);
    for (const dz of [-0.017, 0.017]) round(g, a - 0.02, TABLE + 0.0085, -r + dz, 0.0032, 0.001, finish.zinc, 10);
    contactPatch(g, a, TABLE + 0.0009, -r, 0.11, 0.1);
  }
  if (c.drive) {
    const { end, side, scale = 0.6 } = c.drive;
    const a = end ? a1 - 0.008 : a0 + 0.008;
    const motor = hardware('Servo', a, y - 0.0085, -(r + side * (half + wall / 2 + 0.002)));
    motor.scale.setScalar(scale);
    motor.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(motor);
  }
  batch(g);
  return g;
}
