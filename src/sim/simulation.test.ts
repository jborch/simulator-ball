import { beforeAll, describe, expect, test } from 'vitest';
import { LINE } from './config';
import { gtinWithCheck } from './gs1';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import { forward, pose, trackLength } from './track';
import type { ItemProcessedEvent, ItemsMergedEvent, SimEvent } from './types';

const L = trackLength(LINE.track);

function running(seed = 7): Simulation {
  const sim = new Simulation({ seed, epochMs: Date.UTC(2026, 10, 14), cfg: steadyConfig() });
  sim.command({ type: 'start' });
  return sim;
}

/** Advances and collects every event. */
function collect(sim: Simulation, seconds: number, into: SimEvent[] = []): SimEvent[] {
  for (let t = 0; t < seconds; t += 10) {
    sim.advance(Math.min(10, seconds - t));
    into.push(...sim.drainEvents());
  }
  return into;
}

const processed = (es: SimEvent[], process?: string) =>
  es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && (!process || e.process === `${LINE.id}-${process}`));

describe('track', () => {
  test('pose is continuous across segment boundaries', () => {
    const { straight: S, radius: R } = LINE.track;
    for (const b of [S, S + Math.PI * R, 2 * S + Math.PI * R, L]) {
      const a = pose(LINE.track, b - 1e-9);
      const c = pose(LINE.track, b + 1e-9);
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(1e-6);
    }
  });
});

describe('plant physics', () => {
  test('movers never overlap', () => {
    const sim = running();
    const len = LINE.mover.length;
    for (let i = 0; i < 3000; i++) {
      sim.advance(0.1);
      const ms = sim.state.plant.movers;
      for (let k = 0; k < ms.length; k++) {
        expect(forward(ms[k].s, ms[(k + 1) % ms.length].s, L)).toBeGreaterThanOrEqual(len - 1e-9);
      }
    }
  }, 30_000);

  test('movers only cross a gate while it is open', () => {
    const sim = running();
    let crossings = 0;
    for (let i = 0; i < 60_000; i++) {
      const before = sim.state.plant.movers.map((m) => m.s);
      const closed = sim.state.plant.stations.map((st) => st.gateClosed);
      sim.advance(0.001);
      sim.state.plant.movers.forEach((m, k) => {
        const moved = forward(before[k], m.s, L);
        LINE.stations.forEach((d, si) => {
          const toGate = forward(before[k], d.s, L);
          if (moved > 0 && toGate < moved) {
            crossings++;
            expect(closed[si], `mover ${m.id} ran through ${d.id}`).toBe(false);
          }
        });
      });
    }
    expect(crossings).toBeGreaterThan(100);
  }, 30_000);
});

