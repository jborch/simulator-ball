import { describe, expect, test } from 'vitest';
import { LINE, type LineConfig } from './config';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { BatchEvent, ItemProcessedEvent, MachineState, SimEvent, StationEvent } from './types';

function sim(mutate?: (c: LineConfig) => void, seed = 8): Simulation {
  const s = new Simulation({ seed, cfg: steadyConfig(mutate), epochMs: Date.UTC(2026, 10, 14, 8) });
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

const idx = (id: string) => LINE.stations.findIndex((d) => d.id === id);
const stationEvents = (es: SimEvent[]) => es.filter((e): e is StationEvent => e.kind === 'station');

describe('faults', () => {
  test('an injected robot fault freezes the station, holds its mover and clears after the repair time', () => {
    const s = sim();
    s.advance(60);
    expect(s.command({ type: 'fault', target: 'EM11-SPRING' })).toBe(true);
    const robot = s.state.plant.stations[idx('EM11')].robots[1];
    const repair = robot.fault;
    expect(repair).toBeGreaterThanOrEqual(LINE.faults.robotRepair[0]);
    expect(repair).toBeLessThanOrEqual(LINE.faults.robotRepair[1]);

    const goodBefore = s.state.mes.good;
    let faultStatus = 0;
    const es = collect(s, repair - 1, () => {
      if (s.state.plc.stations[idx('EM11')].status === 'fault') faultStatus++;
    });
    expect(faultStatus).toBeGreaterThan(0);
    expect(robot.fault).toBeGreaterThan(0);
    // Downstream drains while the queue builds behind EM11; the machine itself keeps running.
    expect(s.state.plc.machine).toBe('Execute');
    expect(stationEvents(es).map((e) => e.message)).toContain('Axis fault (EM11-SPRING): operator called');

    const after = collect(s, 5);
    expect(robot.fault).toBe(0);
    expect(stationEvents(after).map((e) => e.message)).toContain('Axis fault cleared (EM11-SPRING)');
    expect(s.state.plc.stations[idx('EM11')].stats.faultTime).toBeGreaterThan(repair - 1.5);
    expect(s.state.mes.good).toBeGreaterThan(goodBefore);
  }, 30_000);

  test('a feeder jam stops feeding, the track drains and the station starves until it is cleared', () => {
    const s = sim();
    s.advance(60);
    s.command({ type: 'fault', target: 'bodies' });
    const feeder = s.state.plant.feeders.find((f) => f.id === 'bodies')!;
    const fedAtJam = feeder.fed;
    let starved = false;
    const es = collect(s, feeder.jam - 0.5, () => {
      if (s.state.plc.stations[idx('EM11')].status === 'starved') starved = true;
    });
    expect(feeder.fed).toBe(fedAtJam);
    expect(starved).toBe(true);
    expect(stationEvents(es).some((e) => e.message.startsWith('Feeder jam (bodies)'))).toBe(true);
    collect(s, 10);
    expect(feeder.fed).toBeGreaterThan(fedAtJam);
  }, 30_000);

  test('a part that does not seat is scrapped and a later inspection rejects the pen as "Part missing"', () => {
    const s = sim((c) => {
      c.faults.enabled = true;
      c.faults.misplaceRate = 0.05;
      c.faults.feederJamPerPart = 0;
      c.faults.robotMtbf = 1e9;
    });
    const es = collect(s, 900, undefined, 1);
    const scrap = Object.values(s.state.plant.scrap).reduce((a, b) => a + b, 0);
    expect(scrap).toBeGreaterThan(20);
    const missing = es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.properties?.['Reject Cause'] === 'Part missing');
    expect(missing.length).toBeGreaterThan(10);
  }, 60_000);

  test('with default random faults the line still runs, at lower throughput', () => {
    const rate = (enabled: boolean) => {
      const s = sim((c) => (c.faults.enabled = enabled), 21);
      s.advance(120);
      const before = s.state.mes.good;
      const es = collect(s, 3600, undefined, 5);
      return { perMin: (s.state.mes.good - before) / 60, faults: stationEvents(es).filter((e) => e.message.includes('operator called')).length };
    };
    const clean = rate(false);
    const faulty = rate(true);
    expect(faulty.faults).toBeGreaterThan(3);
    expect(faulty.perMin).toBeLessThan(clean.perMin);
    expect(faulty.perMin).toBeGreaterThan(clean.perMin * 0.6);
  }, 120_000);
});

