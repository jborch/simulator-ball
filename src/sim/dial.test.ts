// UN02's housing dial (EM30 load, EM31 label, EM32 label check) and EM40's snap curve.
import { beforeAll, describe, expect, test } from 'vitest';
import { catalogue } from '../catchai/catalogue';
import { Mapper } from '../catchai/mapper';
import { LINE, type LineConfig } from './config';
import { processId, stationById, subProcessId } from './machine';
import { Simulation } from './simulation';
import { judge, snapCurve } from './snap';
import { steadyConfig } from './testing';
import type { ItemProcessedEvent, ItemsMergedEvent, SeriesEvent, SimEvent } from './types';

function sim(mutate?: (c: LineConfig) => void, seed = 6): Simulation {
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

const at = (es: SimEvent[], process: string) => es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process === process);
const em30 = subProcessId(LINE, LINE.dial.load);
const em31 = subProcessId(LINE, LINE.dial.label);
const em32 = subProcessId(LINE, LINE.dial.inspect);
const em40 = processId(LINE, stationById(LINE, 'EM40'));

describe('housing dial and snap (20 min)', () => {
  let s: Simulation;
  let events: SimEvent[];
  beforeAll(() => {
    // Tighter label limits than the original's so plenty of housings fail in a short run.
    s = sim((c) => (c.dial.inspect.inspect.lower = 0.78));
    events = collect(s, 1200);
  }, 120_000);

  test('every housing in a pen was loaded, labelled and passed its label check, in that order', () => {
    const loaded = new Map(at(events, em30).map((e) => [e.scopedId, e]));
    const labelled = new Map(at(events, em31).map((e) => [e.scopedId, e]));
    const checked = new Map(at(events, em32).map((e) => [e.scopedId, e]));
    expect([...checked.values()].filter((e) => e.result === 'Failed').length).toBeGreaterThan(20);
    const housings = events.filter((e): e is ItemsMergedEvent => e.kind === 'merged' && e.sourceType === 'Housing');
    expect(housings.length).toBeGreaterThan(300);
    for (const m of housings) {
      const [l, b, c] = [loaded.get(m.source), labelled.get(m.source), checked.get(m.source)];
      expect(l && b && c).toBeTruthy();
      expect(c!.result).toBe('Passed');
      expect(l!.to).toBeLessThanOrEqual(b!.from);
      expect(b!.to).toBeLessThanOrEqual(c!.from);
      expect(c!.properties?.['Code Read']).toBe(b!.identifier);
    }
  });

  test('housings that fail the label check are pushed into the bin, never onto a pen', () => {
    const failed = at(events, em32).filter((e) => e.result === 'Failed');
    const merged = new Set(events.filter((e): e is ItemsMergedEvent => e.kind === 'merged').map((m) => m.source));
    for (const f of failed) expect(merged.has(f.scopedId)).toBe(false);
    // The last one or two may still be on their way to the eject position.
    const binned = s.state.plant.bins[LINE.dial.inspect.id];
    expect(binned).toBeGreaterThanOrEqual(failed.length - 2);
    expect(binned).toBeLessThanOrEqual(failed.length);
  });

  test("EM40 records each snap on the housing, with the original's properties and its curve", () => {
    const recs = at(events, em40);
    const curves = new Map(events.filter((e): e is SeriesEvent => e.kind === 'series').map((e) => [e.scopedId, e]));
    expect(recs.length).toBeGreaterThan(300);
    for (const r of recs) {
      expect(r.itemType).toBe('Housing');
      expect(typeof r.properties?.['Peak Force']).toBe('number');
      expect(typeof r.properties?.['Snap Position']).toBe('number');
      expect(r.result === 'Failed').toBe(r.properties?.['Failure Reason'] !== undefined);
      const curve = curves.get(r.scopedId)!;
      expect(curve.process).toBe(em40);
      // 0.6 s at full speed, sampled every ms, within the station's cycle.
      expect(curve.values.Force.length).toBe(600);
      expect(curve.start).toBeGreaterThanOrEqual(r.from);
      expect(curve.start + (curve.values.Force.length - 1) * curve.interval).toBeLessThanOrEqual(r.to + 1);
      // The recorded peak is the curve's, before the housing bottoms out (last 0.6 mm).
      const before = curve.values.Force.filter((_, i) => curve.values.Displacement[i] <= LINE.snap.stroke - 0.6);
      expect(Math.max(...before)).toBeCloseTo(r.properties!['Peak Force'] as number, 6);
    }
  });
});

test('the dial holds still while EM40 does not take housings, and none is lost', () => {
  const s = sim();
  s.advance(240);
  const d = s.state.plant.dial;
  const count = () => d.slots.filter(Boolean).length;
  // Freeze EM40's robot: the unload position fills and the dial must stop turning.
  const robot = s.state.plant.stations[s.cfg.stations.findIndex((x) => x.id === 'EM40')].robots[0];
  robot.fault = 60;
  s.advance(20);
  expect(d.slots[LINE.dial.positions.unload]).not.toBeNull();
  const before = JSON.stringify(d.slots.map((x) => x?.uid ?? null));
  s.advance(20);
  expect(JSON.stringify(d.slots.map((x) => x?.uid ?? null))).toBe(before);
  expect(d.phase).toBe('dwell');
  const held = count();
  s.advance(45);
  // Repaired: it takes housings again and the dial moves on.
  expect(robot.fault).toBe(0);
  expect(JSON.stringify(d.slots.map((x) => x?.uid ?? null))).not.toBe(before);
  expect(held).toBeGreaterThan(0);
}, 60_000);

