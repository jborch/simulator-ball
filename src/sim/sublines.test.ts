// UN01's sub-lines: inline spring check (EM10), spring base orienter (EM13) and the distribution
// conveyor that feeds the four EM14 presses.
import { beforeAll, describe, expect, test } from 'vitest';
import { LINE, type LineConfig } from './config';
import { processId, stationById, subProcessId } from './machine';
import { stepFeeder } from './devices';
import { Simulation } from './simulation';
import { scanSublines, stepDistribution } from './sublines';
import { steadyConfig } from './testing';
import type { BatchEvent, ItemProcessedEvent, ItemsMergedEvent, SimEvent } from './types';

function sim(mutate?: (c: LineConfig) => void, seed = 4): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate) });
  s.command({ type: 'start' });
  return s;
}

function collect(s: Simulation, seconds: number, each?: () => void, step = 0.1): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < seconds; t += step) {
    s.advance(step);
    each?.();
    out.push(...s.drainEvents());
  }
  return out;
}

const em10 = subProcessId(LINE, LINE.feeders.find((f) => f.inline)!.inline!);
const em13 = subProcessId(LINE, LINE.orienter);
const processedAt = (es: SimEvent[], process: string) => es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process === process);
const merged = (es: SimEvent[], type: string) => es.filter((e): e is ItemsMergedEvent => e.kind === 'merged' && e.sourceType === type);

describe('inspected parts (20 min)', () => {
  let s: Simulation;
  let events: SimEvent[];
  beforeAll(() => {
    // Wider limits than the original's so plenty of parts fail in a short run.
    s = sim((c) => {
      c.feeders.find((f) => f.inline)!.inline!.inspect.upper = 6;
      c.orienter.inspect.upper = 95;
    });
    events = collect(s, 1200);
  }, 120_000);

  test('every spring in a pen passed EM10; failed springs are blown into the chute', () => {
    const checks = processedAt(events, em10);
    expect(checks.every((e) => e.itemType === 'Spring' && e.carrier === undefined)).toBe(true);
    const verdict = new Map(checks.map((e) => [e.scopedId, e.result]));
    const failed = checks.filter((e) => e.result === 'Failed').length;
    expect(failed).toBeGreaterThan(20);
    const springs = merged(events, 'Spring');
    expect(springs.length).toBeGreaterThan(300);
    for (const m of springs) expect(verdict.get(m.source)).toBe('Passed');
    // Every failed spring has reached the jet except those still on the track between camera and jet.
    expect(s.state.plant.bins.EM10).toBeGreaterThanOrEqual(failed - 3);
    expect(s.state.plant.bins.EM10).toBeLessThanOrEqual(failed);
  });

  test('every spring base in a pen passed EM13; failed ones go into its chute', () => {
    const checks = processedAt(events, em13);
    expect(checks.every((e) => e.itemType === 'SpringBase')).toBe(true);
    const verdict = new Map(checks.map((e) => [e.scopedId, e.result]));
    const failed = checks.filter((e) => e.result === 'Failed').length;
    expect(failed).toBeGreaterThan(20);
    expect(s.state.plant.bins.EM13).toBe(failed);
    const bases = merged(events, 'SpringBase');
    expect(bases.length).toBeGreaterThan(300);
    for (const m of bases) expect(verdict.get(m.source)).toBe('Passed');
    // Each base goes into exactly one pen, at one of the four presses.
    expect(new Set(bases.map((m) => m.source)).size).toBe(bases.length);
    const presses = new Set(['EM14A', 'EM14B', 'EM14C', 'EM14D'].map((id) => processId(LINE, stationById(LINE, id))));
    for (const m of bases) expect(presses.has(m.process)).toBe(true);
  });

  test('each press records its cycle on the spring base it mounted, carried by the pen’s mover', () => {
    const bases = new Map(merged(events, 'SpringBase').map((m) => [m.source, m]));
    for (const id of ['EM14A', 'EM14B', 'EM14C', 'EM14D']) {
      const recs = processedAt(events, processId(LINE, stationById(LINE, id)));
      expect(recs.length).toBeGreaterThan(50);
      for (const r of recs) {
        expect(r.itemType).toBe('SpringBase');
        expect(r.properties?.['Mover Id']).toBe(r.carrier);
        expect(bases.get(r.scopedId)?.process).toBe(r.process);
      }
    }
  });
});