describe('steady production (60 min)', () => {
  let sim: Simulation;
  let events: SimEvent[];
  const minutes = 60;

  beforeAll(() => {
    sim = running(11);
    sim.advance(180);
    sim.drainEvents();
    events = collect(sim, minutes * 60);
    const { good, rejected, rejectsByCause } = sim.state.mes;
    const a = processed(events, 'ST40A').filter((e) => e.itemType === 'Pen').length;
    const b = processed(events, 'ST40B').filter((e) => e.itemType === 'Pen').length;
    console.log(`60 min: ${good} good, ${rejected} rejected (${((100 * rejected) / (good + rejected)).toFixed(2)} %), ST40A ${a} / ST40B ${b}`, rejectsByCause);
  }, 120_000);

  test('throughput is around 21 pens/min with the twin station as bottleneck', () => {
    const out = processed(events, 'ST70').filter((e) => e.itemType === 'Pen').length + processed(events, 'R1').length;
    const perMin = out / minutes;
    expect(perMin).toBeGreaterThan(19);
    expect(perMin).toBeLessThan(24);
  });

  test('reject rate is about 5 %', () => {
    const { good, rejected } = sim.state.mes;
    const rate = rejected / (good + rejected);
    expect(rate).toBeGreaterThan(0.035);
    expect(rate).toBeLessThan(0.07);
  });

  test('twin stations share the work and process at the same time', () => {
    const a = processed(events, 'ST40A').filter((e) => e.itemType === 'Pen');
    const b = processed(events, 'ST40B').filter((e) => e.itemType === 'Pen');
    const share = a.length / (a.length + b.length);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
    const overlapping = a.filter((x) => b.some((y) => x.from < y.to && y.from < x.to));
    expect(overlapping.length / a.length).toBeGreaterThan(0.8);
  });

  test('fragile ST40B pushes seating-depth rejects up', () => {
    const viaB = new Set(processed(events, 'ST40B').map((e) => e.scopedId));
    const final = processed(events, 'ST60');
    const rate = (xs: ItemProcessedEvent[]) => xs.filter((e) => e.result === 'Failed').length / xs.length;
    expect(rate(final.filter((e) => viaB.has(e.scopedId)))).toBeGreaterThan(rate(final.filter((e) => !viaB.has(e.scopedId))));
  });

  test('worn mover #24 (fixture offset) is rejected more often than average', () => {
    const m = sim.state.mes.movers;
    const rate = (id: number) => m[id].rejects / (m[id].pens + m[id].rejects);
    const ids = Object.keys(m).map(Number);
    const avg = ids.reduce((sum, id) => sum + rate(id), 0) / ids.length;
    expect(rate(24)).toBeGreaterThan(avg * 1.5);
  });

  test('each good pen has full genealogy: spring, cartridge (from a nest), housing, cap and a tray', () => {
    const merged = events.filter((e): e is ItemsMergedEvent => e.kind === 'merged');
    const goods = processed(events, 'ST70').filter((e) => e.itemType === 'Pen' && e.properties?.['Tray Position'] !== undefined);
    const byTarget = new Map<number, string[]>();
    for (const e of merged) byTarget.set(e.target, [...(byTarget.get(e.target) ?? []), e.sourceType]);
    const trayed = new Set(merged.filter((e) => e.sourceType === 'Pen').map((e) => e.source));
    // Pens loaded before the collection window started miss early merges; check those fully inside it.
    const loaded = new Set(processed(events, 'ST10').map((e) => e.scopedId));
    const inside = goods.filter((g) => loaded.has(g.scopedId));
    expect(inside.length).toBeGreaterThan(500);
    for (const g of inside) {
      expect(byTarget.get(g.scopedId)?.sort()).toEqual(['Cap', 'Cartridge', 'Housing', 'Spring']);
      expect(trayed.has(g.scopedId)).toBe(true);
    }
    const cartridges = processed(events).filter((e) => e.itemType === 'Cartridge');
    expect(cartridges.every((c) => c.sourceScopedId !== undefined && c.sourcePosition! < LINE.nestSize)).toBe(true);
  });

  test('ST10 marks a GS1 identifier and ST60 reads it back', () => {
    const marks = new Map(processed(events, 'ST10').map((e) => [e.scopedId, e.identifier]));
    const gtin = gtinWithCheck(LINE.gs1.gtin);
    for (const id of marks.values()) expect(id).toMatch(new RegExp(`^\\(01\\)${gtin}\\(17\\)\\d{6}\\(10\\)B\\d{6}\\(21\\)[0-9A-Z]{12}$`));
    const reads = processed(events, 'ST60').filter((e) => marks.has(e.scopedId) && e.properties?.['Code Read']);
    expect(reads.length).toBeGreaterThan(500);
    for (const r of reads) expect(r.properties!['Code Read']).toBe(marks.get(r.scopedId));
  });

  test('event timestamps follow sim time and cycles take real time', () => {
    const st40 = processed(events, 'ST40A').filter((e) => e.itemType === 'Pen');
    for (const e of st40) expect(e.to - e.from).toBeGreaterThanOrEqual(LINE.stations.find((s) => s.id === 'ST40A')!.mech * 1000 - 1);
  });
});

describe('machine control', () => {
  test('speed override slows the whole line', () => {
    const rate = (percent: number) => {
      const sim = running(3);
      sim.command({ type: 'speed', percent });
      sim.advance(240);
      const before = sim.state.mes.good + sim.state.mes.rejected;
      sim.advance(600);
      return (sim.state.mes.good + sim.state.mes.rejected - before) / 10;
    };
    const full = rate(100);
    const half = rate(50);
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.65);
  }, 60_000);

  test('stop finishes cycles then stops the belt; hold/unhold; abort stops at once; reset', () => {
    const sim = running(5);
    sim.advance(60);
    expect(sim.state.plc.machine).toBe('Execute');

    expect(sim.command({ type: 'stop' })).toBe(true);
    expect(sim.state.plc.machine).toBe('Stopping');
    sim.advance(15);
    expect(sim.state.plc.machine).toBe('Stopped');
    sim.advance(2);
    expect(sim.state.plant.beltSpeed).toBe(0);
    expect(sim.state.plant.movers.every((m) => m.v === 0)).toBe(true);

    expect(sim.command({ type: 'start' })).toBe(true);
    sim.advance(5);
    expect(sim.state.plc.machine).toBe('Execute');
    expect(sim.command({ type: 'hold' })).toBe(true);
    sim.advance(15);
    expect(sim.state.plc.machine).toBe('Held');
    expect(sim.command({ type: 'unhold' })).toBe(true);
    sim.advance(5);
    expect(sim.state.plc.machine).toBe('Execute');

    sim.advance(10);
    expect(sim.command({ type: 'abort' })).toBe(true);
    sim.advance(0.02);
    expect(sim.state.plant.beltSpeed).toBe(0);
    const frozen = JSON.stringify(sim.state.plant.stations.map((s) => s.camera?.cycle ?? s.robot?.steps));
    sim.advance(5);
    expect(JSON.stringify(sim.state.plant.stations.map((s) => s.camera?.cycle ?? s.robot?.steps))).toBe(frozen);
    expect(sim.command({ type: 'start' })).toBe(false);
    expect(sim.command({ type: 'reset' })).toBe(true);
    expect(sim.state.plc.machine).toBe('Stopped');

    const log = sim.drainEvents().filter((e) => e.kind === 'command');
    expect(log.map((e) => e.kind === 'command' && `${e.command}:${e.accepted}`)).toContain('start:false');
  }, 30_000);
});

test('the whole state survives a JSON round trip (needed for remote viewers)', () => {
  const sim = running(9);
  sim.advance(120);
  const s = sim.state;
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
});
