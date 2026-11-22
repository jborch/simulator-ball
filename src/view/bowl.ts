// Layout of the housing bowl feeder (EM30): the bowl's stepped helical track, the loose housings
// in its well, the single file climbing the track lying down, the up-ending section and the
// upright queue in the guided discharge. Pure geometry (no DOM), so the non-overlap rules are
// tested in bowl.test.ts against the same capsules the layout is built with.
//
// Frame: origin at the centre of the bowl floor, y up. The track climbs counter-clockwise seen
// from above (increasing atan2(z, x)) and leaves the bowl at angle 0 along +z, at radius
// BOWL.exit, onto a straight discharge tongue that butts onto the linear feeder at z = 0.13.
import * as THREE from 'three';

/** A feature standing proud of the round shell on one side (the pocket clip, the label land):
 * enclosed by a capsule whose axis runs parallel to the housing's, `off` out along `dir`. */
export interface Lug {
  dir: THREE.Vector3;
  off: number;
  r: number;
  y0: number;
  y1: number;
}

/** Collision envelope of a housing in its own frame (origin at the base, axis +y). */
export interface HousingEnvelope {
  /** Radius of the round shell (with its print, collar and window) and length. */
  R: number;
  L: number;
  /** The clip first: its direction is the reference for a part's roll about its axis. */
  lugs: Lug[];
}

/** The housing model (tools/blender/parts.py, as measured by measureHousing). */
export const HOUSING_ENVELOPE: HousingEnvelope = {
  R: 0.00885,
  L: 0.12,
  lugs: [
    { dir: new THREE.Vector3(0, 0, -1), off: 0.00955, r: 0.00254, y0: 0.0525, y1: 0.0875 },
    { dir: new THREE.Vector3(0.65925, 0, 0.75193), off: 0.00834, r: 0.00365, y0: 0.017, y1: 0.057 },
    { dir: new THREE.Vector3(-0.65925, 0, 0.75193), off: 0.00834, r: 0.00365, y0: 0.017, y1: 0.057 },
  ],
};

/** Enclosing capsule of plan points along the best offset from the axis. */
function fitLug(points: THREE.Vector3[]): Lug {
  const box = new THREE.Box3().setFromPoints(points);
  const c = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(c.x, 0, c.z).normalize();
  const reach = Math.max(...points.map((p) => p.x * dir.x + p.z * dir.z));
  let best = { off: 0, r: Infinity };
  for (let i = 0; i <= 100; i++) {
    const off = (reach * i) / 100;
    const r = Math.max(...points.map((p) => Math.hypot(p.x - dir.x * off, p.z - dir.z * off)));
    if (r < best.r) best = { off, r };
  }
  return { dir, off: best.off, r: best.r, y0: box.min.y, y1: box.max.y };
}

/** Measures the envelope from the visible meshes of a housing: the round shell, and as lugs the
 * meshes named *clip* (first) and *land*. */
export function measureHousing(part: THREE.Object3D): HousingEnvelope {
  part.updateMatrixWorld(true);
  const inv = part.matrixWorld.clone().invert();
  let R = 0;
  let L = 0;
  const clip: THREE.Vector3[] = [];
  const land: THREE.Vector3[] = [];
  part.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const name = o.name || o.parent?.name || '';
    const into = /clip/i.test(name) ? clip : /land/i.test(name) ? land : null;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m);
      if (into) into.push(v);
      else R = Math.max(R, Math.hypot(v.x, v.z));
      L = Math.max(L, v.y);
    }
  });
  if (!R || !clip.length) return HOUSING_ENVELOPE;
  const lugs = [fitLug(clip)];
  // The flat land only stands proud of the round shell at its two edges: one lug per edge.
  const proud = land.filter((v) => Math.hypot(v.x, v.z) > R + 1e-6);
  if (proud.length) {
    const c = new THREE.Box3().setFromPoints(proud).getCenter(new THREE.Vector3());
    const across = new THREE.Vector3(-c.z, 0, c.x);
    for (const side of [-1, 1]) {
      const edge = proud.filter((v) => side * v.dot(across) > 0);
      if (edge.length) lugs.push(fitLug(edge));
    }
  }
  return { R, L, lugs };
}