describe('batches', () => {
  test('a batch fills its trays, runs out the line, completes and the next one starts after the pause', () => {
    const s = sim((c) => {
      c.traySize = 8;
      c.batch.size = 5;
      c.batch.pause = 10;
    });
    const states: MachineState[] = [];
    const es = collect(s, 600, () => {
      if (states.at(-1) !== s.state.plc.machine) states.push(s.state.plc.machine);
    });
    const batches = es.filter((e): e is BatchEvent => e.kind === 'batch');
    expect(batches.map((b) => b.state).slice(0, 3)).toEqual(['started', 'completed', 'started']);
    const done = batches[1];
    // Fill to count: exactly the trays' worth of good pens, the rejects topped up by extra loads.
    expect(done.good).toBe(40);
    expect(states).toEqual(expect.arrayContaining(['Execute', 'Completing', 'Complete', 'Starting']));
    // Nothing is loaded during run-out: every pen loaded in batch 1 is finished before Complete.
    const loads = es.filter((e) => e.kind === 'processed' && e.process.endsWith('EM11'));
    const completedAt = done.logged;
    expect(loads.filter((e) => e.kind === 'processed' && e.to <= completedAt).length).toBe(done.good + done.rejected);
  }, 60_000);

  test('ending a batch early runs the line empty; auto-next off waits in Complete', () => {
    const s = sim((c) => {
      c.batch.size = 1000;
      c.batch.autoNext = false;
    });
    s.advance(90);
    expect(s.command({ type: 'endBatch' })).toBe(true);
    s.advance(1);
    expect(s.state.plc.machine).toBe('Completing');
    s.advance(240);
    expect(s.state.plc.machine).toBe('Complete');
    expect(s.state.plant.movers.every((m) => m.load === null)).toBe(true);
    const b = s.state.plc.batch!;
    expect(b.good + b.rejected).toBe(b.loaded);
    s.advance(60);
    expect(s.state.plc.machine).toBe('Complete');
    expect(s.command({ type: 'batchSize', size: 25 })).toBe(true);
    expect(s.command({ type: 'start' })).toBe(true);
    expect(s.state.plc.batch!.target).toBe(25);
    expect(s.state.plc.batch!.name).toMatch(/^\d{14}$/);
  }, 60_000);
});

/** Faults on, but none of the random ones: only what a test injects or a consumable running out. */
function onlyConsumables(c: LineConfig): void {
  c.faults.enabled = true;
  c.faults.feederJamPerPart = 0;
  c.faults.robotMtbf = 1e9;
  c.faults.misplaceRate = 0;
  c.faults.dialJamPerIndex = 0;
  c.faults.orienterMtbf = 1e9;
  c.faults.pickMiss = 0;
  c.faults.pressOverload = 0;
}

