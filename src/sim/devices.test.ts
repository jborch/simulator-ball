import { describe, expect, test } from 'vitest';
import { LINE, type LineConfig } from './config';
import { Simulation } from './simulation';
import type { ItemProcessedEvent, SimEvent, StationStatus } from './types';

function sim(mutate?: (c: LineConfig) => void, seed = 4): Simulation {
  const cfg: LineConfig = structuredClone(LINE);
  mutate?.(cfg);
  const s = new Simulation({ seed, cfg });
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
      for (const st of s.state.plant.stations) {
        if (!st.robot) continue;
        maxH = Math.max(maxH, Math.abs(st.robot.va) / s.state.plant.speed, Math.abs(st.robot.vr) / s.state.plant.speed);
        maxZ = Math.max(maxZ, Math.abs(st.robot.vz) / s.state.plant.speed);
      }
    }, 0.01);
    expect(maxH).toBeLessThanOrEqual(LINE.robot.vH + 1e-9);
    expect(maxZ).toBeLessThanOrEqual(LINE.robot.vZ + 1e-9);
    expect(maxH).toBeGreaterThan(LINE.robot.vH * 0.3);
  }, 30_000);

  test('loading stations pre-pick: the robot holds a part before the mover arrives', () => {
    const s = sim();
    let held = 0;
    let arrivals = 0;
    let prev = 'idle';
    run(s, 300, () => {
      const step = s.state.plc.stations[idx('ST20')].step;
      if (prev === 'idle' && step !== 'idle') {
        arrivals++;
        if (s.state.plant.stations[idx('ST20')].robot!.holding) held++;
      }
      prev = step;
    }, 0.01);
    expect(arrivals).toBeGreaterThan(80);
    expect(held / arrivals).toBeGreaterThan(0.95);
  }, 30_000);
});

describe('feeders, nest and tray', () => {
  test('a slow bowl feeder starves its station and cuts throughput', () => {
    const rate = (interval: number) => {
      const s = sim((c) => (c.feeders.find((f) => f.id === 'bodies')!.interval = interval));
      const seen = new Set<StationStatus>();
      s.advance(120);
      const before = s.state.mes.good + s.state.mes.rejected;
      run(s, 300, () => seen.add(s.state.plc.stations[idx('ST10')].status));
      return { perMin: (s.state.mes.good + s.state.mes.rejected - before) / 5, starved: seen.has('starved') };
    };
    const normal = rate(1.0);
    const slow = rate(6.0);
    expect(slow.starved).toBe(true);
    expect(slow.perMin).toBeLessThan(normal.perMin * 0.6);
    expect(slow.perMin).toBeGreaterThan(5);
  }, 60_000);

  test('each nest is changed after 24 cartridges; a slow change starves its station', () => {
    // The robot pre-picks a spare cartridge, which covers the normal 4 s change; a 15 s one doesn't.
    const s = sim((c) => (c.nestChange = 15));
    let changes = 0;
    let wasChanging = false;
    let starvedDuringChange = false;
    run(s, 600, () => {
      const n = s.state.plant.nests.find((x) => x.station === 'ST40A')!;
      if (n.changing > 0 && !wasChanging) changes++;
      wasChanging = n.changing > 0;
      if (wasChanging && s.state.plc.stations[idx('ST40A')].status === 'starved') starvedDuringChange = true;
    });
    const cartridges = s.state.plc.stations[idx('ST40A')].stats.cycles;
    // The robot may hold one pre-picked cartridge not yet inserted.
    expect(changes).toBeGreaterThanOrEqual(Math.floor(cartridges / LINE.nestSize));
    expect(changes).toBeLessThanOrEqual(Math.floor((cartridges + 1) / LINE.nestSize));
    expect(starvedDuringChange).toBe(true);
  }, 60_000);

  test('full trays index out; a tray never holds more than its size', () => {
    const s = sim();
    let maxFill = 0;
    run(s, 600, () => (maxFill = Math.max(maxFill, s.state.plant.tray.count)));
    expect(maxFill).toBe(LINE.traySize);
    const good = s.state.mes.good;
    const p = s.state.plant;
    expect(p.traysOut * LINE.traySize + p.tray.count).toBeGreaterThanOrEqual(good - 1);
    expect(p.traysOut * LINE.traySize + p.tray.count).toBeLessThanOrEqual(good);
  }, 60_000);
});

test('parts are conserved: every body leaving the feeder is on a mover, in a gripper, in a bin or in a tray', () => {
  const s = sim();
  const events: SimEvent[] = [];
  run(s, 900, () => events.push(...s.drainEvents()), 1);
  const p = s.state.plant;
  const bodies = p.feeders.find((f) => f.id === 'bodies')!;
  const initialOnTrack = Math.floor((LINE.feeders[0].track - LINE.feeders[0].pitch) / LINE.feeders[0].pitch + 1e-9) + 1;
  const leftFeeder = bodies.fed + initialOnTrack - bodies.items.length;

  const onMovers = p.movers.filter((m) => m.load).length;
  const inGrippers = p.stations.filter((st) => st.robot?.holding).filter((st) => st.robot!.holding!.kind === 'pen' || st.robot!.holding!.parts.includes('body')).length;
  const inBins = Object.values(p.bins).reduce((a, b) => a + b, 0);
  const packed = p.traysOut * LINE.traySize + p.tray.count;
  expect(onMovers + inGrippers + inBins + packed).toBe(leftFeeder);

  const loaded = events.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process.endsWith('ST10'));
  expect(loaded.length).toBe(leftFeeder - (p.stations[idx('ST10')].robot!.holding ? 1 : 0));
}, 60_000);