/** Furthest the envelope reaches from the axis. */
export const reach = (env: HousingEnvelope) => Math.max(env.R, ...env.lugs.map((l) => l.off + l.r));

export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

/** Shortest distance between 3D segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistance3(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const eps = 1e-12;
  let s: number;
  let t: number;
  if (a <= eps && e <= eps) return p1.distanceTo(p2);
  if (a <= eps) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= eps) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > eps ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Clearance between capsules (negative when they overlap). */
export function capsuleGap(x: Capsule, y: Capsule): number {
  return segmentDistance3(x.a, x.b, y.a, y.b) - x.r - y.r;
}

/** The shell and lug capsules of a housing placed with `m` (conservative: the caps cover the flat ends). */
export function housingCapsules(env: HousingEnvelope, m: THREE.Matrix4): Capsule[] {
  const at = (v: THREE.Vector3) => v.clone().applyMatrix4(m);
  return [
    { a: at(new THREE.Vector3(0, 0, 0)), b: at(new THREE.Vector3(0, env.L, 0)), r: env.R },
    ...env.lugs.map((l) => {
      const o = l.dir.clone().multiplyScalar(l.off);
      return { a: at(o.clone().setY(l.y0)), b: at(o.clone().setY(l.y1)), r: l.r };
    }),
  ];
}

/** Plan radius of a point. */
export const planRadius = (p: THREE.Vector3) => Math.hypot(p.x, p.z);

/** Bowl dimensions (m). */
export const BOWL = {
  /** Inside of the cylindrical wall, the rim top and the rolled lip's outer radius. */
  wall: 0.2075,
  rim: 0.093,
  lip: 0.2155,
  /** Inner edge of the helical ledge, its thickness and the retaining bead on its edge. */
  lane: 0.175,
  ledge: 0.006,
  bead: 0.003,
  /** The track starts at the floor at angle `start`, climbs to `top` at angle `level` and runs level to the exit. */
  start: -2 * Math.PI * 1.42,
  level: -1.3,
  bottom: 0.0035,
  top: 0.083,
  /** Centreline radius of the upright queue (and of the lying parts' chord ends). */
  exit: 0.198,
  /** Loose parts stay inside this radius, clear of the ledge. */
  well: 0.169,
  /** End of the discharge tongue (the linear feeder starts at 0.13). */
  tongue: 0.134,
};

/** Bowl floor height at plan radius rho: a shallow centre cone and a flat ring to the wall. */
const FLOOR: [number, number][] = [
  [0, 0.016],
  [0.045, 0.007],
  [0.11, 0.0025],
  [BOWL.wall - 0.004, 0.002],
  [BOWL.wall, 0.006],
];
export const floorProfile = (): [number, number][] => FLOOR.map(([r, y]) => [r, y]);
export function floorAt(rho: number): number {
  for (let i = 1; i < FLOOR.length; i++) {
    const [r1, y1] = FLOOR[i];
    if (rho <= r1) {
      const [r0, y0] = FLOOR[i - 1];
      return y0 + ((Math.max(rho, r0) - r0) / (r1 - r0)) * (y1 - y0);
    }
  }
  return FLOOR[FLOOR.length - 1][1];
}
/** Steepest floor slope, for the clearance of a sphere resting on it. */
const FLOOR_SLOPE = Math.sqrt(1 + 0.2 ** 2);

/** Track (ledge top) height at angle theta (start..0). */
export function laneAt(theta: number): number {
  if (theta >= BOWL.level) return BOWL.top;
  const u = Math.max(0, (theta - BOWL.start) / (BOWL.level - BOWL.start));
  return BOWL.bottom + u * (BOWL.top - BOWL.bottom);
}
/** Rise of the track per turn. */
export const PITCH = ((BOWL.top - BOWL.bottom) * 2 * Math.PI) / (BOWL.level - BOWL.start);

/** The angle (start..0) of a plan point on the track; points a turn up are found by `turn`. */
function laneAngle(x: number, z: number, near: number): number {
  let a = Math.atan2(z, x);
  while (a > near + Math.PI) a -= 2 * Math.PI;
  while (a < near - Math.PI) a += 2 * Math.PI;
  return a;
}

