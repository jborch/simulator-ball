// Physical interlocks, insertion strokes and run-out behaviour of the station equipment.
import { describe, expect, test } from 'vitest';
import { LINE } from './config';
import { seatedTip } from './layout';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { ItemProcessedEvent, SimEvent } from './types';

const idx = (id: string) => LINE.stations.findIndex((d) => d.id === id);

function sim(mutate?: Parameters<typeof steadyConfig>[0], seed = 5): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate) });
  s.command({ type: 'start' });
  return s;
}

test("nest and tray changes only start with the robot's gripper clear of them", () => {
  const s = sim();
  const p = s.state.plant;
  const safe = LINE.layout.z.safe - 1e-6;
  let nestChanges = 0;
  let trayChanges = 0;
  let prevTray = 0;
  let prevNest = 0;
  for (let t = 0; t < 900; t += 0.01) {
    s.advance(0.01);
    if (p.cartridges.changing > 0 && prevNest === 0) {
      nestChanges++;
      expect(p.cartridges.robot.z).toBeGreaterThanOrEqual(safe);
    }
    prevNest = p.cartridges.changing;
    if (p.tray.changing > 0 && prevTray === 0) {
      trayChanges++;
      expect(p.stations[idx('EM60')].robots[0].z).toBeGreaterThanOrEqual(safe);
    }
    prevTray = p.tray.changing;
  }
  expect(nestChanges).toBeGreaterThan(0);
  expect(trayChanges).toBeGreaterThan(0);
}, 60_000);

test('a cartridge is pushed home slowly from above the body during the press time', () => {
  const s = sim();
  const robot = s.state.plant.stations[idx('EM41')].robots[0];
  const def = LINE.stations[idx('EM41')].robots![0];
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

/** Runs until the machine is Complete (or the time limit), collecting events. */
function untilComplete(s: Simulation, limit: number, each?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < limit && s.state.plc.machine !== 'Complete'; t += 0.1) {
    s.advance(0.1);
    each?.();
    events.push(...s.drainEvents());
  }
  return events;
}

const trayRecords = (es: SimEvent[], suffix: string) =>
  es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.itemType === 'Tray' && e.process.endsWith(suffix));

test('fill to count: a batch ends on full trays, each checked by EM61, despite rejects on the way', () => {
  // Small trays keep the test short; the count is in trays, as EM61 counts them.
  const s = sim((c) => {
    c.traySize = 4;
    c.batch.size = 3;
  });
  const events = untilComplete(s, 600);
  const p = s.state.plant;
  const b = s.state.plc.batch!;
  expect(s.state.plc.machine).toBe('Complete');
  expect(b.good).toBe(12);
  expect(b.loaded).toBe(b.good + b.rejected);
  expect(b.trays).toBe(3);
  expect(p.tray.count).toBe(0);
  expect(p.pensOut).toBe(12);
  expect(trayRecords(events, '-TRAY').map((e) => e.properties?.['Tray Count'])).toEqual([4, 4, 4]);
  expect(trayRecords(events, 'EM61').map((e) => e.result)).toEqual(['Passed', 'Passed', 'Passed']);
  expect(p.trayLine.stacked).toBe(3);
}, 60_000);

test('a batch ended early sends its part-filled tray out, and EM61 rejects it as incomplete', () => {
  const s = sim((c) => {
    c.traySize = 8;
    c.batch.size = 10;
  });
  for (let t = 0; t < 400 && s.state.plant.tray.count < 3; t += 0.1) s.advance(0.1);
  expect(s.state.plant.tray.count).toBeGreaterThanOrEqual(3);
  expect(s.command({ type: 'endBatch' })).toBe(true);
  const events = untilComplete(s, 400);
  const b = s.state.plc.batch!;
  expect(s.state.plc.machine).toBe('Complete');
  const checked = trayRecords(events, 'EM61');
  const last = checked.at(-1)!;
  expect(last.properties?.['Tray Count']).toBeLessThan(8);
  expect(last.result).toBe('Failed');
  expect(last.properties?.['Reject Cause']).toBe('Tray packing incomplete');
  expect(b.traysRejected).toBe(1);
  expect(s.state.plant.trayLine.rejected).toBe(1);
}, 60_000);

test('once Complete, no robot is moving and none picked parts for pens that will never come', () => {
  const s = sim((c) => {
    c.traySize = 4;
    c.batch.size = 1;
  });
  untilComplete(s, 600);
  expect(s.state.plc.machine).toBe('Complete');
  const robots = s.state.plant.stations.flatMap((ps) => ps.robots);
  expect(robots.every((r) => r.job === null)).toBe(true);
  // The loading robot doesn't fetch a body for a pen beyond the batch.
  expect(s.state.plant.stations[idx('EM11')].robots[0].holding).toBeNull();
  const z = robots.map((r) => r.z);
  s.advance(5);
  expect(robots.map((r) => r.z)).toEqual(z);
}, 60_000);

