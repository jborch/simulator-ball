// Physical interlocks, insertion strokes and run-out behaviour of the station equipment.
import { expect, test } from 'vitest';
import { LINE } from './config';
import { seatedTip } from './layout';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { SimEvent } from './types';

const idx = (id: string) => LINE.stations.findIndex((d) => d.id === id);

function sim(mutate?: Parameters<typeof steadyConfig>[0], seed = 5): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate) });
  s.command({ type: 'start' });
  return s;
}

test('nests and trays are only changed with the robot gripper clear of them', () => {
  const s = sim();
  const p = s.state.plant;
  const safe = LINE.layout.z.safe - 1e-6;
  let nestChanges = 0;
  let trayChanges = 0;
  let prevTray = 0;
  const prevNest = new Map<string, number>();
  for (let t = 0; t < 400; t += 0.01) {
    s.advance(0.01);
    for (const n of p.nests) {
      if (n.changing > 0 && !(prevNest.get(n.station)! > 0)) {
        nestChanges++;
        expect(p.stations[idx(n.station)].robot!.z).toBeGreaterThanOrEqual(safe);
      }
      prevNest.set(n.station, n.changing);
    }
    if (p.tray.changing > 0 && prevTray === 0) {
      trayChanges++;
      expect(p.stations[idx('ST70')].robot!.z).toBeGreaterThanOrEqual(safe);
    }
    prevTray = p.tray.changing;
  }
  expect(nestChanges).toBeGreaterThan(0);
  expect(trayChanges).toBeGreaterThan(0);
}, 60_000);

test('a cartridge is pushed home slowly from above the body during the press time', () => {
  const s = sim();
  const robot = s.state.plant.stations[idx('ST40A')].robot!;
  const def = LINE.stations[idx('ST40A')];
  const seated = seatedTip(LINE, def.parts!);
  const heights: number[] = [];
  for (let t = 0; t < 120 && heights.length < 50; t += 0.01) {
    s.advance(0.01);
    if (robot.phase === 'press') heights.push(robot.z);
  }
  expect(heights.length).toBeGreaterThan(20);
  expect(heights[0]).toBeGreaterThan(seated + def.insert! * 0.9);
  for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
  expect(heights.at(-1)!).toBeGreaterThanOrEqual(seated);
}, 60_000);

test("a batch's last, partly filled tray goes out before the batch completes", () => {
  const s = sim((c) => (c.batch.size = 5));
  const events: SimEvent[] = [];
  for (let t = 0; t < 300 && s.state.plc.machine !== 'Complete'; t += 0.1) {
    s.advance(0.1);
    events.push(...s.drainEvents());
  }
  const p = s.state.plant;
  const b = s.state.plc.batch!;
  expect(s.state.plc.machine).toBe('Complete');
  expect(p.tray.count).toBe(0);
  expect(p.pensOut).toBe(b.good);
  expect(s.state.plc.tray.count).toBe(0);
  const trays = events.filter((e) => e.kind === 'processed' && e.itemType === 'Tray');
  expect(trays).toHaveLength(1);
  expect(trays[0].kind === 'processed' && trays[0].properties?.['Tray Count']).toBe(b.good);
}, 60_000);

test('once Complete, no robot is moving and none picked parts for pens that will never come', () => {
  const s = sim((c) => (c.batch.size = 5));
  for (let t = 0; t < 300 && s.state.plc.machine !== 'Complete'; t += 0.1) s.advance(0.1);
  expect(s.state.plc.machine).toBe('Complete');
  const robots = s.state.plant.stations.map((ps) => ps.robot).filter((r) => r !== null);
  expect(robots.every((r) => r.job === null)).toBe(true);
  // The loading robot doesn't fetch a body for a pen beyond the batch.
  expect(s.state.plant.stations[idx('ST10')].robot!.holding).toBeNull();
  const z = robots.map((r) => r.z);
  s.advance(5);
  expect(robots.map((r) => r.z)).toEqual(z);
}, 60_000);

test('ST40A does not pass movers on to a faulted ST40B', () => {
  const s = sim();
  const a = s.state.plc.stations[idx('ST40A')];
  const b = s.state.plc.stations[idx('ST40B')];
  s.advance(60);
  // Fault B while it's free; a busy B would never be offered a mover anyway.
  for (let t = 0; t < 30 && !(b.step === 'idle' && !b.reserved); t += 0.01) s.advance(0.01);
  expect(s.command({ type: 'fault', target: 'ST40B' })).toBe(true);
  const robotB = s.state.plant.stations[idx('ST40B')].robot!;
  const cyclesA = a.stats.cycles;
  let reservedWhileFaulted = false;
  for (let t = 0; t < 30 && robotB.fault > 0; t += 0.01) {
    s.advance(0.01);
    if (b.reserved && b.step === 'idle') reservedWhileFaulted = true;
  }
  expect(reservedWhileFaulted).toBe(false);
  expect(a.stats.cycles).toBeGreaterThan(cyclesA);
}, 60_000);

test('a pen whose body was lost at loading still closes its batch (the reject robot comes up empty)', () => {
  const s = sim((c) => {
    c.batch.size = 1;
    c.faults.enabled = true;
    c.faults.misplaceRate = 1;
    c.faults.feederJamPerPart = 0;
    c.faults.robotMtbf = 1e9;
  });
  for (let t = 0; t < 240 && s.state.plc.machine !== 'Complete'; t += 0.1) s.advance(0.1);
  const b = s.state.plc.batch!;
  expect(s.state.plc.machine).toBe('Complete');
  expect(b.rejected).toBe(1);
  expect(s.state.plc.stations.every((st) => st.output === null)).toBe(true);
}, 60_000);

test('Hold waits for a running tray change, so nothing moves once Held', () => {
  const s = sim();
  const p = s.state.plant;
  for (let t = 0; t < 300 && p.tray.changing === 0; t += 0.01) s.advance(0.01);
  expect(p.tray.changing).toBeGreaterThan(0);
  s.command({ type: 'hold' });
  for (let t = 0; t < 60 && s.state.plc.machine !== 'Held'; t += 0.01) s.advance(0.01);
  expect(s.state.plc.machine).toBe('Held');
  expect(p.tray.changing).toBe(0);
  expect(p.nests.every((n) => n.changing === 0)).toBe(true);
}, 60_000);
