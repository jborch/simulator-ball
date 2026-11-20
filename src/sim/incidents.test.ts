import { describe, expect, test } from 'vitest';
import { parseToHost } from '../server/validate';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import { PEN_LENGTH } from './incidents';
import { forward, trackLength } from './track';

function sim(seed = 8): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(), epochMs: Date.UTC(2026, 10, 20, 8) });
  s.command({ type: 'start' });
  s.advance(90); // pens on the movers all round the loop
  s.drainEvents();
  return s;
}

// Each test simulates a few minutes of the line: allow for a busy machine running tests in parallel.
describe('visible incidents', { timeout: 30_000 }, () => {
  test('a jammed mover stays put while the movers behind it close up, then moves on', () => {
    const s = sim();
    expect(s.command({ type: 'incident', kind: 'jam', station: 'EM41' })).toBe(true);
    const inc = s.state.plant.incidents.list[0];
    const L = trackLength(s.cfg.track);
    const stuck = s.state.plant.movers.find((m) => m.id === inc.moverId)!;
    const behind = s.state.plant.movers[(s.state.plant.movers.indexOf(stuck) - 1 + 32) % 32];
    const at = stuck.s;
    s.advance(Math.min(inc.left - 1, 15));
    expect(stuck.s).toBe(at);
    expect(forward(behind.s, stuck.s, L) - s.cfg.mover.length).toBeLessThan(0.001);
    s.advance(30);
    expect(s.state.plant.incidents.list).toHaveLength(0);
    expect(stuck.s).not.toBe(at);
  });

  test('a loose pen rides the belt between two movers, which it keeps apart, and is cleared later', () => {
    const s = sim();
    expect(s.command({ type: 'incident', kind: 'loosePen', station: 'EM11' })).toBe(true);
    const inc = s.state.plant.incidents.list[0];
    const L = trackLength(s.cfg.track);
    const clear = s.cfg.mover.length / 2 + PEN_LENGTH / 2 - 1e-6;
    const s0 = inc.s!;
    let moved = false;
    for (let t = 0; t < 60; t += 0.1) {
      s.advance(0.1);
      moved ||= inc.s !== s0;
      // Never under a mover.
      for (const m of s.state.plant.movers) expect(Math.min(forward(m.s, inc.s!, L), forward(inc.s!, m.s, L))).toBeGreaterThan(clear);
    }
    expect(moved).toBe(true);
    s.advance(160);
    expect(s.state.plant.incidents.list).toHaveLength(0);
  });

  test('a pen that falls out of its mover lands on the belt behind it; mover incidents end at unload', () => {
    const s = sim();
    expect(s.command({ type: 'incident', kind: 'emptyMover', station: 'EM40' })).toBe(true);
    const [empty, pen] = s.state.plant.incidents.list;
    expect(empty.kind).toBe('emptyMover');
    // The pen lands behind the mover if there's room (else it falls out of sight).
    if (pen) {
      expect(pen.kind).toBe('loosePen');
      expect(pen.parts).toEqual(s.state.plant.movers.find((m) => m.id === empty.moverId)!.load!.parts);
    }
    // A lap is well under 5 minutes, and the pen is unloaded on the way.
    s.advance(300);
    expect(s.state.plant.incidents.list.some((x) => x.id === empty.id)).toBe(false);
  });

  test('a missing spring picks a pen whose spring is still in view (no housing yet)', () => {
    const s = sim();
    expect(s.command({ type: 'incident', kind: 'missingSpring', station: 'EM14B' })).toBe(true);
    const m = s.state.plant.movers.find((x) => x.id === s.state.plant.incidents.list[0].moverId)!;
    expect(m.load!.parts).toContain('spring');
    expect(m.load!.parts).not.toContain('housing');
  });

  test("the line doesn't notice: no events, no alarms, and (but for jams and loose pens in the way) the same production", () => {
    const a = sim();
    const b = sim();
    for (const kind of ['droppedPart', 'missingSpring', 'tiltedPen', 'emptyMover'] as const) expect(a.command({ type: 'incident', kind, station: 'EM40' })).toBe(true);
    // emptyMover's pen may land on the belt; it only shows, so take it off again for this comparison.
    a.state.plant.incidents.list = a.state.plant.incidents.list.filter((x) => x.kind !== 'loosePen');
    expect(a.drainEvents()).toEqual([]);
    expect(a.frame().incidents.length).toBe(4);
    a.advance(120);
    b.advance(120);
    expect(a.state.mes.good).toBe(b.state.mes.good);
    expect(a.state.plant.alarms).toEqual(b.state.plant.alarms);
  });

  test('scene commands change the lighting and seed without an event', () => {
    const s = sim();
    expect(s.command({ type: 'scene', lighting: 'night', seed: 42 })).toBe(true);
    expect(s.frame().scene).toEqual({ seed: 42, lighting: 'night' });
    expect(s.drainEvents()).toEqual([]);
  });

  test('viewers can only send known incidents and lightings', () => {
    const cmd = (c: object) => parseToHost(JSON.stringify({ type: 'command', command: c, origin: 'test' }));
    expect(cmd({ type: 'incident', kind: 'jam', station: 'EM41' })).toEqual({ type: 'command', command: { type: 'incident', kind: 'jam', station: 'EM41' }, origin: 'test' });
    expect(cmd({ type: 'incident', kind: 'fire' })).toBeNull();
    expect(cmd({ type: 'scene', lighting: 'disco' })).toBeNull();
    expect(cmd({ type: 'scene', seed: -1 })).toBeNull();
    expect(cmd({ type: 'scene', lighting: 'dim', seed: 7 })).not.toBeNull();
  });
});