describe('snap judging', () => {
  const rng = () => ({ seed: 11 });
  test('a good snap is accepted with its peak and position', () => {
    const r = snapCurve(LINE, rng(), 32, 4.2, 0.6, 0);
    expect(r.accepted).toBe(true);
    expect(r.peak).toBeGreaterThan(31);
    expect(r.peak).toBeLessThan(33.5);
    expect(Math.abs(r.position - 4.2)).toBeLessThan(0.05);
  });

  test('no drop, a peak out of limits or a snap out of its window is rejected with the reason', () => {
    const noSnap = structuredClone(LINE);
    noSnap.snap.noSnap = 1;
    expect(snapCurve(noSnap, rng(), 32, 4.2, 0.6, 0).reason).toBe('No snap detected');
    expect(snapCurve(LINE, rng(), 42, 4.2, 0.6, 0).reason).toBe('Peak force too high');
    expect(snapCurve(LINE, rng(), 22, 4.2, 0.6, 0).reason).toBe('Peak force too low');
    expect(snapCurve(LINE, rng(), 32, 5.0, 0.6, 0).reason).toBe('Snap position out of window');
  });

  test('judging looks only at the curve', () => {
    const r = snapCurve(LINE, rng(), 32, 4.2, 0.6, 0);
    expect(judge(LINE, r.force, r.displacement)).toEqual({ peak: r.peak, position: r.position, accepted: r.accepted, reason: r.reason });
  });

  test('the reporter sends a curve as one device data row per sample, the first with the start event', () => {
    const cat = catalogue(LINE);
    const properties = Object.fromEntries(cat.properties.map((p, i) => [p.Name, `p${i}`]));
    const evKeys = Object.fromEntries(cat.events.map((p, i) => [p.Name, `e${i}`]));
    const m = new Mapper(cat, { properties, events: evKeys, batchTypeId: 1, scopedIdBase: 100, created: 0, warnings: [] });
    const out = m.map({ kind: 'series', process: em40, scopedId: 7, start: 1_000_000, interval: 1, values: { Force: [1, 2, 3], Displacement: [0, 0.01, 0.02] }, startEvent: 'Snap Start' });
    expect(out).toHaveLength(3);
    const rows = out.map((o) => (o.k === 'data' ? o.v : null));
    expect(rows.map((r) => r!.Properties?.[properties.Force])).toEqual([1, 2, 3]);
    expect(rows[0]!.Events?.[evKeys['Snap Start']]).toBe('ID: 107');
    expect(rows[1]!.Events).toBeUndefined();
    expect(new Set(rows.map((r) => r!.Logged)).size).toBe(3);
  });
});

describe('snap curves stay consistent (review findings)', () => {
  test("a full curve never shares a millisecond with the station's own result row", () => {
    const cat = catalogue(LINE);
    const properties = Object.fromEntries(cat.properties.map((p, i) => [p.Name, `p${i}`]));
    const evKeys = Object.fromEntries(cat.events.map((p, i) => [p.Name, `e${i}`]));
    const m = new Mapper(cat, { properties, events: evKeys, batchTypeId: 1, scopedIdBase: 0, created: 0, warnings: [] });
    const end = 5_000_000;
    // As records.ts emits them: the result first, then the 600-sample curve ending on the same ms.
    const out = [
      ...m.map({ kind: 'processed', process: em40, scopedId: 1, itemType: 'Housing', from: end - 900, to: end, properties: { 'Peak Force': 32 } }),
      ...m.map({ kind: 'series', process: em40, scopedId: 1, start: end - 599, interval: 1, values: { Force: new Array(600).fill(1), Displacement: new Array(600).fill(0) }, startEvent: 'Snap Start' }),
    ];
    const times = out.flatMap((o) => (o.k === 'data' ? [o.v.Logged] : []));
    expect(times).toHaveLength(601);
    expect(new Set(times).size).toBe(601);
  });

  test('curves span the time the stroke really took, whatever the speed does meanwhile', () => {
    const s = sim(undefined, 9);
    const events = collect(s, 600, () => {
      // Swing the speed override every few seconds, mid-stroke as often as not.
      const t = s.state.plant.t;
      if (Math.abs((t % 7) - 0.05) < 0.051) s.command({ type: 'speed', percent: Math.floor(t / 7) % 2 === 0 ? 15 : 100 });
    });
    const recs = new Map(at(events, em40).map((r) => [r.scopedId, r]));
    const curves = events.filter((e): e is SeriesEvent => e.kind === 'series');
    expect(curves.length).toBeGreaterThan(50);
    const lengths = new Set<number>();
    for (const c of curves) {
      const r = recs.get(c.scopedId)!;
      const n = c.values.Force.length;
      lengths.add(Math.round(n / 100));
      expect(c.start).toBeGreaterThanOrEqual(r.from);
      expect(c.start + (n - 1) * c.interval).toBeLessThanOrEqual(r.to + 1);
    }
    // Slow strokes give longer curves than fast ones.
    expect(lengths.size).toBeGreaterThan(2);
  }, 60_000);

  test('impossible inputs never give NaN or an accepted snap', () => {
    for (const [peak, position] of [
      [32, 0],
      [32, -1],
      [Number.NaN, 4.2],
      [32, Number.NaN],
      [-5, 4.2],
    ]) {
      const r = snapCurve(LINE, { seed: 3 }, peak, position, 0.6, 0);
      expect(r.force.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(r.peak) && Number.isFinite(r.position)).toBe(true);
      expect(r.accepted).toBe(false);
    }
    const bad = judge(LINE, [1, Number.NaN, 3], [0, 1, 2]);
    expect(bad.accepted).toBe(false);
    expect(bad.reason).toBe('Invalid force curve');
  });
});
