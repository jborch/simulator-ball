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
  test('a batch loads its target, runs out the line, completes and the next one starts after the pause', () => {
    const s = sim((c) => {
      c.batch.size = 40;
      c.batch.pause = 10;
    });
    const states: MachineState[] = [];
    const es = collect(s, 400, () => {
      if (states.at(-1) !== s.state.plc.machine) states.push(s.state.plc.machine);
    });
    const batches = es.filter((e): e is BatchEvent => e.kind === 'batch');
    expect(batches.map((b) => b.state).slice(0, 3)).toEqual(['started', 'completed', 'started']);
    const done = batches[1];
    expect(done.good + done.rejected).toBe(40);
    expect(states).toEqual(expect.arrayContaining(['Execute', 'Completing', 'Complete', 'Starting']));
    // Nothing is loaded during run-out: every pen loaded in batch 1 is finished before Complete.
    const loads = es.filter((e) => e.kind === 'processed' && e.process.endsWith('EM11'));
    const completedAt = done.logged;
    expect(loads.filter((e) => e.kind === 'processed' && e.to <= completedAt).length).toBe(40);
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
