import { describe, expect, test } from 'vitest';
import { LINE, type LineConfig } from './config';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { ItemProcessedEvent, SimEvent, StationStatus } from './types';

function sim(mutate?: (c: LineConfig) => void, seed = 4): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate) });
  s.command({ type: 'start' });
  return s;
}

/** Advances in small steps, calling `each` after every step. */
function run(s: Simulation, seconds: number, each: () => void, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) {
    s.advance(step);
    each();
  }
}

const idx = (id: string) => LINE.stations.findIndex((d) => d.id === id);

describe('robots', () => {
  test('axes never exceed velocity limits (scaled by machine speed)', () => {
    const s = sim();
    s.command({ type: 'speed', percent: 60 });
    let maxH = 0;
    let maxZ = 0;
    run(s, 120, () => {
      for (const r of s.state.plant.stations.flatMap((st) => st.robots)) {
        maxH = Math.max(maxH, Math.abs(r.va) / s.state.plant.speed, Math.abs(r.vr) / s.state.plant.speed);
        maxZ = Math.max(maxZ, Math.abs(r.vz) / s.state.plant.speed);
      }
    }, 0.01);
    expect(maxH).toBeLessThanOrEqual(LINE.robot.vH + 1e-9);
    expect(maxZ).toBeLessThanOrEqual(LINE.robot.vZ + 1e-9);
    expect(maxH).toBeGreaterThan(LINE.robot.vH * 0.3);
  }, 30_000);

  test('loading stations pre-pick: each robot holds its part when its turn on the mover comes', () => {
    const s = sim();
    const i = idx('EM11');
    let turns = 0;
    let ready = 0;
    let last = '';
    let arrivals = 0;
    let heldOnArrival = 0;
    let prev = 'idle';
    run(s, 300, () => {
      const st = s.state.plc.stations[i];
      // The first arm has its part before the mover even arrives.
      if (prev === 'idle' && st.step !== 'idle') {
        arrivals++;
        if (s.state.plant.stations[i].robots[0].holding) heldOnArrival++;
      }
      prev = st.step;
      if (st.step !== 'waitRobot') return;
      // A turn starts when the station first waits for robot `job` on this mover.
      const key = `${st.moverId}/${st.job}`;
      if (key === last) return;
      last = key;
      turns++;
      if (s.state.plant.stations[i].robots[st.job].holding) ready++;
    }, 0.01);
    expect(turns).toBeGreaterThan(160);
    expect(ready / turns).toBeGreaterThan(0.95);
    expect(arrivals).toBeGreaterThan(80);
    expect(heldOnArrival / arrivals).toBeGreaterThan(0.95);
  }, 30_000);
});

describe('feeders, nest and tray', () => {
  test('a slow bowl feeder starves its station and cuts throughput', () => {
    const rate = (interval: number) => {
      const s = sim((c) => (c.feeders.find((f) => f.id === 'bodies')!.interval = interval));
      const seen = new Set<StationStatus>();
      s.advance(120);
      const before = s.state.mes.good + s.state.mes.rejected;
      run(s, 300, () => seen.add(s.state.plc.stations[idx('EM11')].status));
      return { perMin: (s.state.mes.good + s.state.mes.rejected - before) / 5, starved: seen.has('starved') };
    };
    const normal = rate(1.0);
    const slow = rate(6.0);
    expect(slow.starved).toBe(true);
    expect(slow.perMin).toBeLessThan(normal.perMin * 0.6);
    expect(slow.perMin).toBeGreaterThan(5);
  }, 60_000);

  test('an empty nest (tub) of 160 is changed; the collets cover a normal change, but not a very slow one', () => {
    const run10 = (change: number) => {
      const s = sim((c) => (c.cartridges.tub.change = change));
      const cell = s.state.plant.cartridges;
      let changes = 0;
      let was = false;
      let starvedDuringChange = false;
      run(s, 900, () => {
        if (cell.changing > 0 && !was) changes++;
        was = cell.changing > 0;
        if (was && s.state.plc.stations[idx('EM41')].status === 'starved') starvedDuringChange = true;
      });
      return { changes, starvedDuringChange, cartridges: s.state.plc.stations[idx('EM41')].stats.cycles, tubs: cell.tubs };
    };
    const normal = run10(LINE.cartridges.tub.change);
    expect(normal.changes).toBeGreaterThanOrEqual(1);
    // Every change starts after the 160th cartridge (12 collets plus the robot's own may be ahead of EM41).
    expect(normal.changes).toBeLessThanOrEqual(Math.floor((normal.cartridges + LINE.cartridges.collets.count + 1) / 160));
    expect(normal.starvedDuringChange).toBe(false);
    // A change much longer than 12 collets' worth of pens empties the loop.
    expect(run10(120).starvedDuringChange).toBe(true);
  }, 120_000);

  test('full trays index out; a tray never holds more than its size', () => {
    const s = sim();
    let maxFill = 0;
    run(s, 600, () => (maxFill = Math.max(maxFill, s.state.plant.tray.count)));
    expect(maxFill).toBe(LINE.traySize);
    const good = s.state.mes.good;
    const p = s.state.plant;
    // A pen is recorded as good after the robot drops it (next PLC scan), never before.
    const packed = p.pensOut + p.tray.count;
    expect(packed - good).toBeGreaterThanOrEqual(0);
    expect(packed - good).toBeLessThanOrEqual(1);
  }, 60_000);
});

test('parts are conserved: every body leaving the feeder is on a mover, in a gripper, in a bin or in a tray', () => {
  const s = sim();
  const initialOnTrack = s.state.plant.feeders.find((f) => f.id === 'bodies')!.items.length;
  const events: SimEvent[] = [];
  run(s, 900, () => events.push(...s.drainEvents()), 1);
  const p = s.state.plant;
  const bodies = p.feeders.find((f) => f.id === 'bodies')!;
  const leftFeeder = bodies.fed + initialOnTrack - bodies.items.length;

  const onMovers = p.movers.filter((m) => m.load).length;
  const inGrippers = p.stations.flatMap((st) => st.robots).filter((r) => r.holding && (r.holding.kind === 'pen' || r.holding.parts.includes('body'))).length;
  // Pen reject bins only; the sub-line chutes hold springs and spring bases.
  const inBins = LINE.stations.filter((d) => d.bin).reduce((a, d) => a + p.bins[d.bin!], 0);
  const packed = p.pensOut + p.tray.count;
  // EM11's spring robot also scraps there, but only springs: with no misplaced parts nothing is scrapped.
  const scrappedBodies = p.scrap.EM11 ?? 0;
  expect(onMovers + inGrippers + inBins + packed + scrappedBodies).toBe(leftFeeder);

  const loaded = events.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process.endsWith('EM11'));
  // EM11 reports a pen when its cycle ends (spring mounted, laser done), so one may be placed but not yet reported.
  const em11 = s.state.plc.stations[idx('EM11')];
  const inCycle = em11.step === 'waitRobot' || em11.step === 'working';
  const placedUnreported = inCycle && (em11.job > 0 || (em11.step === 'working' && !p.stations[idx('EM11')].robots[0].holding)) ? 1 : 0;
  const unreported = (p.stations[idx('EM11')].robots[0].holding ? 1 : 0) + placedUnreported;
  expect(loaded.length).toBe(leftFeeder - unreported);
}, 60_000);
