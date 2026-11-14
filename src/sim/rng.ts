/** Seeded RNG whose whole state is one number, so it lives inside the serializable sim state. */
export interface RngState {
  seed: number;
}

export function random(r: RngState): number {
  // mulberry32
  r.seed = (r.seed + 0x6d2b79f5) | 0;
  let t = r.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function uniform(r: RngState, min: number, max: number): number {
  return min + (max - min) * random(r);
}

/** Box–Muller normal sample. */
export function normal(r: RngState, mean: number, sd: number): number {
  const u1 = 1 - random(r);
  const u2 = random(r);
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