/** Discharge centreline: arc of radius BOWL.exit for s ≤ 0 (s = arc length to the exit), then straight along +z. */
export function dischargeAt(s: number): { p: THREE.Vector2; t: THREE.Vector2; n: THREE.Vector2 } {
  if (s > 0) return { p: new THREE.Vector2(BOWL.exit, s), t: new THREE.Vector2(0, 1), n: new THREE.Vector2(1, 0) };
  const a = s / BOWL.exit;
  return {
    p: new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(BOWL.exit),
    t: new THREE.Vector2(-Math.sin(a), Math.cos(a)),
    n: new THREE.Vector2(Math.cos(a), Math.sin(a)),
  };
}

export interface BowlLayout {
  /** Loose housings in the well (for the circulating stock group). */
  pile: THREE.Matrix4[];
  /** Housings lying on the track, the one being up-ended, and the upright queue. */
  lying: THREE.Matrix4[];
  tipping: THREE.Matrix4[];
  upright: THREE.Matrix4[];
  /** Up-ending ramp wire (rod radius RAMP_R): from the track up under the tipping part, then in and down to the ledge. */
  ramp: THREE.Vector3[];
  /** Fixtures the parts must clear (ramp, guide rails and posts), as capsules. */
  fixtures: Capsule[];
  /** Arc length where the guides start (just behind the last upright housing). */
  guideStart: number;
  /** Guide geometry: rail heights above the track, lateral offsets of rails and posts, post positions. */
  rails: { paths: THREE.Vector3[][]; r: number; postOffset: number; postR: number; posts: { s: number; side: number; y0: number }[] };
  /** Low guide strips either side of the upright queue (inside from guideStart, outside from the exit). */
  strips: { side: number; s0: number; s1: number; offset: number; thickness: number; height: number }[];
}

export const RAMP_R = 0.0018;
const CLEAR = 0.0006;

/** Basis: local +y onto `d`, local clip direction onto `u` (u ⟂ d), origin at `base`. */
function orient(env: HousingEnvelope, base: THREE.Vector3, d: THREE.Vector3, u: THREE.Vector3): THREE.Matrix4 {
  const y = new THREE.Vector3(0, 1, 0);
  const c = env.lugs[0].dir.clone();
  const local = new THREE.Matrix4().makeBasis(c, y, c.clone().cross(y));
  const world = new THREE.Matrix4().makeBasis(u, d, u.clone().cross(d));
  return world.multiply(local.transpose()).setPosition(base);
}

/** Unit vector ⟂ d in the vertical plane through d, pointing up (straight up for a vertical d: any). */
function upPerp(d: THREE.Vector3): THREE.Vector3 {
  const up = new THREE.Vector3(0, 1, 0);
  const v = up.clone().addScaledVector(d, -up.dot(d));
  return v.lengthSq() < 1e-10 ? new THREE.Vector3(1, 0, 0) : v.normalize();
}

/**
 * Height a sphere of radius r at plan point (x, z) must have its centre at to clear `others` by
 * CLEAR, dropping onto them from above. The other capsules are sampled every 1.5 mm.
 */
function clearHeight(x: number, z: number, r: number, others: Capsule[]): number {
  let y = -Infinity;
  for (const o of others) {
    const D = r + o.r + CLEAR * 1.5;
    const ax = o.b.x - o.a.x;
    const az = o.b.z - o.a.z;
    const len2 = ax * ax + az * az;
    const t = len2 > 0 ? THREE.MathUtils.clamp(((x - o.a.x) * ax + (z - o.a.z) * az) / len2, 0, 1) : 0;
    if (Math.hypot(o.a.x + ax * t - x, o.a.z + az * t - z) >= D) continue;
    // Only the stretch of the other axis within D of the point in plan can matter.
    const lenP = Math.sqrt(len2);
    const free = len2 > 0 ? ((x - o.a.x) * ax + (z - o.a.z) * az) / len2 : 0;
    const span = lenP > 0 ? D / lenP : 1;
    const u0 = Math.max(0, free - span);
    const u1 = Math.min(1, free + span);
    const n = Math.max(2, Math.ceil(((u1 - u0) * o.a.distanceTo(o.b)) / 0.0015));
    for (let i = 0; i <= n; i++) {
      const k = u0 + ((u1 - u0) * i) / n;
      const qx = o.a.x + ax * k;
      const qz = o.a.z + az * k;
      const d2 = (qx - x) ** 2 + (qz - z) ** 2;
      if (d2 < D * D) y = Math.max(y, o.a.y + (o.b.y - o.a.y) * k + Math.sqrt(D * D - d2));
    }
  }
  return y;
}