describe('sub-line faults', () => {
  test('a dial jam stops the housing dial until it is cleared, reported on EM30', () => {
    const s = sim(onlyConsumables);
    s.advance(60);
    expect(s.command({ type: 'fault', target: 'EM30-DIAL' })).toBe(true);
    const d = s.state.plant.dial;
    const repair = s.state.plant.alarms.dialJam;
    // The dial doesn't turn (EM40's robot may still take the housing already at the unload position).
    const unload = LINE.dial.positions.unload;
    const dialState = () => JSON.stringify(d.slots.map((x, i) => (i === unload ? '-' : (x?.uid ?? null)))) + d.phase + d.turn;
    const before = dialState();
    s.drainEvents();
    const es = collect(s, repair - 0.5);
    expect(dialState()).toBe(before);
    const jam = stationEvents(es).find((e) => e.code === 'dialJam')!;
    expect(jam.process).toBe(`${LINE.id}-UN02-EM30`);
    const after = collect(s, 10);
    expect(stationEvents(after).some((e) => e.code === 'dialJamCleared')).toBe(true);
    expect(dialState()).not.toBe(before);
  }, 60_000);

  test('the label roll runs out after its labels and is changed; labelling waits meanwhile', () => {
    const s = sim((c) => {
      onlyConsumables(c);
      c.faults.labelRoll = 15;
    });
    let labelsWhileOut = 0;
    const es = collect(s, 300, () => {
      if (s.state.plant.alarms.labelRoll > 0 && s.state.plant.dial.jobs.label !== null && s.state.plant.dial.jobs.label !== 'done') labelsWhileOut++;
    });
    const codes = stationEvents(es).map((e) => e.code);
    expect(codes).toContain('labelRollEmpty');
    expect(codes).toContain('labelRollChanged');
    expect(labelsWhileOut).toBe(0);
    // Labels go on 15 to a roll: the first empty comes after exactly 15 EM31 records.
    const em31 = es.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process.endsWith('EM31'));
    const empty = stationEvents(es).find((e) => e.code === 'labelRollEmpty')!;
    expect(em31.filter((e) => e.to <= empty.logged)).toHaveLength(15);
  }, 60_000);

  test('an orienter fault stops spring bases coming until it is repaired, reported on EM13', () => {
    const s = sim(onlyConsumables);
    s.advance(60);
    s.drainEvents();
    expect(s.command({ type: 'fault', target: 'EM13-ORIENTER' })).toBe(true);
    const at = s.state.epochMs + s.state.plant.t * 1000;
    const o = s.state.plant.orienter;
    s.advance(0.02);
    const before = JSON.stringify(o);
    const es = collect(s, s.state.plant.alarms.orienter - 0.5);
    expect(JSON.stringify(o)).toBe(before);
    expect(stationEvents(es).find((e) => e.code === 'orienterFault')!.process).toBe(`${LINE.id}-UN01-EM13`);
    // Nothing checked after the fault (a part finished as it came may still be recorded).
    expect(es.some((e) => e.kind === 'processed' && e.process.endsWith('EM13') && e.to > at + 20)).toBe(false);
    const after = collect(s, 15);
    expect(stationEvents(after).some((e) => e.code === 'orienterFaultCleared')).toBe(true);
    expect(after.some((e) => e.kind === 'processed' && e.process.endsWith('EM13'))).toBe(true);
  }, 60_000);

  test('EM00 drops a cartridge: it is scrapped, reported, and never recorded or merged', () => {
    const s = sim(onlyConsumables);
    s.advance(240);
    const cell = s.state.plant.cartridges;
    const used = cell.tub!.used;
    const holding = cell.robot.holding ? 1 : 0;
    s.drainEvents();
    expect(s.command({ type: 'fault', target: 'EM00-PICK' })).toBe(true);
    const es = collect(s, 30, undefined, 0.01);
    expect(cell.misses).toBe(1);
    expect(s.state.plant.scrap.EM00).toBe(1);
    expect(stationEvents(es).filter((e) => e.code === 'pickMiss')).toHaveLength(1);
    // Every pocket taken is accounted for: one dropped, the rest recorded at EM00.
    const recorded = es.filter((e) => e.kind === 'processed' && e.process.endsWith('EM00')).length;
    // (Plus the one it held already, minus one it may hold now.)
    expect(cell.tub!.used - used).toBe(recorded + 1 - holding + (cell.robot.holding ? 1 : 0));
  }, 60_000);

  test('the destacker runs empty after its trays and is refilled; EM60 waits meanwhile', () => {
    const s = sim((c) => {
      onlyConsumables(c);
      c.traySize = 4;
      c.faults.trayStack = 2;
    });
    let blocked = false;
    const es = collect(s, 500, () => {
      if (s.state.plant.alarms.destacker > 0 && s.state.plc.stations[idx('EM60')].status === 'blocked') blocked = true;
    });
    const codes = stationEvents(es).map((e) => e.code);
    expect(codes).toContain('destackerEmpty');
    expect(codes).toContain('destackerRefilled');
    expect(blocked).toBe(true);
    expect(stationEvents(es).find((e) => e.code === 'destackerEmpty')!.process).toBe(`${LINE.id}-UN03-EM60-TRAY`);
  }, 60_000);

  test('a press overload stops that press until reset and is reported as such', () => {
    const s = sim(onlyConsumables);
    s.advance(60);
    expect(s.command({ type: 'fault', target: 'EM14B-OVERLOAD' })).toBe(true);
    const robot = s.state.plant.stations[idx('EM14B')].robots[0];
    expect(robot.faultKind).toBe('overload');
    const es = collect(s, robot.fault + 2);
    const msgs = stationEvents(es).map((e) => e.message);
    expect(msgs).toContain('Press overload: operator called');
    expect(msgs).toContain('Press overload cleared');
    expect(robot.fault).toBe(0);
    expect(robot.faultKind).toBe('axis');
  }, 60_000);
});