test('the spring base presses pass no movers on to a faulted EM14D, and keep working', () => {
  const s = sim();
  const others = ['EM14A', 'EM14B', 'EM14C'].map((id) => s.state.plc.stations[idx(id)]);
  const d = s.state.plc.stations[idx('EM14D')];
  s.advance(90);
  // Fault D while it's idle. A mover already promised to it stays committed (it waits for the repair).
  for (let t = 0; t < 60 && d.step !== 'idle'; t += 0.01) s.advance(0.01);
  expect(d.step).toBe('idle');
  const promised = d.reserved;
  expect(s.command({ type: 'fault', target: 'EM14D' })).toBe(true);
  const robotD = s.state.plant.stations[idx('EM14D')].robots[0];
  const before = others.map((x) => x.stats.cycles);
  let reservedWhileFaulted = false;
  for (let t = 0; t < 30 && robotD.fault > 0; t += 0.01) {
    s.advance(0.01);
    if (d.reserved !== null && d.reserved !== promised) reservedWhileFaulted = true;
  }
  expect(reservedWhileFaulted).toBe(false);
  others.forEach((x, i) => expect(x.stats.cycles).toBeGreaterThan(before[i]));
}, 60_000);

test('pens whose body was lost at loading still close their batch (the reject robot comes up empty)', () => {
  const s = sim((c) => {
    c.batch.size = 1;
    c.faults.enabled = true;
    c.faults.misplaceRate = 1;
    c.faults.feederJamPerPart = 0;
    c.faults.robotMtbf = 1e9;
  });
  // Every part is lost, so the batch could never fill a tray: end it once a few pens are loaded.
  for (let t = 0; t < 60 && s.state.plc.batch!.loaded < 3; t += 0.1) s.advance(0.1);
  expect(s.command({ type: 'endBatch' })).toBe(true);
  untilComplete(s, 400);
  const b = s.state.plc.batch!;
  expect(s.state.plc.machine).toBe('Complete');
  expect(b.loaded).toBeGreaterThanOrEqual(3);
  expect(b.rejected).toBe(b.loaded);
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
}, 60_000);

test('the 4-up spring base presses take consecutive movers and work at the same time', () => {
  const s = sim();
  const members = ['EM14A', 'EM14B', 'EM14C', 'EM14D'].map((id) => s.cfg.stations.findIndex((d) => d.id === id));
  let maxBusy = 0;
  for (let t = 0; t < 300; t += 0.05) {
    s.advance(0.05);
    const busy = members.filter((i) => s.state.plc.stations[i].step === 'working').length;
    maxBusy = Math.max(maxBusy, busy);
  }
  const cycles = members.map((i) => s.state.plc.stations[i].stats.cycles);
  expect(maxBusy).toBe(4);
  const total = cycles.reduce((a, b) => a + b, 0);
  for (const c of cycles) expect(c / total).toBeGreaterThan(0.18);
}, 60_000);

describe('arms sharing a gantry', () => {
  const clearance = LINE.robot.armClearance;
  const gap = (s: Simulation) => {
    const [body, spring] = s.state.plant.stations[idx('EM11')].robots;
    return spring.a - body.a;
  };

  test('never come closer than the clearance in normal work', () => {
    const s = sim();
    let min = Infinity;
    for (let t = 0; t < 120; t += 0.002) {
      s.advance(0.002);
      min = Math.min(min, gap(s));
    }
    expect(min).toBeGreaterThanOrEqual(clearance - 1e-9);
  }, 60_000);

  test('the spring arm waits for a body arm that faults over the mover, and works once it is repaired', () => {
    const s = sim();
    const [body, spring] = s.state.plant.stations[idx('EM11')].robots;
    // Freeze the body arm right as it starts back home from the mover.
    for (let t = 0; t < 60 && !(body.steps[0]?.k === 'leave' && body.stepStarted); t += 0.001) s.advance(0.001);
    expect(body.steps[0]?.k).toBe('leave');
    body.fault = 5;
    let min = Infinity;
    for (let t = 0; t < 4.9; t += 0.002) {
      s.advance(0.002);
      min = Math.min(min, gap(s));
    }
    expect(min).toBeGreaterThanOrEqual(clearance - 1e-9);
    // Still waiting beside the mover with its spring.
    expect(spring.job).toBe('place');
    expect(spring.holding).not.toBeNull();
    const cycles = s.state.plc.stations[idx('EM11')].stats.cycles;
    s.advance(5);
    expect(s.state.plc.stations[idx('EM11')].stats.cycles).toBeGreaterThan(cycles);
  }, 60_000);
});
