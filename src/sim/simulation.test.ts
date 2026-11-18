import { beforeAll, describe, expect, test } from 'vitest';
import { LINE } from './config';
import { gtinWithCheck } from './gs1';
import { tubSize } from './cartridges';
import { processId, stationById, subProcessId } from './machine';
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

/** Process id of a station, optionally with a suffix: 'EM60-REJECT' → 'L07-UN03-EM60-REJECT'. */
const pid = (id: string) => {
  const [station, ...rest] = id.split('-');
  return [processId(LINE, stationById(LINE, station)), ...rest].join('-');
};

const processed = (es: SimEvent[], process?: string) =>
  es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && (!process || e.process === pid(process)));

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
    const presses = ['EM14A', 'EM14B', 'EM14C', 'EM14D'].map((id) => processed(events, id).length).join(' / ');
    console.log(`60 min: ${good} good, ${rejected} rejected (${((100 * rejected) / (good + rejected)).toFixed(2)} %), EM14A–D ${presses}`, rejectsByCause);
  }, 120_000);

  test('throughput is around 21 pens/min with the 4-up spring base presses as bottleneck', () => {
    const out = processed(events, 'EM60').length + processed(events, 'EM60-REJECT').length + processed(events, 'R1').length;
    const perMin = out / minutes;
    expect(perMin).toBeGreaterThan(19);
    expect(perMin).toBeLessThan(24);
  });

  test('EM60 reports packed pens on its own process and rejects on its reject bin', () => {
    const packed = processed(events, 'EM60');
    const binned = processed(events, 'EM60-REJECT');
    expect(packed.length).toBeGreaterThan(0);
    expect(binned.length).toBeGreaterThan(0);
    for (const e of packed) expect(e.properties?.['Tray Position']).toBeDefined();
    for (const e of [...binned, ...processed(events, 'R1')]) expect(e.properties?.['Reject Cause']).toBeDefined();
  });

  test("reject rate is about 17 %, as the original line's quality figures give", () => {
    // Mostly EM14B (~31 % of its pens) and the original's bad movers (most of mover 2's pens).
    const { good, rejected } = sim.state.mes;
    const rate = rejected / (good + rejected);
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.22);
  });

  test('the four spring base presses share the work and process at the same time', () => {
    const recs = ['EM14A', 'EM14B', 'EM14C', 'EM14D'].map((id) => processed(events, id));
    const total = recs.reduce((n, r) => n + r.length, 0);
    for (const r of recs) expect(r.length / total).toBeGreaterThan(0.2);
    const [a, ...rest] = recs;
    const overlapping = a.filter((x) => rest.every((ys) => ys.some((y) => x.from < y.to && y.from < x.to)));
    expect(overlapping.length / a.length).toBeGreaterThan(0.6);
  });
  test('EM14B is the outlier of the four spring base presses, logged on the spring base', () => {
    const rate = (id: string) => {
      const xs = processed(events, id);
      expect(xs.every((e) => e.itemType === 'SpringBase' && e.carrier)).toBe(true);
      return xs.filter((e) => e.result === 'Failed').length / xs.length;
    };
    const others = ['EM14A', 'EM14C', 'EM14D'].map(rate);
    for (const r of others) expect(r).toBeLessThan(0.12);
    expect(rate('EM14B')).toBeGreaterThan(0.2);
    expect(rate('EM14B')).toBeGreaterThan(3 * Math.max(...others));
  });

  test("the original's bad movers are rejected more, the worse the more (badness 2: 22, 24: 12)", () => {
    const m = sim.state.mes.movers;
    const rate = (id: number) => m[id].rejects / (m[id].pens + m[id].rejects);
    const good = Object.keys(m).map(Number).filter((id) => ![2, 6, 24].includes(id));
    const avg = good.reduce((sum, id) => sum + rate(id), 0) / good.length;
    expect(rate(24)).toBeGreaterThan(avg * 1.5);
    expect(rate(2)).toBeGreaterThan(rate(24));
    expect(rate(2)).toBeGreaterThan(0.5);
  });

  test('each good pen has full genealogy: spring, spring base, cartridge (from a nest), housing and a tray', () => {
    const merged = events.filter((e): e is ItemsMergedEvent => e.kind === 'merged');
    const goods = processed(events, 'EM60').filter((e) => e.itemType === 'Pen' && e.properties?.['Tray Position'] !== undefined);
    const byTarget = new Map<number, string[]>();
    for (const e of merged) byTarget.set(e.target, [...(byTarget.get(e.target) ?? []), e.sourceType]);
    const trayed = new Set(merged.filter((e) => e.sourceType === 'Pen').map((e) => e.source));
    // Pens loaded before the collection window started miss early merges; check those fully inside it.
    const loaded = new Set(processed(events, 'EM11').map((e) => e.scopedId));
    const inside = goods.filter((g) => loaded.has(g.scopedId));
    expect(inside.length).toBeGreaterThan(500);
    for (const g of inside) {
      expect(byTarget.get(g.scopedId)?.sort()).toEqual(['Cartridge', 'Housing', 'Spring', 'SpringBase']);
      expect(trayed.has(g.scopedId)).toBe(true);
    }
    // Cartridges come from EM00, out of a nest of 160, each carried in a collet.
    const cartridges = processed(events).filter((e) => e.itemType === 'Cartridge');
    expect(cartridges.length).toBeGreaterThan(500);
    for (const c of cartridges) {
      expect(c.process).toBe(subProcessId(LINE, LINE.cartridges.denest));
      expect(c.sourceType).toBe('Nest');
      expect(c.sourcePosition).toBeLessThan(tubSize(LINE));
      expect(c.carrier).toMatch(/^C\d\d$/);
    }
  });

  test('EM31 labels the housing with a GS1 identifier; the pen wears it from EM40 and EM50 reads it back', () => {
    const em31 = events.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process === subProcessId(LINE, LINE.dial.label));
    const gtin = gtinWithCheck(LINE.gs1.gtin);
    const labels = new Map(em31.map((e) => [e.scopedId, e.identifier!]));
    for (const id of labels.values()) expect(id).toMatch(new RegExp(`^\\(01\\)${gtin}\\(17\\)\\d{6}\\(10\\)B\\d{6}\\(21\\)[0-9A-Z]{12}$`));
    // The housing EM40 put on each pen tells which label the pen wears.
    const housingOf = new Map(
      events.filter((e): e is ItemsMergedEvent => e.kind === 'merged' && e.sourceType === 'Housing').map((m) => [m.target, m.source]),
    );
    const reads = processed(events, 'EM50').filter((e) => labels.has(housingOf.get(e.scopedId)!) && e.properties?.['Code Read']);
    expect(reads.length).toBeGreaterThan(500);
    for (const r of reads) {
      const label = labels.get(housingOf.get(r.scopedId)!);
      expect(r.properties!['Code Read']).toBe(label);
      expect(r.identifier).toBe(label);
    }
  });

  test('event timestamps follow sim time and cycles take real time', () => {
    const em41 = processed(events, 'EM41').filter((e) => e.itemType === 'Pen');
    expect(em41.length).toBeGreaterThan(500);
    for (const e of em41) expect(e.to - e.from).toBeGreaterThanOrEqual(stationById(LINE, 'EM41').robots![0].mech * 1000 - 1);
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
    const frozen = JSON.stringify(sim.state.plant.stations.map((s) => s.camera?.cycle ?? s.robots.map((r) => r.steps)));
    sim.advance(5);
    expect(JSON.stringify(sim.state.plant.stations.map((s) => s.camera?.cycle ?? s.robots.map((r) => r.steps)))).toBe(frozen);
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