/**
 * Settles a straight housing whose axis runs in plan from a toward b (b is re-solved so the 3D
 * length is L) onto `ground` and the `others`: the axis heights are the lowest line over the
 * required heights along it that holds the centre of mass (the concave envelope at the middle),
 * so the part rests on supports either side of its middle. `roll` gives the clip direction for
 * an axis direction. Returns the placement or null if the rest is steeper than maxTilt.
 */
function settle(
  env: HousingEnvelope,
  a: THREE.Vector2,
  heading: THREE.Vector2,
  ground: (x: number, z: number, r: number) => number,
  others: Capsule[],
  roll: (d: THREE.Vector3) => THREE.Vector3,
  maxTilt: number,
): THREE.Matrix4 | null {
  const K = 32;
  // Only capsules near the part's plan footprint can hold it up.
  const pad = reach(env) + Math.max(env.R, ...others.map((o) => o.r)) + 2 * CLEAR;
  const x0 = Math.min(a.x, a.x + heading.x * env.L) - pad;
  const x1 = Math.max(a.x, a.x + heading.x * env.L) + pad;
  const z0 = Math.min(a.y, a.y + heading.y * env.L) - pad;
  const z1 = Math.max(a.y, a.y + heading.y * env.L) + pad;
  others = others.filter((o) => Math.max(o.a.x, o.b.x) > x0 && Math.min(o.a.x, o.b.x) < x1 && Math.max(o.a.z, o.b.z) > z0 && Math.min(o.a.z, o.b.z) < z1);
  let tilt = 0;
  let y0 = 0;
  let y1 = 0;
  for (let iter = 0; iter < 3; iter++) {
    const lp = env.L * Math.cos(tilt);
    const d = new THREE.Vector3(heading.x * Math.cos(tilt), Math.sin(tilt), heading.y * Math.cos(tilt));
    const rot = orient(env, new THREE.Vector3(), d, roll(d));
    const lugs = env.lugs.map((l) => ({ ...l, w: l.dir.clone().multiplyScalar(l.off).applyMatrix4(rot) }));
    const h: number[] = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const x = a.x + heading.x * lp * t;
      const z = a.y + heading.y * lp * t;
      let need = Math.max(ground(x, z, env.R), clearHeight(x, z, env.R, others));
      const along = env.L * t;
      for (const l of lugs) {
        if (along < l.y0 - l.r || along > l.y1 + l.r) continue;
        const cx = x + l.w.x;
        const cz = z + l.w.z;
        need = Math.max(need, ground(cx, cz, l.r) - l.w.y, clearHeight(cx, cz, l.r, others) - l.w.y);
      }
      h.push(need);
    }
    // Concave envelope at the middle: the best line through a support on each side.
    let best = -Infinity;
    let line: [number, number] = [0, 0];
    const mid = K / 2;
    for (let i = 0; i <= mid; i++)
      for (let j = mid; j <= K; j++) {
        if (i === j) {
          if (h[i] > best) {
            best = h[i];
            line = [h[i], h[i]];
          }
          continue;
        }
        const ti = i / K;
        const tj = j / K;
        const v = h[i] + ((h[j] - h[i]) * (0.5 - ti)) / (tj - ti);
        if (v > best) {
          best = v;
          const slope = (h[j] - h[i]) / (tj - ti);
          line = [v - slope * 0.5, v + slope * 0.5];
        }
      }
    // Same line, with a flat line (a part flat on one support) when both sides agree.
    [y0, y1] = line;
    const nextTilt = Math.asin(THREE.MathUtils.clamp((y1 - y0) / env.L, -1, 1));
    if (Math.abs(nextTilt - tilt) < 1e-4) {
      tilt = nextTilt;
      break;
    }
    tilt = nextTilt;
  }
  if (Math.abs(tilt) > maxTilt) return null;
  const d = new THREE.Vector3(heading.x * Math.cos(tilt), Math.sin(tilt), heading.y * Math.cos(tilt));
  // A tiny lift keeps the settled line strictly clear of what it rests on.
  return orient(env, new THREE.Vector3(a.x, y0 + 0.0002, a.y), d, roll(d));
}

