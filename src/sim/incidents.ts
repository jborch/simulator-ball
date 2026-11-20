// Visible incidents: things that go wrong on the line that a camera can see but the line's own
// sensors don't report: a pen lying loose on the belt, a part dropped in a robot's working area,
// a pen missing its spring, tilted or gone from its fixture, a mover that sticks so the movers
// behind it pile up. They exist to test vision (anomaly detection), so they raise no alarm and
// write no MES event; the host logs each one, which is the ground truth to score a detector against.
//
// Apart from the jam, which stops a mover and so makes the line starve downstream as a real one
// would, an incident changes only what is drawn: the sim still believes the pen is complete.
import type { LineConfig, PartType } from './config';
import { type RngState, random, uniform } from './rng';
import { forward, trackLength } from './track';
import type { Mover, PlantState } from './types';

export const INCIDENT_KINDS = ['loosePen', 'droppedPart', 'missingSpring', 'tiltedPen', 'emptyMover', 'jam'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_TEXT: Record<IncidentKind, string> = {
  loosePen: 'Pen lying loose on the belt',
  droppedPart: 'Part dropped in the robot area',
  missingSpring: 'Pen without its spring',
  tiltedPen: 'Pen tilted in its fixture',
  emptyMover: 'Pen fallen out of its mover',
  jam: 'Mover stuck: movers pile up',
};

export interface Incident {
  id: number;
  kind: IncidentKind;
  /** Sim time it started. */
  t: number;
  /** Seconds until it is cleared (by an operator, or the stuck mover frees itself). */
  left: number;
  /** Station it was injected near (its camera should see it). */
  station: string;
  /** missingSpring, tiltedPen, emptyMover, jam: the mover. Mover incidents end when its pen is unloaded. */
  moverId?: number;
  /** loosePen: where it lies on the belt, as a loop position and an offset across it (m, + outward). */
  s?: number;
  offset?: number;
  /** loosePen: the pen as built so far. */
  parts?: PartType[];
  /** droppedPart: what was dropped, and where on the mover's top plate (a along, r outward, m). */
  part?: PartType;
  a?: number;
  r?: number;
  /** Turn about the vertical (rad) for parts lying down; tilt from vertical (rad) for tiltedPen. */
  angle: number;
}

export interface IncidentState {
  list: Incident[];
  nextId: number;
  /** Own random stream, so injecting incidents doesn't change what the line itself does. */
  rng: RngState;
}

/** How long each kind lasts unless something ends it sooner (s). */
const DURATION: Record<IncidentKind, [number, number]> = {
  loosePen: [90, 150],
  droppedPart: [90, 150],
  missingSpring: [600, 600],
  tiltedPen: [600, 600],
  emptyMover: [600, 600],
  jam: [20, 40],
};
/** How far either side of a station its camera sees movers on the belt (m). */
const IN_VIEW = 0.3;
/** A loose pen's length along the belt (it lies lengthwise), with a little play. */
export const PEN_LENGTH = 0.13;

export function createIncidents(seed: number): IncidentState {
  return { list: [], nextId: 1, rng: { seed: (seed ^ 0x5eed1) | 0 } };
}

/** Starts an incident near `station` (or a random station). Returns it, or null if none fits now. */
export function injectIncident(p: PlantState, cfg: LineConfig, kind: IncidentKind, station?: string): Incident | null {
  const st = p.incidents;
  const rng = st.rng;
  const def = station ? cfg.stations.find((d) => d.id === station) : cfg.stations[Math.floor(random(rng) * cfg.stations.length)];
  if (!def) return null;
  const L = trackLength(cfg.track);
  const [lo, hi] = DURATION[kind];
  const base = { id: st.nextId, kind, t: p.t, left: uniform(rng, lo, hi), station: def.id, angle: 0 };
  // Movers the station camera will see, best first: in view and coming up to the station, in view
  // past it, then on their way, but only those that get there before their pen is unloaded (a pen
  // incident ends at unload). Movers that already have an incident are left out.
  const taken = new Set(st.list.map((x) => x.moverId));
  const unload = cfg.stations.find((d) => d.kind === 'unload');
  const toUnload = (m: Mover) => (unload ? forward(m.s, unload.s, L) : Infinity);
  const coming = (m: Mover) => forward(m.s, def.s, L);
  const past = (m: Mover) => forward(def.s, m.s, L);
  const free = p.movers.filter((m) => !taken.has(m.id) && toUnload(m) > 0.02);
  const by = (f: (m: Mover) => number) => (a: Mover, b: Mover) => f(a) - f(b);
  const upstream = [
    ...free.filter((m) => coming(m) < IN_VIEW).sort(by(coming)),
    ...free.filter((m) => past(m) > 0 && past(m) < IN_VIEW && toUnload(m) > 0.5).sort(by(past)),
    ...free.filter((m) => coming(m) >= IN_VIEW && coming(m) <= toUnload(m)).sort(by(coming)),
  ];
  const inView = upstream.filter((m) => Math.min(coming(m), past(m)) < IN_VIEW);
  let inc: Incident | null = null;
  switch (kind) {
    case 'loosePen': {
      // Dropped onto the belt in a gap between movers coming up to the station, so it rides into
      // the camera's view; it looks like the pens being built there.
      const s = freeSpot(p, cfg, def.s, 0.15, 2);
      if (s !== null) {
        inc = {
          ...base,
          s,
          offset: uniform(rng, -0.015, 0.015),
          angle: uniform(rng, -0.12, 0.12),
          parts: [...(upstream.find((x) => x.load?.parts.length)?.load?.parts ?? ['body', 'spring', 'springBase', 'cartridge', 'housing'])],
        };
      }
      break;
    }
    case 'droppedPart': {
      // A robot lets go of a part over a passing mover: it lies on the mover's top plate, beside
      // the fixture, and rides round with it until the pen is unloaded.
      const parts: PartType[] = ['spring', 'cartridge', 'housing', 'body'];
      const m = upstream.find((x) => x.load);
      if (m) inc = { ...base, moverId: m.id, part: parts[Math.floor(random(rng) * parts.length)], a: uniform(rng, -0.03, 0.03), r: -uniform(rng, 0.025, 0.035), angle: uniform(rng, -0.5, 0.5) };
      break;
    }
    case 'missingSpring': {
      // The spring shows through the body until the housing goes on, so pick a pen in that state.
      const m = upstream.find((x) => x.load?.parts.includes('spring') && !x.load.parts.includes('housing')) ?? upstream.find((x) => x.load);
      if (m) inc = { ...base, moverId: m.id };
      break;
    }
    case 'tiltedPen':
    case 'emptyMover': {
      const m = upstream.find((x) => x.load && x.load.parts.length > 0);
      if (m) inc = { ...base, moverId: m.id, angle: kind === 'tiltedPen' ? uniform(rng, 0.15, 0.3) * (random(rng) < 0.5 ? -1 : 1) : 0 };
      break;
    }
    case 'jam': {
      // A mover in the camera's view (one on the move rather than waiting at the gate), else the next one coming.
      const m = inView.find((x) => x.stoppedAt === null) ?? upstream[0] ?? p.movers.find((x) => !taken.has(x.id));
      if (m) inc = { ...base, moverId: m.id, angle: uniform(rng, 0.04, 0.08) * (random(rng) < 0.5 ? -1 : 1) };
      break;
    }
  }
  if (!inc) return null;
  st.nextId++;
  st.list.push(inc);
  // A pen that falls out of its mover lands on the belt behind it (if there's room; else it falls
  // into the machine, out of sight).
  if (kind === 'emptyMover') {
    const m = p.movers.find((x) => x.id === inc.moverId)!;
    const s = freeSpot(p, cfg, m.s, 0, 0.3);
    if (s !== null) st.list.push({ ...base, id: st.nextId++, kind: 'loosePen', s, offset: 0.01, angle: 0.08, parts: [...m.load!.parts], left: uniform(rng, ...DURATION.loosePen) });
  }
  return inc;
}

export function isStuck(p: PlantState, moverId: number): boolean {
  return p.incidents.list.some((x) => x.kind === 'jam' && x.moverId === moverId);
}

/**
 * The middle of the nearest gap behind loop position `s`, `back` to `back + within` behind it, with
 * room for a pen lying lengthwise; null if there's none.
 */
function freeSpot(p: PlantState, cfg: LineConfig, s: number, back: number, within: number): number | null {
  const L = trackLength(cfg.track);
  const need = cfg.mover.length + PEN_LENGTH + 0.01;
  // Movers can't overtake, so sorted by position they are in loop order.
  const sorted = [...p.movers].sort((a, b) => a.s - b.s);
  let best: number | null = null;
  let bestD = Infinity;
  sorted.forEach((behind, k) => {
    const gap = forward(behind.s, sorted[(k + 1) % sorted.length].s, L);
    if (gap < need || p.incidents.list.some((x) => x.kind === 'loosePen' && forward(behind.s, x.s!, L) < gap)) return;
    const mid = (behind.s + gap / 2) % L;
    const d = forward(mid, s, L);
    if (d >= back && d <= back + within && d < bestD) {
      best = mid;
      bestD = d;
    }
  });
  return best;
}

/**
 * Room the loose pens take up in front of the mover at `s` (up to the next mover, `gap` ahead):
 * a pen on the belt keeps the movers either side of it apart.
 */
export function penSpace(p: PlantState, cfg: LineConfig, s: number, gap: number): number {
  const L = trackLength(cfg.track);
  let room = 0;
  for (const x of p.incidents.list) if (x.kind === 'loosePen' && forward(s, x.s!, L) < gap) room += PEN_LENGTH;
  return room;
}

/** Ages incidents and moves loose pens with the belt. Returns the ones that ended this step. */
export function stepIncidents(p: PlantState, cfg: LineConfig, dt: number): Incident[] {
  const L = trackLength(cfg.track);
  const half = cfg.mover.length / 2;
  const ended: Incident[] = [];
  for (const inc of p.incidents.list) {
    inc.left -= dt;
    if (inc.moverId !== undefined && inc.kind !== 'jam') {
      // Mover incidents last as long as that pen: when it is unloaded, the next one is fine.
      const m = p.movers.find((x) => x.id === inc.moverId);
      if (!m?.load) inc.left = Math.min(inc.left, 0);
    }
    if (inc.kind === 'loosePen') {
      // Carried by the belt, it slides against the mover ahead when that one waits; the mover
      // behind pushes it along. The movers keep it room (see penSpace), so it never gets squeezed.
      const clear = half + PEN_LENGTH / 2;
      let s = inc.s! + p.beltSpeed * dt;
      const nearest = (dist: (m: (typeof p.movers)[number]) => number) => p.movers.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      const behind = nearest((m) => forward(m.s, s, L));
      if (forward(behind.s, s, L) < clear) s = behind.s + clear;
      const ahead = nearest((m) => forward(s % L, m.s, L));
      if (forward(s % L, ahead.s, L) < clear) s = ahead.s - clear;
      inc.s = ((s % L) + L) % L;
    }
    if (inc.left <= 0) ended.push(inc);
  }
  if (ended.length) p.incidents.list = p.incidents.list.filter((x) => x.left > 0);
  return ended;
}
