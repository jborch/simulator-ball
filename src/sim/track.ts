/**
 * Closed mover loop: two straights joined by semicircles, run clockwise seen from above.
 * Plan coordinates: x to the right, y "up" in the top view. s = 0 is the left end of the top straight.
 */
export interface TrackDef {
  straight: number;
  radius: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Direction of travel, radians from +x. */
  heading: number;
}

export function trackLength(t: TrackDef): number {
  return 2 * t.straight + 2 * Math.PI * t.radius;
}

export function wrap(s: number, length: number): number {
  const m = s % length;
  return m < 0 ? m + length : m;
}

/** Distance travelling forward from a to b. */
export function forward(a: number, b: number, length: number): number {
  return wrap(b - a, length);
}

export function pose(t: TrackDef, s: number): Pose {
  const { straight: S, radius: R } = t;
  const arc = Math.PI * R;
  s = wrap(s, trackLength(t));
  if (s < S) return { x: -S / 2 + s, y: R, heading: 0 };
  s -= S;
  if (s < arc) {
    const a = s / R;
    return { x: S / 2 + R * Math.sin(a), y: R * Math.cos(a), heading: -a };
  }
  s -= arc;
  if (s < S) return { x: S / 2 - s, y: -R, heading: Math.PI };
  s -= S;
  const a = s / R;
  return { x: -S / 2 - R * Math.sin(a), y: -R * Math.cos(a), heading: Math.PI - a };
}