/** Lowest points of the (flat-ended) shell along its length: on the bottom line of the cylinder. */
export function shellBottom(env: HousingEnvelope, m: THREE.Matrix4, samples = 24): THREE.Vector3[] {
  const base = new THREE.Vector3().setFromMatrixPosition(m);
  const d = new THREE.Vector3(0, 1, 0).transformDirection(m);
  const down = upPerp(d).negate();
  const out: THREE.Vector3[] = [];
  for (let k = 0; k <= samples; k++) out.push(base.clone().addScaledVector(d, (env.L * k) / samples).addScaledVector(down, env.R));
  return out;
}

/** Points on the shell's surface (rings along the axis), for the wall and floor checks. */
export function shellPoints(env: HousingEnvelope, m: THREE.Matrix4, rings = 12, around = 12): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j < around; j++) {
      const a = (j / around) * Math.PI * 2;
      out.push(new THREE.Vector3(Math.cos(a) * env.R, (env.L * i) / rings, Math.sin(a) * env.R).applyMatrix4(m));
    }
  return out;
}

const groundFloor = (x: number, z: number, r: number) => floorAt(Math.hypot(x, z)) + r * FLOOR_SLOPE;

/** Lays out the bowl: deterministic (seeded), so every viewer sees the same feeder. */
export function housingBowlLayout(env: HousingEnvelope = HOUSING_ENVELOPE): BowlLayout {
  let seed = 3412;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const fixed: Capsule[] = [];
  const parts: Capsule[] = [];
  const fits = (caps: Capsule[], against: Capsule[]) => caps.every((c) => against.every((o) => capsuleGap(c, o) >= CLEAR));
  const top = BOWL.top;
  const up = new THREE.Vector3(0, 1, 0);

  // Upright queue: bases on the track and the tongue, one pitch apart, clips trailing.
  // Pitch: the closest the trailing clip and the leading land of neighbours allow.
  const standing = (x: number, z: number) => orient(env, new THREE.Vector3(x, 0, z), up, new THREE.Vector3(0, 0, -1));
  let pitch = 2 * env.R;
  while (!fits(housingCapsules(env, standing(0, 0)), housingCapsules(env, standing(0, pitch)))) pitch += 0.0002;
  pitch += 0.0006;
  // Sideways reach of the upright queue, for the guides.
  const lateral = Math.max(...housingCapsules(env, standing(0, 0)).map((c) => Math.max(Math.abs(c.a.x), Math.abs(c.b.x)) + c.r));
  const upright: THREE.Matrix4[] = [];
  const first = BOWL.tongue - 0.0255;
  let last = first;
  for (let k = 0; k < 9; k++) {
    const s = first - k * pitch;
    const { p, t } = dischargeAt(s);
    const m = orient(env, new THREE.Vector3(p.x, top + 0.0002, p.y), up, new THREE.Vector3(-t.x, 0, -t.y));
    upright.push(m);
    parts.push(...housingCapsules(env, m));
    last = s;
  }

  // Guides along the discharge: two rails each side from just behind the last upright part, on
  // posts standing on the ledge (inside), the rim (outside, where the wall is closed) and the tongue.
  const railHeights = [0.052, 0.0864];
  const railOff = lateral + 0.0012 + 0.0022;
  const railR = 0.0022;
  const postOff = railOff + 0.0035;
  const postR = 0.0025;
  const guideStart = last - 0.006;
  const posts: { s: number; side: number; y0: number }[] = [];
  for (const side of [-1, 1]) {
    const along = [guideStart, (guideStart + 0) / 2 - 0.01, 0.07];
    for (const s of along) {
      // Outside, the rim is open over the tongue's exit (angles -0.04..0.34).
      if (side > 0 && s > -0.012 && s <= 0) continue;
      const y0 = s > 0 ? top : side < 0 ? top : BOWL.rim;
      posts.push({ s, side, y0 });
    }
  }
  const railPath = (side: number, h: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    const start = dischargeAt(guideStart);
    // Start inside the end post.
    pts.push(new THREE.Vector3(start.p.x + start.n.x * side * postOff, top + h, start.p.y + start.n.y * side * postOff));
    for (let s = guideStart + 0.006; s <= BOWL.tongue + 0.003; s += 0.006) {
      const { p, n } = dischargeAt(Math.min(s, BOWL.tongue + 0.003));
      pts.push(new THREE.Vector3(p.x + n.x * side * railOff, top + h, p.y + n.y * side * railOff));
    }
    return pts;
  };
  const railCaps = (pts: THREE.Vector3[]) => pts.slice(1).map((b, i) => ({ a: pts[i], b, r: railR }));
  const railPaths = [-1, 1].flatMap((side) => railHeights.map((h) => railPath(side, h)));
  for (const path of railPaths) fixed.push(...railCaps(path));
  // Low guide strips (as on the linear feeder), approximated by capsules along their faces.
  const strips = [-1, 1].map((side) => ({ side, s0: side < 0 ? guideStart : 0, s1: BOWL.tongue + 0.003, offset: lateral + 0.0018, thickness: 0.002, height: 0.028 }));
  for (const st of strips)
    for (let s = st.s0; s < st.s1; s += 0.004) {
      const at = (q: number, h: number) => {
        const { p, n } = dischargeAt(q);
        return new THREE.Vector3(p.x + n.x * st.side * st.offset, top + h, p.y + n.y * st.side * st.offset);
      };
      for (const h of [0.004, 0.014, st.height - 0.001]) fixed.push({ a: at(s, h), b: at(Math.min(s + 0.004, st.s1), h), r: st.thickness / 2 });
    }
  for (const post of posts) {
    const { p, n } = dischargeAt(post.s);
    const x = p.x + n.x * post.side * postOff;
    const z = p.y + n.y * post.side * postOff;
    fixed.push({ a: new THREE.Vector3(x, post.y0, z), b: new THREE.Vector3(x, top + railHeights[1] + 0.003, z), r: postR });
  }

  // The part being up-ended: its trailing end on the track, its leading end lifted by the ramp
  // wire, which then turns in and down to the ledge. Slide it back until it clears the queue.
  const beta = 0.68;
  const tipping: THREE.Matrix4[] = [];
  let ramp: THREE.Vector3[] = [];
  let tipRear = 0;
  for (let s = last - 0.07; s > last - 0.3; s -= 0.002) {
    const c = dischargeAt(s).p;
    const reach = env.R * Math.sin(beta) + env.L * Math.cos(beta);
    const ahead = dischargeAt(s + 2 * BOWL.exit * Math.asin(reach / 2 / BOWL.exit)).p;
    const dh = ahead.clone().sub(c).normalize();
    const d = new THREE.Vector3(dh.x * Math.cos(beta), Math.sin(beta), dh.y * Math.cos(beta));
    const base = new THREE.Vector3(c.x + dh.x * env.R * Math.sin(beta), top + env.R * Math.cos(beta) + 0.0002, c.y + dh.y * env.R * Math.sin(beta));
    const m = orient(env, base, d, upPerp(d));
    const caps = housingCapsules(env, m);
    // Ramp: from the track a little ahead of the trailing edge, straight up to the contact under
    // the part at 92 % of its length, then in toward the bowl axis and down onto the ledge.
    const contact = base.clone().addScaledVector(d, 0.92 * env.L).addScaledVector(upPerp(d), -(env.R + RAMP_R + 0.0002));
    const inward = new THREE.Vector3(-dh.y, 0, dh.x);
    if (inward.dot(new THREE.Vector3(contact.x, 0, contact.z)) > 0) inward.negate();
    const turn = contact.clone().addScaledVector(inward, env.R + RAMP_R + 0.004);
    const foot = new THREE.Vector3(turn.x, top + RAMP_R * 0.5, turn.z);
    const startRamp = new THREE.Vector3(c.x + dh.x * 0.02, top + RAMP_R * 0.5, c.y + dh.y * 0.02);
    const wire = [startRamp, contact, turn, foot];
    const wireCaps = wire.slice(1).map((b, i) => ({ a: wire[i], b, r: RAMP_R }));
    if (!fits(caps, [...parts, ...fixed]) || !fits(wireCaps, parts)) continue;
    // The wire touches the tipping part only at its contact (by construction) — skip that pair.
    tipping.push(m);
    parts.push(...caps);
    fixed.push(...wireCaps);
    ramp = wire;
    tipRear = s;
    break;
  }

  // Single file lying on the track up to the up-ending section: chords whose ends touch the
  // outer edge, clip up, with irregular gaps (some long, as the track is not starved).
  const lying: THREE.Matrix4[] = [];
  const groundLane = (x: number, z: number, r: number, near: number) => laneAt(laneAngle(x, z, near)) + r;
  const endAngle = tipRear / BOWL.exit - 0.004;
  let angle = BOWL.start + 0.55;
  const half = (lp: number) => 2 * Math.asin(lp / 2 / BOWL.exit);
  const placedLying: THREE.Matrix4[] = [];
  while (angle + half(env.L) < endAngle) {
    const a = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(BOWL.exit);
    const b = new THREE.Vector2(Math.cos(angle + half(env.L)), Math.sin(angle + half(env.L))).multiplyScalar(BOWL.exit);
    const heading = b.clone().sub(a).normalize();
    const near = angle + half(env.L) / 2;
    // Lane only: the file never stacks; the exact test below keeps it clear of its neighbours.
    // Clip toward the wall, 9° down, so the land faces in and its lower edge stays off the track.
    const roll = (d: THREE.Vector3) => {
      const out = new THREE.Vector3(-d.z, 0, d.x).normalize();
      const mid = new THREE.Vector3(Math.cos(near), 0, Math.sin(near));
      if (out.dot(mid) < 0) out.negate();
      return out.multiplyScalar(Math.cos(0.16)).addScaledVector(upPerp(d), -Math.sin(0.16)).normalize();
    };
    const m = settle(env, a, heading, (x, z, r) => groundLane(x, z, r, near), [], roll, 0.3);
    if (m) {
      const caps = housingCapsules(env, m);
      const end = new THREE.Vector3(0, env.L, 0).applyMatrix4(m);
      const onLane = caps.every((c) => [0, 0.25, 0.5, 0.75, 1].every((k) => planRadius(c.a.clone().lerp(c.b, k)) - c.r > BOWL.lane + 0.0015));
      if (onLane && laneAngle(end.x, end.z, near) < endAngle && fits(caps, [...parts, ...fixed])) {
        placedLying.push(m);
        parts.push(...caps);
        const gap = random() < 0.25 ? 0.05 + random() * 0.12 : 0.02 + random() * 0.03;
        angle += half(env.L) + gap / BOWL.exit;
        continue;
      }
    }
    angle += 0.01;
  }
  lying.push(...placedLying);

  // Loose housings dropped one by one into the well: each settles on the floor or across others,
  // tilted where it rests on one end, never through another (exact capsule test), rolled with
  // the clip and the label land within 40° of sideways.
  const pile: THREE.Matrix4[] = [];
  const pileCaps: Capsule[] = [];
  for (let attempt = 0; attempt < 5000 && pile.length < 30; attempt++) {
    const c = new THREE.Vector2((random() - 0.5) * 0.3, (random() - 0.5) * 0.3);
    const yaw = random() * Math.PI * 2;
    const heading = new THREE.Vector2(Math.cos(yaw), Math.sin(yaw));
    const a = c.clone().addScaledVector(heading, -env.L / 2);
    const b = c.clone().addScaledVector(heading, env.L / 2);
    if (Math.max(a.length(), b.length()) > BOWL.well - reach(env)) continue;
    const phi = (random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (random() - 0.5) * 1.4);
    const roll = (d: THREE.Vector3) => {
      const upv = upPerp(d);
      const side = d.clone().cross(upv).normalize();
      return upv.multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi)).normalize();
    };
    const m = settle(env, a, heading, groundFloor, pileCaps, roll, 0.42);
    if (!m) continue;
    const caps = housingCapsules(env, m);
    if (caps.some((cap) => cap.a.y > 0.075 || cap.b.y > 0.075)) continue;
    if (!fits(caps, pileCaps)) continue;
    if (shellPoints(env, m).some((p) => p.y < floorAt(Math.hypot(p.x, p.z)) - 1e-4)) continue;
    pile.push(m);
    pileCaps.push(...caps);
  }

  return {
    pile,
    lying,
    tipping,
    upright,
    ramp,
    fixtures: fixed,
    guideStart,
    rails: { paths: railPaths, r: railR, postOffset: postOff, postR, posts },
    strips,
  };
}

export { laneAngle };
