// Regression tests for issues found in code review.
import { expect, test } from 'vitest';
import { LINE } from './config';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { ItemProcessedEvent, SimEvent } from './types';

const idx = (id: string) => LINE.stations.findIndex((d) => d.id === id);

function sim(mutate?: Parameters<typeof steadyConfig>[0], seed = 3): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate) });
  s.command({ type: 'start' });
  return s;
}

/** Advances in small steps until `done` is true (or the time limit). Returns whether it happened. */
function until(s: Simulation, done: () => boolean, limit = 120, step = 0.005): boolean {
  for (let t = 0; t < limit; t += step) {
    if (done()) return true;
    s.advance(step);
  }
  return done();
}

test('a station whose tag write keeps failing holds the mover in fault until the write succeeds', () => {
  const s = sim();
  const st = s.state.plc.stations[idx('ST10')];
  // Wait for ST10 to start loading a body, then make that mover's tag unwritable.
  expect(until(s, () => st.step === 'waitRobot' || st.step === 'working')).toBe(true);
  const mover = s.state.plant.movers[st.moverId! - 1];
  const reliable = mover.profile.rfidOk;
  mover.profile.rfidOk = 0;

  expect(until(s, () => st.status === 'fault')).toBe(true);
  s.advance(10);
  expect(st.status).toBe('fault');
  expect(st.moverId).toBe(mover.id);
  expect(s.state.plant.stations[idx('ST10')].gateClosed).toBe(true);
  expect(mover.load).not.toBeNull();
  expect(mover.tag.status).toBe('empty');

  mover.profile.rfidOk = reliable;
  expect(until(s, () => st.step === 'leaving' || st.step === 'idle', 10)).toBe(true);
  expect(mover.tag.status).toBe('ok');
  expect(mover.tag.srId).toBe(mover.load!.srId);
  const messages = s.drainEvents().filter((e) => e.kind === 'station').map((e) => e.kind === 'station' && e.message);
  expect(messages).toEqual(expect.arrayContaining(['RFID write failed: holding mover', 'RFID write recovered']));
}, 30_000);

test('after an E-stop, Reset leaves the equipment frozen until Start', () => {
  const s = sim();
  const robot = s.state.plant.stations[idx('ST20')].robot!;
  expect(until(s, () => robot.job === 'place' && robot.vz !== 0)).toBe(true);
  s.command({ type: 'abort' });
  s.advance(0.02);
  s.command({ type: 'reset' });
  expect(s.state.plc.machine).toBe('Stopped');
  const z = robot.z;
  const steps = robot.steps.length;
  s.advance(3);
  expect(robot.z).toBe(z);
  expect(robot.steps.length).toBe(steps);

  s.command({ type: 'start' });
  expect(until(s, () => robot.job !== 'place', 10)).toBe(true);
}, 30_000);

test('a batch completes only after its last pen is physically in the tray or bin', () => {
  const s = sim((c) => (c.batch.size = 1));
  let checked = false;
  expect(
    until(
      s,
      () => {
        if (s.state.plc.machine !== 'Complete') return false;
        const p = s.state.plant;
        const packed = p.pensOut + p.tray.count;
        const binned = Object.values(p.bins).reduce((a, b) => a + b, 0);
        const b = s.state.plc.batch!;
        expect(packed).toBe(b.good);
        expect(binned).toBe(b.rejected);
        expect(p.stations.every((st) => !st.robot?.holding || st.robot.holding.kind === 'part')).toBe(true);
        checked = true;
        return true;
      },
      180,
      0.01,
    ),
  ).toBe(true);
  expect(checked).toBe(true);
}, 30_000);

test('a missing measurement is reported as null, so JSON transport keeps it unchanged', () => {
  const s = sim((c) => {
    c.faults.enabled = true;
    c.faults.misplaceRate = 0.2;
    c.faults.feederJamPerPart = 0;
    c.faults.robotMtbf = 1e9;
  });
  const events: SimEvent[] = [];
  for (let t = 0; t < 300; t++) {
    s.advance(1);
    events.push(...s.drainEvents());
  }
  // Inspection records (not the later reject records, which only carry the cause).
  const missing = events.filter(
    (e): e is ItemProcessedEvent => e.kind === 'processed' && e.properties?.['Reject Cause'] === 'Part missing' && 'Inspection Value' in e.properties,
  );
  expect(missing.length).toBeGreaterThan(0);
  for (const e of missing) {
    expect(e.properties!['Inspection Value']).toBeNull();
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  }
}, 30_000);