test('the presses rarely wait for a spring base: the distribution conveyor keeps their cups full', () => {
  const s = sim();
  const presses = ['EM14A', 'EM14B', 'EM14C', 'EM14D'].map((id) => LINE.stations.findIndex((d) => d.id === id));
  let working = 0;
  let starved = 0;
  collect(s, 600, () => {
    for (const i of presses) {
      const st = s.state.plc.stations[i].status;
      if (st === 'working') working++;
      if (st === 'starved') starved++;
    }
  });
  expect(working).toBeGreaterThan(1000);
  expect(starved / (working + starved)).toBeLessThan(0.02);
}, 60_000);

test('no part is fed or checked between batches', () => {
  const s = sim((c) => {
    c.batch.size = 20;
    c.batch.pause = 30;
  });
  let completeAt: number | null = null;
  const events = collect(s, 400, () => {
    if (completeAt === null && s.state.plc.machine === 'Complete') completeAt = s.state.plant.t;
  });
  expect(completeAt).not.toBeNull();
  const batches = events.filter((e): e is BatchEvent => e.kind === 'batch');
  const done = batches.find((e) => e.state === 'completed')!.logged;
  const next = batches.find((e) => e.state === 'started' && e.logged > done)!.logged;
  const between = [...processedAt(events, em10), ...processedAt(events, em13)].filter((e) => e.to > done && e.to < next);
  expect(between).toHaveLength(0);
}, 60_000);

describe('robust to coarse timing', () => {
  test('a checked spring waits at the jet until the PLC has decided, and a failed one is blown off', () => {
    const s = sim();
    const { plant: p } = s.state;
    const cfg = s.cfg;
    const i = cfg.feeders.findIndex((f) => f.inline);
    const def = cfg.feeders[i];
    const f = p.feeders[i];
    p.feedersOn = true;
    f.items = [{ x: def.inline!.at + 0.001, uid: 999, truth: 100, measured: false, sr: null, eject: false }];
    f.nextIn = 1e9;
    // One step long enough to carry the spring past the camera, the jet and on to the pick point.
    stepFeeder(p, f, def, cfg, s.state.rng, 2);
    expect(f.items[0].measured).toBe(true);
    expect(f.items[0].x).toBe(def.inline!.jetAt);
    const before = p.bins[def.inline!.id];
    scanSublines(s.state, cfg);
    expect(f.items[0].eject).toBe(true);
    stepFeeder(p, f, def, cfg, s.state.rng, 0.001);
    expect(f.items).toHaveLength(0);
    expect(p.bins[def.inline!.id]).toBe(before + 1);
  });

  test('a part that moves past a cup within one step is still diverted into it', () => {
    const s = sim();
    const { plant: p } = s.state;
    const cfg = s.cfg;
    const d = cfg.distribution;
    p.feedersOn = true;
    const cupA = stationById(cfg, d.stations[0]).s;
    p.distribution.items = [{ x: cupA - 0.03, sr: 77 }];
    for (const c of p.distribution.cups) Object.assign(c, { full: false, filling: 0, sr: null });
    // 0.5 s at conveyor speed carries the part 6 cm: right across cup A's 1.2 cm window.
    stepDistribution(p, cfg, 0.5);
    expect(p.distribution.cups[0].sr).toBe(77);
    expect(p.distribution.items).toHaveLength(0);
  });
});

test('passes through the fragile EM14B shift every later inspection of the pen down', () => {
  // A fragile shift 20 times the original's makes the effect at EM15 unmistakable.
  const s = sim((c) => (c.fragileShift = 3));
  const events = collect(s, 900);
  const viaB = new Set(merged(events, 'SpringBase').filter((m) => m.process === processId(LINE, stationById(LINE, 'EM14B'))).map((m) => m.target));
  const em15 = processedAt(events, processId(LINE, stationById(LINE, 'EM15'))).filter((e) => !['02', '06', '24'].includes(e.carrier!));
  const rate = (xs: ItemProcessedEvent[]) => xs.filter((e) => e.result === 'Failed').length / xs.length;
  const b = em15.filter((e) => viaB.has(e.scopedId));
  const others = em15.filter((e) => !viaB.has(e.scopedId));
  expect(b.length).toBeGreaterThan(30);
  expect(rate(b)).toBeGreaterThan(0.2);
  expect(rate(others)).toBeLessThan(0.02);
}, 60_000);
